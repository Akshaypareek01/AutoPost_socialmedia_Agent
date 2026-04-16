#!/usr/bin/env node
/**
 * Get your LinkedIn Person URN
 * Run ONCE after setting LINKEDIN_ACCESS_TOKEN.
 * node scripts/get-linkedin-urn.js
 */

require('dotenv').config();
const axios = require('axios');

async function main() {
  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  if (!token) {
    console.error('LINKEDIN_ACCESS_TOKEN not set in .env');
    process.exit(1);
  }

  try {
    const res = await axios.get('https://api.linkedin.com/v2/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const urn = `urn:li:person:${res.data.id}`;
    console.log(`\n✅ Your LinkedIn Person URN:\n   ${urn}`);
    console.log(`\nAdd this to .env:\n   LINKEDIN_PERSON_URN=${urn}\n`);
  } catch (err) {
    console.error('Failed:', err.response?.data || err.message);
  }
}

main();
