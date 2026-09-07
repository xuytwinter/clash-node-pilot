const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = (server) => new Promise((resolve) => server.close(resolve));

for (const endpoint of ['/api/connectivity-heal', '/api/auto-optimize']) {
  for (const verified of [true, false]) {
    test(`${endpoint} retains ${verified ? 'verified' : 'unknown'} selector outcome after post-job persistence failure`, async () => {
      const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-commit-persistence-'));
      const statePath = path.join(sandbox, 'state.json');
      let active = 'Japan 01';
      let writes = 0;
      let verificationUnavailable = !verified;
      const controller = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        const send = (status, body) => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(body));
        };
        if (url.pathname === '/version') return send(200, { version: '1.0.0' });
        if (url.pathname === '/proxies') {
          if (writes && verificationUnavailable) return send(503, { message: 'Verification unavailable' });
          return send(200, { proxies: {
            'AI Sites': { type: 'Selector', now: 'Proxy Select', all: ['Proxy Select'] },
            'Proxy Select': { type: 'Selector', now: active, all: ['Japan 01', 'Japan 02'] },
            'Japan 01': { type: 'Vless' }, 'Japan 02': { type: 'Vless' }
          } });
        }
        if (url.pathname.endsWith('/delay')) {
          const name = decodeURIComponent(url.pathname.split('/')[2]);
          const failed = name === 'Japan 01' && url.searchParams.get('url').includes('chatgpt.com');
          return send(failed ? 504 : 200, failed ? { message: 'timeout' } : { delay: 50 });
        }
        if (req.method === 'PUT' && url.pathname === '/proxies/Proxy%20Select') {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          active = JSON.parse(Buffer.concat(chunks).toString()).name;
          writes += 1;
          // Invalidate only this test's state destination after the external write.
          fs.rmSync(statePath, { force: true });
          fs.mkdirSync(statePath);
          res.writeHead(204);
          return res.end();
        }
        send(404, {});
      });
      const controllerPort = await listen(controller);
      const configPath = path.join(sandbox, 'config.yaml');
      fs.writeFileSync(configPath, `external-controller: 127.0.0.1:${controllerPort}\n`);
      const overrides = {
        APPDATA: path.join(sandbox, 'Roaming'), LOCALAPPDATA: path.join(sandbox, 'Local'), USERPROFILE: sandbox, HOME: sandbox,
        CLASH_CONFIG: configPath, CLASH_PILOT_STATE: statePath, CLASH_PILOT_DISABLE_AUTO_LOOP: '1',
        CLASH_PILOT_DISABLE_OS_INTEGRATION: '1', CLASH_PILOT_DEMO: '1', CLASH_TARGET_GROUP: 'AI Sites', PORT: '0'
      };
      const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
      Object.assign(process.env, overrides);
      delete require.cache[require.resolve('../server')];
      const { server } = require('../server');
      try {
        const port = await listen(server);
        const base = `http://127.0.0.1:${port}`;
        const { token } = await (await fetch(`${base}/api/session`)).json();
        const response = await fetch(`${base}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-pilot-session': token }, body: JSON.stringify({ force: true }) });
        const body = await response.json();
        assert.equal(response.status, 507);
        assert.equal(body.code, 'state-save-failed');
        assert.equal(writes, 1);
        assert.equal(active, 'Japan 02');
        assert.equal(body.commit.started, true);
        assert.equal(body.commit.verified, verified);
        assert.equal(body.commit.writeResult, verified ? 'verified' : 'unknown');
        assert.equal(body.active, verified ? 'Japan 02' : null);
        assert.equal(body.persistence.writable, false);
        verificationUnavailable = false;
        const status = await (await fetch(`${base}/api/status`, { headers: { 'x-pilot-session': token } })).json();
        assert.equal(status.automation.currentJob, null);
      } finally {
        await close(server);
        await close(controller);
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    });
  }
}
