const logger = require('./logger');

/**
 * Retry a function with exponential backoff.
 * @param {Function} fn - Async function to retry
 * @param {Object} options
 * @param {number} options.retries - Max attempts (default: 3)
 * @param {number} options.baseDelay - Base delay in ms (default: 1000)
 * @param {string} options.label - Label for logs
 */
async function withRetry(fn, { retries = 3, baseDelay = 1000, label = 'operation' } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isRateLimit = err.response?.status === 429;
      const delay = isRateLimit
        ? (parseInt(err.response?.headers?.['retry-after'] || 60) * 1000)
        : baseDelay * Math.pow(2, attempt - 1);

      if (attempt < retries) {
        logger.warn(`${label} failed (attempt ${attempt}/${retries}), retrying in ${delay}ms: ${err.message}`);
        await sleep(delay);
      }
    }
  }
  const apiDetail =
    lastError.response?.data !== undefined
      ? ` — ${JSON.stringify(lastError.response.data)}`
      : '';
  logger.error(`${label} failed after ${retries} attempts: ${lastError.message}${apiDetail}`);
  throw lastError;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { withRetry, sleep };
