/**
 * Scheduler
 * Manages the daily pipeline: Fetch → Generate → Approve → Publish
 *
 * Pipeline runs in two separate cron jobs:
 *   1. GENERATE JOB (default 8:00am IST = 2:30am UTC):
 *      Fetch stories → Generate content → Send Telegram approval request
 *
 *   2. PUBLISH JOB (default 9:00am IST = 3:30am UTC):
 *      Publish all approved posts from queue
 *
 * This 1-hour gap gives you time to review + approve on Telegram.
 */

require('dotenv').config();
const cron = require('node-cron');
const { fetchAllStories } = require('../fetcher');
const { generateAndQueue } = require('../generator');
const { publishApprovedPosts } = require('../publisher');
const { sendApprovalRequest, sendNotification } = require('../approval/telegram');
const { getByStatus, pruneOldPosts } = require('../utils/queue');
const logger = require('../utils/logger');

// Default: 8am IST (2:30am UTC)
const GENERATE_CRON = process.env.GENERATE_CRON || '30 2 * * *';
// Default: 9am IST (3:30am UTC)
const PUBLISH_CRON = process.env.PUBLISH_CRON || '30 3 * * *';
// Weekly prune: Sunday midnight IST
const PRUNE_CRON = '0 18 * * 0';

/**
 * Step 1: Fetch + Generate + Queue approval requests
 * This is the "content creation" job.
 */
async function runGenerateJob() {
  logger.info('=== GENERATE JOB START ===');
  const startTime = Date.now();

  try {
    // 1. Fetch trending stories
    const stories = await fetchAllStories();

    if (stories.length === 0) {
      logger.warn('[Scheduler] No stories fetched — skipping generation');
      await sendNotification('⚠️ *Generate Job*: No stories found today.');
      return;
    }

    // 2. Generate content for top story (1 post/day)
    const queued = await generateAndQueue(stories, 1);

    if (queued.length === 0) {
      logger.warn('[Scheduler] Generation produced no posts');
      await sendNotification('⚠️ *Generate Job*: Content generation failed.');
      return;
    }

    // 3. Send approval requests for each queued post
    for (const post of queued) {
      await sendApprovalRequest(post);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info(`=== GENERATE JOB DONE (${duration}s) — ${queued.length} post(s) queued ===`);
  } catch (err) {
    logger.error(`[Scheduler] Generate job failed: ${err.message}`, err);
    await sendNotification(`🔴 *Generate Job FAILED*: ${err.message}`);
  }
}

/**
 * Step 2: Publish all approved posts
 * Runs 1 hour after generate job to allow time for approval.
 */
async function runPublishJob() {
  logger.info('=== PUBLISH JOB START ===');
  const startTime = Date.now();

  try {
    const approved = getByStatus('approved');

    if (approved.length === 0) {
      logger.info('[Scheduler] No approved posts to publish');
      await sendNotification('ℹ️ *Publish Job*: No approved posts. Either approve on Telegram or check the queue.');
      return;
    }

    const results = await publishApprovedPosts();

    const successCount = results.filter((r) => ['published', 'partial'].includes(r.status)).length;
    const failCount = results.filter((r) => r.status === 'failed').length;

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const msg = `📊 *Publish Job Done* (${duration}s)\n✅ Published: ${successCount}\n❌ Failed: ${failCount}`;
    await sendNotification(msg);
    logger.info(`=== PUBLISH JOB DONE (${duration}s) ===`);
  } catch (err) {
    logger.error(`[Scheduler] Publish job failed: ${err.message}`, err);
    await sendNotification(`🔴 *Publish Job FAILED*: ${err.message}`);
  }
}

/**
 * Start the scheduler — registers all cron jobs.
 */
function startScheduler() {
  logger.info('[Scheduler] Starting...');
  logger.info(`[Scheduler] Generate job: ${GENERATE_CRON}`);
  logger.info(`[Scheduler] Publish job:  ${PUBLISH_CRON}`);

  // Generate job
  cron.schedule(GENERATE_CRON, runGenerateJob, { timezone: 'UTC' });

  // Publish job
  cron.schedule(PUBLISH_CRON, runPublishJob, { timezone: 'UTC' });

  // Weekly cleanup
  cron.schedule(PRUNE_CRON, () => {
    pruneOldPosts(7);
    logger.info('[Scheduler] Queue pruned');
  }, { timezone: 'UTC' });

  logger.info('[Scheduler] ✓ All jobs registered. Running...');
  sendNotification('🟢 *TechPageAuto started* — Scheduler is running.')
    .catch(() => {}); // don't crash if Telegram isn't configured yet
}

module.exports = { startScheduler, runGenerateJob, runPublishJob };
