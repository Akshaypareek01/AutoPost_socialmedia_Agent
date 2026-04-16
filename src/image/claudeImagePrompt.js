/**
 * Drafts a DALL-E 3 image prompt via Claude (Anthropic).
 * Claude handles story context and layout; OpenAI renders the pixels.
 */

const { callClaude } = require('../generator/claude');
const logger = require('../utils/logger');

const MAX_OUT_CHARS = 3400;

/**
 * Strips markdown fences and wrapping quotes from model output.
 * @param {string} raw
 * @returns {string}
 */
function sanitizeClaudePromptOutput(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/^```[\w]*\n?/i, '').replace(/\n?```\s*$/i, '');
  s = s.replace(/^\s*["'`]+/, '').replace(/["'`]+\s*$/, '');
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Builds a Claude user message that asks for a single DALL-E–ready prompt.
 * @param {{ verbatimHeadline: string, contextText: string }} params
 * @returns {string}
 */
function buildClaudeUserMessage({ verbatimHeadline, contextText }) {
  const safeHeadline = JSON.stringify(verbatimHeadline);
  const ctx = String(contextText || '').replace(/\s+/g, ' ').trim().slice(0, 2200);

  return `You are a senior art director. Produce ONE continuous image-generation prompt for OpenAI DALL-E 3 (square 1024x1024, photoreal / 3D infographic quality).

OUTPUT RULES — CRITICAL:
- Output ONLY the final prompt text. No title line, no bullet list, no "Here is", no markdown, no code fences, no quotation marks around the whole prompt.
- Entire output must be plain English DALL-E instructions under ${MAX_OUT_CHARS} characters.

LAYOUT — MANDATORY (split composition):
- Strict 50/50 VERTICAL split (left half | right half). A crisp clean vertical seam at the horizontal center; no diagonal split.
- LEFT HALF: rich visual storytelling — cinematic 3D icons, metaphors, subtle glow, electric blue (#007AFF) accents on deep charcoal; no paragraphs of tiny illegible text; no fake UI screenshots.
- RIGHT HALF: flat near-black panel (#0a0a12). ONLY typography: ONE dominant headline in very large, heavy geometric sans-serif (Helvetica / SF Pro style), high contrast (white or #007AFF on dark). Optional second line in smaller but still large bold text for a sub-hook — must remain perfectly readable on a phone thumbnail. Generous padding; no busy textures behind letters; no warped, mirrored, or misspelled letters.

HEADLINE — VERBATIM (right half primary line must spell exactly this, same words and order):
${safeHeadline}

STORY CONTEXT (inform the LEFT visual only; do not contradict the headline):
${ctx || '(no extra context)'}

Also instruct: subtle film grain OK; 8k sharp focus; premium tech editorial look; no watermarks; no brand logos except abstract shapes.`;
}

/**
 * Calls Claude to compose a DALL-E 3 prompt with half visuals / half typography.
 * @param {Object} params
 * @param {string} params.verbatimHeadline - Exact headline text for the image (short slice if very long)
 * @param {string} params.contextText - Summary, URL, or topic for visual ideas
 * @returns {Promise<string>} Sanitized prompt capped for the Images API
 */
async function buildOpenAiImagePromptViaClaude({ verbatimHeadline, contextText }) {
  const msg = buildClaudeUserMessage({ verbatimHeadline, contextText });
  const raw = await callClaude(msg, { maxTokens: 1200, temperature: 0.45 });
  let out = sanitizeClaudePromptOutput(raw);
  if (!out || out.length < 80) {
    logger.warn('[Image] Claude returned very short image prompt; check model output');
  }
  if (out.length > MAX_OUT_CHARS) {
    out = out.slice(0, MAX_OUT_CHARS).trim();
  }
  return out;
}

module.exports = { buildOpenAiImagePromptViaClaude, sanitizeClaudePromptOutput };
