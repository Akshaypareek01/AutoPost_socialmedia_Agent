/**
 * Prompt templates for content generation.
 * Tuned for viral tech content — casual IG tone + professional LinkedIn tone.
 */

function buildInstagramPrompt(story) {
  return `You are a tech Instagram writer. Write a SHORT caption for this story.

Story Title: ${story.title}
Story URL: ${story.url}
${story.summary ? `Summary: ${story.summary}` : ''}
Source: ${story.source}

Requirements (strict):
- Hard limit: **under 260 characters total** including spaces, line breaks, and hashtags (mobile-first; no long essays).
- Structure: 1 hook line (max ~12 words) + optional 1 short second line (max ~10 words) + blank line + **4–6 hashtags only** (no more).
- At most **2 emojis** in the whole caption.
- No bullet lists, no "link in bio" walls of text, no multiple paragraphs beyond the 2 short lines above.
- Tone: punchy, readable in 2 seconds.

Return ONLY the caption text + hashtags. No commentary.`;
}

function buildLinkedInPrompt(story) {
  return `You are a B2B tech content writer for LinkedIn. Write a professional LinkedIn post for this tech story.

Story Title: ${story.title}
Story URL: ${story.url}
${story.summary ? `Summary: ${story.summary}` : ''}
Source: ${story.source}

Requirements:
- Open with a bold statement or insight (NOT "Excited to share..." or "I came across...")
- 180–230 words total
- Structure: Hook → Context → Key insight → Business/career implication → Question
- Include a practical takeaway developers/founders/tech professionals can use
- Professional tone but conversational, not corporate jargon
- End with an engaging question to drive comments
- Add 3–5 relevant hashtags at the very end (less is more on LinkedIn)
- No excessive emojis — max 3 total

Return ONLY the post text + hashtags. No commentary.`;
}

function buildSummaryPrompt(story) {
  return `Summarize this tech news article in 2–3 sentences for a social media audience. Be factual and concise.

Title: ${story.title}
URL: ${story.url}
${story.summary ? `Existing snippet: ${story.summary}` : ''}

Return ONLY the 2–3 sentence summary. No extra text.`;
}

module.exports = { buildInstagramPrompt, buildLinkedInPrompt, buildSummaryPrompt };
