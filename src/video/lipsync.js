/**
 * fal.ai LatentSync — Lip-Sync Video Generation
 *
 * Takes a looped video + an audio file and returns a lip-synced MP4.
 * Uses fal.ai's LatentSync model via their REST API.
 *
 * Pricing: ~$0.05 per video (~2 req/day = ~$3/month)
 *
 * Required .env vars:
 *   FAL_API_KEY         — from fal.ai dashboard
 *   FAL_LIPSYNC_MODEL   — model ID (default: fal-ai/latentsync)
 *
 * Flow:
 *   1. Upload video + audio to fal.ai storage (returns URLs)
 *   2. Submit lipsync job
 *   3. Poll for completion
 *   4. Download result MP4
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const logger = require('../utils/logger');

const FAL_BASE = 'https://queue.fal.run';
const FAL_STORAGE = 'https://storage.fal.ai/upload';
const FAL_LIPSYNC_MODEL = process.env.FAL_LIPSYNC_MODEL || 'fal-ai/latentsync';

// Polling config
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 60; // 5 min max wait

// ─────────────────────────────────────────────────────────────
//  Upload helpers
// ─────────────────────────────────────────────────────────────

/**
 * Upload a local file to fal.ai storage and return its CDN URL.
 * @param {string} filePath - Local file path
 * @param {string} mimeType - MIME type (e.g. 'video/mp4', 'audio/mpeg')
 * @returns {Promise<string>} CDN URL
 */
async function uploadToFal(filePath, mimeType) {
  const apiKey = getFalKey();
  const fileName = path.basename(filePath);
  const fileBuffer = fs.readFileSync(filePath);

  logger.info(`[LipSync] Uploading ${fileName} (${Math.round(fileBuffer.length / 1024)}KB) to fal.ai storage...`);

  const form = new FormData();
  form.append('file', fileBuffer, { filename: fileName, contentType: mimeType });

  let response;
  try {
    response = await axios.post(FAL_STORAGE, form, {
      headers: {
        Authorization: `Key ${apiKey}`,
        ...form.getHeaders(),
      },
      timeout: 120000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
  } catch (err) {
    const msg = err.response?.data ? JSON.stringify(err.response.data).slice(0, 300) : err.message;
    throw new Error(`[LipSync] fal.ai upload failed: ${msg}`);
  }

  const url = response.data?.url;
  if (!url) throw new Error(`[LipSync] No URL returned from fal.ai upload: ${JSON.stringify(response.data)}`);

  logger.info(`[LipSync] ✓ Uploaded: ${url}`);
  return url;
}

// ─────────────────────────────────────────────────────────────
//  Main lip-sync function
// ─────────────────────────────────────────────────────────────

/**
 * Generate a lip-synced video using fal.ai LatentSync.
 *
 * @param {string} videoPath - Path to looped video (no audio)
 * @param {string} audioPath - Path to TTS audio (.mp3)
 * @param {string} outputPath - Where to save the final lip-synced .mp4
 * @returns {Promise<string>} outputPath
 */
async function lipSyncVideo(videoPath, audioPath, outputPath) {
  const apiKey = getFalKey();

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  // Step 1: Upload both files to fal.ai CDN
  logger.info('[LipSync] Starting lip-sync pipeline...');
  const [videoUrl, audioUrl] = await Promise.all([
    uploadToFal(videoPath, 'video/mp4'),
    uploadToFal(audioPath, 'audio/mpeg'),
  ]);

  // Step 2: Submit the lipsync job
  logger.info(`[LipSync] Submitting LatentSync job (model: ${FAL_LIPSYNC_MODEL})...`);

  let submitResponse;
  try {
    submitResponse = await axios.post(
      `${FAL_BASE}/${FAL_LIPSYNC_MODEL}`,
      {
        video_url: videoUrl,
        audio_url: audioUrl,
        // LatentSync options
        guidance_scale: 2.0,   // higher = more faithful lip movement
        inference_steps: 20,   // 20 is a good balance of quality vs speed
        resolution: 512,       // 256 = fast/cheap, 512 = better quality
        seed: 42,
      },
      {
        headers: {
          Authorization: `Key ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );
  } catch (err) {
    const msg = err.response?.data ? JSON.stringify(err.response.data).slice(0, 300) : err.message;
    throw new Error(`[LipSync] Job submission failed: ${msg}`);
  }

  const requestId = submitResponse.data?.request_id;
  if (!requestId) {
    throw new Error(`[LipSync] No request_id in response: ${JSON.stringify(submitResponse.data)}`);
  }

  logger.info(`[LipSync] Job submitted. request_id: ${requestId}`);

  // Step 3: Poll for result
  const resultUrl = await pollForResult(requestId, apiKey);

  // Step 4: Download the result video
  logger.info(`[LipSync] Downloading result from: ${resultUrl}`);
  await downloadFile(resultUrl, outputPath, apiKey);

  const sizeKb = Math.round(fs.statSync(outputPath).size / 1024);
  logger.info(`[LipSync] ✓ Lip-synced video saved: ${sizeKb}KB → ${outputPath}`);

  return outputPath;
}

// ─────────────────────────────────────────────────────────────
//  Polling
// ─────────────────────────────────────────────────────────────

async function pollForResult(requestId, apiKey) {
  const statusUrl = `${FAL_BASE}/${FAL_LIPSYNC_MODEL}/requests/${requestId}/status`;
  const resultUrl = `${FAL_BASE}/${FAL_LIPSYNC_MODEL}/requests/${requestId}`;

  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);

    let statusResp;
    try {
      statusResp = await axios.get(statusUrl, {
        headers: { Authorization: `Key ${apiKey}` },
        timeout: 15000,
      });
    } catch (err) {
      logger.warn(`[LipSync] Poll attempt ${attempt} failed: ${err.message}`);
      continue;
    }

    const status = statusResp.data?.status;
    logger.info(`[LipSync] Poll ${attempt}/${MAX_POLL_ATTEMPTS} — status: ${status}`);

    if (status === 'COMPLETED') {
      // Fetch final result
      const resultResp = await axios.get(resultUrl, {
        headers: { Authorization: `Key ${apiKey}` },
        timeout: 15000,
      });

      const videoUrl = resultResp.data?.video?.url || resultResp.data?.output?.video_url;
      if (!videoUrl) {
        throw new Error(`[LipSync] Completed but no video URL in response: ${JSON.stringify(resultResp.data).slice(0, 300)}`);
      }
      return videoUrl;
    }

    if (status === 'FAILED') {
      const error = statusResp.data?.error || 'Unknown error';
      throw new Error(`[LipSync] Job failed: ${error}`);
    }

    // IN_QUEUE or IN_PROGRESS — keep polling
  }

  throw new Error(`[LipSync] Timed out after ${MAX_POLL_ATTEMPTS} polls (${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s)`);
}

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────

async function downloadFile(url, destPath, apiKey) {
  const response = await axios.get(url, {
    headers: apiKey ? { Authorization: `Key ${apiKey}` } : {},
    responseType: 'arraybuffer',
    timeout: 180000,
    maxContentLength: Infinity,
  });
  fs.writeFileSync(destPath, Buffer.from(response.data));
}

function getFalKey() {
  const key = process.env.FAL_API_KEY;
  if (!key) throw new Error('FAL_API_KEY not set in .env. Get it from fal.ai dashboard.');
  return key;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { lipSyncVideo, uploadToFal };

// ── Direct test ──────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('Usage: node lipsync.js <video.mp4> <audio.mp3>');
    console.log('Example: node lipsync.js output/video/looped.mp4 output/video/audio.mp3');
    process.exit(1);
  }

  const [videoPath, audioPath] = args;
  const outputPath = path.join(path.dirname(videoPath), 'lipsync-output.mp4');

  lipSyncVideo(videoPath, audioPath, outputPath)
    .then((p) => console.log('✓ Done:', p))
    .catch((err) => {
      console.error('✗', err.message);
      process.exit(1);
    });
}
