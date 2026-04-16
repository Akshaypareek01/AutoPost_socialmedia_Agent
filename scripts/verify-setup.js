#!/usr/bin/env node
/**
 * Setup Verification Script
 * Run this FIRST before doing anything else.
 * node scripts/verify-setup.js
 *
 * It will check all credentials and tell you exactly what's missing.
 */

require('dotenv').config();
const axios = require('axios');

const checks = [];
let passed = 0;
let failed = 0;

function check(name, condition, hint) {
  if (condition) {
    console.log(`  ✅  ${name}`);
    passed++;
  } else {
    console.log(`  ❌  ${name}`);
    if (hint) console.log(`       → ${hint}`);
    failed++;
  }
}

async function checkAsync(name, fn, hint) {
  try {
    await fn();
    console.log(`  ✅  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌  ${name}: ${err.response?.data?.error?.message || err.message}`);
    if (hint) console.log(`       → ${hint}`);
    failed++;
  }
}

async function main() {
  console.log('\n🔍 TechPageAuto — Setup Verification\n');

  // ── ENV FILE ─────────────────────────────────────────────
  console.log('📄 Environment File:');
  const fs = require('fs');
  check('.env file exists', fs.existsSync('.env'), 'Run: cp .env.example .env and fill in values');

  // ── AI PROVIDER ───────────────────────────────────────────
  console.log('\n🤖 AI Provider:');
  const provider = process.env.AI_PROVIDER || 'claude';
  check('AI_PROVIDER set', !!process.env.AI_PROVIDER, 'Set AI_PROVIDER=claude or AI_PROVIDER=gemini in .env');

  if (provider === 'claude') {
    check('ANTHROPIC_API_KEY set', !!process.env.ANTHROPIC_API_KEY, 'Get key from console.anthropic.com');
    if (process.env.ANTHROPIC_API_KEY) {
      await checkAsync(
        'Claude API reachable',
        async () => {
          await axios.post(
            'https://api.anthropic.com/v1/messages',
            { model: process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] },
            { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' } }
          );
        },
        'Check API key is valid and has credits'
      );
    }
  }

  if (provider === 'gemini') {
    check('GEMINI_API_KEY set', !!process.env.GEMINI_API_KEY, 'Get key from aistudio.google.com');
    if (process.env.GEMINI_API_KEY) {
      await checkAsync(
        'Gemini API reachable',
        async () => {
          await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
            { contents: [{ parts: [{ text: 'hi' }] }], generationConfig: { maxOutputTokens: 5 } }
          );
        },
        'Check Gemini API key is valid'
      );
    }
  }

  // ── INSTAGRAM ─────────────────────────────────────────────
  console.log('\n📸 Instagram:');
  check('INSTAGRAM_ACCESS_TOKEN set', !!process.env.INSTAGRAM_ACCESS_TOKEN, 'Get from developers.facebook.com → Instagram Graph API');
  check('INSTAGRAM_BUSINESS_ACCOUNT_ID set', !!process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID, 'Your Instagram Business/Creator account numeric ID');

  if (process.env.INSTAGRAM_ACCESS_TOKEN && process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID) {
    await checkAsync(
      'Instagram API reachable',
      async () => {
        const r = await axios.get(
          `https://graph.facebook.com/v19.0/${process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID}`,
          { params: { fields: 'id,username', access_token: process.env.INSTAGRAM_ACCESS_TOKEN } }
        );
        console.log(`       → Account: @${r.data.username}`);
      },
      'Check token has instagram_basic permission and account is linked to a Facebook Page'
    );
  }

  // ── LINKEDIN ──────────────────────────────────────────────
  console.log('\n💼 LinkedIn:');
  check('LINKEDIN_ACCESS_TOKEN set', !!process.env.LINKEDIN_ACCESS_TOKEN, 'OAuth2 token with w_member_social scope');
  check('LINKEDIN_PERSON_URN set', !!process.env.LINKEDIN_PERSON_URN, 'Run: node -e "require(\'./src/publisher/linkedin\').getPersonUrn()" after setting token');

  if (process.env.LINKEDIN_ACCESS_TOKEN) {
    await checkAsync(
      'LinkedIn API reachable',
      async () => {
        await axios.get('https://api.linkedin.com/v2/me', {
          headers: { Authorization: `Bearer ${process.env.LINKEDIN_ACCESS_TOKEN}` },
        });
      },
      'Check token is valid and has r_liteprofile scope'
    );
  }

  // ── TELEGRAM ──────────────────────────────────────────────
  console.log('\n📱 Telegram:');
  check('TELEGRAM_BOT_TOKEN set', !!process.env.TELEGRAM_BOT_TOKEN, 'Create bot via @BotFather');
  check('TELEGRAM_CHAT_ID set', !!process.env.TELEGRAM_CHAT_ID, 'Message @userinfobot to get your chat ID');

  if (process.env.TELEGRAM_BOT_TOKEN) {
    await checkAsync(
      'Telegram bot reachable',
      async () => {
        const r = await axios.get(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`);
        console.log(`       → Bot: @${r.data.result.username}`);
      },
      'Check bot token is correct'
    );
  }

  // ── DATA SOURCES ──────────────────────────────────────────
  console.log('\n📡 Data Sources:');
  await checkAsync(
    'Hacker News API reachable',
    async () => {
      await axios.get('https://hacker-news.firebaseio.com/v0/topstories.json');
    }
  );

  await checkAsync(
    'Google News RSS (trend feed) reachable',
    async () => {
      const Parser = require('rss-parser');
      const p = new Parser({ timeout: 15000 });
      const u =
        (process.env.GOOGLE_NEWS_RSS_URL || '').trim() ||
        'https://news.google.com/rss/search?q=technology&hl=en-US&gl=US&ceid=US:en';
      await p.parseURL(u);
    },
    'Fetcher uses this with HN + RSS; set GOOGLE_NEWS_RSS_URL to override'
  );

  // ── VIDEO PIPELINE ────────────────────────────────────────
  console.log('\n🎬 Video Pipeline (optional):');
  const videoEnabled = process.env.VIDEO_ENABLED === 'true';
  check('VIDEO_ENABLED set', !!process.env.VIDEO_ENABLED, 'Set VIDEO_ENABLED=true to enable video days');

  if (videoEnabled) {
    check('ELEVENLABS_API_KEY set', !!process.env.ELEVENLABS_API_KEY, 'Get from elevenlabs.io');
    check('FAL_API_KEY set', !!process.env.FAL_API_KEY, 'Get from fal.ai dashboard');
    check('BASE_VIDEO_PATH set', !!process.env.BASE_VIDEO_PATH, 'Record a 5-10s face clip, set path here');

    if (process.env.BASE_VIDEO_PATH) {
      check(
        'BASE_VIDEO_PATH file exists',
        fs.existsSync(process.env.BASE_VIDEO_PATH),
        `File not found at: ${process.env.BASE_VIDEO_PATH}`
      );
    }

    // Check ffmpeg
    const { spawnSync } = require('child_process');
    const ff = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8', timeout: 5000 });
    check('ffmpeg installed', ff.status === 0, 'Run: brew install ffmpeg (Mac) or apt install ffmpeg (Linux)');

    if (process.env.ELEVENLABS_API_KEY) {
      await checkAsync(
        'ElevenLabs API reachable',
        async () => {
          await axios.get('https://api.elevenlabs.io/v1/voices', {
            headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY },
            timeout: 10000,
          });
        },
        'Check ELEVENLABS_API_KEY is correct'
      );
    }
  } else {
    console.log('       (skipped — VIDEO_ENABLED is not true)');
  }

  // ── SUMMARY ───────────────────────────────────────────────
  console.log('\n──────────────────────────────────────');
  console.log(`Result: ${passed} passed, ${failed} failed`);
  if (failed === 0) {
    console.log('\n🎉 All checks passed! You are ready to run:');
    console.log('   node src/index.js --run-now    (test full pipeline)');
    console.log('   node src/index.js --publish    (publish approved posts)');
    console.log('   node src/index.js              (start scheduler)\n');
  } else {
    console.log(`\n⚠️  Fix the ${failed} failing check(s) above before running.\n`);
  }
}

main().catch(console.error);
