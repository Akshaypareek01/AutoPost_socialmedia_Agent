/**
 * FFmpeg Video Looper
 *
 * Takes a short base video (5-10 sec) and loops it to match the audio duration.
 * Also optionally resizes to 9:16 (720x1280) for Reels format.
 *
 * Required: ffmpeg installed (brew install ffmpeg / apt install ffmpeg)
 *
 * Required .env vars:
 *   BASE_VIDEO_PATH         — path to your short presenter clip
 *   BASE_VIDEO_RESOLUTION   — optional resize, e.g. "720:1280" (width:height)
 *   VIDEO_OUTPUT_DIR        — where to write temp files (default: ./output/video)
 */

require('dotenv').config();
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Check that ffmpeg is installed.
 * Throws if not found.
 */
function checkFfmpeg() {
  const result = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8', timeout: 5000 });
  if (result.status !== 0) {
    throw new Error('ffmpeg not found. Install it: brew install ffmpeg (Mac) or apt install ffmpeg (Linux)');
  }
}

/**
 * Get video duration using ffprobe.
 * @param {string} videoPath
 * @returns {number} duration in seconds
 */
function getVideoDuration(videoPath) {
  const result = spawnSync('ffprobe', [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_streams',
    videoPath,
  ], { encoding: 'utf8', timeout: 10000 });

  if (result.status !== 0) {
    throw new Error(`ffprobe failed on ${videoPath}: ${result.stderr}`);
  }

  const info = JSON.parse(result.stdout);
  // Check video streams for duration
  const videoStream = info.streams?.find((s) => s.codec_type === 'video');
  const duration = parseFloat(videoStream?.duration || info.format?.duration);
  if (isNaN(duration) || duration <= 0) {
    throw new Error(`Could not determine duration of ${videoPath}`);
  }
  return duration;
}

/**
 * Loop a base video to match a target duration.
 *
 * Strategy: Use ffmpeg's stream_loop to seamlessly loop the clip,
 * then cut at exactly targetDuration seconds.
 *
 * @param {string} baseVideoPath - Input short clip
 * @param {number} targetDuration - Desired output duration in seconds
 * @param {string} outputPath - Output .mp4 path
 * @returns {string} outputPath
 */
function loopVideo(baseVideoPath, targetDuration, outputPath) {
  checkFfmpeg();

  if (!fs.existsSync(baseVideoPath)) {
    throw new Error(`Base video not found: ${baseVideoPath}. Set BASE_VIDEO_PATH in .env`);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const baseDuration = getVideoDuration(baseVideoPath);
  const loopCount = Math.ceil(targetDuration / baseDuration) + 1; // +1 for safety

  logger.info(`[Loop] Base: ${baseDuration.toFixed(1)}s → Target: ${targetDuration.toFixed(1)}s → Loops: ${loopCount}`);

  const resolution = (process.env.BASE_VIDEO_RESOLUTION || '').trim();

  // Build filter chain
  let vf = '';
  if (resolution) {
    // scale to exact resolution, add padding if needed for 9:16
    const [w, h] = resolution.split(':');
    vf = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black`;
  }

  const ffmpegArgs = [
    '-stream_loop', String(loopCount),
    '-i', baseVideoPath,
    '-t', String(targetDuration),
    '-an',                 // Remove audio from looped clip (we'll mux in audio from ElevenLabs)
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p', // Required for Instagram compatibility
  ];

  if (vf) {
    ffmpegArgs.push('-vf', vf);
  }

  ffmpegArgs.push('-y', outputPath); // -y = overwrite if exists

  logger.info(`[Loop] Running ffmpeg to loop video...`);

  const result = spawnSync('ffmpeg', ffmpegArgs, {
    encoding: 'utf8',
    timeout: 120000, // 2 min max
  });

  if (result.status !== 0) {
    throw new Error(`[Loop] ffmpeg loop failed:\n${result.stderr?.slice(-500)}`);
  }

  const sizeKb = Math.round(fs.statSync(outputPath).size / 1024);
  logger.info(`[Loop] ✓ Looped video: ${sizeKb}KB → ${outputPath}`);
  return outputPath;
}

/**
 * Mux video (no audio) + audio file → final MP4.
 * Used AFTER lipsync to ensure audio is properly embedded.
 *
 * @param {string} videoPath - Video-only file
 * @param {string} audioPath - Audio file (.mp3)
 * @param {string} outputPath - Output .mp4
 * @returns {string} outputPath
 */
function muxVideoAudio(videoPath, audioPath, outputPath) {
  checkFfmpeg();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  logger.info(`[Loop] Muxing video + audio → ${path.basename(outputPath)}`);

  const result = spawnSync('ffmpeg', [
    '-i', videoPath,
    '-i', audioPath,
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-shortest',           // cut at the shorter of the two streams
    '-movflags', '+faststart', // optimize for streaming
    '-y', outputPath,
  ], { encoding: 'utf8', timeout: 120000 });

  if (result.status !== 0) {
    throw new Error(`[Loop] ffmpeg mux failed:\n${result.stderr?.slice(-500)}`);
  }

  const sizeKb = Math.round(fs.statSync(outputPath).size / 1024);
  logger.info(`[Loop] ✓ Muxed: ${sizeKb}KB → ${outputPath}`);
  return outputPath;
}

module.exports = { loopVideo, muxVideoAudio, getVideoDuration, checkFfmpeg };

// ── Direct test ──────────────────────────────────────────────
if (require.main === module) {
  const baseVideo = process.env.BASE_VIDEO_PATH;
  if (!baseVideo) {
    console.error('Set BASE_VIDEO_PATH in .env first');
    process.exit(1);
  }

  const outputDir = process.env.VIDEO_OUTPUT_DIR || './output/video';
  const outputPath = path.resolve(outputDir, 'test-looped.mp4');

  try {
    checkFfmpeg();
    console.log('✓ ffmpeg is installed');

    const dur = getVideoDuration(baseVideo);
    console.log(`✓ Base video duration: ${dur.toFixed(1)}s`);

    loopVideo(baseVideo, 55, outputPath);
    console.log('✓ Looped video saved to:', outputPath);
  } catch (err) {
    console.error('✗', err.message);
  }
}
