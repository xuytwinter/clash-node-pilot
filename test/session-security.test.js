const test = require('node:test');
const assert = require('node:assert/strict');
const { createLocalSession, validateLocalApiRequest } = require('../src/core/security');

function request(headers = {}, method = 'GET') {
  return { method, socket: { localPort: 3210 }, headers: { host: '127.0.0.1:3210', ...headers } };
}

function bootstrap(session, req = request()) {
  const response = {};
  session.bootstrap(req, {
    writeHead(status, headers) { Object.assign(response, { status, headers }); },
    end(body) { response.body = JSON.parse(body); }
  });
  return response;
}

test('session bootstrap returns a stable in-memory token with no-store protection', () => {
  const session = createLocalSession();
  const response = bootstrap(session, request({ origin: 'http://127.0.0.1:3210', 'sec-fetch-site': 'same-origin' }));
  assert.equal(response.status, 200);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.equal(response.headers['Cross-Origin-Resource-Policy'], 'same-origin');
  assert.match(response.body.token, /^[a-f0-9]{64}$/);
  assert.equal(bootstrap(session).body.token, response.body.token);
  assert.notEqual(bootstrap(createLocalSession()).body.token, response.body.token);
  assert.deepEqual(Object.keys(session).sort(), ['authorize', 'bootstrap']);
});

test('authorization rejects absent, wrong, malformed, and another process session token', () => {
  const session = createLocalSession();
  const token = bootstrap(session).body.token;
  const invalid = [undefined, '', 'short', 'g'.repeat(64), '\u00e9'.repeat(64), [token], bootstrap(createLocalSession()).body.token];
  for (const value of invalid) {
    assert.throws(() => session.authorize(request({ 'x-pilot-session': value })), { code: 'invalid-session', status: 403 });
  }
  assert.equal(session.authorize(request({ 'x-pilot-session': token })), true);
});

test('GET and HEAD enforce Host, Origin, Referer, and Fetch Metadata boundaries', () => {
  const cases = [
    [{ host: 'attacker.test:3210' }, 'invalid-host'],
    [{ host: 'localhost :3210' }, 'invalid-host'],
    [{ origin: 'https://attacker.test' }, 'cross-origin-request'],
    [{ origin: 'http://127.0.0.1:3211' }, 'cross-origin-request'],
    [{ origin: 'http://localhost:3210' }, 'cross-origin-request'],
    [{ origin: 'null' }, 'cross-origin-request'],
    [{ origin: '' }, 'cross-origin-request'],
    [{ referer: 'http://attacker.test/path' }, 'cross-origin-request'],
    [{ referer: '' }, 'cross-origin-request'],
    [{ 'sec-fetch-site': 'cross-site' }, 'cross-site-request'],
    [{ 'sec-fetch-site': 'same-site' }, 'cross-site-request']
  ];
  const session = createLocalSession();
  const token = bootstrap(session).body.token;
  for (const [headers, code] of cases) {
    for (const method of ['GET', 'HEAD']) {
      assert.throws(() => validateLocalApiRequest(request(headers, method)), { code, status: 403 });
      assert.throws(() => session.authorize(request({ ...headers, 'x-pilot-session': token }, method)), { code, status: 403 });
    }
    assert.throws(() => bootstrap(session, request(headers)), { code, status: 403 });
  }
});

test('bootstrap permits local clients and same-origin browser requests, but only GET', () => {
  const session = createLocalSession();
  for (const headers of [{}, { 'sec-fetch-site': 'none' }, { referer: 'http://127.0.0.1:3210/index.html' }]) {
    assert.equal(bootstrap(session, request(headers)).status, 200);
  }
  assert.throws(() => bootstrap(session, request({}, 'POST')), { code: 'method-not-allowed', status: 405 });
});
