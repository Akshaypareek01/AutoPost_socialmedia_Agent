/**
 * Cloudflare R2 Uploader
 * R2 is S3-compatible — we use AWS SDK with the R2 endpoint.
 *
 * Required .env vars:
 *   R2_ACCESS_KEY_ID      — from R2 → Manage API Tokens
 *   R2_SECRET_ACCESS_KEY  — same
 *   R2_ENDPOINT           — https://<accountid>.r2.cloudflarestorage.com
 *   R2_BUCKET_NAME        — your bucket name
 *   R2_PUBLIC_URL         — public URL base, e.g. https://pub-xxxx.r2.dev or custom domain
 */

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

let _client = null;

function getClient() {
  if (_client) return _client;
  const { R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT } = process.env;
  if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_ENDPOINT) {
    throw new Error('R2 credentials not set. Need R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT in .env');
  }
  _client = new S3Client({
    region: 'auto',
    endpoint: R2_ENDPOINT,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
  return _client;
}

/**
 * Upload a local file to R2 and return its public URL.
 * @param {string} localPath - Absolute path to the file
 * @param {string} remoteName - Filename in R2 bucket (e.g. "posts/2024-01-15.jpg")
 * @returns {string} Public URL of the uploaded file
 */
async function uploadToR2(localPath, remoteName) {
  const client = getClient();
  const bucket = process.env.R2_BUCKET_NAME;
  const publicBase = process.env.R2_PUBLIC_URL?.replace(/\/$/, '');

  if (!bucket) throw new Error('R2_BUCKET_NAME not set');
  if (!publicBase) throw new Error('R2_PUBLIC_URL not set');

  const fileBuffer = fs.readFileSync(localPath);
  const ext = path.extname(localPath).toLowerCase();
  const contentType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';

  logger.info(`[R2] Uploading ${path.basename(localPath)} → ${bucket}/${remoteName}`);

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: remoteName,
    Body: fileBuffer,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000',
  }));

  const publicUrl = `${publicBase}/${remoteName}`;
  logger.info(`[R2] ✓ Uploaded: ${publicUrl}`);
  return publicUrl;
}

/**
 * Generate a unique R2 key for a post image.
 * @param {string} [prefix='posts']
 * @param {string} [ext='jpg'] - file extension without dot (e.g. jpg, png)
 */
function makeR2Key(prefix = 'posts', ext = 'jpg') {
  const date = new Date().toISOString().slice(0, 10);
  const rand = Math.random().toString(36).slice(2, 8);
  const safeExt = String(ext || 'jpg')
    .replace(/^\./, '')
    .replace(/[^a-z0-9]/gi, '') || 'jpg';
  return `${prefix}/${date}-${rand}.${safeExt}`;
}

module.exports = { uploadToR2, makeR2Key };
