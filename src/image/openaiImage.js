/**
 * OpenAI Images API (DALL-E 3) — returns a path to a temporary PNG file.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');
const logger = require('../utils/logger');

const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations';

/**
 * Calls OpenAI image generation and writes the result to a temp file.
 * @param {string} prompt - Full image prompt (max length enforced by API)
 * @returns {Promise<string>} Absolute path to a PNG file in os.tmpdir()
 */
async function generateOpenAiImageToFile(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set (required for COVER_IMAGE_MODE=openai)');
  }

  const model = process.env.OPENAI_IMAGE_MODEL || 'dall-e-3';
  const size = process.env.OPENAI_IMAGE_SIZE || '1024x1024';
  const quality = process.env.OPENAI_IMAGE_QUALITY || 'standard';
  const trimmed = String(prompt).slice(0, 3900);

  logger.info(`[OpenAI Image] Generating (${model}, ${size})…`);

  let res;
  try {
    res = await axios.post(
      OPENAI_IMAGES_URL,
      {
        model,
        prompt: trimmed,
        n: 1,
        size,
        quality,
        response_format: 'b64_json',
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 180000,
      }
    );
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    throw new Error(`OpenAI Images request failed: ${detail}`);
  }

  const b64 = res.data?.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error(`OpenAI Images: unexpected response: ${JSON.stringify(res.data)}`);
  }

  const buf = Buffer.from(b64, 'base64');
  const tmpFile = path.join(os.tmpdir(), `nvhotech_openai_${Date.now()}.png`);
  fs.writeFileSync(tmpFile, buf);
  logger.info('[OpenAI Image] ✓ Saved to temp file');
  return tmpFile;
}

module.exports = { generateOpenAiImageToFile };
