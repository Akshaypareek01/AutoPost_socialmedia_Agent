#!/usr/bin/env node
/**
 * Compares your token against the two different Instagram-related stacks Meta runs:
 * - graph.instagram.com → Instagram API (Messaging, etc.) — validates IGAA… tokens
 * - graph.facebook.com → Instagram Graph API (feed publishing) — needs EAA… user/page token
 *
 * Run from repo root: node scripts/diagnose-instagram-token.js
 */

require('dotenv').config();
const axios = require('axios');

const IG_HOST = 'https://graph.instagram.com/v21.0';
const FB_GRAPH = 'https://graph.facebook.com/v19.0';

/**
 * Returns a short label for the token shape (no secret material).
 * @param {string | undefined} token
 * @returns {string}
 */
function tokenFamily(token) {
  if (!token || typeof token !== 'string') return 'missing';
  const t = token.trim();
  if (t.startsWith('EAA')) return 'EAA (Facebook User/Page access token)';
  if (t.startsWith('IG')) return 'IG… (Instagram API token — graph.instagram.com)';
  return 'unknown prefix';
}

/**
 * Runs one probe and logs the result.
 * @param {string} label
 * @param {() => Promise<{ ok: boolean; detail?: string }>} fn
 * @returns {Promise<boolean>} whether the probe succeeded
 */
async function runCheck(label, fn) {
  process.stdout.write(`  ${label} … `);
  try {
    const r = await fn();
    if (r.ok) {
      console.log(`OK${r.detail ? ` — ${r.detail}` : ''}`);
      return true;
    }
    console.log(`FAIL — ${r.detail || 'unknown'}`);
    return false;
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    console.log(`FAIL — ${msg}`);
    return false;
  }
}

async function main() {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN?.trim();
  const configuredId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID?.trim();

  console.log('\n🔬 Instagram token diagnostic (TechPageAuto)\n');
  console.log(`  Token family: ${tokenFamily(token)}`);
  console.log(`  INSTAGRAM_BUSINESS_ACCOUNT_ID in .env: ${configuredId || '(not set)'}\n`);

  if (!token) {
    console.log('Set INSTAGRAM_ACCESS_TOKEN in .env first.\n');
    process.exit(1);
  }

  console.log('1) Instagram API (same stack as Messaging tools in Developer dashboard)\n');
  const step1Ok = await runCheck('GET graph.instagram.com/.../me', async () => {
    const r = await axios.get(`${IG_HOST}/me`, {
      params: { fields: 'id,username', access_token: token },
    });
    const id = r.data?.id;
    const user = r.data?.username;
    return {
      ok: !!id,
      detail: id ? `@${user || '?'} (id ${id})` : undefined,
    };
  });

  let igMeId;
  try {
    const r = await axios.get(`${IG_HOST}/me`, {
      params: { fields: 'id,username', access_token: token },
    });
    igMeId = r.data?.id;
  } catch {
    igMeId = undefined;
  }

  const idForFacebookProbe = configuredId || igMeId;
  let step2Ok = false;

  console.log('\n2) Instagram Graph API (what this app uses to publish feed posts)\n');
  if (!idForFacebookProbe) {
    console.log('  (skipped — set INSTAGRAM_BUSINESS_ACCOUNT_ID or fix step 1 so we can read your id)\n');
  } else {
    step2Ok = await runCheck(`GET graph.facebook.com/.../${idForFacebookProbe}`, async () => {
      const r = await axios.get(`${FB_GRAPH}/${idForFacebookProbe}`, {
        params: { fields: 'id,username', access_token: token },
      });
      return {
        ok: !!r.data?.id,
        detail: r.data?.username ? `@${r.data.username}` : `id ${r.data?.id}`,
      };
    });
  }

  console.log('\n── What this means ─────────────────────────────────────────────');
  if (step2Ok) {
    console.log('  • Step 2 OK → Your EAA token + INSTAGRAM_BUSINESS_ACCOUNT_ID work for');
    console.log('    Instagram Graph API (feed publishing). TechPageAuto can use these.');
    if (!step1Ok && token.trim().startsWith('EAA')) {
      console.log('  • Step 1 failing is normal: graph.instagram.com expects IG… tokens;');
      console.log("    you do not need step 1 for this repo's publisher.");
    }
  } else if (step1Ok && !step2Ok) {
    console.log('  • Step 1 OK + Step 2 FAIL → Token is valid for Instagram API only.');
    console.log('    TechPageAuto publishes via graph.facebook.com; you need a Facebook');
    console.log('    User/Page token (usually EAA…) with instagram_content_publish, not');
    console.log('    only the IG token from the Messaging tester.');
  } else {
    console.log('  • Fix failing step(s) above. For feed posts, step 2 must succeed.');
  }
  if (igMeId && !configuredId) {
    console.log(`\n  • Your Instagram user id from step 1 looks like: ${igMeId}`);
    console.log('    Add to .env: INSTAGRAM_BUSINESS_ACCOUNT_ID=' + igMeId);
    console.log('    (Still need step 2 to pass for feed posting with this codebase.)\n');
  } else if (igMeId && configuredId && igMeId !== configuredId) {
    console.log(
      `\n  • Note: graph.instagram.com/me id (${igMeId}) ≠ INSTAGRAM_BUSINESS_ACCOUNT_ID (${configuredId}).`
    );
    console.log(
      '    For feed publishing, once you have an EAA token, prefer the id from GET /me/accounts?fields=instagram_business_account{id}.\n'
    );
  } else {
    console.log('');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
