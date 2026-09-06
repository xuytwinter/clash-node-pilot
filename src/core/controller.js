const fs = require('node:fs/promises');
const { DiagnosticCode, diagnostic } = require('./capabilities');

function parseConfig(text) {
  const value = (key) => {
    const match = text.match(new RegExp(`^${key}:\\s*(.*?)\\s*$`, 'm'));
    return match ? match[1].replace(/^['"]|['"]$/g, '') : '';
  };
  return { controller: value('external-controller') || '127.0.0.1:9097', secret: value('secret') };
}

function normalizeControllerUrl(controller) {
  if (!controller) return 'http://127.0.0.1:9097';
  return /^https?:\/\//i.test(controller) ? controller.replace(/\/+$/, '') : `http://${controller.replace(/\/+$/, '')}`;
}

function authHeaders(secret, headers = {}) {
  return secret ? { ...headers, Authorization: `Bearer ${secret}` } : { ...headers };
}

function safeBackend(backend) {
  const { config, secret, ...rest } = backend;
  return {
    ...rest,
    config: config ? { controller: config.controller, hasSecret: Boolean(config.secret) } : undefined,
    hasSecret: Boolean(secret || config?.secret)
  };
}

class ControllerClient {
  constructor({ controller, secret = '', fetchImpl = globalThis.fetch, timeout = 10000 }) {
    this.controller = normalizeControllerUrl(controller);
    this.secret = secret;
    this.fetchImpl = fetchImpl;
    this.timeout = timeout;
  }

  async request(route, options = {}) {
    const headers = authHeaders(this.secret, { Accept: 'application/json', ...options.headers });
    const timeout = options.timeout || this.timeout;
    const response = await this.fetchImpl(`${this.controller}${route}`, {
      ...options,
      headers,
      signal: AbortSignal.timeout(timeout)
    });
    const body = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      throw Object.assign(new Error(body?.message || `Mihomo returned ${response.status}`), { status: response.status });
    }
    return body;
  }

  version() {
    return this.request('/version', { timeout: 1800 });
  }
}

async function probeConfigBackend(backend, options = {}) {
  try {
    const config = backend.config || parseConfig(await fs.readFile(backend.configPath, 'utf8'));
    const client = new ControllerClient({ controller: config.controller, secret: config.secret, fetchImpl: options.fetchImpl, timeout: options.timeout });
    const version = await client.version();
    return {
      ...backend,
      online: true,
      version: version.version || version.meta || 'unknown',
      config,
      capabilities: backend.capabilities
    };
  } catch (error) {
    return {
      ...backend,
      online: false,
      diagnostic: diagnostic(
        error.status === 401 ? DiagnosticCode.AUTH_REQUIRED : DiagnosticCode.CONTROLLER_UNAVAILABLE,
        error.status === 401 ? 'Controller authentication is required or the saved secret is invalid' : 'Controller is unavailable'
      )
    };
  }
}

module.exports = {
  ControllerClient,
  authHeaders,
  normalizeControllerUrl,
  parseConfig,
  probeConfigBackend,
  safeBackend
};
