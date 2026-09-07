const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

function createFakeController() {
  const state = { scenario: 'degraded', scenarios: ['healthy', 'degraded', 'target-outage'] };
  let scenarioGate = null;
  let scenarioStarted;
  const started = new Promise((resolve) => { scenarioStarted = resolve; });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && req.url === '/version') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ version: 'fake-demo' }));
      return;
    }
    if (req.method === 'GET' && req.url === '/proxies') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        proxies: {
          'Proxy Select': { type: 'Selector', now: 'Japan 01', all: ['Japan 01'] },
          'Japan 01': { type: 'Vless' }
        }
      }));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/demo/state') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(state));
      return;
    }
    if (req.method === 'PUT' && url.pathname === '/demo/scenario') {
      scenarioStarted();
      if (scenarioGate) await scenarioGate;
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      if (!state.scenarios.includes(body.scenario)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'unknown scenario' }));
        return;
      }
      state.scenario = body.scenario;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(state));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'not found' }));
  });
  return {
    state,
    started,
    holdScenario() { let release; scenarioGate = new Promise((resolve) => { release = resolve; }); return release; },
    listen: () => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port))),
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

function listen(app) {
  return new Promise((resolve) => app.listen(0, '127.0.0.1', () => resolve(app.address().port)));
}

function close(app) {
  return new Promise((resolve) => app.close(resolve));
}

async function requestJson(port, pathName, { method = 'GET', body } = {}) {
  const { token } = await (await fetch(`http://127.0.0.1:${port}/api/session`)).json();
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathName,
      method,
      headers: {
        'x-pilot-session': token,
        Host: `127.0.0.1:${port}`,
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {})
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, body: text ? JSON.parse(text) : {} });
      });
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

test('demo mode exposes only the fake backend and disables OS integrations', async () => {
  const fake = createFakeController();
  const fakePort = await fake.listen();
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'clash-node-pilot-demo-test-'));
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
  process.env.PORT = '0';
  delete process.env.V2RAYN_HOME;

  delete require.cache[require.resolve('../server')];
  const { server } = require('../server');
  const pilotPort = await listen(server);
  try {
    const status = await requestJson(pilotPort, '/api/status');
    assert.equal(status.status, 200);
    assert.deepEqual(status.body.backends.map((backend) => backend.id), ['demo']);
    assert.equal(status.body.backend.id, 'demo');
    assert.equal(status.body.startup.supported, false);
    assert.equal(status.body.startup.reason, 'demo-mode');
    assert.deepEqual(status.body.demo, { enabled: true, scenario: 'degraded', scenarios: ['healthy', 'degraded', 'target-outage'] });
    assert.equal(status.body.detectedClients.some((client) => client.id === 'clash-verge'), false);
    assert.equal(status.body.detectedClients.find((client) => client.id === 'v2rayn')?.online, false);

    const startup = await requestJson(pilotPort, '/api/startup', { method: 'POST', body: { enabled: true } });
    assert.equal(startup.status, 403);
    assert.equal(startup.body.code, 'startup-disabled');

    await requestJson(pilotPort, '/api/automation', { method: 'POST', body: { action: 'lock' } });
    await requestJson(pilotPort, '/api/automation', { method: 'POST', body: { action: 'monitor', value: true } });
    const releaseScenario = fake.holdScenario();
    const resetting = requestJson(pilotPort, '/api/demo-scenario', { method: 'POST', body: { scenario: 'target-outage' } });
    await fake.started;
    try {
      const overlapping = await requestJson(pilotPort, '/api/demo-scenario', { method: 'POST', body: { scenario: 'healthy' } });
      assert.equal(overlapping.status, 409);
      assert.equal(overlapping.body.code, 'job-conflict');
    } finally { releaseScenario(); }
    const scenario = await resetting;
    assert.equal(scenario.status, 200);
    assert.equal(scenario.body.scenario, 'target-outage');
    assert.equal(fake.state.scenario, 'target-outage');
    const reset = await requestJson(pilotPort, '/api/status');
    assert.equal(reset.body.automation.lockMs, 0);
    assert.equal(reset.body.automation.monitorOnly, false);
    assert.equal(reset.body.automation.lastResults, null);
    assert.deepEqual(reset.body.automation.history, []);
  } finally {
    await close(server);
    await fake.close();
  }
});
