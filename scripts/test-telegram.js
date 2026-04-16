#!/usr/bin/env node
/**
 * Verifies Telegram: getMe + sendMessage to TELEGRAM_CHAT_ID.
 * Run from repo root: node scripts/test-telegram.js
 */

require('dotenv').config();
const axios = require('axios');

/**
 * Runs Telegram API checks and logs results (no secrets).
 * @returns {Promise<void>}
 */
async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token) {
    console.error('FAIL: TELEGRAM_BOT_TOKEN missing in .env');
    process.exit(1);
  }

  try {
    const me = await axios.get(`https://api.telegram.org/bot${token}/getMe`);
    if (!me.data?.ok) {
      console.error('FAIL getMe:', me.data);
      process.exit(1);
    }
    console.log(`OK getMe → @${me.data.result.username}`);
  } catch (err) {
    const msg = err.response?.data || err.message;
    console.error('FAIL getMe:', msg);
    process.exit(1);
  }

  if (!chatId) {
    console.log('SKIP sendMessage: set TELEGRAM_CHAT_ID (e.g. from @userinfobot)');
    return;
  }

  try {
    const sm = await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text: 'TechPageAuto: Telegram test — token + chat_id OK.',
    });
    if (!sm.data?.ok) {
      console.error('FAIL sendMessage:', sm.data);
      process.exit(1);
    }
    console.log(`OK sendMessage → chat_id ${chatId}`);
  } catch (err) {
    const msg = err.response?.data || err.message;
    console.error('FAIL sendMessage:', msg);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
