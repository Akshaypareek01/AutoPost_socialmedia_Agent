/**
 * Fact Extractor
 * Uses AI to pull 3 punchy, standalone facts from a story.
 * Each fact becomes one slide in the Instagram carousel.
 */

const logger = require('../utils/logger');

/**
 * Extract 3 key facts from a story for carousel slides.
 * @param {Object} story
 * @param {Function} aiCall - callClaude or callGemini
 * @returns {Array<{headline: string, body: string, year: string|null}>}
 */
async function extractFacts(story, aiCall) {
  const prompt = `You are writing content for an Instagram tech carousel post (like "technology" page style).

Story: ${story.title}
${story.summary ? `Summary: ${story.summary}` : ''}
${story.url ? `Source: ${story.url}` : ''}

Extract exactly 3 standalone facts or insights from this story. Each fact becomes one slide.

Return ONLY valid JSON array, no other text:
[
  {
    "headline": "THE KEY INSIGHT",
    "body": "One punchy sentence explaining it. Max 20 words. All caps. Bold and factual.",
    "year": "2025" or null
  },
  ...3 items total
]

Rules:
- headline: 2-4 words MAX, all caps, dramatic (e.g. "THE SPEED JUMP", "ZERO HUMAN WORKERS", "10X FASTER")
- body: 1 sentence, factual, under 20 words
- year: only if a specific year is relevant, else null
- Make facts surprising, specific, and shareable`;

  try {
    const raw = await aiCall(prompt, { maxTokens: 400, temperature: 0.7 });
    // Extract JSON from response (AI sometimes adds extra text)
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No JSON array in response');
    const facts = JSON.parse(jsonMatch[0]);

    if (!Array.isArray(facts) || facts.length === 0) throw new Error('Empty facts array');

    // Validate + sanitize each fact
    return facts.slice(0, 3).map((f, i) => ({
      headline: String(f.headline || `FACT ${i + 1}`).toUpperCase().slice(0, 40),
      body: String(f.body || '').slice(0, 120),
      year: f.year ? String(f.year).slice(0, 20) : null,
    }));
  } catch (err) {
    logger.warn(`[Facts] AI extraction failed (${err.message}) — using fallback facts`);
    return buildFallbackFacts(story);
  }
}

/**
 * Fallback facts when AI is unavailable.
 */
function buildFallbackFacts(story) {
  const title = story.title || 'This story';
  return [
    {
      headline: 'THE STORY',
      body: title.slice(0, 100).toUpperCase(),
      year: null,
    },
    {
      headline: 'WHY IT MATTERS',
      body: 'THIS IS A MAJOR DEVELOPMENT FOR ANYONE IN TECH.',
      year: null,
    },
    {
      headline: 'WHAT\'S NEXT',
      body: 'THE INDUSTRY IS WATCHING THIS CLOSELY. MORE CHANGES ARE COMING.',
      year: null,
    },
  ];
}

module.exports = { extractFacts };
