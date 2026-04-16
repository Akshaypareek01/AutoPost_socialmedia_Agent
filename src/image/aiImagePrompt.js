/**
 * Background-only prompt for DALL-E / Imagen.
 * CRITICAL RULE: NO TEXT, NO WORDS, NO LETTERS in the image.
 * Text is composited separately by Python/PIL for pixel-perfect results.
 *
 * The prompt generates a cinematic tech visual that fills the TOP half of the
 * final post. Python then overlays a dark gradient + bold branded text on the bottom.
 */

/**
 * Strip characters that confuse image models or break prompt structure.
 */
function sanitizePromptPart(s, maxLen) {
  return String(s || '')
    .replace(/[\[\]"']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

/**
 * Builds the DALL-E background prompt.
 * Intentionally asks for NO text — all text added by PIL compositor.
 *
 * @param {string} title  - Story headline (used to infer visual subject, not rendered)
 * @param {string} topic  - Summary text for visual context
 * @returns {string}
 */
function buildUniversalTechPrompt(title, topic) {
  const safeTitle = sanitizePromptPart(title, 120) || 'technology innovation';
  const safeTopic = sanitizePromptPart(topic, 400) || 'cutting edge technology';

  return `Cinematic tech product photography for a social media post about: ${safeTitle}.

Visual subject: ${safeTopic}

Style requirements:
- Dark, moody background — near-black (#080808 to #111111)
- Dramatic rim lighting with electric blue (#1E90FF) accent highlights
- Subject fills top 60% of frame; bottom 40% fades to near-black (space for text overlay)
- Photorealistic, sharp focus, 8K quality
- Cinematic depth of field, premium magazine aesthetic
- Examples of good subjects: sleek smartphones, laptop screens, circuit boards, robot hands, glowing data visualizations, tech industry scenes

ABSOLUTE RULES — violation will ruin the post:
- NO text, NO words, NO letters, NO numbers, NO labels anywhere in the image
- NO watermarks, NO logos, NO UI overlays
- NO captions, NO titles, NO subtitles
- The bottom third must be dark enough (near-black) for white text to be readable on top

Square 1:1 aspect ratio, Instagram-ready.`;
}

module.exports = { buildUniversalTechPrompt };
