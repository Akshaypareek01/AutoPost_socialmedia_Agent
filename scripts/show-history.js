#!/usr/bin/env node
/**
 * Show recent post history — what topics have been posted and are blocked.
 * node scripts/show-history.js
 */
require('dotenv').config();
const { getRecentHistory, pruneHistory } = require('../src/utils/history');

const history = getRecentHistory(20);

if (history.length === 0) {
  console.log('\nNo posts recorded yet.\n');
  process.exit(0);
}

console.log('\n📋 Recent Post History (last 20)\n');
console.log('─'.repeat(70));
history.forEach((h, i) => {
  const date = new Date(h.posted_at).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
  const daysAgo = Math.floor((Date.now() - new Date(h.posted_at)) / 86400000);
  const blocked = daysAgo < 7 ? '🔴 BLOCKED (7d)' : daysAgo < 30 ? '🟡 URL blocked (30d)' : '🟢 Free';
  console.log(`\n${i + 1}. ${h.title.slice(0, 65)}`);
  console.log(`   📅 ${date} (${daysAgo}d ago) | ${blocked}`);
  console.log(`   🔗 ${h.url.slice(0, 70)}`);
});
console.log('\n─'.repeat(70));
console.log(`\n🔴 = topic blocked for 7 days (too similar)`);
console.log(`🟡 = URL blocked for 30 days (exact duplicate)`);
console.log(`🟢 = free to use again\n`);
