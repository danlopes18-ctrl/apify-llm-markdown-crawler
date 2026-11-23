# Fast LLM-Ready Markdown & Sitemap Crawler (RAG / MCP)

Ultra-fast, **zero-browser** HTML-to-Markdown crawler built for **RAG pipelines, Claude, Cursor, n8n, Make, and autonomous MCP agents (`mcp.apify.com`)**.

Runs on pure native Node.js 22 without heavy headless browsers — extracting clean, token-counted Markdown up to **10x faster and cheaper** than Chromium crawlers.

---

## Why Use This Crawler for AI & RAG

- **Automatic Boilerplate Stripping:** Removes `<nav>`, `<footer>`, `<aside>`, `<script>`, `<style>`, and `<svg>`, isolating `<main>` / `<article>` content cleanly.
- **Preserves Developer Structure:** Keeps `#` headings, fenced code blocks (with language tags), inline code, lists, and resolved absolute links.
- **Native Sitemap Discovery:** Pass any `sitemap.xml` (including nested `<sitemapindex>` files) or enable `discoverSitemap` to crawl docs & blogs automatically up to `maxPages`.
- **Regex Filtering:** Use `includePattern` (e.g. `/docs/|/guides/`) and `excludePattern` (e.g. `/login|/pricing`) to extract only high-signal pages.
- **Built-in Token Estimation:** Every dataset item includes `wordCount`, `estimatedTokens`, `headings`, `fetchMs`, and clean `markdown` capped cleanly via `maxCharsPerPage`.
- **Hardened Security:** DNS-verified SSRF protection blocks private networks and cloud metadata endpoints automatically.

---

## Ideal Use Cases

1. **Knowledge Base & Docs Ingestion for RAG / Vector DBs** (Pinecone, Qdrant, Supabase `pgvector`).
2. **n8n / Make AI Workflows:** Feed clean Markdown straight into OpenAI, Claude, or Gemini nodes without wasting 70% of your context window on HTML tags.
3. **MCP Tool Call (`mcp.apify.com`):** Let Claude or Cursor read any documentation page or `/llms.txt` cleanly in <500ms.

---

## Example Input

```json
{
  "startUrls": [
    "https://danlopes18-ctrl.github.io/",
    "https://danlopes18-ctrl.github.io/sitemap.xml"
  ],
  "maxPages": 25,
  "includePattern": "",
  "excludePattern": "/login|/cart",
  "maxCharsPerPage": 50000
}
```
