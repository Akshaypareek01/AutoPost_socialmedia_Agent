/**
 * RSS Feed Fetcher
 * Pulls from high-quality tech RSS feeds — no API key needed.
 */

const Parser = require('rss-parser');
const logger = require('../utils/logger');

const parser = new Parser({
  timeout: 10000,
  headers: { 'User-Agent': 'TechPageAuto/1.0' },
});

const FEEDS = [
  // ── Core Tech ─────────────────────────────────────────────
  { name: 'TechCrunch',      url: 'https://techcrunch.com/feed/' },
  { name: 'The Verge',       url: 'https://www.theverge.com/rss/index.xml' },
  { name: 'Ars Technica',    url: 'https://feeds.arstechnica.com/arstechnica/technology-lab' },
  { name: 'Wired',           url: 'https://www.wired.com/feed/rss' },
  { name: 'MIT Tech Review', url: 'https://www.technologyreview.com/feed/' },
  { name: 'VentureBeat',     url: 'https://venturebeat.com/feed/' },
  { name: 'Hacker News Best',url: 'https://hnrss.org/best' },
  { name: 'CNET',            url: 'https://www.cnet.com/rss/news/' },
  { name: 'Engadget',        url: 'https://www.engadget.com/rss.xml' },
  // ── AI / Science ──────────────────────────────────────────
  { name: 'OpenAI Blog',     url: 'https://openai.com/blog/rss.xml' },
  { name: 'Google AI Blog',  url: 'https://blog.google/technology/ai/rss/' },
  { name: 'New Scientist',   url: 'https://www.newscientist.com/feed/home/' },
  { name: 'Science Daily',   url: 'https://www.sciencedaily.com/rss/top/technology.xml' },
  // ── Gaming ────────────────────────────────────────────────
  { name: 'IGN',             url: 'https://feeds.feedburner.com/ign/games-all' },
  { name: 'Polygon',         url: 'https://www.polygon.com/rss/index.xml' },
  { name: 'Eurogamer',       url: 'https://www.eurogamer.net/?format=rss' },
  { name: 'PC Gamer',        url: 'https://www.pcgamer.com/rss/' },
  // ── Startups / Business ───────────────────────────────────
  { name: 'Product Hunt',    url: 'https://www.producthunt.com/feed' },
  { name: 'Inc',             url: 'https://www.inc.com/rss' },
];

async function fetchRSSStories(limit = 5) {
  logger.info(`[RSS] Fetching from ${FEEDS.length} feeds`);

  const stories = [];
  const seen = new Set();

  for (const feed of FEEDS) {
    try {
      const result = await parser.parseURL(feed.url);
      const items = (result.items || []).slice(0, 3);

      for (const item of items) {
        if (!item.link || seen.has(item.link)) continue;
        seen.add(item.link);

        stories.push({
          id: `rss_${Buffer.from(item.link).toString('base64').slice(0, 16)}`,
          source: 'rss',
          feedName: feed.name,
          title: item.title || '',
          url: item.link,
          summary: stripHtml(item.contentSnippet || item.content || '').slice(0, 500),
          publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
          score: 0,
          comments: 0,
        });
      }
    } catch (err) {
      logger.warn(`[RSS] Failed ${feed.name}: ${err.message}`);
    }
  }

  // Prefer recent items
  stories.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  const top = stories.slice(0, limit);
  logger.info(`[RSS] Got ${top.length} stories`);
  return top;
}

function stripHtml(html) {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

module.exports = { fetchRSSStories };
