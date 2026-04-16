/**
 * Video Script Generator
 *
 * Takes a trending story and generates a tight spoken-word script
 * suitable for a ~55-second Instagram Reel / LinkedIn video.
 *
 * Output format:
 * {
 *   script:       string  — full narration text (no stage directions)
 *   title:        string  — short video title for captions
 *   instagramCaption: string
 *   linkedinPost: string
 *   hashtags:     string[]
 * }
 */

require('dotenv').config();
const logger = require('../utils/logger');

const TARGET_SECONDS = parseInt(process.env.VIDEO_SCRIPT_SECONDS, 10) || 55;
// Average spoken words per minute for a clear narrator voice
const WPM = 140;
const TARGET_WORDS = Math.round((TARGET_SECONDS / 60) * WPM); // ~128 words for 55s

// ─────────────────────────────────────────────────────────────
//  Provider routing (same pattern as content generator)
// ─────────────────────────────────────────────────────────────

async function generateVideoScript(story) {
  const provider = (process.env.AI_PROVIDER || 'claude').toLowerCase();

  logger.info(`[VideoScript] Generating script for: "${story.title?.slice(0, 60)}"`);

  let result;
  if (provider === 'gemini' && process.env.GEMINI_API_KEY) {
    result = await generateWithGemini(story);
  } else if (process.env.ANTHROPIC_API_KEY) {
    result = await generateWithClaude(story);
  } else {
    throw new Error('No AI provider configured. Set ANTHROPIC_API_KEY or GEMINI_API_KEY in .env');
  }

  logger.info(`[VideoScript] Script generated — ${result.script.split(' ').length} words`);
  return result;
}

// ─────────────────────────────────────────────────────────────
//  Claude
// ─────────────────────────────────────────────────────────────

async function generateWithClaude(story) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = buildPrompt(story);

  const response = await client.messages.create({
    model: process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  return parseResponse(response.content[0].text);
}

// ─────────────────────────────────────────────────────────────
//  Gemini
// ─────────────────────────────────────────────────────────────

async function generateWithGemini(story) {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.0-flash' });

  const prompt = buildPrompt(story);
  const result = await model.generateContent(prompt);
  return parseResponse(result.response.text());
}

// ─────────────────────────────────────────────────────────────
//  Prompt
// ─────────────────────────────────────────────────────────────

function buildPrompt(story) {
  const brand = process.env.INSTAGRAM_HANDLE || 'nvhotech';

  return `You are writing a script for a short tech news video for @${brand} on Instagram Reels and LinkedIn.

STORY TO COVER:
Title: ${story.title}
Source: ${story.source || 'tech news'}
URL: ${story.url || ''}
Summary: ${story.summary || story.description || story.title}

REQUIREMENTS:
- Script must be exactly ${TARGET_WORDS} words (±10%) — this equals ~${TARGET_SECONDS} seconds when spoken
- Write ONLY the spoken narration — no stage directions, no [brackets], no emojis, no punctuation like ellipsis
- Open with a strong hook — a surprising fact or bold statement (NOT "Hey everyone")
- Cover: what happened, why it matters, one concrete takeaway
- End with a call to action: "Follow @${brand} for more tech updates"
- Tone: confident, direct, informative — like a sharp tech journalist
- Avoid filler phrases: "in today's video", "make sure to like", "don't forget to subscribe"

ALSO GENERATE:
1. Instagram caption (max 480 chars) with 8-10 relevant hashtags on separate lines
2. LinkedIn post (max 700 chars, professional tone, no hashtag spam — max 5 tags)
3. A short punchy video title (max 8 words, for the caption overlay)

RESPOND IN THIS EXACT FORMAT — nothing before or after:
<script>
[spoken narration here]
</script>
<title>[short video title]</title>
<instagram>
[caption here]

[hashtags here]
</instagram>
<linkedin>
[linkedin post here]
</linkedin>`;
}

// ─────────────────────────────────────────────────────────────
//  Parser
// ─────────────────────────────────────────────────────────────

function parseResponse(text) {
  const extract = (tag) => {
    const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return m ? m[1].trim() : '';
  };

  const script = extract('script');
  const title = extract('title');
  const instagramCaption = extract('instagram');
  const linkedinPost = extract('linkedin');

  if (!script) {
    logger.warn('[VideoScript] Could not parse script from AI response — using raw text');
    // Fallback: use the whole response as script
    return {
      script: text.trim(),
      title: 'Tech Update',
      instagramCaption: text.slice(0, 480),
      linkedinPost: text.slice(0, 700),
      hashtags: ['#tech', '#technews', '#ai'],
    };
  }

  // Extract hashtags from instagram caption
  const hashtags = (instagramCaption.match(/#\w+/g) || []);

  const wordCount = script.split(/\s+/).filter(Boolean).length;
  logger.info(`[VideoScript] Script: ${wordCount} words (~${Math.round(wordCount / WPM * 60)}s spoken)`);

  return { script, title, instagramCaption, linkedinPost, hashtags };
}

module.exports = { generateVideoScript };

// ── Direct test ──────────────────────────────────────────────
if (require.main === module) {
  const testStory = {
    title: 'OpenAI Releases GPT-5 with 10x Better Reasoning',
    source: 'hackernews',
    url: 'https://openai.com/blog/gpt-5',
    summary: 'OpenAI has launched GPT-5, claiming significant improvements in math, coding and multi-step reasoning tasks compared to GPT-4o.',
  };

  generateVideoScript(testStory)
    .then((r) => {
      console.log('\n=== VIDEO SCRIPT ===');
      console.log('Title:', r.title);
      console.log('\nScript:');
      console.log(r.script);
      console.log('\nWord count:', r.script.split(' ').length);
      console.log('\nInstagram Caption:');
      console.log(r.instagramCaption);
      console.log('\nLinkedIn Post:');
      console.log(r.linkedinPost);
    })
    .catch(console.error);
}
