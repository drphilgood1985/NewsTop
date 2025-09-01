import Parser from 'rss-parser';
import { log } from './util.js';

const parser = new Parser({ timeout: 15000 });

export async function fetchHeadlines(feeds) {
  const results = await Promise.allSettled(
    feeds.map(async (url) => {
      try {
        const feed = await parser.parseURL(url);
        const items = Array.isArray(feed.items) ? feed.items : [];
        // prefer title; fallback to contentSnippet
        return items.map((it) => it.title || it.contentSnippet || '').filter(Boolean);
      } catch (err) {
        log('RSS error:', url, err?.message || err);
        return [];
      }
    })
  );

  const headlines = results.flatMap((res) => (res.status === 'fulfilled' ? res.value : []));
  // Deduplicate while preserving order
  const seen = new Set();
  const unique = [];
  for (const h of headlines) {
    const k = h.trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    unique.push(k);
  }
  return unique.slice(0, 100);
}

