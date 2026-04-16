/**
 * LinkedIn Publisher
 * Uses LinkedIn UGC Posts API (v2).
 *
 * SETUP CHECKLIST:
 * 1. Go to linkedin.com/developers → Create app
 * 2. Fill in company details + app info
 * 3. Request these products in your app:
 *    - "Share on LinkedIn" → gives w_member_social scope
 *    - "Sign In with LinkedIn using OpenID Connect"
 * 4. IMPORTANT: w_member_social requires manual LinkedIn review (1–2 weeks)
 *    Submit your app for review explaining the use case
 * 5. Generate OAuth2 token with scopes: r_liteprofile, w_member_social
 * 6. Get your Person URN: call /v2/me after OAuth2 login
 *    It looks like: urn:li:person:xxxxxxxxxx
 * 7. For company page: use urn:li:organization:xxxxxxxxxx
 *    Requires ORGANIZATION_SOCIAL or ORGANIZATION_SOCIAL_MEDIA_MANAGEMENT
 *
 * Token refresh: LinkedIn tokens expire in 60 days.
 * Set a calendar reminder to refresh.
 */

const axios = require('axios');
const logger = require('../utils/logger');
const { withRetry } = require('../utils/retry');

const LI_API = 'https://api.linkedin.com/v2';

/**
 * Post text content to LinkedIn.
 */
async function postToLinkedIn(postText) {
  const accessToken = process.env.LINKEDIN_ACCESS_TOKEN;
  const postAs = process.env.LINKEDIN_POST_AS || 'person';

  if (!accessToken) {
    throw new Error('LINKEDIN_ACCESS_TOKEN not set in .env');
  }

  const authorUrn =
    postAs === 'organization'
      ? process.env.LINKEDIN_ORGANIZATION_URN
      : process.env.LINKEDIN_PERSON_URN;

  if (!authorUrn) {
    throw new Error(`LINKEDIN_${postAs.toUpperCase()}_URN not set in .env`);
  }

  logger.info(`[LinkedIn] Posting as ${postAs}: ${authorUrn}`);

  const payload = {
    author: authorUrn,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: {
          text: postText.slice(0, 3000), // LinkedIn character limit
        },
        shareMediaCategory: 'NONE',
      },
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
    },
  };

  const response = await withRetry(
    () =>
      axios.post(`${LI_API}/ugcPosts`, payload, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0',
        },
      }),
    { label: 'LinkedIn post', retries: 3, baseDelay: 2000 }
  );

  const postId = response.headers['x-restli-id'] || response.data?.id;
  logger.info(`[LinkedIn] ✓ Published successfully. Post ID: ${postId}`);

  return {
    platform: 'linkedin',
    success: true,
    postId,
    postUrl: `https://www.linkedin.com/feed/update/${postId}/`,
  };
}

/**
 * Post to LinkedIn with an image (optional enhancement).
 * Two-step: register image upload → upload binary → create post with asset.
 */
async function postToLinkedInWithImage(postText, imageBuffer, imageFilename = 'tech_news.jpg') {
  const accessToken = process.env.LINKEDIN_ACCESS_TOKEN;
  const personUrn = process.env.LINKEDIN_PERSON_URN;

  // Step 1: Register image upload
  const registerRes = await withRetry(
    () =>
      axios.post(
        `${LI_API}/assets?action=registerUpload`,
        {
          registerUploadRequest: {
            recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
            owner: personUrn,
            serviceRelationships: [
              {
                relationshipType: 'OWNER',
                identifier: 'urn:li:userGeneratedContent',
              },
            ],
          },
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      ),
    { label: 'LinkedIn register image' }
  );

  const uploadUrl = registerRes.data.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].uploadUrl;
  const assetUrn = registerRes.data.value.asset;

  // Step 2: Upload image
  await axios.put(uploadUrl, imageBuffer, {
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'image/jpeg' },
  });

  // Step 3: Post with image
  const postAs = process.env.LINKEDIN_POST_AS || 'person';
  const authorUrn = postAs === 'organization'
    ? process.env.LINKEDIN_ORGANIZATION_URN
    : personUrn;

  const response = await axios.post(
    `${LI_API}/ugcPosts`,
    {
      author: authorUrn,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: postText.slice(0, 3000) },
          shareMediaCategory: 'IMAGE',
          media: [
            {
              status: 'READY',
              description: { text: 'Tech news image' },
              media: assetUrn,
              title: { text: imageFilename },
            },
          ],
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
      },
    }
  );

  const postId = response.headers['x-restli-id'] || response.data?.id;
  logger.info(`[LinkedIn] ✓ Published with image. Post ID: ${postId}`);
  return { platform: 'linkedin', success: true, postId };
}

/**
 * Get your LinkedIn person URN — run this once to get the URN for .env
 */
async function getPersonUrn() {
  const accessToken = process.env.LINKEDIN_ACCESS_TOKEN;
  if (!accessToken) throw new Error('LINKEDIN_ACCESS_TOKEN not set');

  const res = await axios.get(`${LI_API}/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const urn = `urn:li:person:${res.data.id}`;
  logger.info(`[LinkedIn] Your Person URN: ${urn}`);
  return urn;
}

/**
 * Verify LinkedIn setup — call this to confirm credentials work.
 */
async function verifyLinkedInSetup() {
  try {
    const urn = await getPersonUrn();
    return { success: true, urn };
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    logger.error(`[LinkedIn] Verification failed: ${msg}`);
    return { success: false, error: msg };
  }
}

/**
 * Post a video to LinkedIn.
 *
 * LinkedIn Video Upload Flow (v2 API):
 *   1. Register video upload → get uploadUrl + asset URN
 *   2. Upload video binary via PUT
 *   3. Create UGC post with VIDEO shareMediaCategory
 *
 * Requirements:
 *   - Video: MP4, H.264, max 200MB, duration 3s–10min
 *   - w_member_social scope required
 *
 * @param {string} postText  - Post text
 * @param {string} videoPath - Local path to the .mp4 file
 * @param {string} [videoTitle] - Optional title shown on LinkedIn
 */
async function postVideoToLinkedIn(postText, videoPath, videoTitle = 'Tech Update') {
  const fs = require('fs');
  const accessToken = process.env.LINKEDIN_ACCESS_TOKEN;
  const postAs = process.env.LINKEDIN_POST_AS || 'person';
  const authorUrn = postAs === 'organization'
    ? process.env.LINKEDIN_ORGANIZATION_URN
    : process.env.LINKEDIN_PERSON_URN;

  if (!accessToken) throw new Error('LINKEDIN_ACCESS_TOKEN not set in .env');
  if (!authorUrn) throw new Error(`LINKEDIN_${postAs.toUpperCase()}_URN not set in .env`);
  if (!fs.existsSync(videoPath)) throw new Error(`Video file not found: ${videoPath}`);

  const videoBuffer = fs.readFileSync(videoPath);
  const videoSizeMb = (videoBuffer.length / 1024 / 1024).toFixed(1);
  logger.info(`[LinkedIn] Uploading video: ${videoSizeMb}MB`);

  // Step 1: Register video upload
  const registerRes = await withRetry(
    () =>
      axios.post(
        `${LI_API}/assets?action=registerUpload`,
        {
          registerUploadRequest: {
            recipes: ['urn:li:digitalmediaRecipe:feedshare-video'],
            owner: authorUrn,
            serviceRelationships: [
              {
                relationshipType: 'OWNER',
                identifier: 'urn:li:userGeneratedContent',
              },
            ],
          },
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      ),
    { label: 'LinkedIn register video', retries: 3, baseDelay: 2000 }
  );

  const uploadUrl = registerRes.data?.value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']?.uploadUrl;
  const assetUrn = registerRes.data?.value?.asset;

  if (!uploadUrl || !assetUrn) {
    throw new Error(`LinkedIn video upload registration failed: ${JSON.stringify(registerRes.data).slice(0, 200)}`);
  }

  logger.info(`[LinkedIn] Video asset registered: ${assetUrn}`);

  // Step 2: Upload video binary
  await withRetry(
    () =>
      axios.put(uploadUrl, videoBuffer, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'video/mp4',
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 300000, // 5 min for large uploads
      }),
    { label: 'LinkedIn video upload', retries: 2, baseDelay: 5000 }
  );

  logger.info('[LinkedIn] Video uploaded. Creating post...');

  // Step 3: Create UGC post with video
  const response = await withRetry(
    () =>
      axios.post(
        `${LI_API}/ugcPosts`,
        {
          author: authorUrn,
          lifecycleState: 'PUBLISHED',
          specificContent: {
            'com.linkedin.ugc.ShareContent': {
              shareCommentary: { text: postText.slice(0, 3000) },
              shareMediaCategory: 'VIDEO',
              media: [
                {
                  status: 'READY',
                  description: { text: videoTitle },
                  media: assetUrn,
                  title: { text: videoTitle.slice(0, 200) },
                },
              ],
            },
          },
          visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'X-Restli-Protocol-Version': '2.0.0',
          },
        }
      ),
    { label: 'LinkedIn video post', retries: 3, baseDelay: 2000 }
  );

  const postId = response.headers['x-restli-id'] || response.data?.id;
  logger.info(`[LinkedIn] ✓ Video published. Post ID: ${postId}`);
  return {
    platform: 'linkedin',
    success: true,
    postId,
    postUrl: `https://www.linkedin.com/feed/update/${postId}/`,
  };
}

module.exports = { postToLinkedIn, postToLinkedInWithImage, postVideoToLinkedIn, getPersonUrn, verifyLinkedInSetup };
