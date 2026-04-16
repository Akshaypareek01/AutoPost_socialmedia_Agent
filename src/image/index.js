/**
 * Image Pipeline
 * Generates a styled post image and uploads it to R2.
 * Returns the public URL ready to pass to Instagram.
 */

require('dotenv').config();
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { uploadToR2, makeR2Key } = require('./r2upload');
const logger = require('../utils/logger');

const GENERATOR = path.join(__dirname, 'generate.py');

/**
 * Cover pipeline: openai (DALL-E), gemini (Imagen), or pil (local).
 * If COVER_IMAGE_MODE is unset: OPENAI_API_KEY → openai; else GEMINI_API_KEY → gemini; else pil.
 * @returns {'pil'|'gemini'|'openai'}
 */
function resolveCoverImageMode() {
  const explicit = (process.env.COVER_IMAGE_MODE || '').trim().toLowerCase();
  if (explicit === 'claude' || explicit === 'anthropic') {
    throw new Error(
      'COVER_IMAGE_MODE=claude is invalid: Anthropic has no text-to-image API. Use gemini, openai, or pil.'
    );
  }
  if (explicit === 'imagen') return 'gemini';
  if (explicit === 'gemini' || explicit === 'openai' || explicit === 'pil') return explicit;
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  return 'pil';
}

/**
 * Generate a single slide image and upload to R2.
 * @param {Object} params - Slide parameters
 * @returns {string} Public URL of uploaded image
 */
async function generateAndUpload(params) {
  const tmpFile = path.join(os.tmpdir(), `nvhotech_${Date.now()}.jpg`);

  try {
    // argv only — no shell — so JSON may contain apostrophes (e.g. "don't") safely
    const jsonArg = JSON.stringify(params);

    logger.info(`[Image] Generating ${params.type || 'cover'} slide: "${(params.title || params.headline || '').slice(0, 40)}"`);

    const result = spawnSync(
      'python3',
      [GENERATOR, '--json', jsonArg, '--output', tmpFile],
      { encoding: 'utf8', timeout: 30000, maxBuffer: 10 * 1024 * 1024 }
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      const errOut = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
      throw new Error(errOut || `python exited with code ${result.status}`);
    }
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    if (!output.includes('SAVED:')) throw new Error(`Generator output: ${output}`);

    logger.info('[Image] Image generated, uploading to R2...');

    const r2Key = makeR2Key('posts');
    const publicUrl = await uploadToR2(tmpFile, r2Key);

    return publicUrl;
  } finally {
    // Clean up temp file
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
}

/**
 * Generate a cover slide image for a story.
 * Uses Universal Tech-Post prompt for gemini (Imagen) and openai; PIL otherwise.
 * @param {Object} story - Story object from fetcher
 * @param {string} brand - Brand name (default: NVHOTECH; used for PIL mode only)
 */
async function generateCoverImage(story, brand = 'NVHOTECH') {
  const title = shortenTitle(story.title);
  const topicSource = (story.summary || story.title || '').replace(/\s+/g, ' ').trim();
  const topic = topicSource.slice(0, 500);

  const mode = resolveCoverImageMode();
  logger.info(`[Image] Cover mode: ${mode}`);

  if (mode === 'gemini') {
    const { buildUniversalTechPrompt } = require('./aiImagePrompt');
    const { generateGeminiImagenToFile } = require('./geminiImage');
    const prompt = buildUniversalTechPrompt(title, topic);
    const allowPilFallback = process.env.GEMINI_IMAGEN_FALLBACK_PIL !== 'false';

    try {
      const tmpImg = await generateGeminiImagenToFile(prompt);
      try {
        logger.info('[Image] Gemini Imagen cover ready, uploading to R2...');
        const ext = path.extname(tmpImg).replace(/^\./, '') || 'png';
        const r2Key = makeR2Key('posts', ext);
        return await uploadToR2(tmpImg, r2Key);
      } finally {
        if (fs.existsSync(tmpImg)) fs.unlinkSync(tmpImg);
      }
    } catch (err) {
      if (!allowPilFallback) throw err;
      logger.warn(`[Image] Imagen failed (${err.message}) — falling back to PIL (set GEMINI_IMAGEN_FALLBACK_PIL=false to disable)`);
      return generateAndUpload({
        type: 'cover',
        title,
        subtitle: topicSource.slice(0, 100),
        brand,
        label: 'TECHNOLOGY',
        slide: 1,
        total: 1,
      });
    }
  }

  if (mode === 'openai') {
    const { buildUniversalTechPrompt } = require('./aiImagePrompt');
    const { generateOpenAiImageToFile } = require('./openaiImage');
    const allowPilFallback = process.env.OPENAI_IMAGE_FALLBACK_PIL !== 'false';

    // Background-only prompt — DALL-E generates the visual, PIL adds text
    const prompt = buildUniversalTechPrompt(title, topic);
    logger.info('[Image] DALL-E generating background (no text — PIL composites text on top)');

    try {
      const tmpBg = await generateOpenAiImageToFile(prompt);
      try {
        // Hybrid: composite bold branded text over the AI background
        logger.info('[Image] Compositing text over DALL-E background...');
        const tmpFinal = path.join(os.tmpdir(), `nvhotech_hybrid_${Date.now()}.jpg`);
        const jsonArg = JSON.stringify({
          type: 'hybrid',
          bg: tmpBg,
          title,
          subtitle: topicSource.slice(0, 160),
          brand,
          label: 'TECHNOLOGY',
          slide: 1,
          total: 1,
        });
        const result = spawnSync(
          'python3',
          [GENERATOR, '--json', jsonArg, '--output', tmpFinal],
          { encoding: 'utf8', timeout: 30000 }
        );
        if (result.error) throw result.error;
        if (result.status !== 0) throw new Error(result.stderr || `python exit ${result.status}`);

        try {
          logger.info('[Image] Hybrid image ready, uploading to R2...');
          const r2Key = makeR2Key('posts', 'jpg');
          return await uploadToR2(tmpFinal, r2Key);
        } finally {
          if (fs.existsSync(tmpFinal)) fs.unlinkSync(tmpFinal);
        }
      } finally {
        if (fs.existsSync(tmpBg)) fs.unlinkSync(tmpBg);
      }
    } catch (err) {
      if (!allowPilFallback) throw err;
      logger.warn(`[Image] OpenAI hybrid failed (${err.message}) — falling back to PIL text card`);
      return generateAndUpload({
        type: 'cover',
        title,
        subtitle: topicSource.slice(0, 100),
        brand,
        label: 'TECHNOLOGY',
        slide: 1,
        total: 1,
      });
    }
  }

  return generateAndUpload({
    type: 'cover',
    title,
    subtitle: topicSource.slice(0, 100),
    brand,
    label: 'TECHNOLOGY',
    slide: 1,
    total: 1,
  });
}

/**
 * Shorten a long title to 4-6 impactful words for the visual.
 */
function shortenTitle(title) {
  const words = title.replace(/['"()]/g, '').split(' ');
  if (words.length <= 6) return title.toUpperCase();
  // Keep first 6 meaningful words
  const stopWords = new Set(['a', 'an', 'the', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or', 'is', 'are', 'was']);
  const meaningful = words.filter(w => !stopWords.has(w.toLowerCase()));
  return meaningful.slice(0, 6).join(' ').toUpperCase();
}

/**
 * Generate all 5 carousel images — every slide gets its own DALL-E background.
 * Slides 1-4: Hybrid (AI visual + PIL text). Slide 5: CTA (PIL only, no cost).
 *
 * @param {Object} story  - Story object from fetcher
 * @param {Array}  facts  - [{headline, body, year}] from extractFacts()
 * @param {string} brand  - Brand name (default NVHOTECH)
 * @returns {Promise<string[]>} Array of up to 5 public image URLs
 */
async function generateCarouselImages(story, facts, brand = 'NVHOTECH') {
  const TOTAL = 5;
  const urls = [];
  const mode = resolveCoverImageMode();
  const { buildUniversalTechPrompt } = require('./aiImagePrompt');

  logger.info(`[Image] Generating carousel (mode: ${mode}): cover + 3 fact slides + CTA`);

  // ── Helper: generate one hybrid slide (DALL-E bg + PIL text) ──────────────
  async function makeHybridSlide({ topic, title, subtitle, slideNum, isOpenai }) {
    if (!isOpenai) {
      // PIL-only fallback (pil mode or DALL-E unavailable)
      return generateAndUpload({
        type: slideNum === 1 ? 'cover' : 'fact',
        title: slideNum === 1 ? title : undefined,
        subtitle: slideNum === 1 ? subtitle : undefined,
        headline: slideNum !== 1 ? title : undefined,
        body: slideNum !== 1 ? subtitle : undefined,
        brand,
        slide: slideNum,
        total: TOTAL,
      });
    }

    // DALL-E background (no text, background visual only)
    const { generateOpenAiImageToFile } = require('./openaiImage');
    const prompt = buildUniversalTechPrompt(title, topic);
    let tmpBg;
    try {
      tmpBg = await generateOpenAiImageToFile(prompt);
    } catch (err) {
      logger.warn(`[Image] DALL-E bg failed for slide ${slideNum} (${err.message}) — using PIL`);
      return generateAndUpload({
        type: slideNum === 1 ? 'cover' : 'fact',
        title: slideNum === 1 ? title : undefined,
        subtitle: slideNum === 1 ? subtitle : undefined,
        headline: slideNum !== 1 ? title : undefined,
        body: slideNum !== 1 ? subtitle : undefined,
        brand,
        slide: slideNum,
        total: TOTAL,
      });
    }

    // PIL composites the text over the background
    const tmpFinal = path.join(os.tmpdir(), `nvhotech_s${slideNum}_${Date.now()}.jpg`);
    try {
      const jsonArg = JSON.stringify({
        type: 'hybrid',
        bg: tmpBg,
        title,
        subtitle,
        brand,
        label: 'TECHNOLOGY',
        slide: slideNum,
        total: TOTAL,
      });
      const result = spawnSync('python3', [GENERATOR, '--json', jsonArg, '--output', tmpFinal], {
        encoding: 'utf8',
        timeout: 30000,
      });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(result.stderr || `python exit ${result.status}`);

      const r2Key = makeR2Key('posts', 'jpg');
      return await uploadToR2(tmpFinal, r2Key);
    } finally {
      if (fs.existsSync(tmpBg)) fs.unlinkSync(tmpBg);
      if (fs.existsSync(tmpFinal)) fs.unlinkSync(tmpFinal);
    }
  }

  const isOpenai = mode === 'openai';
  const storyTopic = (story.summary || story.title || '').slice(0, 400);

  // ── Slide 1: Cover ───────────────────────────────────────────────────────
  try {
    const coverTitle = shortenTitle(story.title);
    const coverSubtitle = storyTopic.slice(0, 160);
    const url = await makeHybridSlide({
      topic: storyTopic,
      title: coverTitle,
      subtitle: coverSubtitle,
      slideNum: 1,
      isOpenai,
    });
    urls.push(url);
    logger.info('[Image] Slide 1/5 (cover) ✓');
  } catch (err) {
    logger.error(`[Image] Cover slide failed: ${err.message}`);
    throw err; // cover is mandatory
  }

  // ── Slides 2-4: Fact slides — each with its own relevant visual ──────────
  for (let i = 0; i < Math.min(facts.length, 3); i++) {
    const fact = facts[i];
    const slideNum = i + 2;
    // Build topic for DALL-E prompt: the fact headline + body gives DALL-E context for a relevant image
    const factTopic = `${fact.headline}. ${fact.body}. Related to: ${story.title}`;
    try {
      const url = await makeHybridSlide({
        topic: factTopic,
        title: fact.headline,
        subtitle: fact.body,
        slideNum,
        isOpenai,
      });
      urls.push(url);
      logger.info(`[Image] Slide ${slideNum}/5 (fact) ✓`);
    } catch (err) {
      logger.warn(`[Image] Fact slide ${slideNum} failed: ${err.message} — skipping`);
    }
    // Small gap between DALL-E calls to avoid rate limits
    if (isOpenai && i < 2) await new Promise(r => setTimeout(r, 1000));
  }

  // ── Slide 5: CTA (PIL — no DALL-E needed, branded design) ───────────────
  const handle = process.env.INSTAGRAM_HANDLE || 'nvhotech';
  try {
    const ctaUrl = await generateAndUpload({
      type: 'cta',
      brand,
      handle,
      tagline: 'DAILY TECH UPDATES',
      slide: 5,
      total: TOTAL,
    });
    urls.push(ctaUrl);
    logger.info('[Image] Slide 5/5 (CTA) ✓');
  } catch (err) {
    logger.warn(`[Image] CTA slide failed: ${err.message} — skipping`);
  }

  logger.info(`[Image] Carousel complete: ${urls.length}/5 slides`);
  return urls;
}

module.exports = { generateAndUpload, generateCoverImage, generateCarouselImages, resolveCoverImageMode };
