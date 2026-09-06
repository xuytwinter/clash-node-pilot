const fs = require('node:fs/promises');
const { DiagnosticCode, diagnostic } = require('./capabilities');
const { normalizeControllerUrl } = require('./security');

function parseConfig(text) {
  const value = (key) => {
    const match = text.match(new RegExp(`^${key}:\\s*(.*?)\\s*$`, 'm'));
    return match ? match[1].replace(/^['"]|['"]$/g, '') : '';
  };
  return { controller: value('external-controller') || '127.0.0.1:9097', secret: value('secret') };
}

function authHeaders(secret, headers = {}) {
  return secret ? { ...headers, Authorization: `Bearer ${secret}` } : { ...headers };
}

function pickString(value) {
  return typeof value === 'string' ? value : undefined;
}

function safeCapabilities(capabilities) {
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) return undefined;
  const allowed = ['discovery', 'authenticatedControl', 'switching', 'startupBackground', 'readOnly'];
  const safe = {};
  for (const key of allowed) {
    if (typeof capabilities[key] === 'string') safe[key] = capabilities[key];
  }
  return Object.keys(safe).length ? safe : undefined;
}

function safeDiagnostic(diagnostic) {
  if (!diagnostic || typeof diagnostic !== 'object' || Array.isArray(diagnostic)) return undefined;
  return {
    code: pickString(diagnostic.code) || 'unknown',
    message: pickString(diagnostic.message) || 'Backend diagnostic is unavailable'
  };
}

function safeBackend(backend = {}) {
  const config = backend.config && typeof backend.config === 'object' ? backend.config : null;
  return {
    id: pickString(backend.id) || 'unknown',
    name: pickString(backend.name) || 'Unknown backend',
    online: Boolean(backend.online),
    writable: typeof backend.writable === 'boolean' ? backend.writable : undefined,
    mode: pickString(backend.mode),
    version: pickString(backend.version),
    config: config ? { controller: pickString(config.controller), hasSecret: Boolean(config.secret) } : undefined,
    hasSecret: Boolean(backend.secret || config?.secret),
    capabilities: safeCapabilities(backend.capabilities),
    diagnostic: safeDiagnostic(backend.diagnostic)
  };
}

function abortError(message, code = 'operation-cancelled') {
  return Object.assign(new Error(message), { name: 'AbortError', code });
}

function timeoutError(timeout) {
  return Object.assign(new Error(`Controller request timed out after ${timeout} ms`), {
    name: 'TimeoutError',
    code: 'controller-timeout'
  });
}

function composeSignal(signal, timeout) {
  const controller = new AbortController();
  const cleanup = [];
  const abort = (reason) => {
    if (!controller.signal.aborted) controller.abort(reason);
  };

  if (signal?.aborted) abort(signal.reason || abortError('Operation cancelled'));
  else if (signal) {
    const onAbort = () => abort(signal.reason || abortError('Operation cancelled'));
    signal.addEventListener('abort', onAbort, { once: true });
    cleanup.push(() => signal.removeEventListener('abort', onAbort));
  }

  if (Number.isFinite(timeout) && timeout > 0) {
    const timer = setTimeout(() => abort(timeoutError(timeout)), timeout);
    if (typeof timer.unref === 'function') timer.unref();
    cleanup.push(() => clearTimeout(timer));
  }

  return {
    signal: controller.signal,
    cleanup: () => cleanup.splice(0).forEach((fn) => fn())
  };
}

async function readJsonResponse(response) {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error('Controller returned invalid JSON'), {
      status: 502,
      code: 'invalid-controller-json'
    });
  }
}

class ControllerClient {
  constructor({ controller, secret = '', fetchImpl = globalThis.fetch, timeout = 10000 }) {
    this.controller = normalizeControllerUrl(controller);
    this.secret = secret;
    this.fetchImpl = fetchImpl;
    this.timeout = timeout;
  }

  async request(route, options = {}) {
    const { timeout: optionTimeout, signal, headers: optionHeaders, ...fetchOptions } = options;
    const headers = authHeaders(this.secret, { Accept: 'application/json', ...optionHeaders });
    const timeout = optionTimeout || this.timeout;
    const composed = composeSignal(signal, timeout);
    try {
      const response = await this.fetchImpl(`${this.controller}${route}`, {
        ...fetchOptions,
        redirect: 'error',
        signal: composed.signal,
        headers
      });
      const body = await readJsonResponse(response);
      if (!response.ok) {
        throw Object.assign(new Error(`Mihomo Controller returned HTTP ${response.status}`), {
          status: response.status,
          controllerStatus: response.status,
          code: 'controller-http-error'
        });
      }
      return body;
    } catch (error) {
      if (composed.signal.aborted && composed.signal.reason instanceof Error) throw composed.signal.reason;
      throw error;
    } finally {
      composed.cleanup();
    }
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
        error.controllerStatus === 401 || error.status === 401 ? DiagnosticCode.AUTH_REQUIRED : DiagnosticCode.CONTROLLER_UNAVAILABLE,
        error.controllerStatus === 401 || error.status === 401 ? 'Controller authentication is required or the saved secret is invalid' : 'Controller is unavailable'
      )
    };
  }
}

module.exports = {
  ControllerClient,
  authHeaders,
  composeSignal,
  normalizeControllerUrl,
  parseConfig,
  probeConfigBackend,
  safeBackend
};
