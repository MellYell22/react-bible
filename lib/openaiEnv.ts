export const OPENAI_API_KEY_ENV_NAME = 'OPENAI_API_KEY';

export function getOpenAIApiKey(): string | null {
  const rawKey = process.env[OPENAI_API_KEY_ENV_NAME];
  const key = rawKey?.trim();
  return key ? key : null;
}

export function getOpenAIKeyDiagnostics() {
  const rawKey = process.env[OPENAI_API_KEY_ENV_NAME];
  const key = rawKey?.trim() || '';

  return {
    envName: OPENAI_API_KEY_ENV_NAME,
    configured: Boolean(key),
    length: key.length,
    hasSurroundingWhitespace: Boolean(rawKey && rawKey !== key),
    keyType: key.startsWith('sk-proj-')
      ? 'project'
      : key.startsWith('sk-')
        ? 'standard'
        : key
          ? 'unknown'
          : 'missing',
  };
}

export function logOpenAIError(context: string, error: any) {
  const status = error?.status || error?.code || error?.response?.status || 'unknown';
  const type = error?.type || error?.error?.type || 'unknown';
  const code = error?.code || error?.error?.code || 'unknown';

  console.error(`[OpenAI] ${context} failed`, {
    status,
    type,
    code,
    message: redactOpenAIKey(error?.message || 'OpenAI request failed'),
    key: getOpenAIKeyDiagnostics(),
  });
}

export function getPublicOpenAIErrorMessage(error: any): string {
  if (error?.status === 401 || error?.code === 'invalid_api_key') {
    return `${OPENAI_API_KEY_ENV_NAME} is missing or invalid on the server.`;
  }

  if (error?.status === 403) {
    return 'The server key does not have permission to use the selected OpenAI model.';
  }

  if (error?.status === 404) {
    return 'The selected OpenAI model is not available to this server key. Set OPENAI_MODEL to a model available on your account, such as gpt-4o-mini.';
  }

  if (error?.status === 429 || error?.code === 'insufficient_quota') {
    return 'OpenAI quota or billing is not available for this server key.';
  }

  return 'OpenAI request failed.';
}

export function getPublicOpenAIHttpStatus(error: any): number {
  const status = Number(error?.status || error?.response?.status);
  if ([400, 401, 403, 404, 408, 409, 422, 429].includes(status)) {
    return status;
  }

  return 500;
}

function redactOpenAIKey(message: string): string {
  return message.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted-openai-key]');
}
