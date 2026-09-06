const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

function createFakeController() {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/version') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ version: 'fake-state' }));
      return;
    }
    if (req.method === 'GET' && req.url === '/proxies') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        proxies: {
          Proxy: { type: 'Selector', now: 'Japan 01', all: ['Japan 01'] },
          'Japan 01': { type: 'Vless' }
        }
      }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'not found' }));
  });
  return {
    listen: () => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port))),
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

function getJson(port, pathName) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathName,
      method: 'GET',
      headers: { Host: `127.0.0.1:${port}` }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('server preserves future state and restores the latest readable backup', async () => {
  const fake = createFakeController();
  const fakePort = await fake.listen();
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'clash-node-pilot-state-recovery-'));
  const configPath = path.join(sandbox, 'config.yaml');
  const statePath = path.join(sandbox, 'state.json');
  fs.writeFileSync(configPath, `external-controller: 127.0.0.1:${fakePort}\n`, 'utf8');
  fs.writeFileSync(statePath, JSON.stringify({ schemaVersion: 999, monitorOnly: false }), 'utf8');
  fs.writeFileSync(`${statePath}.bak`, JSON.stringify({ schemaVersion: 2, monitorOnly: true, history: [{ restored: true }] }), 'utf8');

  process.env.APPDATA = path.join(sandbox, 'Roaming');
  process.env.LOCALAPPDATA = path.join(sandbox, 'Local');
  process.env.USERPROFILE = sandbox;
  process.env.HOME = sandbox;
  process.env.CLASH_CONFIG = configPath;
  process.env.CLASH_PILOT_STATE = statePath;
  process.env.CLASH_PILOT_DISABLE_AUTO_LOOP = '1';
  process.env.CLASH_PILOT_DISABLE_OS_INTEGRATION = '1';
  process.env.PORT = '0';

  delete require.cache[require.resolve('../server')];
  const { server } = require('../server');
  const pilotPort = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
  try {
    const status = await getJson(pilotPort, '/api/status');
    assert.equal(status.status, 200);
    assert.equal(status.body.automation.monitorOnly, true);
    assert.deepEqual(status.body.automation.history, [{ restored: true }]);
    assert.equal(fs.existsSync(`${statePath}.future`), true);
    assert.equal(status.body.diagnostics.some((item) => item.code === 'state-restored-from-backup'), true);
    assert.equal(status.body.diagnostics.some((item) => item.code === 'state-future-schema'), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fake.close();
  }
});
