const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'clash-node-pilot-security-'));
process.env.APPDATA = path.join(sandbox, 'Roaming');
process.env.LOCALAPPDATA = path.join(sandbox, 'Local');
process.env.USERPROFILE = sandbox;
process.env.HOME = sandbox;
process.env.CLASH_PILOT_STATE = path.join(sandbox, 'state.json');
process.env.CLASH_PILOT_DISABLE_AUTO_LOOP = '1';
process.env.PORT = '0';

const { server } = require('../server');
const { isAllowedHostHeader, isSameLocalOrigin, normalizeControllerUrl, normalizeProbeUrl } = require('../src/core/security');

function listen(app) {
  return new Promise((resolve) => app.listen(0, '127.0.0.1', () => resolve(app.address().port)));
}

function close(app) {
  return new Promise((resolve) => app.close(resolve));
}

function request(port, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: options.path || '/api/health',
      method: options.method || 'GET',
      headers: { Host: `127.0.0.1:${port}`, ...(options.headers || {}) }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (options.body !== undefined) req.end(options.body);
    else req.end();
  });
}

test('controller and probe URLs are constrained to local controllers and trusted HTTPS probes', () => {
  assert.equal(normalizeControllerUrl('0.0.0.0:9097'), 'http://127.0.0.1:9097');
  assert.equal(normalizeControllerUrl('http://localhost:9097/'), 'http://localhost:9097');
  assert.throws(() => normalizeControllerUrl('http://192.168.1.2:9097'), { code: 'controller-not-local' });
  assert.throws(() => normalizeControllerUrl('http://user:pass@127.0.0.1:9097'), { code: 'invalid-controller-url' });
  assert.equal(normalizeProbeUrl('https://www.gstatic.com/generate_204'), 'https://www.gstatic.com/generate_204');
  assert.throws(() => normalizeProbeUrl('http://www.gstatic.com/generate_204'), { code: 'invalid-probe-url' });
  assert.throws(() => normalizeProbeUrl('https://127.0.0.1/generate_204'), { code: 'invalid-probe-url' });
  assert.throws(() => normalizeProbeUrl('https://example.com/generate_204'), { code: 'probe-url-not-allowed' });
});

test('host and origin validation requires strict syntax and matching effective port', () => {
  assert.equal(isAllowedHostHeader('localhost:3210', { port: 3210 }), true);
  assert.equal(isAllowedHostHeader('[::1]:3210', { port: 3210 }), true);
  assert.equal(isAllowedHostHeader('localhost', { port: 3210 }), false);
  assert.equal(isAllowedHostHeader('other@localhost:3210', { port: 3210 }), false);
  assert.equal(isAllowedHostHeader('localhost:3210/path', { port: 3210 }), false);

  assert.equal(isSameLocalOrigin('http://localhost:3210', { port: 3210, serialized: true }), true);
  assert.equal(isSameLocalOrigin('http://localhost', { port: 3210, serialized: true }), false);
  assert.equal(isSameLocalOrigin('https://localhost:3210', { port: 3210, serialized: true }), false);
  assert.equal(isSameLocalOrigin('http://localhost:3210/path', { port: 3210, serialized: true }), false);
  assert.equal(isSameLocalOrigin('http://localhost:3210/path', { port: 3210 }), true);
});

test('local HTTP API rejects hostile request boundaries before routing', async () => {
  const port = await listen(server);
  try {
    const ok = await request(port);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers['x-content-type-options'], 'nosniff');

    const badHost = await request(port, { headers: { Host: 'attacker.test' } });
    assert.equal(badHost.status, 403);
    assert.match(badHost.body, /invalid-host/);

    const malformedHost = await request(port, { headers: { Host: `other@localhost:${port}` } });
    assert.equal(malformedHost.status, 403);
    assert.match(malformedHost.body, /invalid-host/);

    const badOrigin = await request(port, {
      path: '/api/automation',
      method: 'POST',
      headers: { Origin: 'https://evil.test', 'Content-Type': 'application/json' },
      body: '{}'
    });
    assert.equal(badOrigin.status, 403);
    assert.match(badOrigin.body, /cross-origin-request/);

    const defaultPortOrigin = await request(port, {
      path: '/api/automation',
      method: 'POST',
      headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
      body: '{}'
    });
    assert.equal(defaultPortOrigin.status, 403);
    assert.match(defaultPortOrigin.body, /cross-origin-request/);

    const wrongContentType = await request(port, { path: '/api/automation', method: 'POST', body: '{}' });
    assert.equal(wrongContentType.status, 415);
    assert.match(wrongContentType.body, /unsupported-media-type/);

    const badJson = await request(port, {
      path: '/api/automation',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{'
    });
    assert.equal(badJson.status, 400);
    assert.match(badJson.body, /invalid-json/);

    const traversal = await request(port, { path: '/..%2Fserver.js' });
    assert.equal(traversal.status, 403);
    assert.match(traversal.body, /static-forbidden/);
  } finally {
    await close(server);
  }
});
