/**
 * Fetcher Orchestrator
 * Pulls stories from HN, RSS, Google News RSS; optionally ranks top picks with Claude.
 */

require('dotenv').config();
const { fetchTopStories } = require('./hn');
const { fetchRSSStories } = require('./rss');
const { fetchGoogleNewsStories, pickTrendingStoriesWithClaude } = require('./claudeTrends');
const { filterByHistory } = require('../utils/history');
const logger = require('../utils/logger');

const FETCH_LIMIT = parseInt(process.env.FETCH_LIMIT, 10) || 10;

/**
 * Main fetch function — pulls from all sources, deduplicates, ranks, returns top picks.
 * @returns {Promise<Array<Object>>} Ranked array of story objects
 */
async function fetchAllStories() {
  logger.info('=== Fetcher: Starting story collection ===');

  const [hnStories, rssStories, gNewsStories] = await Promise.allSettled([
    fetchTopStories(20),
    fetchRSSStories(15),
    fetchGoogleNewsStories(15),
  ]);

  const all = [
    ...(hnStories.status === 'fulfilled' ? hnStories.value : []),
    ...(rssStories.status === 'fulfilled' ? rssStories.value : []),
    ...(gNewsStories.status === 'fulfilled' ? gNewsStories.value : []),
  ];

  if (hnStories.status === 'rejected') logger.error('HN fetch failed:', hnStories.reason);
  if (rssStories.status === 'rejected') logger.error('RSS fetch failed:', rssStories.reason);
  if (gNewsStories.status === 'rejected') {
    logger.warn('Google News fetch failed:', gNewsStories.reason?.message || gNewsStories.reason);
  }

  // Deduplicate by URL (same session)
  const seen = new Set();
  const unique = all.filter((s) => {
    const key = normalizeUrl(s.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Filter out recently posted topics using SQLite history
  const fresh = filterByHistory(unique);

  const useClaudeTrend =
    !!process.env.ANTHROPIC_API_KEY && String(process.env.CLAUDE_TREND_PICK || 'true').toLowerCase() !== 'false';

  let ranked;
  if (useClaudeTrend && fresh.length > 0) {
    try {
      ranked = await pickTrendingStoriesWithClaude(fresh, FETCH_LIMIT);
      logger.info(
        `[Fetcher] Claude curated ${ranked.length} of ${FETCH_LIMIT} stories from ${unique.length} web candidates`
      );
    } catch (err) {
      logger.warn(`[Fetcher] Claude trend curation failed (${err.message}) — using score sort`);
      ranked = null;
    }
  }

  if (!ranked || ranked.length === 0) {
    ranked = fresh
      .map((s) => ({
        ...s,
        _priority: computePriority(s) * (1 - (s._historyPenalty || 0)),
      }))
      .sort((a, b) => b._priority - a._priority)
      .slice(0, FETCH_LIMIT);
  } else {
    ranked = ranked.map((s) => ({ ...s, _priority: computePriority(s) }));
  }

  logger.info(`=== Fetcher: ${all.length} raw → ${unique.length} deduped → ${fresh.length} fresh → ${ranked.length} selected ===`);
  return ranked;
}

/**
 * Heuristic priority when Claude is off or as secondary signal.
 * @param {Object} story
 * @returns {number}
 */
function computePriority(story) {
  let score = 0;
  score += Math.min(story.score || 0, 1000) * 0.5;
  score += Math.min(story.comments || 0, 500) * 0.3;
  const ageHours = (Date.now() - new Date(story.publishedAt).getTime()) / 3600000;
  if (ageHours < 6) score += 200;
  else if (ageHours < 12) score += 100;
  else if (ageHours < 24) score += 50;
  const sourceWeights = { hackernews: 1.2, rss: 0.9, googlenews: 1.05 };
  score *= sourceWeights[story.source] || 1.0;
  return score;
}

/**
 * Normalize URL for deduplication.
 * @param {string} url
 * @returns {string}
 */
function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`.toLowerCase().replace(/\/$/, '');
  } catch {
    return String(url).toLowerCase();
  }
}

module.exports = { fetchAllStories };

if (require.main === module) {
  fetchAllStories()
    .then((stories) => {
      console.log('\n=== TOP STORIES ===');
      stories.forEach((s, i) => {
        console.log(`\n${i + 1}. [${s.source}] ${s.title}`);
        console.log(`   Score: ${s.score} | Comments: ${s.comments} | Priority: ${s._priority.toFixed(0)}`);
        console.log(`   ${s.url}`);
      });
    })
    .catch(console.error);
}
