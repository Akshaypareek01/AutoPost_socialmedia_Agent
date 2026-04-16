/**
 * Hacker News Fetcher
 * Uses the official Firebase API — no auth needed, completely free.
 */

const axios = require('axios');
const logger = require('../utils/logger');
const { withRetry } = require('../utils/retry');

const HN_BASE = 'https://hacker-news.firebaseio.com/v0';
const MIN_SCORE = parseInt(process.env.HN_MIN_SCORE) || 100;

async function fetchTopStories(limit = 10) {
  logger.info(`[HN] Fetching top ${limit} stories (min score: ${MIN_SCORE})`);

  const topIds = await withRetry(
    () => axios.get(`${HN_BASE}/topstories.json`).then((r) => r.data.slice(0, 100)),
    { label: 'HN topstories' }
  );

  const stories = [];
  for (const id of topIds) {
    if (stories.length >= limit) break;

    try {
      const item = await withRetry(
        () => axios.get(`${HN_BASE}/item/${id}.json`).then((r) => r.data),
        { label: `HN item ${id}` }
      );

      if (!item || item.type !== 'story' || !item.url) continue;
      if (item.score < MIN_SCORE) continue;
      if (!isTechRelated(item.title)) continue;

      stories.push({
        id: `hn_${item.id}`,
        source: 'hackernews',
        title: item.title,
        url: item.url,
        score: item.score,
        comments: item.descendants || 0,
        author: item.by,
        publishedAt: new Date(item.time * 1000).toISOString(),
        hnUrl: `https://news.ycombinator.com/item?id=${item.id}`,
        summary: null, // populated by generator
      });
    } catch (err) {
      logger.warn(`[HN] Skipped item ${id}: ${err.message}`);
    }
  }

  logger.info(`[HN] Got ${stories.length} qualifying stories`);
  return stories;
}

function isTechRelated(title) {
  const techKeywords = [
    'ai', 'ml', 'llm', 'gpt', 'software', 'api', 'open source', 'github',
    'startup', 'launch', 'cloud', 'security', 'hack', 'data', 'model',
    'python', 'javascript', 'rust', 'react', 'linux', 'kubernetes', 'docker',
    'database', 'neural', 'chip', 'gpu', 'cpu', 'apple', 'google', 'microsoft',
    'amazon', 'meta', 'openai', 'anthropic', 'developer', 'programming',
    'framework', 'library', 'release', 'update', 'bug', 'vulnerability',
    'blockchain', 'crypto', 'web3', 'quantum', 'autonomous', 'robot',
  ];
  const lower = title.toLowerCase();
  return techKeywords.some((kw) => lower.includes(kw));
}

module.exports = { fetchTopStories };
