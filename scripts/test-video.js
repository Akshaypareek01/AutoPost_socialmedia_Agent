#!/usr/bin/env node
/**
 * Test Video Pipeline
 *
 * Runs the full video pipeline for a test story and optionally posts to Instagram/LinkedIn.
 *
 * Usage:
 *   node scripts/test-video.js              — generate only (no post)
 *   node scripts/test-video.js --post       — generate + post to all PLATFORMS
 *   node scripts/test-video.js --script     — test script generation only (cheapest)
 *   node scripts/test-video.js --audio      — test script + TTS only (no ffmpeg/lipsync)
 *   node scripts/test-video.js --loop       — test script + TTS + ffmpeg loop only
 *
 * Prerequisites:
 *   ANTHROPIC_API_KEY or GEMINI_API_KEY in .env
 *   ELEVENLABS_API_KEY in .env
 *   FAL_API_KEY in .env (optional — skip with --loop flag)
 *   BASE_VIDEO_PATH in .env (not needed for --script / --audio)
 *   R2_* vars in .env (only needed for --post)
 *   ffmpeg installed (brew install ffmpeg)
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const logger = require('../src/utils/logger');

const arg = process.argv[2] || '';

const TEST_STORY = {
  id: 'test_video_001',
  source: 'hackernews',
  title: 'OpenAI Releases GPT-5 with 10x Better Reasoning',
  url: 'https://openai.com/blog/gpt-5',
  summary: 'OpenAI has launched GPT-5, claiming significant improvements in math, coding and multi-step reasoning tasks compared to GPT-4o. The model shows 92% accuracy on PhD-level math problems.',
  score: 2500,
  comments: 890,
  publishedAt: new Date().toISOString(),
};

async function main() {
  console.log('\n🎬 TechPageAuto — Video Pipeline Test\n');
  console.log('Story:', TEST_STORY.title);
  console.log('Mode:', arg || 'full pipeline (no post)\n');

  // ── Script only ─────────────────────────────────────────────
  if (arg === '--script') {
    const { generateVideoScript } = require('../src/video/script');
    console.log('Testing script generation...\n');

    const result = await generateVideoScript(TEST_STORY);
    console.log('=== SCRIPT ===');
    console.log(result.script);
    console.log(`\nWord count: ${result.script.split(' ').length}`);
    console.log('\n=== TITLE ===');
    console.log(result.title);
    console.log('\n=== IG CAPTION ===');
    console.log(result.instagramCaption);
    console.log('\n=== LI POST ===');
    console.log(result.linkedinPost);
    return;
  }

  // ── Audio only ──────────────────────────────────────────────
  if (arg === '--audio') {
    const { generateVideoScript } = require('../src/video/script');
    const { textToSpeech, getAudioDuration } = require('../src/video/audio');

    const outputDir = process.env.VIDEO_OUTPUT_DIR || './output/video';
    fs.mkdirSync(outputDir, { recursive: true });

    console.log('Step 1: Generating script...');
    const scriptData = await generateVideoScript(TEST_STORY);
    console.log(`✓ Script: ${scriptData.script.split(' ').length} words\n`);

    console.log('Step 2: Converting to speech (ElevenLabs)...');
    const audioPath = path.resolve(outputDir, 'test-audio.mp3');
    await textToSpeech(scriptData.script, audioPath);
    const duration = await getAudioDuration(audioPath);
    console.log(`✓ Audio saved: ${audioPath}`);
    console.log(`✓ Duration: ${duration.toFixed(1)}s`);
    return;
  }

  // ── Loop only ───────────────────────────────────────────────
  if (arg === '--loop') {
    const { generateVideoScript } = require('../src/video/script');
    const { textToSpeech, getAudioDuration } = require('../src/video/audio');
    const { loopVideo, muxVideoAudio } = require('../src/video/loop');

    const outputDir = process.env.VIDEO_OUTPUT_DIR || './output/video';
    const runDir = path.resolve(outputDir, 'test-loop');
    fs.mkdirSync(runDir, { recursive: true });

    console.log('Step 1: Generating script...');
    const scriptData = await generateVideoScript(TEST_STORY);
    console.log(`✓ Script ready\n`);

    console.log('Step 2: TTS...');
    const audioPath = path.join(runDir, 'audio.mp3');
    await textToSpeech(scriptData.script, audioPath);
    const duration = await getAudioDuration(audioPath);
    console.log(`✓ Audio: ${duration.toFixed(1)}s\n`);

    console.log('Step 3: Loop base video...');
    const baseVideo = process.env.BASE_VIDEO_PATH;
    if (!baseVideo || !fs.existsSync(baseVideo)) {
      console.error(`✗ BASE_VIDEO_PATH not set or file not found: "${baseVideo}"`);
      console.error('  Record a 5-10s face clip and set BASE_VIDEO_PATH in .env');
      process.exit(1);
    }

    const loopedPath = path.join(runDir, 'looped.mp4');
    loopVideo(baseVideo, duration + 0.5, loopedPath);
    console.log(`✓ Looped video: ${loopedPath}\n`);

    console.log('Step 4: Muxing video + audio (no lipsync)...');
    const muxedPath = path.join(runDir, 'muxed.mp4');
    muxVideoAudio(loopedPath, audioPath, muxedPath);
    console.log(`✓ Final video: ${muxedPath}`);
    console.log('\n  Play it in QuickTime to review before running full pipeline with lipsync!');
    return;
  }

  // ── Full pipeline ────────────────────────────────────────────
  const { generateVideoPost } = require('../src/video');
  const doPost = arg === '--post';

  console.log(`Running full pipeline${doPost ? ' + posting' : ' (generate only)'}...\n`);

  let post;
  try {
    post = await generateVideoPost(TEST_STORY);
  } catch (err) {
    console.error('\n✗ Video pipeline failed:', err.message);
    if (err.message.includes('BASE_VIDEO_PATH')) {
      console.error('\nFix: Record a 5-10 second video of your face, then set BASE_VIDEO_PATH=/path/to/clip.mp4 in .env');
    }
    process.exit(1);
  }

  console.log('\n=== VIDEO POST GENERATED ===');
  console.log('Video URL:', post.videoUrl);
  console.log('Duration:', post.audioDuration?.toFixed(1) + 's');
  console.log('Title:', post.title);
  console.log('\nScript preview:', post.script?.slice(0, 150) + '...');
  console.log('\nIG Caption preview:', post.instagramCaption?.slice(0, 100) + '...');
  console.log('\nLI Post preview:', post.linkedinPost?.slice(0, 100) + '...');

  if (!doPost) {
    console.log('\nℹ️  Run with --post to publish to Instagram/LinkedIn');
    return;
  }

  // Post to platforms
  console.log('\n=== POSTING ===');
  const { publishPost } = require('../src/publisher');
  const { enqueue } = require('../src/utils/queue');

  const queued = enqueue(post);
  // Auto-approve for direct test
  const { updatePost } = require('../src/utils/queue');
  updatePost(queued.id, { status: 'approved' });

  const result = await publishPost({ ...queued, status: 'approved' });
  console.log('\n=== PUBLISH RESULT ===');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error('\n✗ Fatal error:', err.message);
  if (process.env.LOG_LEVEL === 'debug') console.error(err.stack);
  process.exit(1);
});
