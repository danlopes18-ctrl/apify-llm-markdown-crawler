import { Actor, log } from "apify";
import { extractPageMarkdown, normalizeUrl, parseSitemapUrls } from "./extractor.js";

await Actor.init();

const input = (await Actor.getInput()) || {};
const rawStarts = Array.isArray(input.startUrls) ? input.startUrls.filter((u) => String(u || "").trim()) : [];
if (rawStarts.length === 0) {
  log.warning("No startUrls provided — exiting cleanly.");
  await Actor.exit();
}

const maxPages = Math.min(Math.max(Number(input.maxPages) || 25, 1), 500);
const discoverSitemap = Boolean(input.discoverSitemap);
const maxCharsPerPage = Math.min(Math.max(Number(input.maxCharsPerPage) || 50000, 1000), 200000);
const maxConcurrency = Math.min(Math.max(Number(input.maxConcurrency) || 6, 1), 20);
const includeRx = input.includePattern ? new RegExp(input.includePattern, "i") : null;
const excludeRx = input.excludePattern ? new RegExp(input.excludePattern, "i") : null;

const queueSet = new Set();
for (const raw of rawStarts) {
  try {
    const u = normalizeUrl(raw);
    if (/sitemap.*\.xml$/i.test(u.pathname)) {
      log.info(`Expanding sitemap: ${u.toString()}`);
      const urls = await parseSitemapUrls(u.toString(), maxPages * 2);
      for (const found of urls) queueSet.add(found);
    } else {
      queueSet.add(u.toString());
      if (discoverSitemap) {
        const smUrls = await parseSitemapUrls(`${u.origin}/sitemap.xml`, maxPages * 2).catch(() => []);
        for (const found of smUrls) queueSet.add(found);
      }
    }
  } catch (err) {
    log.warning(`Invalid start URL ${raw}: ${err?.message || err}`);
  }
}

const targets = Array.from(queueSet)
  .filter((u) => (!includeRx || includeRx.test(u)) && (!excludeRx || !excludeRx.test(u)))
  .slice(0, maxPages);

log.info(`Extracting clean LLM-ready Markdown from ${targets.length} URL(s) (concurrency=${maxConcurrency})...`);

let idx = 0;
async function worker() {
  while (idx < targets.length) {
    const cur = idx++;
    const targetUrl = targets[cur];
    try {
      const result = await extractPageMarkdown(targetUrl, { maxCharsPerPage });
      await Actor.pushData(result);
      log.info(`[${cur + 1}/${targets.length}] ${result.url} -> ${result.wordCount} words (~${result.estimatedTokens} tokens) in ${result.fetchMs}ms`);
    } catch (err) {
      log.warning(`[${cur + 1}/${targets.length}] Failed ${targetUrl}: ${err?.message || err}`);
    }
  }
}

await Promise.all(Array.from({ length: Math.min(maxConcurrency, targets.length) }, () => worker()));

log.info("LLM Markdown extraction complete.");
await Actor.exit();
