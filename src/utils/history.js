/**
 * Post History — JSON file-based tracker (no native deps, zero setup)
 *
 * Prevents same or very similar topics from being posted repeatedly.
 * Rules:
 *  - Exact URL: blocked for 30 days
 *  - Topic keyword overlap >60%: blocked for 7 days
 *  - Topic keyword overlap >40%: penalised (lower priority) for 3 days
 *
 * File location: queue/history.json (persists on your machine)
 */

const fs   = require('fs');
const path = require('path');
const logger = require('./logger');

const HISTORY_FILE = path.join(__dirname, '../../queue/history.json');

// ── Internal helpers ──────────────────────────────────────────────────────

function readHistory() {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch { return []; }
}

function writeHistory(records) {
  try {
    fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(records, null, 2));
  } catch (err) {
    logger.warn(`[History] Write failed: ${err.message}`);
  }
}

const STOP_WORDS = new Set([
  'a','an','the','is','are','was','were','be','been','being',
  'have','has','had','do','does','did','will','would','could','should',
  'may','might','must','shall','to','of','in','on','at','for','with',
  'by','from','up','about','into','through','and','or','but','if',
  'that','this','these','those','it','its','he','she','they','we',
  'how','why','what','when','where','who','which','new','says','said',
]);

function extractKeywords(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w))
    .slice(0, 30);
}

// Jaccard similarity 0–1
function jaccardSimilarity(kwA, kwB) {
  if (!kwA.length || !kwB.length) return 0;
  const setA = new Set(kwA);
  const setB = new Set(kwB);
  const intersection = [...setA].filter(k => setB.has(k)).length;
  const union = new Set([...setA, ...setB]).size;
  return intersection / union;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Record a story as posted. Call this after successful publish.
 */
function recordPosted(story, platform = 'instagram') {
  const records = readHistory();
  const keywords = extractKeywords(`${story.title} ${story.summary || ''}`);
  records.push({
    storyId:  story.id || `story_${Date.now()}`,
    url:      story.url || '',
    title:    story.title || '',
    keywords,
    source:   story.source || '',
    platform,
    postedAt: new Date().toISOString(),
  });
  writeHistory(records);
  logger.info(`[History] Recorded: "${story.title?.slice(0, 60)}"`);
}

/**
 * Filter stories by history. Blocks exact URL dupes and topic-similar posts.
 * Adds `_historyPenalty` (0–1) to remaining stories.
 */
function filterByHistory(stories) {
  const records = readHistory();
  const now = Date.now();

  const recent7d  = records.filter(r => now - new Date(r.postedAt) < 7  * 86400000);
  const recent30d = records.filter(r => now - new Date(r.postedAt) < 30 * 86400000);

  const blockedUrls = new Set(recent30d.map(r => r.url));

  const result = [];
  for (const story of stories) {
    // Hard block: exact URL in last 30 days
    if (story.url && blockedUrls.has(story.url)) {
      logger.debug(`[History] Blocked URL dupe: "${story.title?.slice(0, 50)}"`);
      continue;
    }

    // Keyword similarity against last 7 days
    const storyKw = extractKeywords(`${story.title} ${story.summary || ''}`);
    let maxSim = 0;
    for (const r of recent7d) {
      const sim = jaccardSimilarity(storyKw, r.keywords || []);
      if (sim > maxSim) maxSim = sim;
    }

    if (maxSim >= 0.6) {
      logger.debug(`[History] Blocked ${(maxSim*100).toFixed(0)}% similar: "${story.title?.slice(0, 50)}"`);
      continue;
    }

    const penalty = maxSim >= 0.4 ? maxSim : 0;
    result.push({ ...story, _historyPenalty: penalty });
  }

  logger.info(`[History] ${stories.length} in → ${result.length} fresh (${stories.length - result.length} blocked as dupes/similar)`);
  return result;
}

/**
 * Get recent history for display.
 */
function getRecentHistory(limit = 10) {
  return readHistory()
    .sort((a, b) => new Date(b.postedAt) - new Date(a.postedAt))
    .slice(0, limit);
}

/**
 * Remove records older than N days.
 */
function pruneHistory(days = 60) {
  const records = readHistory();
  const cutoff = Date.now() - days * 86400000;
  const fresh = records.filter(r => new Date(r.postedAt) > cutoff);
  writeHistory(fresh);
  if (records.length !== fresh.length) {
    logger.info(`[History] Pruned ${records.length - fresh.length} old records`);
  }
}

module.exports = { recordPosted, filterByHistory, getRecentHistory, pruneHistory, extractKeywords };
