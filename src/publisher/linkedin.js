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

module.exports = { postToLinkedIn, postToLinkedInWithImage, getPersonUrn, verifyLinkedInSetup };
