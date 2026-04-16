/**
 * Content Generator
 * Takes a story object → generates Instagram caption + LinkedIn post.
 * Supports Claude and Gemini backends.
 */

require('dotenv').config();
const { callClaude } = require('./claude');
const { callGemini } = require('./gemini');
const { buildInstagramPrompt, buildLinkedInPrompt, buildSummaryPrompt } = require('./prompts');
const { enqueue } = require('../utils/queue');
const logger = require('../utils/logger');
const { sleep } = require('../utils/retry');
const { generateCoverImage, generateCarouselImages } = require('../image');
const { extractFacts } = require('./facts');
const { generateVideoPost, isTodayVideoDay } = require('../video');

/**
 * Trims Instagram caption to INSTAGRAM_CAPTION_MAX_CHARS (default 480, max 2200).
 */
function clipInstagramCaption(text) {
  const max = Math.min(
    2200,
    Math.max(80, parseInt(process.env.INSTAGRAM_CAPTION_MAX_CHARS || '480', 10) || 480)
  );
  return String(text || '').trim().slice(0, max);
}

/**
 * Generate content for a single story.
 * Produces a carousel (cover + 3 fact slides) for Instagram.
 * @param {Object} story - Story object from fetcher
 * @returns {Object} Post object ready for queue
 */
async function generatePost(story) {
  logger.info(`[Generator] Generating content for: "${story.title.slice(0, 60)}"`);

  const aiCall = getAIProvider();

  // Step 1: Generate summary if not already present
  if (!story.summary || story.summary.length < 50) {
    try {
      story.summary = await aiCall(buildSummaryPrompt(story), { maxTokens: 150, temperature: 0.5 });
      logger.debug('[Generator] Generated summary');
    } catch (err) {
      logger.warn(`[Generator] Summary generation failed: ${err.message}`);
      story.summary = story.title;
    }
    await sleep(500);
  }

  // Step 2: Generate Instagram caption
  let instagramCaption = '';
  try {
    instagramCaption = await aiCall(buildInstagramPrompt(story), { maxTokens: 200 });
    logger.debug('[Generator] Instagram caption generated');
  } catch (err) {
    logger.error(`[Generator] Instagram generation failed: ${err.message}`);
    instagramCaption = buildFallbackInstagram(story);
  }
  instagramCaption = clipInstagramCaption(instagramCaption);
  await sleep(500);

  // Step 3: Generate LinkedIn post
  let linkedinPost = '';
  try {
    linkedinPost = await aiCall(buildLinkedInPrompt(story), { maxTokens: 600 });
    logger.debug('[Generator] LinkedIn post generated');
  } catch (err) {
    logger.error(`[Generator] LinkedIn generation failed: ${err.message}`);
    linkedinPost = buildFallbackLinkedIn(story);
  }

  // Step 4: Extract hashtags
  const igHashtags = extractHashtags(instagramCaption);
  const liHashtags = extractHashtags(linkedinPost);

  // Step 5: Generate carousel images (cover + 3 fact slides)
  let imageUrls = [];   // carousel: array of URLs
  let imageUrl  = '';   // single fallback
  const platforms = (process.env.PLATFORMS || 'instagram,linkedin').split(',').map((p) => p.trim());

  if (platforms.includes('instagram')) {
    try {
      // Extract 3 facts for slide 2-4
      logger.info('[Generator] Extracting facts for carousel slides...');
      const facts = await extractFacts(story, aiCall);
      await sleep(500);

      // Generate all 4 slide images
      imageUrls = await generateCarouselImages(story, facts);
      imageUrl = imageUrls[0] || ''; // cover as single fallback
      logger.info(`[Generator] Carousel: ${imageUrls.length} slides ready`);
    } catch (err) {
      logger.warn(`[Generator] Carousel failed (${err.message}) — trying single cover`);
      try {
        imageUrl = await generateCoverImage(story);
        imageUrls = [imageUrl];
      } catch (e2) {
        logger.warn(`[Generator] Cover also failed: ${e2.message}`);
      }
    }
    await sleep(500);
  }

  const post = {
    story,
    instagramCaption,
    linkedinPost,
    igHashtags,
    liHashtags,
    // carousel: array of image URLs (cover + fact slides)
    // single: imageUrl for backwards compatibility / fallback
    ...(imageUrls.length > 0 ? { imageUrls } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    generatedAt: new Date().toISOString(),
  };

  logger.info(`[Generator] ✓ Post generated: IG ${instagramCaption.length} chars, LI ${linkedinPost.length} chars`);
  return post;
}

/**
 * Generate posts for multiple stories and add to queue.
 * Only generates 1 post by default (best story of the day).
 *
 * On VIDEO_DAYS (see .env), generates a video post instead of a carousel.
 */
async function generateAndQueue(stories, count = 1) {
  logger.info(`[Generator] Processing top ${count} of ${stories.length} stories`);

  const top = stories.slice(0, count);
  const queued = [];
  const isVideoDay = isTodayVideoDay();

  if (isVideoDay) {
    logger.info('[Generator] 🎬 VIDEO DAY — generating video post instead of carousel');
  }

  for (const story of top) {
    try {
      let post;
      if (isVideoDay) {
        post = await generateVideoPost(story);
      } else {
        post = await generatePost(story);
      }
      const queued_item = enqueue(post);
      queued.push(queued_item);
      await sleep(1000);
    } catch (err) {
      logger.error(`[Generator] Failed for story ${story.id}: ${err.message}`);
      // If video pipeline failed, fall back to carousel
      if (isVideoDay) {
        logger.warn('[Generator] Video pipeline failed — falling back to carousel post');
        try {
          const fallbackPost = await generatePost(story);
          const queued_item = enqueue(fallbackPost);
          queued.push(queued_item);
        } catch (fallbackErr) {
          logger.error(`[Generator] Carousel fallback also failed: ${fallbackErr.message}`);
        }
      }
    }
  }

  logger.info(`[Generator] Queued ${queued.length} post(s)`);
  return queued;
}

function getAIProvider() {
  const provider = process.env.AI_PROVIDER || 'claude';
  if (provider === 'gemini') return callGemini;
  return callClaude;
}

function extractHashtags(text) {
  const matches = text.match(/#\w+/g) || [];
  return [...new Set(matches)];
}

function buildFallbackInstagram(story) {
  const t = (story.title || 'Tech').slice(0, 72);
  return `🚀 ${t}\n\n#tech #news #buildinpublic`;
}

function buildFallbackLinkedIn(story) {
  return `${story.title}\n\nThis development is worth paying attention to for anyone in tech.\n\nWhat are your thoughts on this?\n\n#technology #innovation #tech`;
}

module.exports = { generatePost, generateAndQueue };

// Direct run: node src/generator/index.js
if (require.main === module) {
  const testStory = {
    id: 'test_001',
    source: 'hackernews',
    title: 'OpenAI releases GPT-5 with 10x better reasoning capabilities',
    url: 'https://openai.com/blog/gpt-5',
    summary: 'OpenAI has released GPT-5, their most capable model yet, featuring dramatically improved reasoning and coding abilities.',
    score: 2500,
    comments: 890,
    publishedAt: new Date().toISOString(),
  };

  generatePost(testStory)
    .then((post) => {
      console.log('\n=== INSTAGRAM CAPTION ===\n');
      console.log(post.instagramCaption);
      console.log('\n=== LINKEDIN POST ===\n');
      console.log(post.linkedinPost);
    })
    .catch(console.error);
}
