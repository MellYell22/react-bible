'use strict';

const OPENAI_API_KEY_ENV_NAME = 'OPENAI_API_KEY';

function getOpenAIApiKey() {
  const rawKey = process.env[OPENAI_API_KEY_ENV_NAME];
  const key = rawKey ? rawKey.trim() : '';
  return key || null;
}

function getOpenAIKeyDiagnostics() {
  const rawKey = process.env[OPENAI_API_KEY_ENV_NAME];
  const key = rawKey ? rawKey.trim() : '';

  return {
    envName: OPENAI_API_KEY_ENV_NAME,
    configured: Boolean(key),
    length: key.length,
    hasSurroundingWhitespace: Boolean(rawKey && rawKey !== key),
    keyType: key.indexOf('sk-proj-') === 0
      ? 'project'
      : key.indexOf('sk-') === 0
        ? 'standard'
        : key
          ? 'unknown'
          : 'missing',
  };
}

function redactOpenAIKey(message) {
  try {
    return String(message).replace(/sk-[A-Za-z0-9_-]+/g, '[redacted-openai-key]');
  } catch (e) {
    return message;
  }
}

function logOpenAIError(context, error) {
  const status = (error && (error.status || error.code || (error.response && error.response.status))) || 'unknown';
  const type = (error && (error.type || (error.error && error.error.type))) || 'unknown';
  const code = (error && (error.code || (error.error && error.error.code))) || 'unknown';

  console.error(`[OpenAI] ${context} failed`, {
    status,
    type,
    code,
    message: redactOpenAIKey(error && (error.message || JSON.stringify(error)) || 'OpenAI request failed'),
    key: getOpenAIKeyDiagnostics(),
  });
}

function getPublicOpenAIErrorMessage(error) {
  if (error && (error.status === 401 || error.code === 'invalid_api_key')) {
    return OPENAI_API_KEY_ENV_NAME + ' is missing or invalid on the server.';
  }

  if (error && (error.status === 429 || error.code === 'insufficient_quota')) {
    return 'OpenAI quota or billing is not available for this server key.';
  }

  return 'OpenAI request failed.';
}

function getPublicOpenAIHttpStatus(error) {
  const status = Number((error && (error.status || (error.response && error.response.status))) || 0);
  if ([400, 401, 403, 408, 409, 422, 429].indexOf(status) !== -1) {
    return status;
  }
  return 500;
}

module.exports = {
  OPENAI_API_KEY_ENV_NAME,
  getOpenAIApiKey,
  getOpenAIKeyDiagnostics,
  logOpenAIError,
  getPublicOpenAIErrorMessage,
  getPublicOpenAIHttpStatus,
};
