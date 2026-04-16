/**
 * Post a carousel to Instagram using already-hosted image URLs (e.g. R2).
 * Does not generate images or call OpenAI — only Graph API publish.
 *
 * Usage:
 *   node scripts/post-carousel-from-urls.js URL1 URL2 URL3 ...
 *   node scripts/post-carousel-from-urls.js --file ./my-carousel-urls.txt
 *   CAROUSEL_IMAGE_URLS="https://...,https://..." node scripts/post-carousel-from-urls.js
 *
 * Optional caption:
 *   node scripts/post-carousel-from-urls.js --caption "Your text" URL1 URL2 ...
 *   or env CAROUSEL_CAPTION
 *
 * Requires: INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_BUSINESS_ACCOUNT_ID in .env
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { postCarouselToInstagram } = require('../src/publisher/instagram');

/**
 * True if the string looks like a public HTTPS image URL Instagram can fetch.
 * @param {string} s
 * @returns {boolean}
 */
function isHttpsImageUrl(s) {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  return /^https:\/\//i.test(t) && t.length > 12;
}

/**
 * Read one URL per line (or JSON array of strings) from a file.
 * @param {string} filePath
 * @returns {string[]}
 */
function readUrlsFromFile(filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  const raw = fs.readFileSync(abs, 'utf8').trim();
  if (!raw) return [];
  if (raw.startsWith('[')) {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) throw new Error('JSON file must be an array of URL strings');
    return arr.filter((u) => isHttpsImageUrl(u)).map((u) => u.trim());
  }
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .filter(isHttpsImageUrl);
}

/**
 * Parse CLI args into { urls: string[], caption: string }.
 * @returns {{ urls: string[], caption: string }}
 */
function parseCli() {
  const args = process.argv.slice(2);
  let caption = (process.env.CAROUSEL_CAPTION || '').trim();
  const urls = [];

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--caption') {
      const next = args[i + 1];
      if (!next) throw new Error('--caption requires a value');
      caption = next;
      i += 1;
      continue;
    }
    if (a === '--file') {
      const next = args[i + 1];
      if (!next) throw new Error('--file requires a path');
      urls.push(...readUrlsFromFile(next));
      i += 1;
      continue;
    }
    if (isHttpsImageUrl(a)) {
      urls.push(a.trim());
    }
  }

  const envList = (process.env.CAROUSEL_IMAGE_URLS || '').trim();
  if (urls.length === 0 && envList) {
    envList
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(isHttpsImageUrl)
      .forEach((u) => urls.push(u));
  }

  if (!caption) {
    caption =
      '📰 Carousel\n\nSwipe for the breakdown ➡️\n\n#tech #developer #nvhotech #buildinpublic #artificialintelligence';
  }

  return { urls, caption };
}

async function main() {
  const { urls, caption } = parseCli();

  if (urls.length < 2) {
    console.error(
      'Need at least 2 HTTPS image URLs (Instagram carousel minimum).\n\n' +
        'Examples:\n' +
        '  node scripts/post-carousel-from-urls.js https://...jpg https://...jpg\n' +
        '  node scripts/post-carousel-from-urls.js --file ./urls.txt\n' +
        '  CAROUSEL_IMAGE_URLS="https://a.jpg,https://b.jpg" node scripts/post-carousel-from-urls.js\n'
    );
    process.exit(1);
  }

  console.log(`\n📸 Posting carousel (${urls.length} slides) — no image generation\n`);
  urls.forEach((u, i) => console.log(`   ${i + 1}. ${u}`));
  console.log('');

  try {
    const result = await postCarouselToInstagram(caption, urls);
    console.log(`✅ Published. Media ID: ${result.mediaId} (${result.slides} slides)\n`);
  } catch (err) {
    console.error(`❌ ${err.message}`);
    if (err.response?.data) {
      console.error(JSON.stringify(err.response.data, null, 2));
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
