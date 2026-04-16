#!/usr/bin/env node
/**
 * Refresh Instagram Long-Lived Token
 * Instagram tokens expire every 60 days.
 * Set up a monthly reminder to run this.
 * node scripts/refresh-ig-token.js
 */

require('dotenv').config();
const axios = require('axios');

async function main() {
  const { INSTAGRAM_ACCESS_TOKEN, FACEBOOK_APP_ID, FACEBOOK_APP_SECRET } = process.env;

  if (!INSTAGRAM_ACCESS_TOKEN || !FACEBOOK_APP_ID || !FACEBOOK_APP_SECRET) {
    console.error('Required: INSTAGRAM_ACCESS_TOKEN, FACEBOOK_APP_ID, FACEBOOK_APP_SECRET in .env');
    process.exit(1);
  }

  try {
    // Get new long-lived token
    const res = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: FACEBOOK_APP_ID,
        client_secret: FACEBOOK_APP_SECRET,
        fb_exchange_token: INSTAGRAM_ACCESS_TOKEN,
      },
    });

    const newToken = res.data.access_token;
    const expiresIn = res.data.expires_in;
    const expiresDate = new Date(Date.now() + expiresIn * 1000).toDateString();

    console.log(`\n✅ New token obtained!`);
    console.log(`   Expires: ${expiresDate} (${Math.round(expiresIn / 86400)} days)`);
    console.log(`\nUpdate .env:\n   INSTAGRAM_ACCESS_TOKEN=${newToken}\n`);
  } catch (err) {
    console.error('Token refresh failed:', err.response?.data?.error || err.message);
  }
}

main();
