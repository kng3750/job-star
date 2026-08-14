const { getGeminiApiKey, getGeminiModel } = require('./_gemini');

module.exports = function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });
  return res.status(200).json({ status: 'ok', hasApiKey: Boolean(getGeminiApiKey()), model: getGeminiModel() });
};
