/**
 * Telegram Approval Bot
 *
 * Flow:
 * 1. Post generated → sent to you via Telegram with IG + LI previews
 * 2. You reply "✅ approve" or "❌ reject" (or use inline buttons)
 * 3. Bot updates queue status
 * 4. Approve button runs publisher immediately (unless TELEGRAM_APPROVE_WITHOUT_PUBLISH=true)
 *
 * SETUP:
 * 1. Message @BotFather on Telegram → /newbot → get token
 * 2. Message @userinfobot to get your chat ID
 * 3. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { getByStatus, updatePost, readQueue } = require('../utils/queue');
const logger = require('../utils/logger');

let bot = null;

function getBot() {
  if (!bot) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN not set in .env');
    bot = new TelegramBot(token, { polling: true });
    setupBotCommands();
  }
  return bot;
}

function setupBotCommands() {
  const chatId = process.env.TELEGRAM_CHAT_ID;

  bot.on('callback_query', async (query) => {
    const [action, postId] = query.data.split(':');
    if (!postId) return;

    if (action === 'approve') {
      updatePost(postId, { status: 'approved' });
      await bot.answerCallbackQuery(query.id, { text: '✅ Publishing…' });
      await bot.editMessageReplyMarkup(
        { inline_keyboard: [] },
        { chat_id: query.message.chat.id, message_id: query.message.message_id }
      );

      const deferPublish = process.env.TELEGRAM_APPROVE_WITHOUT_PUBLISH === 'true';
      let detail;

      if (deferPublish) {
        detail = `✅ Post \`${postId}\` approved. Run \`node src/index.js --publish\` or wait for the publish cron.`;
      } else {
        const fullPost = readQueue().find((p) => p.id === postId);
        if (!fullPost) {
          detail = `✅ Approved, but post \`${postId}\` was not found in the queue.`;
        } else {
          try {
            const { publishPost } = require('../publisher');
            const result = await publishPost(fullPost);
            if (['published', 'partial'].includes(result.status)) {
              const ig = result.platformResults?.instagram;
              const li = result.platformResults?.linkedin;
              const lines = [`📤 *Published* (${result.status})`];
              if (ig?.success && ig?.mediaId) lines.push(`Instagram media ID: \`${ig.mediaId}\``);
              if (ig && !ig.success) lines.push(`Instagram: ${(ig.error || 'failed').slice(0, 120)}`);
              if (li?.success) lines.push('LinkedIn: ok');
              if (li && !li.success) lines.push(`LinkedIn: ${(li.error || 'failed').slice(0, 120)}`);
              detail = lines.join('\n');
            } else {
              detail = `⚠️ Publish finished with status: \`${result.status}\``;
            }
          } catch (err) {
            logger.error(`[Telegram] publish after approve failed: ${err.message}`, err);
            detail = `🔴 Publish failed: ${(err.message || 'unknown').slice(0, 300)}`;
          }
        }
      }

      await bot.sendMessage(chatId, detail, { parse_mode: 'Markdown' });
      logger.info(`[Telegram] Post ${postId} approved via bot`);
    }

    if (action === 'reject') {
      updatePost(postId, { status: 'rejected' });
      await bot.answerCallbackQuery(query.id, { text: '❌ Post rejected' });
      await bot.editMessageReplyMarkup(
        { inline_keyboard: [] },
        { chat_id: query.message.chat.id, message_id: query.message.message_id }
      );
      await bot.sendMessage(chatId, `❌ Post *${postId}* rejected.`, { parse_mode: 'Markdown' });
      logger.info(`[Telegram] Post ${postId} rejected via bot`);
    }
  });

  // /status command
  bot.onText(/\/status/, async (msg) => {
    if (msg.chat.id.toString() !== chatId) return;
    const queue = readQueue();
    const counts = queue.reduce((acc, p) => {
      acc[p.status] = (acc[p.status] || 0) + 1;
      return acc;
    }, {});
    const text = Object.entries(counts)
      .map(([s, n]) => `• ${s}: ${n}`)
      .join('\n');
    bot.sendMessage(chatId, `📊 *Queue Status*\n${text || 'Empty queue'}`, { parse_mode: 'Markdown' });
  });

  // /pending command
  bot.onText(/\/pending/, async (msg) => {
    if (msg.chat.id.toString() !== chatId) return;
    const pending = getByStatus('pending_approval');
    if (pending.length === 0) {
      bot.sendMessage(chatId, 'No posts pending approval.');
      return;
    }
    for (const post of pending) {
      await sendApprovalRequest(post);
    }
  });

  logger.info('[Telegram] Bot commands set up');
}

/**
 * Escape text for Telegram HTML parse mode (captions / messages).
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Escape a URL for use inside double-quoted HTML attribute.
 * @param {string} url
 * @returns {string}
 */
function escapeHtmlAttr(url) {
  return String(url || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
}

/**
 * Send a post approval request to Telegram.
 * Called automatically when a new post is generated.
 */
async function sendApprovalRequest(post) {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const requireApproval = process.env.REQUIRE_APPROVAL !== 'false';

  if (!requireApproval) {
    logger.info(`[Telegram] Approval disabled — auto-approving post ${post.id}`);
    updatePost(post.id, { status: 'approved' });
    return;
  }

  const b = getBot();

  const keyboard = {
    inline_keyboard: [
      [
        { text: '✅ Approve & Post', callback_data: `approve:${post.id}` },
        { text: '❌ Reject', callback_data: `reject:${post.id}` },
      ],
    ],
  };

  const coverUrl = post.imageUrl || process.env.INSTAGRAM_DEFAULT_IMAGE_URL || '';
  const storyTitle = (post.story?.title || 'N/A').slice(0, 220);
  const timeoutMin = process.env.APPROVAL_TIMEOUT_MINUTES || 30;

  const preview = [
    `🆕 *New Post Ready for Review*`,
    `ID: \`${post.id}\``,
    `📰 *Story:* ${escapeMarkdown(post.story?.title || 'N/A')}`,
    coverUrl ? `\n🔗 *Cover image:*\n\`${coverUrl}\`` : '\n⚠️ No cover — set `INSTAGRAM_DEFAULT_IMAGE_URL` in `.env` or fix image generation.',
    ``,
    `📸 *Instagram Caption Preview:*`,
    `\`\`\``,
    (post.instagramCaption || '').slice(0, 320),
    `\`\`\``,
    ``,
    `💼 *LinkedIn Post Preview:*`,
    `\`\`\``,
    (post.linkedinPost || '').slice(0, 400),
    `\`\`\``,
    ``,
    `⏰ Auto-rejects in ${timeoutMin} minutes if no response.`,
  ].join('\n');

  // Photo + approve buttons so you see the actual card (Telegram fetches the URL).
  if (coverUrl) {
    let igExcerptLen = 280;
    let cap = '';
    do {
      const igExcerpt = (post.instagramCaption || '').slice(0, igExcerptLen);
      cap = [
        `<b>New post — review</b>`,
        `<b>ID:</b> <code>${escapeHtml(post.id)}</code>`,
        `<b>Story:</b> ${escapeHtml(storyTitle)}`,
        `<a href="${escapeHtmlAttr(coverUrl)}">🔗 Open cover image</a>`,
        `<b>IG excerpt:</b>`,
        `<pre>${escapeHtml(igExcerpt)}</pre>`,
        `<i>Approve below after checking the image.</i>`,
        `<i>Auto-reject in ${escapeHtml(String(timeoutMin))} min if no action.</i>`,
      ].join('\n');
      igExcerptLen -= 60;
    } while (cap.length > 1024 && igExcerptLen > 40);

    let photoOk = false;
    try {
      await b.sendPhoto(chatId, coverUrl, {
        parse_mode: 'HTML',
        caption: cap,
        reply_markup: keyboard,
      });
      photoOk = true;
    } catch (err) {
      logger.warn(`[Telegram] sendPhoto failed (${err.message}) — sending text + link with buttons`);
      await b.sendMessage(chatId, preview, { parse_mode: 'Markdown', reply_markup: keyboard });
    }
    if (photoOk) {
      await b.sendMessage(chatId, preview, { parse_mode: 'Markdown' });
    }
  } else {
    await b.sendMessage(chatId, preview, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  }

  logger.info(`[Telegram] Approval request sent for post ${post.id}`);

  // Auto-reject after timeout
  const timeoutMs = parseInt(process.env.APPROVAL_TIMEOUT_MINUTES || 30) * 60 * 1000;
  setTimeout(() => {
    const current = readQueue().find((p) => p.id === post.id);
    if (current?.status === 'pending_approval') {
      updatePost(post.id, { status: 'rejected', rejectionReason: 'timeout' });
      b.sendMessage(chatId, `⏱ Post \`${post.id}\` auto-rejected (timeout).`, { parse_mode: 'Markdown' });
      logger.info(`[Telegram] Post ${post.id} auto-rejected after timeout`);
    }
  }, timeoutMs);
}

/**
 * Send a simple notification (no approval needed — for status updates).
 */
async function sendNotification(message) {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  try {
    const b = getBot();
    await b.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (err) {
    logger.warn(`[Telegram] Notification failed: ${err.message}`);
  }
}

function escapeMarkdown(text) {
  return (text || '').replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
}

/**
 * Stop the bot (call on graceful shutdown).
 */
function stopBot() {
  if (bot) {
    bot.stopPolling();
    bot = null;
  }
}

module.exports = { sendApprovalRequest, sendNotification, stopBot, getBot };
