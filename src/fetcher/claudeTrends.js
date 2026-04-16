/**
 * Web trend candidates (Google News RSS) + Claude curation over real URLs only.
 * Claude does not browse; it ranks items we already fetched from the open web.
 */

const crypto = require('crypto');
const Parser = require('rss-parser');
const { callClaude } = require('../generator/claude');
const logger = require('../utils/logger');

const parser = new Parser({
  timeout: 15000,
  headers: { 'User-Agent': 'TechPageAuto/1.0 (tech digest; contact via repo)' },
});

const DEFAULT_GOOGLE_NEWS_RSS =
  'https://news.google.com/rss/search?q=technology+artificial+intelligence+startups&hl=en-US&gl=US&ceid=US:en';

/**
 * Strip basic HTML tags from a string.
 * @param {string} html
 * @returns {string}
 */
function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fallback priority when Claude output is short or invalid.
 * @param {Object} story
 * @returns {number}
 */
function scoreFallback(story) {
  let score = Math.min(story.score || 0, 1000) * 0.5 + Math.min(story.comments || 0, 500) * 0.3;
  const t = new Date(story.publishedAt || Date.now()).getTime();
  const ageHours = (Date.now() - t) / 3600000;
  if (ageHours < 6) score += 200;
  else if (ageHours < 12) score += 100;
  else if (ageHours < 24) score += 50;
  const w = { hackernews: 1.2, rss: 0.9, googlenews: 1.05 };
  score *= w[story.source] || 1;
  return score;
}

/**
 * Fetch Google News (or custom) RSS as normalized story rows.
 * @param {number} limit
 * @returns {Promise<Array<Object>>}
 */
async function fetchGoogleNewsStories(limit = 15) {
  const url = (process.env.GOOGLE_NEWS_RSS_URL || '').trim() || DEFAULT_GOOGLE_NEWS_RSS;
  logger.info('[GoogleNews] Fetching RSS headlines');

  const result = await parser.parseURL(url);
  const stories = [];
  const items = (result.items || []).slice(0, Math.max(limit, 5));

  for (const item of items) {
    if (!item.link) continue;
    const id = `gnews_${crypto.createHash('sha1').update(item.link).digest('hex').slice(0, 14)}`;
    stories.push({
      id,
      source: 'googlenews',
      title: item.title || '',
      url: item.link,
      summary: stripHtml(item.contentSnippet || item.content || '').slice(0, 500),
      publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
      score: 0,
      comments: 0,
    });
    if (stories.length >= limit) break;
  }

  logger.info(`[GoogleNews] Got ${stories.length} stories`);
  return stories;
}

/**
 * Compact candidate list for the model context window.
 * @param {Array<Object>} candidates
 * @returns {Array<Object>}
 */
function compactForClaude(candidates) {
  return candidates.slice(0, 48).map((c) => ({
    id: c.id,
    title: String(c.title || '').slice(0, 160),
    url: String(c.url || '').slice(0, 240),
    source: c.source,
    snippet: String(c.summary || '').slice(0, 220),
    publishedAt: String(c.publishedAt || '').slice(0, 32),
  }));
}

/**
 * Parse JSON array of id strings from Claude output.
 * @param {string} text
 * @returns {string[]}
 */
function parseIdArrayFromClaude(text) {
  let body = String(text || '').trim();
  body = body.replace(/^```[\w]*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  try {
    const arr = JSON.parse(body);
    if (Array.isArray(arr)) return arr.filter((x) => typeof x === 'string');
  } catch (_) {
    /* try bracket slice */
  }
  const m = body.match(/\[[\s\S]*\]/);
  if (m) {
    try {
      const arr = JSON.parse(m[0]);
      if (Array.isArray(arr)) return arr.filter((x) => typeof x === 'string');
    } catch (_) {
      /* ignore */
    }
  }
  return [];
}

/**
 * Ask Claude to pick the top `limit` trending items by id (must exist in candidates).
 * @param {Array<Object>} candidates
 * @param {number} limit
 * @returns {Promise<Array<Object>>}
 */
async function pickTrendingStoriesWithClaude(candidates, limit) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not set');
  }
  if (!candidates.length) return [];

  const take = Math.min(limit, candidates.length);
  const compact = compactForClaude(candidates);
  const payload = JSON.stringify(compact);

  const prompt = `You are a senior tech editor curating for a technical Instagram audience.

You will receive a JSON array of REAL stories already collected from the open web (Hacker News, tech publication RSS, Google News). Each entry has a unique string field "id".

Rules:
1. Pick exactly ${take} items that are the most timely, consequential, and engaging for tech professionals RIGHT NOW.
2. Favor: major product or model launches, AI/ML breakthroughs or policy, security incidents, platform shifts, hardware, and engineering-relevant news. Deprioritize generic listicles and pure celebrity gossip unless tightly tech-relevant.
3. Output ONLY a JSON array of strings: each string must be exactly one "id" from the input, best-first. No markdown fences, no commentary, no invented ids.

INPUT:
${payload}`;

  const raw = await callClaude(prompt, { maxTokens: 900, temperature: 0.25 });
  const ids = parseIdArrayFromClaude(raw);
  const map = new Map(candidates.map((c) => [c.id, c]));
  const out = [];

  for (const id of ids) {
    const row = map.get(id);
    if (row && !out.some((o) => o.id === row.id)) out.push(row);
    if (out.length >= limit) break;
  }

  const used = new Set(out.map((o) => o.id));
  const rest = candidates.filter((c) => !used.has(c.id)).sort((a, b) => scoreFallback(b) - scoreFallback(a));
  for (const c of rest) {
    if (out.length >= limit) break;
    out.push(c);
  }

  return out.slice(0, limit);
}

module.exports = { fetchGoogleNewsStories, pickTrendingStoriesWithClaude };
