/**
 * Google Gemini API client (alternative to Claude)
 * Gemini Flash has a generous free tier — good fallback.
 */

const axios = require('axios');
const logger = require('../utils/logger');
const { withRetry } = require('../utils/retry');

async function callGemini(prompt, { maxTokens = 600, temperature = 0.8 } = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const model = 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await withRetry(
    () =>
      axios.post(url, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature,
        },
      }),
    { label: 'Gemini API', retries: 3, baseDelay: 2000 }
  );

  const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty response from Gemini');

  logger.debug('[Gemini] Response received');
  return text.trim();
}

module.exports = { callGemini };
