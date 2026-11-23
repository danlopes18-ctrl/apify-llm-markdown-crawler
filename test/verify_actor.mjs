import assert from "node:assert/strict";
import { extractPageMarkdown, isPrivateIp, parseSitemapUrls } from "../src/extractor.js";

console.log("=== QA: Fast LLM-Ready Markdown & Sitemap Crawler ===");

// 1. SSRF Shield check
assert.equal(isPrivateIp("127.0.0.1"), true);
assert.equal(isPrivateIp("169.254.169.254"), true);
let blocked = false;
try { await extractPageMarkdown("http://127.0.0.1:8080/secret"); } catch (e) { blocked = String(e.message).includes("SSRF blocked"); }
assert.equal(blocked, true, "must block localhost");
console.log("PASS 1/3: SSRF Shield verified");

// 2. Sitemap expansion on live site
const urls = await parseSitemapUrls("https://danlopes18-ctrl.github.io/sitemap.xml");
assert.ok(urls.length >= 1, "sitemap parsed");
console.log("PASS 2/3: Sitemap parsed ->", urls);

// 3. Live HTML -> Markdown + token count check
const res = await extractPageMarkdown("https://danlopes18-ctrl.github.io/");
assert.equal(res.statusCode, 200);
assert.ok(res.wordCount >= 150, `expected >= 150 words, got ${res.wordCount}`);
assert.ok(res.estimatedTokens >= 200, "token estimate computed");
assert.ok(res.markdown.includes("# "), "markdown headings preserved");
assert.ok(!res.markdown.includes("<script"), "scripts stripped");
console.log(`PASS 3/3: Extracted ${res.wordCount} words (~${res.estimatedTokens} tokens, ${res.headingsCount} headings) in ${res.fetchMs}ms`);

// Bonus: llms.txt plain text extraction
const llms = await extractPageMarkdown("https://danlopes18-ctrl.github.io/llms.txt");
assert.equal(llms.statusCode, 200);
assert.ok(llms.markdown.includes("Daniel Lopes"), "llms.txt extracted");
console.log(`PASS BONUS: llms.txt extracted (${llms.estimatedTokens} tokens)`);
console.log("\nALL LIVE QA SUITES PASSED!");
