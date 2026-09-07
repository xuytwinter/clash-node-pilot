const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

function createFakeController() {
  const state = { active: { 'AI Sites': 'Proxy Select', 'Proxy Select': 'Japan 01' } };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/version') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ version: 'fake-mihomo-1.0' }));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/proxies') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        proxies: {
          'AI Sites': { type: 'Selector', now: state.active['AI Sites'], all: ['Proxy Select', 'US 01'] },
          'Proxy Select': { type: 'Selector', now: state.active['Proxy Select'], all: ['Japan 01', 'Japan 02'] },
          'Japan 01': { type: 'Vless' },
          'Japan 02': { type: 'Vless' },
          'US 01': { type: 'Vless' }
        }
      }));
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/proxies/') && url.pathname.endsWith('/delay')) {
      const name = decodeURIComponent(url.pathname.split('/')[2]);
      const target = url.searchParams.get('url') || '';
      const fails = name === 'Japan 01' && target.includes('chatgpt.com');
      res.writeHead(fails ? 504 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(fails ? { message: 'timeout' } : { delay: name === 'Japan 02' ? 55 : 95 }));
      return;
    }
    if (req.method === 'PUT' && url.pathname === '/proxies/Proxy%20Select') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      state.active['Proxy Select'] = JSON.parse(Buffer.concat(chunks).toString('utf8')).name;
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'not found' }));
  });
  return {
    state,
    listen: () => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port))),
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function postJson(port, pathName, body = {}) {
  const { token } = await (await fetch(`http://127.0.0.1:${port}/api/session`)).json();
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathName,
      method: 'POST',
      headers: {
        'x-pilot-session': token,
        Host: `127.0.0.1:${port}`,
        'Content-Type': 'application/json'
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

test('connectivity heal switches the inner selector that owns the failing real node', async () => {
  const fake = createFakeController();
  const fakePort = await fake.listen();
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'clash-node-pilot-heal-'));
  const configPath = path.join(sandbox, 'config.yaml');
  fs.writeFileSync(configPath, `external-controller: 127.0.0.1:${fakePort}\n`, 'utf8');
  process.env.APPDATA = path.join(sandbox, 'Roaming');
  process.env.LOCALAPPDATA = path.join(sandbox, 'Local');
  process.env.USERPROFILE = sandbox;
  process.env.HOME = sandbox;
  process.env.CLASH_CONFIG = configPath;
  process.env.CLASH_PILOT_STATE = path.join(sandbox, 'state.json');
  process.env.CLASH_PILOT_DISABLE_AUTO_LOOP = '1';
  process.env.CLASH_PILOT_DEMO = '1';
  process.env.CLASH_PILOT_DISABLE_OS_INTEGRATION = '1';
  process.env.CLASH_TARGET_GROUP = 'AI Sites';
  process.env.PORT = '0';

  const { server } = require('../server');
  const pilotPort = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
  try {
    const response = await postJson(pilotPort, '/api/connectivity-heal', {});
    assert.equal(response.status, 200);
    assert.equal(response.body.switched, true);
    assert.equal(response.body.group, 'AI Sites');
    assert.equal(response.body.controlGroup, 'Proxy Select');
    assert.equal(response.body.active, 'Japan 02');
    assert.equal(fake.state.active['AI Sites'], 'Proxy Select');
    assert.equal(fake.state.active['Proxy Select'], 'Japan 02');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fake.close();
  }
});
