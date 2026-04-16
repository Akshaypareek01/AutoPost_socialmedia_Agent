/**
 * Claude API client (Anthropic)
 * Uses claude-haiku for cost efficiency (~₹0.2 per post set)
 */

const axios = require('axios');
const logger = require('../utils/logger');
const { withRetry } = require('../utils/retry');

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

async function callClaude(prompt, { maxTokens = 600, temperature = 0.8 } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const model = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';

  const response = await withRetry(
    () =>
      axios.post(
        ANTHROPIC_API,
        {
          model,
          max_tokens: maxTokens,
          temperature,
          messages: [{ role: 'user', content: prompt }],
        },
        {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
        }
      ),
    { label: 'Claude API', retries: 3, baseDelay: 2000 }
  );

  const text = response.data?.content?.[0]?.text;
  if (!text) throw new Error('Empty response from Claude');

  logger.debug(`[Claude] Input tokens: ${response.data.usage?.input_tokens}, Output: ${response.data.usage?.output_tokens}`);
  return text.trim();
}

module.exports = { callClaude };
