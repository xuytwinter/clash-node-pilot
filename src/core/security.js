const net = require('node:net');
const { randomBytes, timingSafeEqual } = require('node:crypto');

const DEFAULT_ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

const DEFAULT_PROBE_URLS = new Set([
  'https://www.gstatic.com/generate_204',
  'https://connectivitycheck.gstatic.com/generate_204',
  'https://cp.cloudflare.com/generate_204',
  'https://www.google.com/generate_204'
]);

function securityError(message, code, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function normalizeHostname(hostname) {
  return String(hostname || '').trim().toLowerCase().replace(/^\[(.*)\]$/, '$1');
}

function parsePort(value) {
  if (value === undefined || value === '') return null;
  if (!/^\d+$/.test(value)) return null;
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

function parseHostHeader(hostHeader) {
  if (typeof hostHeader !== 'string' || !hostHeader.trim()) return null;
  const value = hostHeader.trim();
  if (value !== hostHeader || /[\s\\@/?#]/.test(value)) return null;

  let host;
  let portText;
  if (value.startsWith('[')) {
    const match = value.match(/^\[([^\]]+)\](?::(\d+))?$/);
    if (!match) return null;
    host = match[1];
    portText = match[2];
  } else {
    const match = value.match(/^([^:]+)(?::(\d+))?$/);
    if (!match) return null;
    host = match[1];
    portText = match[2];
  }
  const port = parsePort(portText);
  if (portText !== undefined && port === null) return null;
  return { hostname: normalizeHostname(host), port };
}

function isAllowedHostHeader(hostHeader, { port, allowedHosts = DEFAULT_ALLOWED_HOSTS } = {}) {
  const parsed = parseHostHeader(hostHeader);
  if (!parsed) return false;
  if (!allowedHosts.has(parsed.hostname)) return false;
  if (!port) return true;
  const effectivePort = parsed.port || 80;
  return effectivePort === Number(port);
}

function isSameLocalOrigin(value, { port, allowedHosts = DEFAULT_ALLOWED_HOSTS, protocol = 'http:', serialized = false } = {}) {
  if (typeof value !== 'string' || !value.trim()) return true;
  try {
    if (serialized && value.trim() !== value) return false;
    const origin = new URL(value);
    if (origin.protocol !== protocol) return false;
    if (serialized && value !== origin.origin) return false;
    const hostname = normalizeHostname(origin.hostname);
    if (!allowedHosts.has(hostname)) return false;
    if (!port) return true;
    const effectivePort = origin.port ? Number(origin.port) : (origin.protocol === 'https:' ? 443 : 80);
    return effectivePort === Number(port);
  } catch {
    return false;
  }
}

function validateLocalApiRequest(req, { port = req.socket?.localPort } = {}) {
  if (!isAllowedHostHeader(req.headers.host, { port })) {
    throw securityError('Rejected request host', 'invalid-host', 403);
  }
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const fetchSite = req.headers['sec-fetch-site'];
  const requestOrigin = new URL(`http://${req.headers.host}`).origin;
  if (origin !== undefined && (!isSameLocalOrigin(origin, { port, serialized: true }) || origin !== requestOrigin)) {
    throw securityError('Rejected cross-origin request', 'cross-origin-request', 403);
  }
  if (origin === undefined && referer !== undefined
    && (typeof referer !== 'string' || !referer.trim()
      || !isSameLocalOrigin(referer, { port }) || new URL(referer).origin !== requestOrigin)) {
    throw securityError('Rejected cross-origin request', 'cross-origin-request', 403);
  }
  if (fetchSite !== undefined && !['same-origin', 'none'].includes(fetchSite)) {
    throw securityError('Rejected cross-site request', 'cross-site-request', 403);
  }
}

function createLocalSession() {
  const token = randomBytes(32).toString('hex');
  const expected = Buffer.from(token, 'ascii');

  function authorize(req, options) {
    validateLocalApiRequest(req, options);
    const supplied = req.headers['x-pilot-session'];
    if (typeof supplied !== 'string' || supplied.length !== token.length) {
      throw securityError('A valid local session is required', 'invalid-session', 403);
    }
    const candidate = Buffer.from(supplied, 'utf8');
    if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) {
      throw securityError('A valid local session is required', 'invalid-session', 403);
    }
    return true;
  }

  function bootstrap(req, res, options) {
    validateLocalApiRequest(req, options);
    if (req.method !== 'GET') {
      throw securityError('Session bootstrap requires GET', 'method-not-allowed', 405);
    }
    res.writeHead(200, {
      ...securityHeaders(),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify({ token }));
  }

  return Object.freeze({ authorize, bootstrap });
}

function requireJsonContentType(req) {
  const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw securityError('Expected application/json request body', 'unsupported-media-type', 415);
  }
}

function isPrivateIpv4(hostname) {
  const parts = hostname.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || a === 0
    || a >= 224;
}

function normalizeProbeUrl(value, { allowed = DEFAULT_PROBE_URLS } = {}) {
  if (typeof value !== 'string' || !value.trim()) return [...allowed][0];
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw securityError('Probe URL is invalid', 'invalid-probe-url', 400);
  }
  parsed.hash = '';
  const normalized = parsed.href.replace(/\/$/, '');
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw securityError('Probe URL must be a trusted HTTPS endpoint', 'invalid-probe-url', 400);
  }
  const hostname = normalizeHostname(parsed.hostname);
  if (net.isIP(hostname) && isPrivateIpv4(hostname)) {
    throw securityError('Probe URL must not target local or private addresses', 'invalid-probe-url', 400);
  }
  if (!allowed.has(normalized)) {
    throw securityError('Probe URL is not in the trusted endpoint allowlist', 'probe-url-not-allowed', 400);
  }
  return normalized;
}

function normalizeControllerUrl(controller) {
  const value = String(controller || '127.0.0.1:9097').trim().replace(/\/+$/, '');
  const withScheme = /^https?:\/\//i.test(value) ? value : `http://${value}`;
  let parsed;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw securityError('Controller URL is invalid', 'invalid-controller-url', 400);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw securityError('Controller URL must use HTTP or HTTPS', 'invalid-controller-url', 400);
  }
  if (parsed.username || parsed.password) {
    throw securityError('Controller URL must not contain credentials', 'invalid-controller-url', 400);
  }
  const hostname = normalizeHostname(parsed.hostname);
  if (hostname === '0.0.0.0') parsed.hostname = '127.0.0.1';
  else if (!DEFAULT_ALLOWED_HOSTS.has(hostname)) {
    throw securityError('Controller URL must point to the local machine', 'controller-not-local', 400);
  }
  if (parsed.pathname !== '/') parsed.pathname = '/';
  parsed.search = '';
  parsed.hash = '';
  return parsed.href.replace(/\/$/, '');
}

function securityHeaders({ html = false } = {}) {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Resource-Policy': 'same-origin',
    ...(html ? {
      'Content-Security-Policy': "default-src 'self'; connect-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
    } : {})
  };
}

module.exports = {
  DEFAULT_ALLOWED_HOSTS,
  DEFAULT_PROBE_URLS,
  createLocalSession,
  isAllowedHostHeader,
  isSameLocalOrigin,
  normalizeControllerUrl,
  normalizeProbeUrl,
  requireJsonContentType,
  securityHeaders,
  validateLocalApiRequest
};
