/**
 * Publisher Orchestrator
 * Takes approved posts from queue and publishes to configured platforms.
 */

require('dotenv').config();
const { postToInstagram, postCarouselToInstagram, postVideoToInstagram } = require('./instagram');
const { postToLinkedIn, postVideoToLinkedIn } = require('./linkedin');
const { getByStatus, updatePost } = require('../utils/queue');
const { recordPosted, pruneHistory } = require('../utils/history');
const logger = require('../utils/logger');
const { sleep } = require('../utils/retry');

const PLATFORMS = (process.env.PLATFORMS || 'instagram,linkedin').split(',').map((p) => p.trim());

/**
 * Publish all approved posts in the queue.
 */
async function publishApprovedPosts() {
  const approved = getByStatus('approved');

  if (approved.length === 0) {
    logger.info('[Publisher] No approved posts in queue');
    return [];
  }

  logger.info(`[Publisher] Found ${approved.length} approved post(s) to publish`);
  const results = [];

  for (const post of approved) {
    const result = await publishPost(post);
    results.push(result);
    await sleep(2000); // don't hammer APIs
  }

  return results;
}

/**
 * Publish a single post to all configured platforms.
 */
async function publishPost(post) {
  logger.info(`[Publisher] Publishing post ${post.id}: "${post.story?.title?.slice(0, 50)}"`);

  updatePost(post.id, { status: 'publishing', attempts: (post.attempts || 0) + 1 });

  const platformResults = {};
  let anySuccess = false;
  let anyFailure = false;

  for (const platform of PLATFORMS) {
    try {
      let result;
      if (platform === 'instagram') {
        result = await publishToInstagram(post);
      } else if (platform === 'linkedin') {
        result = await publishToLinkedIn(post);
      } else {
        logger.warn(`[Publisher] Unknown platform: ${platform}`);
        continue;
      }

      platformResults[platform] = result;
      anySuccess = true;
      logger.info(`[Publisher] ✓ ${platform} published`);
    } catch (err) {
      anyFailure = true;
      platformResults[platform] = { success: false, error: err.message };
      logger.error(`[Publisher] ✗ ${platform} failed: ${err.message}`);
    }

    await sleep(3000); // gap between platform posts
  }

  const finalStatus = anyFailure && !anySuccess
    ? 'failed'
    : anyFailure
    ? 'partial'
    : 'published';

  updatePost(post.id, {
    status: finalStatus,
    publishedAt: new Date().toISOString(),
    platformResults,
  });

  // Record to history so this topic isn't reused for 7 days
  if (anySuccess && post.story) {
    try {
      recordPosted(post.story, PLATFORMS.join(','));
    } catch (err) {
      logger.warn(`[Publisher] History record failed: ${err.message}`);
    }
  }

  // Weekly cleanup of old history records
  try { pruneHistory(60); } catch (_) {}

  logger.info(`[Publisher] Post ${post.id} final status: ${finalStatus}`);
  return { postId: post.id, status: finalStatus, platformResults };
}

async function publishToInstagram(post) {
  const caption = post.instagramCaption;

  // Video (Reel): use videoUrl
  if (post.contentType === 'video' && post.videoUrl) {
    logger.info('[Publisher] Instagram Reel: posting video');
    const coverUrl = process.env.INSTAGRAM_REEL_COVER_URL || undefined;
    return await postVideoToInstagram(caption, post.videoUrl, coverUrl);
  }

  // Carousel: use imageUrls array (cover + fact slides)
  if (Array.isArray(post.imageUrls) && post.imageUrls.length >= 2) {
    logger.info(`[Publisher] Instagram carousel: ${post.imageUrls.length} slides`);
    return await postCarouselToInstagram(caption, post.imageUrls);
  }

  // Single image fallback
  const imageUrl = post.imageUrl || post.imageUrls?.[0] || process.env.INSTAGRAM_DEFAULT_IMAGE_URL;
  return await postToInstagram(caption, imageUrl);
}

async function publishToLinkedIn(post) {
  // Video: upload local file
  if (post.contentType === 'video' && post.videoLocalPath) {
    logger.info('[Publisher] LinkedIn: posting video');
    return await postVideoToLinkedIn(post.linkedinPost, post.videoLocalPath, post.title || 'Tech Update');
  }
  return await postToLinkedIn(post.linkedinPost);
}

/**
 * Verify all platform credentials before first run.
 */
async function verifyAllPlatforms() {
  const { verifyInstagramSetup } = require('./instagram');
  const { verifyLinkedInSetup } = require('./linkedin');

  logger.info('[Publisher] Verifying platform credentials...');
  const results = {};

  if (PLATFORMS.includes('instagram')) {
    results.instagram = await verifyInstagramSetup();
    logger.info(`[Publisher] Instagram: ${results.instagram.success ? '✓ OK' : '✗ FAILED'}`);
  }
  if (PLATFORMS.includes('linkedin')) {
    results.linkedin = await verifyLinkedInSetup();
    logger.info(`[Publisher] LinkedIn: ${results.linkedin.success ? '✓ OK' : '✗ FAILED'}`);
  }

  return results;
}

module.exports = { publishApprovedPosts, publishPost, verifyAllPlatforms };

// Direct run: node src/publisher/index.js
if (require.main === module) {
  verifyAllPlatforms()
    .then((r) => console.log('\nPlatform verification:', JSON.stringify(r, null, 2)))
    .catch(console.error);
}
