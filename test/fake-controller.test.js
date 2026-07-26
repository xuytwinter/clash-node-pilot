const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { ControllerClient } = require('../src/core/controller');
const {
  measureNode,
  measureNodeStable,
  selectorGroupsFromPayload
} = require('../src/core/optimizer');

function createFakeController() {
  const state = {
    active: 'JP Fast',
    secret: 'unit-secret',
    delays: { 'JP Fast': 42, 'JP Slow': 180, 'US Fast': 70 }
  };
  const server = http.createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${state.secret}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Unauthorized' }));
      return;
    }
    if (req.method === 'GET' && req.url === '/version') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ version: 'fake-mihomo-1.0' }));
      return;
    }
    if (req.method === 'GET' && req.url === '/proxies') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        proxies: {
          Proxy: { type: 'Selector', now: state.active, all: ['JP Fast', 'JP Slow', 'US Fast', 'DIRECT', 'Auto'] },
          Auto: { type: 'URLTest', now: 'JP Fast', all: ['JP Fast', 'US Fast'] },
          'JP Fast': { type: 'Shadowsocks' },
          'JP Slow': { type: 'Shadowsocks' },
          'US Fast': { type: 'Trojan' },
          DIRECT: { type: 'Direct' }
        }
      }));
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/proxies/')) {
      const name = decodeURIComponent(req.url.split('/')[2]);
      const delay = state.delays[name];
      res.writeHead(delay ? 200 : 504, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(delay ? { delay } : { message: 'timeout' }));
      return;
    }
    if (req.method === 'PUT' && req.url === '/proxies/Proxy') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      state.active = JSON.parse(Buffer.concat(chunks).toString('utf8')).name;
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

test('shared controller and optimizer core operate against a fake Mihomo Controller', async () => {
  const fake = createFakeController();
  const port = await fake.listen();
  try {
    const client = new ControllerClient({ controller: `http://127.0.0.1:${port}`, secret: fake.state.secret });
    assert.equal((await client.version()).version, 'fake-mihomo-1.0');
    const inventory = selectorGroupsFromPayload(await client.request('/proxies'));
    assert.deepEqual(inventory.groups, [{ name: 'Proxy', now: 'JP Fast', members: ['JP Fast', 'JP Slow', 'US Fast'] }]);
    assert.deepEqual(await measureNode(client.request.bind(client), 'JP Fast', 'https://example.test/generate_204', 1000), { name: 'JP Fast', delay: 42, ok: true });
    assert.equal((await measureNodeStable(client.request.bind(client), 'JP Slow', 'https://example.test/generate_204', 1000, 2)).delay, 180);
    await client.request('/proxies/Proxy', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'US Fast' }) });
    assert.equal(fake.state.active, 'US Fast');
  } finally {
    await fake.close();
  }
});

test('fake Controller rejects missing secrets without leaking them', async () => {
  const fake = createFakeController();
  const port = await fake.listen();
  try {
    const client = new ControllerClient({ controller: `http://127.0.0.1:${port}`, secret: '' });
    await assert.rejects(() => client.version(), /Unauthorized/);
  } finally {
    await fake.close();
  }
});
