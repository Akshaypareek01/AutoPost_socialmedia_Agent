/**
 * Instagram Publisher
 * Uses Meta's Instagram Graph API.
 *
 * SETUP CHECKLIST (do this before first run):
 * 1. Go to developers.facebook.com → Create App → Business type
 * 2. Add "Instagram Graph API" product
 * 3. Link your Instagram account: must be Business or Creator account
 * 4. Connect Instagram account to a Facebook Page
 * 5. Generate User Access Token with permissions:
 *    - instagram_basic
 *    - instagram_content_publish
 *    - pages_read_engagement
 * 6. Exchange for Long-Lived Token (60 days) — see refreshToken() below
 * 7. Set INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_BUSINESS_ACCOUNT_ID in .env
 *
 * NOTE: Text-only posts are NOT supported on Instagram Graph API.
 * You must provide an image URL. Options:
 *  A) Host a branded image template on Cloudflare R2/S3 (cheapest)
 *  B) Use a fixed "breaking news" style image you upload once
 *  C) Generate images via Canva API (more complex)
 * This implementation uses a configurable INSTAGRAM_DEFAULT_IMAGE_URL.
 */

const axios = require('axios');
const logger = require('../utils/logger');
const { withRetry } = require('../utils/retry');

const IG_API = 'https://graph.facebook.com/v19.0';

/** Max chars sent to Instagram (caption + hashtags); keeps posts scannable. */
const INSTAGRAM_CAPTION_MAX = Math.min(
  2200,
  Math.max(80, parseInt(process.env.INSTAGRAM_CAPTION_MAX_CHARS || '480', 10) || 480)
);

/**
 * Graph POST with x-www-form-urlencoded body (required for long captions — query params exceed URL limits).
 * @param {string} url
 * @param {Record<string, string>} fields
 * @returns {Promise<object>}
 */
function graphFormPost(url, fields) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    body.append(key, value);
  }
  return axios.post(url, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });
}

/**
 * Post to Instagram using a two-step process:
 * 1. Create media container
 * 2. Publish the container
 */
async function postToInstagram(caption, imageUrl) {
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const accountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;

  if (!accessToken || !accountId) {
    throw new Error('Instagram credentials not configured. Set INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_BUSINESS_ACCOUNT_ID in .env');
  }

  // Use provided imageUrl or fall back to default branded image
  const finalImageUrl = imageUrl || process.env.INSTAGRAM_DEFAULT_IMAGE_URL;
  if (!finalImageUrl) {
    throw new Error('No image URL provided. Set INSTAGRAM_DEFAULT_IMAGE_URL in .env or pass an imageUrl');
  }

  logger.info('[Instagram] Creating media container...');

  // Step 1: Create container (form body — not query string — so long captions + image_url don't hit URL limits)
  const containerRes = await withRetry(
    () =>
      graphFormPost(`${IG_API}/${accountId}/media`, {
        image_url: finalImageUrl,
        caption: (caption || '').slice(0, INSTAGRAM_CAPTION_MAX),
        access_token: accessToken,
      }),
    { label: 'Instagram create container', retries: 3, baseDelay: 2000 }
  );

  const containerId = containerRes.data?.id;
  if (!containerId) throw new Error('Failed to get container ID from Instagram');

  logger.info(`[Instagram] Container created: ${containerId}. Waiting 5s before publish...`);

  // Instagram recommends waiting before publishing
  await new Promise((r) => setTimeout(r, 5000));

  // Step 2: Check container status
  await waitForContainerReady(containerId, accessToken);

  // Step 3: Publish
  logger.info('[Instagram] Publishing container...');
  const publishRes = await withRetry(
    () =>
      graphFormPost(`${IG_API}/${accountId}/media_publish`, {
        creation_id: containerId,
        access_token: accessToken,
      }),
    { label: 'Instagram publish', retries: 3, baseDelay: 3000 }
  );

  const mediaId = publishRes.data?.id;
  if (!mediaId) throw new Error('Instagram publish did not return media ID');

  logger.info(`[Instagram] ✓ Published successfully. Media ID: ${mediaId}`);
  return {
    platform: 'instagram',
    success: true,
    mediaId,
    postUrl: `https://www.instagram.com/p/${mediaId}/`,
  };
}

/**
 * Poll container status until it's ready to publish (or timeout).
 */
async function waitForContainerReady(containerId, accessToken, maxWaitMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const statusRes = await axios.get(`${IG_API}/${containerId}`, {
      params: { fields: 'status_code,status', access_token: accessToken },
    });
    const status = statusRes.data?.status_code;
    if (status === 'FINISHED') return;
    if (status === 'ERROR') throw new Error(`Instagram container error: ${statusRes.data?.status}`);
    logger.debug(`[Instagram] Container status: ${status}, waiting...`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error('Instagram container status check timed out');
}

/**
 * Refresh a short-lived token to a long-lived one (60 days).
 * Run this manually when your token is about to expire.
 */
async function refreshToLongLivedToken(shortLivedToken) {
  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;

  const res = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortLivedToken,
    },
  });

  logger.info(`[Instagram] Long-lived token obtained. Expires in: ${res.data.expires_in}s`);
  return res.data.access_token;
}

/**
 * Get account info — useful for verifying your setup.
 */
async function verifyInstagramSetup() {
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const accountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;

  if (!accessToken || !accountId) {
    return { success: false, error: 'Credentials not set' };
  }

  try {
    const res = await axios.get(`${IG_API}/${accountId}`, {
      params: {
        fields: 'id,username,followers_count,media_count',
        access_token: accessToken,
      },
    });
    logger.info(`[Instagram] Account verified: @${res.data.username} (${res.data.followers_count} followers)`);
    return { success: true, account: res.data };
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    logger.error(`[Instagram] Verification failed: ${msg}`);
    return { success: false, error: msg };
  }
}

/**
 * Post a carousel (2-10 images) to Instagram.
 * Instagram Carousel API flow:
 *   1. Create individual item containers (is_carousel_item=true)
 *   2. Create carousel container (media_type=CAROUSEL, children=ids)
 *   3. Publish the carousel container
 *
 * @param {string}   caption    - Post caption (shown with the carousel)
 * @param {string[]} imageUrls  - Array of 2-10 public HTTPS image URLs
 * @returns {Object}
 */
async function postCarouselToInstagram(caption, imageUrls) {
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const accountId  = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;

  if (!accessToken || !accountId) {
    throw new Error('Instagram credentials not configured.');
  }
  if (!imageUrls || imageUrls.length < 2) {
    // Instagram requires at least 2 items — fall back to single post
    logger.warn('[Instagram] Carousel needs ≥2 images — falling back to single post');
    return postToInstagram(caption, imageUrls?.[0]);
  }
  if (imageUrls.length > 10) {
    logger.warn('[Instagram] Carousel max 10 images — trimming');
    imageUrls = imageUrls.slice(0, 10);
  }

  logger.info(`[Instagram] Creating carousel with ${imageUrls.length} slides...`);

  // ── Step 1: Create item containers ──────────────────────────
  const itemIds = [];
  for (let i = 0; i < imageUrls.length; i++) {
    const url = imageUrls[i];
    logger.info(`[Instagram] Creating item container ${i + 1}/${imageUrls.length}...`);
    const res = await withRetry(
      () =>
        graphFormPost(`${IG_API}/${accountId}/media`, {
          image_url: url,
          is_carousel_item: 'true',
          access_token: accessToken,
        }),
      { label: `IG carousel item ${i + 1}`, retries: 3, baseDelay: 2000 }
    );
    const id = res.data?.id;
    if (!id) throw new Error(`No container ID for carousel item ${i + 1}`);
    itemIds.push(id);
    // Small gap between uploads to avoid rate limits
    await new Promise((r) => setTimeout(r, 1500));
  }

  logger.info(`[Instagram] All ${itemIds.length} item containers ready`);

  // ── Step 2: Create carousel container ───────────────────────
  const carouselRes = await withRetry(
    () =>
      graphFormPost(`${IG_API}/${accountId}/media`, {
        media_type: 'CAROUSEL',
        children: itemIds.join(','),
        caption: (caption || '').slice(0, INSTAGRAM_CAPTION_MAX),
        access_token: accessToken,
      }),
    { label: 'IG carousel container', retries: 3, baseDelay: 2000 }
  );

  const carouselId = carouselRes.data?.id;
  if (!carouselId) throw new Error('Failed to get carousel container ID');

  logger.info(`[Instagram] Carousel container: ${carouselId}. Waiting 5s...`);
  await new Promise((r) => setTimeout(r, 5000));
  await waitForContainerReady(carouselId, accessToken);

  // ── Step 3: Publish ──────────────────────────────────────────
  logger.info('[Instagram] Publishing carousel...');
  const publishRes = await withRetry(
    () =>
      graphFormPost(`${IG_API}/${accountId}/media_publish`, {
        creation_id: carouselId,
        access_token: accessToken,
      }),
    { label: 'IG carousel publish', retries: 3, baseDelay: 3000 }
  );

  const mediaId = publishRes.data?.id;
  if (!mediaId) throw new Error('Carousel publish did not return media ID');

  logger.info(`[Instagram] ✓ Carousel published! Media ID: ${mediaId} (${imageUrls.length} slides)`);
  return {
    platform: 'instagram',
    success: true,
    mediaId,
    slides: imageUrls.length,
    postUrl: `https://www.instagram.com/p/${mediaId}/`,
  };
}

/**
 * Post a video (Reel) to Instagram.
 *
 * Flow:
 *   1. Create video container with media_type=REELS + video_url
 *   2. Poll container status until FINISHED (encoding can take 1-3 min)
 *   3. Publish container
 *
 * Requirements:
 *   - Video must be a publicly accessible HTTPS URL (MP4, H.264, AAC audio)
 *   - Duration: 3–90 seconds for Reels
 *   - Aspect ratio: 9:16 recommended (720x1280 or 1080x1920)
 *
 * @param {string} caption   - Post caption
 * @param {string} videoUrl  - Public HTTPS URL of the MP4
 * @param {string} [coverUrl] - Optional cover image URL
 * @returns {Object}
 */
async function postVideoToInstagram(caption, videoUrl, coverUrl) {
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const accountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;

  if (!accessToken || !accountId) {
    throw new Error('Instagram credentials not configured.');
  }
  if (!videoUrl) throw new Error('videoUrl is required for Instagram video post');

  logger.info(`[Instagram] Creating Reel container for: ${videoUrl.slice(0, 80)}...`);

  const containerFields = {
    media_type: 'REELS',
    video_url: videoUrl,
    caption: (caption || '').slice(0, INSTAGRAM_CAPTION_MAX),
    access_token: accessToken,
  };

  if (coverUrl) {
    containerFields.cover_url = coverUrl;
  }

  // Step 1: Create container
  const containerRes = await withRetry(
    () => graphFormPost(`${IG_API}/${accountId}/media`, containerFields),
    { label: 'IG video container', retries: 3, baseDelay: 3000 }
  );

  const containerId = containerRes.data?.id;
  if (!containerId) throw new Error('Failed to get video container ID from Instagram');

  logger.info(`[Instagram] Video container created: ${containerId}. Waiting for encoding...`);

  // Step 2: Poll until FINISHED — video encoding can take 1-3 minutes
  await waitForContainerReady(containerId, accessToken, 300000); // 5 min timeout

  // Step 3: Publish
  logger.info('[Instagram] Publishing Reel...');
  const publishRes = await withRetry(
    () =>
      graphFormPost(`${IG_API}/${accountId}/media_publish`, {
        creation_id: containerId,
        access_token: accessToken,
      }),
    { label: 'IG video publish', retries: 3, baseDelay: 3000 }
  );

  const mediaId = publishRes.data?.id;
  if (!mediaId) throw new Error('Instagram video publish did not return media ID');

  logger.info(`[Instagram] ✓ Reel published! Media ID: ${mediaId}`);
  return {
    platform: 'instagram',
    success: true,
    mediaId,
    type: 'reel',
    postUrl: `https://www.instagram.com/reel/${mediaId}/`,
  };
}

module.exports = { postToInstagram, postCarouselToInstagram, postVideoToInstagram, refreshToLongLivedToken, verifyInstagramSetup };
