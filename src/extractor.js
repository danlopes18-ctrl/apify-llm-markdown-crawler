import dns from "node:dns/promises";
import net from "node:net";

const USER_AGENT = "LLMMarkdownCrawler/1.0 (+https://apify.com; respectful-rag-crawler)";
const MAX_BODY_BYTES = 2_000_000;

export function isPrivateIp(ip) {
  if (!ip) return true;
  const clean = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (net.isIPv4(clean)) {
    const [a, b] = clean.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  if (net.isIPv6(clean)) {
    const l = clean.toLowerCase();
    return l === "::1" || l === "::" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80") || l.startsWith("ff");
  }
  return true;
}

export function normalizeUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) throw new Error("Empty URL");
  const withProto = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  const u = new URL(withProto);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(`Unsupported protocol: ${u.protocol}`);
  return u;
}

export async function assertSafeHost(hostname) {
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".local") || lower.endsWith(".internal")) {
    throw new Error(`SSRF blocked host: ${hostname}`);
  }
  if (net.isIP(lower)) {
    if (isPrivateIp(lower)) throw new Error(`SSRF blocked IP: ${lower}`);
    return;
  }
  const recs = await dns.lookup(lower, { all: true });
  if (!recs || !recs.length) throw new Error(`DNS failed: ${hostname}`);
  for (const r of recs) {
    if (isPrivateIp(r.address)) throw new Error(`SSRF blocked private IP ${r.address} for ${hostname}`);
  }
}

async function safeFetch(urlStr, timeoutMs = 12000) {
  const u = normalizeUrl(urlStr);
  await assertSafeHost(u.hostname);
  const t0 = performance.now();
  const res = await fetch(u.toString(), {
    method: "GET",
    redirect: "follow",
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9"
    },
    signal: AbortSignal.timeout(timeoutMs)
  });
  const fetchMs = Math.round(performance.now() - t0);
  const finalUrl = new URL(res.url || u.toString());
  if (finalUrl.hostname !== u.hostname) await assertSafeHost(finalUrl.hostname);

  const reader = res.body?.getReader();
  const chunks = [];
  let total = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total <= MAX_BODY_BYTES) chunks.push(value);
      else {
        chunks.push(value.subarray(0, Math.max(0, MAX_BODY_BYTES - (total - value.byteLength))));
        await reader.cancel().catch(() => {});
        break;
      }
    }
  }
  const body = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  return { status: res.status, finalUrl: finalUrl.toString(), contentType, body, fetchMs };
}

function decodeEntities(str) {
  return String(str || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

export function htmlToMarkdown(rawHtml, baseUrl) {
  let html = String(rawHtml || "");
  // Prefer <main> or <article> when present and substantial
  const mainMatch = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i) || html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  if (mainMatch && mainMatch[1].replace(/<[^>]+>/g, "").trim().length > 200) {
    html = mainMatch[1];
  } else {
    const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) html = bodyMatch[1];
  }

  // Strip non-content boilerplate
  html = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg|iframe|canvas|template|nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, "\n");

  // Preserve fenced code blocks
  const codeBlocks = [];
  html = html.replace(/<pre\b[^>]*>\s*(?:<code\b[^>]*class=["'][^"']*language-([a-z0-9_-]+)[^"']*["'][^>]*>|<code\b[^>]*>)?([\s\S]*?)(?:<\/code>)?\s*<\/pre>/gi, (_, lang, inner) => {
    const clean = decodeEntities(inner.replace(/<[^>]+>/g, "")).trim();
    const idx = codeBlocks.length;
    codeBlocks.push(`\n\`\`\`${lang || ""}\n${clean}\n\`\`\`\n`);
    return `%%CODE_BLOCK_${idx}%%`;
  });

  // Inline code
  html = html.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, c) => `\`${decodeEntities(c.replace(/<[^>]+>/g, "")).trim()}\``);

  // Headings
  const headings = [];
  html = html.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, lvl, inner) => {
    const txt = decodeEntities(inner.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (txt) headings.push({ level: Number(lvl), text: txt });
    return txt ? `\n\n${"#".repeat(Number(lvl))} ${txt}\n\n` : "\n";
  });

  // Links
  html = html.replace(/<a\b[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, inner) => {
    const txt = decodeEntities(inner.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (!txt) return "";
    let abs = href.trim();
    try { abs = new URL(abs, baseUrl).toString(); } catch (_) {}
    if (/^javascript:/i.test(abs)) return txt;
    return `[${txt}](${abs})`;
  });

  // Lists & paragraphs & line breaks
  html = html
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, inner) => `\n- ${inner.replace(/\s+/g, " ").trim()}`)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|tr|blockquote|ul|ol|header|table)>/gi, "\n\n")
    .replace(/<(td|th)\b[^>]*>/gi, " | ")
    .replace(/<strong\b[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**")
    .replace(/<b\b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**")
    .replace(/<em\b[^>]*>([\s\S]*?)<\/em>/gi, "*$1*");

  // Strip remaining tags & normalize whitespace
  let md = decodeEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Restore fenced code blocks
  md = md.replace(/%%CODE_BLOCK_(\d+)%%/g, (_, i) => codeBlocks[Number(i)] || "");
  return { markdown: md, headings };
}

export async function parseSitemapUrls(sitemapUrl, maxUrls = 500, timeoutMs = 12000) {
  const res = await safeFetch(sitemapUrl, timeoutMs);
  if (res.status !== 200) return [];
  const locs = Array.from(res.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)).map((m) => decodeEntities(m[1].trim()));

  // If it's a sitemapindex, expand up to 5 child sitemaps
  if (/<sitemapindex/i.test(res.body)) {
    const expanded = [];
    for (const childUrl of locs.slice(0, 5)) {
      if (expanded.length >= maxUrls) break;
      try {
        const sub = await safeFetch(childUrl, timeoutMs);
        if (sub.status === 200) {
          for (const m of sub.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
            expanded.push(decodeEntities(m[1].trim()));
            if (expanded.length >= maxUrls) break;
          }
        }
      } catch (_) {}
    }
    return Array.from(new Set(expanded)).slice(0, maxUrls);
  }
  return Array.from(new Set(locs)).slice(0, maxUrls);
}

export async function extractPageMarkdown(rawUrl, options = {}) {
  const { maxCharsPerPage = 50000, timeoutMs = 12000 } = options;
  const page = await safeFetch(rawUrl, timeoutMs);

  // Plain text / markdown files (e.g., llms.txt)
  if (page.contentType.includes("text/plain") || page.contentType.includes("text/markdown")) {
    const md = page.body.trim().slice(0, maxCharsPerPage);
    const words = md ? md.split(/\s+/).length : 0;
    return {
      url: page.finalUrl,
      statusCode: page.status,
      contentType: page.contentType,
      title: new URL(page.finalUrl).pathname.split("/").pop() || page.finalUrl,
      description: md.slice(0, 180),
      headings: [],
      headingsCount: 0,
      wordCount: words,
      estimatedTokens: Math.ceil(md.length / 4),
      truncated: page.body.length > maxCharsPerPage,
      fetchMs: page.fetchMs,
      markdown: md,
      extractedAt: new Date().toISOString()
    };
  }

  const title = decodeEntities((page.body.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "").replace(/\s+/g, " ").trim();
  const description = decodeEntities(
    (page.body.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ||
     page.body.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i) || [])[1] || ""
  ).trim();

  const { markdown: fullMd, headings } = htmlToMarkdown(page.body, page.finalUrl);
  const truncated = fullMd.length > maxCharsPerPage;
  const markdown = truncated ? fullMd.slice(0, maxCharsPerPage) : fullMd;
  const wordCount = markdown ? markdown.split(/\s+/).length : 0;

  return {
    url: page.finalUrl,
    statusCode: page.status,
    contentType: page.contentType,
    title,
    description,
    headings: headings.slice(0, 40),
    headingsCount: headings.length,
    wordCount,
    estimatedTokens: Math.ceil(markdown.length / 4),
    truncated,
    fetchMs: page.fetchMs,
    markdown,
    extractedAt: new Date().toISOString()
  };
}
