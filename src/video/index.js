/**
 * Video Generation Pipeline Orchestrator
 *
 * Full flow:
 *   story → generateVideoScript() → textToSpeech() → loopVideo() → lipSyncVideo()
 *             → uploadToR2() → post object ready for publisher
 *
 * Returns a post object compatible with the existing queue/publisher system,
 * with an additional `videoUrl` field.
 *
 * Required .env vars (see .env.example VIDEO PIPELINE section):
 *   ELEVENLABS_API_KEY, FAL_API_KEY, BASE_VIDEO_PATH,
 *   R2_* (for video upload), VIDEO_OUTPUT_DIR
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { generateVideoScript } = require('./script');
const { textToSpeech, getAudioDuration } = require('./audio');
const { loopVideo, muxVideoAudio } = require('./loop');
const { lipSyncVideo } = require('./lipsync');
const { uploadToR2, makeR2Key } = require('../image/r2upload');

const OUTPUT_DIR = path.resolve(process.env.VIDEO_OUTPUT_DIR || './output/video');

/**
 * Generate a complete lip-synced video post from a story.
 *
 * @param {Object} story - Story object from fetcher
 * @returns {Promise<Object>} Post object with videoUrl, instagramCaption, linkedinPost, etc.
 */
async function generateVideoPost(story) {
  const runId = Date.now().toString(36);
  const workDir = path.join(OUTPUT_DIR, runId);
  fs.mkdirSync(workDir, { recursive: true });

  logger.info(`[Video] === Starting video pipeline for: "${story.title?.slice(0, 60)}" ===`);
  logger.info(`[Video] Work dir: ${workDir}`);

  const timings = {};

  try {
    // ── Step 1: Generate script ──────────────────────────────
    logger.info('[Video] Step 1/4 — Generating script...');
    let t = Date.now();
    const scriptData = await generateVideoScript(story);
    timings.script = Date.now() - t;
    logger.info(`[Video] Script done in ${timings.script}ms`);

    // ── Step 2: Text-to-Speech ───────────────────────────────
    logger.info('[Video] Step 2/4 — Converting script to speech (ElevenLabs)...');
    t = Date.now();
    const audioPath = path.join(workDir, 'audio.mp3');
    await textToSpeech(scriptData.script, audioPath);
    const audioDuration = await getAudioDuration(audioPath);
    timings.tts = Date.now() - t;
    logger.info(`[Video] TTS done in ${timings.tts}ms — audio: ${audioDuration.toFixed(1)}s`);

    // ── Step 3: Loop base video ──────────────────────────────
    logger.info('[Video] Step 3/4 — Looping base video with ffmpeg...');
    t = Date.now();
    const baseVideoPath = process.env.BASE_VIDEO_PATH;
    if (!baseVideoPath || !fs.existsSync(baseVideoPath)) {
      throw new Error(`BASE_VIDEO_PATH not set or file not found: "${baseVideoPath}". Record a 5-10s face clip and set BASE_VIDEO_PATH in .env`);
    }

    const loopedPath = path.join(workDir, 'looped.mp4');
    loopVideo(baseVideoPath, audioDuration + 0.5, loopedPath); // +0.5s buffer
    timings.loop = Date.now() - t;
    logger.info(`[Video] Loop done in ${timings.loop}ms`);

    // ── Step 4: Lip-sync ─────────────────────────────────────
    let finalVideoPath;
    const useLipsync = !!process.env.FAL_API_KEY;

    if (useLipsync) {
      logger.info('[Video] Step 4/4 — Generating lip-sync (fal.ai LatentSync)...');
      t = Date.now();
      const lipsyncPath = path.join(workDir, 'lipsync.mp4');
      await lipSyncVideo(loopedPath, audioPath, lipsyncPath);
      timings.lipsync = Date.now() - t;
      logger.info(`[Video] Lip-sync done in ${timings.lipsync}ms`);

      // Mux lipsync video with original audio (LatentSync output may have different audio)
      const muxedPath = path.join(workDir, 'final.mp4');
      muxVideoAudio(lipsyncPath, audioPath, muxedPath);
      finalVideoPath = muxedPath;
    } else {
      // Skip lipsync — mux looped video with audio directly
      logger.warn('[Video] FAL_API_KEY not set — skipping lip-sync, using looped video + audio only');
      const muxedPath = path.join(workDir, 'final.mp4');
      muxVideoAudio(loopedPath, audioPath, muxedPath);
      finalVideoPath = muxedPath;
    }

    // ── Step 5: Upload to R2 ─────────────────────────────────
    logger.info('[Video] Uploading final video to R2...');
    t = Date.now();
    const r2Key = makeR2Key('videos', 'mp4');
    const videoUrl = await uploadToR2(finalVideoPath, r2Key);
    timings.upload = Date.now() - t;
    logger.info(`[Video] Upload done in ${timings.upload}ms — URL: ${videoUrl}`);

    // ── Build post object ─────────────────────────────────────
    const totalMs = Object.values(timings).reduce((a, b) => a + b, 0);
    logger.info(`[Video] === Pipeline complete in ${(totalMs / 1000).toFixed(1)}s ===`);
    logger.info(`[Video] Timings: ${JSON.stringify(Object.fromEntries(Object.entries(timings).map(([k, v]) => [k, `${(v/1000).toFixed(1)}s`])))}`);

    return {
      contentType: 'video',
      story,
      videoUrl,
      videoLocalPath: finalVideoPath,
      audioDuration,
      script: scriptData.script,
      title: scriptData.title,
      instagramCaption: scriptData.instagramCaption,
      linkedinPost: scriptData.linkedinPost,
      hashtags: scriptData.hashtags,
      workDir,
      timings,
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    logger.error(`[Video] Pipeline failed: ${err.message}`, err);
    // Clean up work dir on failure
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (_) {}
    throw err;
  }
}

/**
 * Check if today is a video day based on VIDEO_DAYS env var.
 * VIDEO_DAYS = comma-separated day numbers (0=Sun, 1=Mon, ..., 6=Sat)
 * @returns {boolean}
 */
function isTodayVideoDay() {
  if (!process.env.VIDEO_ENABLED || process.env.VIDEO_ENABLED === 'false') return false;
  const videoDays = (process.env.VIDEO_DAYS || '2,5').split(',').map((d) => parseInt(d.trim(), 10));
  const today = new Date().getDay();
  return videoDays.includes(today);
}

/**
 * Clean up old video work directories (keep last N runs).
 * @param {number} keepCount - How many runs to keep
 */
function cleanupOldVideoRuns(keepCount = 3) {
  if (!fs.existsSync(OUTPUT_DIR)) return;

  const runs = fs.readdirSync(OUTPUT_DIR)
    .filter((d) => fs.statSync(path.join(OUTPUT_DIR, d)).isDirectory())
    .map((d) => ({ name: d, mtime: fs.statSync(path.join(OUTPUT_DIR, d)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  const toDelete = runs.slice(keepCount);
  for (const run of toDelete) {
    try {
      fs.rmSync(path.join(OUTPUT_DIR, run.name), { recursive: true, force: true });
      logger.info(`[Video] Cleaned up old run: ${run.name}`);
    } catch (_) {}
  }
}

module.exports = { generateVideoPost, isTodayVideoDay, cleanupOldVideoRuns };

// ── Direct test ──────────────────────────────────────────────
if (require.main === module) {
  const testStory = {
    title: 'OpenAI Releases GPT-5 with 10x Better Reasoning',
    source: 'hackernews',
    url: 'https://openai.com/blog/gpt-5',
    summary: 'OpenAI has launched GPT-5, claiming significant improvements in math, coding and multi-step reasoning tasks.',
    score: 500,
    comments: 200,
    publishedAt: new Date().toISOString(),
  };

  generateVideoPost(testStory)
    .then((post) => {
      console.log('\n=== VIDEO POST GENERATED ===');
      console.log('Video URL:', post.videoUrl);
      console.log('Duration:', post.audioDuration?.toFixed(1) + 's');
      console.log('Script preview:', post.script?.slice(0, 100) + '...');
      console.log('IG Caption preview:', post.instagramCaption?.slice(0, 80) + '...');
    })
    .catch(console.error);
}
