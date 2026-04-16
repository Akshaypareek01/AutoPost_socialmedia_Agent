/**
 * TechPageAuto — Main Entry Point
 *
 * Starts the scheduler and Telegram bot.
 * Run with: node src/index.js
 * Production: pm2 start ecosystem.config.js
 */

require('dotenv').config();
const logger = require('./utils/logger');
const { startScheduler, runGenerateJob, runPublishJob } = require('./scheduler');
const { getBot } = require('./approval/telegram');

async function main() {
  logger.info('==============================================');
  logger.info('  TechPageAuto — Starting up');
  logger.info(`  Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`  Platforms: ${process.env.PLATFORMS || 'instagram,linkedin'}`);
  logger.info(`  Approval required: ${process.env.REQUIRE_APPROVAL !== 'false'}`);
  logger.info('==============================================');

  // Validate required env vars
  const missing = validateEnv();
  if (missing.length > 0) {
    logger.error(`Missing required env vars: ${missing.join(', ')}`);
    logger.error('Copy .env.example to .env and fill in values');
    process.exit(1);
  }

  // Start Telegram bot (for approvals)
  if (process.env.TELEGRAM_BOT_TOKEN) {
    try {
      getBot(); // initializes polling
      logger.info('[Main] Telegram bot started');
    } catch (err) {
      logger.warn(`[Main] Telegram bot failed to start: ${err.message}`);
    }
  } else {
    logger.warn('[Main] TELEGRAM_BOT_TOKEN not set — approval bot disabled, posts will auto-approve');
    process.env.REQUIRE_APPROVAL = 'false';
  }

  // Handle CLI arguments for manual runs
  const arg = process.argv[2];
  if (arg === '--run-now') {
    logger.info('[Main] --run-now flag detected: running full pipeline immediately');
    await runGenerateJob();
    logger.info(
      '[Main] Generate job done. Approve in Telegram to publish (or run: node src/index.js --publish).'
    );
    return;
  }
  if (arg === '--publish') {
    logger.info('[Main] --publish flag: publishing approved posts now');
    await runPublishJob();
    return;
  }
  if (arg === '--generate') {
    logger.info('[Main] --generate flag: running generate job only');
    await runGenerateJob();
    return;
  }

  // Start normal scheduled operation
  startScheduler();
}

function validateEnv() {
  const required = ['AI_PROVIDER'];

  // Check at least one AI provider is configured
  const provider = process.env.AI_PROVIDER || 'claude';
  if (provider === 'claude' && !process.env.ANTHROPIC_API_KEY) {
    required.push('ANTHROPIC_API_KEY');
  }
  if (provider === 'gemini' && !process.env.GEMINI_API_KEY) {
    required.push('GEMINI_API_KEY');
  }

  return required.filter((key) => !process.env[key]);
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('[Main] SIGTERM received — shutting down gracefully');
  const { stopBot } = require('./approval/telegram');
  stopBot();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('[Main] SIGINT received — shutting down');
  const { stopBot } = require('./approval/telegram');
  stopBot();
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection:', reason);
});

main().catch((err) => {
  logger.error('Fatal startup error:', err);
  process.exit(1);
});
