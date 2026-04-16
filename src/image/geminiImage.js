/**
 * Google Imagen via Gemini API — same key as text generation (GEMINI_API_KEY).
 * Model IDs change; we try imagen-4 first, then fallbacks (404 → next model).
 * @see https://ai.google.dev/gemini-api/docs/imagen
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');
const logger = require('../utils/logger');

/**
 * Pick file extension from image magic bytes.
 * @param {Buffer} buf
 * @returns {'jpg'|'png'}
 */
function bufferImageExt(buf) {
  if (buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  return 'png';
}

/**
 * Extract first base64 image from Imagen :predict response.
 * @param {object} data - Parsed JSON body
 * @returns {string|null}
 */
function extractImageB64(data) {
  const preds = data.predictions;
  if (Array.isArray(preds) && preds.length > 0) {
    const p = preds[0];
    if (typeof p === 'string') return p;
    return (
      p.bytesBase64Encoded ||
      p.bytesBase64 ||
      p.image?.bytesBase64Encoded ||
      p.imageBytes ||
      null
    );
  }
  if (Array.isArray(data.generatedImages) && data.generatedImages[0]) {
    const g = data.generatedImages[0];
    return g.image?.imageBytes || g.image?.bytesBase64Encoded || g.bytesBase64Encoded || null;
  }
  return null;
}

/**
 * Single Imagen :predict call for one model id.
 * @param {string} apiKey
 * @param {string} model
 * @param {string} prompt
 * @returns {Promise<string>} temp file path
 */
async function predictImagenOnce(apiKey, model, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${encodeURIComponent(apiKey)}`;

  const body = {
    instances: [{ prompt: String(prompt).slice(0, 4000) }],
    parameters: {
      sampleCount: 1,
      aspectRatio: process.env.GEMINI_IMAGE_ASPECT_RATIO || '1:1',
    },
  };

  logger.info(`[Gemini Image] Imagen :predict (${model})…`);

  const res = await axios.post(url, body, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 180000,
  });

  const b64 = extractImageB64(res.data);
  if (!b64) {
    logger.error('[Gemini Image] Unexpected body:', JSON.stringify(res.data).slice(0, 2500));
    throw new Error('Imagen response contained no image bytes');
  }

  const buf = Buffer.from(b64, 'base64');
  const ext = bufferImageExt(buf);
  const tmpFile = path.join(os.tmpdir(), `nvhotech_imagen_${Date.now()}.${ext}`);
  fs.writeFileSync(tmpFile, buf);
  logger.info(`[Gemini Image] ✓ Saved temp .${ext}`);
  return tmpFile;
}

/**
 * Ordered model ids: env override first, then current Gemini API defaults from Google docs.
 * @returns {string[]}
 */
function imagenModelCandidates() {
  const preferred = (process.env.GEMINI_IMAGE_MODEL || '').trim();
  const defaults = [
    'imagen-4.0-generate-001',
    'imagen-4.0-fast-generate-001',
    'imagen-3.0-generate-001',
    'imagen-3.0-generate-002',
  ];
  if (preferred) {
    return [preferred, ...defaults.filter((m) => m !== preferred)];
  }
  return defaults;
}

/**
 * Generates one image from a text prompt; writes temp file in os.tmpdir().
 * Retries other Imagen model ids on HTTP 404 (model not enabled for this key/API version).
 * @param {string} prompt
 * @returns {Promise<string>} Absolute path to image file
 */
async function generateGeminiImagenToFile(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set (required for COVER_IMAGE_MODE=gemini)');
  }

  const models = imagenModelCandidates();
  let last404Detail = '';

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    try {
      return await predictImagenOnce(apiKey, model, prompt);
    } catch (err) {
      const status = err.response?.status;
      const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      if (status === 404 && i < models.length - 1) {
        last404Detail = detail;
        logger.warn(`[Gemini Image] ${model} → 404, trying fallback model`);
        continue;
      }
      if (status === 404) {
        last404Detail = detail;
        break;
      }
      throw new Error(`Gemini Imagen (${model}) failed: ${detail}`);
    }
  }

  throw new Error(
    `Gemini Imagen: no model worked for this API key. Tried: ${models.join(', ')}. Last: ${last404Detail}`
  );
}

module.exports = { generateGeminiImagenToFile, imagenModelCandidates };
