/**
 * ElevenLabs Text-to-Speech
 *
 * Converts a script string into an MP3 file using ElevenLabs API.
 *
 * Required .env vars:
 *   ELEVENLABS_API_KEY   — from elevenlabs.io
 *   ELEVENLABS_VOICE_ID  — voice to use (default: Rachel)
 *   ELEVENLABS_MODEL     — TTS model (default: eleven_monolingual_v1)
 *
 * Returns: absolute path to the generated .mp3 file
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const logger = require('../utils/logger');

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1';

// Default voice: Rachel — clear, natural, American English
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';
const DEFAULT_MODEL = 'eleven_monolingual_v1';

/**
 * Convert text to speech using ElevenLabs API.
 * @param {string} text - Script text to convert
 * @param {string} outputPath - Where to save the .mp3 file (absolute path)
 * @returns {Promise<string>} outputPath on success
 */
async function textToSpeech(text, outputPath) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY not set in .env');

  const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
  const model = process.env.ELEVENLABS_MODEL || DEFAULT_MODEL;

  // Ensure output directory exists
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  logger.info(`[Audio] Generating TTS — ${text.split(' ').length} words → ${path.basename(outputPath)}`);
  logger.info(`[Audio] Voice: ${voiceId} | Model: ${model}`);

  const url = `${ELEVENLABS_BASE}/text-to-speech/${voiceId}`;

  const payload = {
    text,
    model_id: model,
    voice_settings: {
      stability: 0.5,        // 0-1: lower = more expressive, higher = more consistent
      similarity_boost: 0.75, // 0-1: how closely to match voice
      style: 0.3,            // 0-1: style exaggeration (0 = natural)
      use_speaker_boost: true,
    },
  };

  let response;
  try {
    response = await axios.post(url, payload, {
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      responseType: 'arraybuffer',
      timeout: 60000,
    });
  } catch (err) {
    const errMsg = err.response
      ? `ElevenLabs API error ${err.response.status}: ${Buffer.from(err.response.data).toString('utf8').slice(0, 200)}`
      : err.message;
    throw new Error(`[Audio] TTS failed: ${errMsg}`);
  }

  fs.writeFileSync(outputPath, Buffer.from(response.data));
  const sizeKb = Math.round(fs.statSync(outputPath).size / 1024);
  logger.info(`[Audio] ✓ Saved ${sizeKb}KB → ${outputPath}`);

  return outputPath;
}

/**
 * Get audio duration in seconds using ffprobe (must be installed).
 * Falls back to estimating from text word count if ffprobe not available.
 * @param {string} audioPath
 * @returns {Promise<number>} duration in seconds
 */
async function getAudioDuration(audioPath) {
  const { spawnSync } = require('child_process');

  const result = spawnSync('ffprobe', [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_streams',
    audioPath,
  ], { encoding: 'utf8', timeout: 10000 });

  if (result.status === 0 && result.stdout) {
    try {
      const info = JSON.parse(result.stdout);
      const duration = parseFloat(info.streams?.[0]?.duration);
      if (!isNaN(duration)) {
        logger.info(`[Audio] Duration from ffprobe: ${duration.toFixed(1)}s`);
        return duration;
      }
    } catch (_) {}
  }

  // Fallback: estimate from word count at ~140 WPM
  logger.warn('[Audio] ffprobe not available — estimating duration from word count');
  return parseInt(process.env.VIDEO_SCRIPT_SECONDS, 10) || 55;
}

/**
 * List available voices (useful for finding a good voice ID).
 */
async function listVoices() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY not set');

  const response = await axios.get(`${ELEVENLABS_BASE}/voices`, {
    headers: { 'xi-api-key': apiKey },
    timeout: 15000,
  });

  return response.data.voices.map((v) => ({
    voice_id: v.voice_id,
    name: v.name,
    category: v.category,
    description: v.labels?.description || '',
  }));
}

module.exports = { textToSpeech, getAudioDuration, listVoices };

// ── Direct test ──────────────────────────────────────────────
if (require.main === module) {
  const testScript = `Artificial intelligence just crossed a major milestone. A new model from OpenAI can now solve PhD-level math problems with ninety-two percent accuracy. That's better than most human experts. The model uses a new reasoning technique called chain-of-thought verification, where it double-checks its own work before giving an answer. This could change how we do research, engineering, and education forever. Follow @nvhotech for more tech updates.`;

  const outputPath = path.join(__dirname, '../../output/video/test-audio.mp3');

  textToSpeech(testScript, outputPath)
    .then(async (p) => {
      console.log('✓ Audio saved to:', p);
      const dur = await getAudioDuration(p);
      console.log('✓ Duration:', dur.toFixed(1) + 's');
    })
    .catch(console.error);
}
