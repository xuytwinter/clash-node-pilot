const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOST = '127.0.0.1';
const SCENARIOS = new Set(['healthy', 'degraded', 'regional-outage', 'target-outage']);

function parseArgs(argv) {
  const options = { scenario: process.env.CLASH_PILOT_DEMO_SCENARIO || 'degraded', auto: true };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--scenario') options.scenario = argv[++index] || options.scenario;
    else if (argv[index].startsWith('--scenario=')) options.scenario = argv[index].slice('--scenario='.length);
    else if (argv[index] === '--no-auto') options.auto = false;
  }
  if (!SCENARIOS.has(options.scenario)) {
    throw new Error(`Unknown demo scenario "${options.scenario}". Use one of: ${[...SCENARIOS].join(', ')}`);
  }
  return options;
}

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

async function findPilotPort() {
  for (let port = 3210; port < 3230; port++) {
    const probe = http.createServer((req, res) => res.end('ok'));
    try {
      await listen(probe, port);
      await new Promise((resolve) => probe.close(resolve));
      return port;
    } catch {
      await new Promise((resolve) => probe.close(resolve));
    }
  }
  return 0;
}

function nodeOutcome(name, targetUrl, scenario) {
  const isOpenAI = targetUrl.includes('chatgpt.com');
  const isJapan = name.startsWith('Japan');
  if (scenario === 'target-outage' && isOpenAI) return null;
  if (scenario === 'regional-outage' && isJapan) return null;
  if (scenario === 'degraded' && name === 'Japan 01' && isOpenAI) return null;
  const delays = {
    'Japan 01': 48,
    'Japan 02': 62,
    'Hong Kong 01': 82,
    'Singapore 01': 96,
    'US 01': 135
  };
  return delays[name] || null;
}

function createFakeController(options) {
  const initialActive = () => ({ 'AI Sites': 'Proxy Select', 'Proxy Select': 'Japan 01', Final: 'Proxy Select' });
  const state = {
    scenario: options.scenario,
    active: initialActive()
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${HOST}`);
    if (req.method === 'GET' && url.pathname === '/version') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ version: `fake-mihomo-demo-${state.scenario}` }));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/proxies') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        proxies: {
          'AI Sites': { type: 'Selector', now: state.active['AI Sites'], all: ['Proxy Select', 'US 01'] },
          Final: { type: 'Selector', now: state.active.Final, all: ['Proxy Select', 'DIRECT'] },
          'Proxy Select': { type: 'Selector', now: state.active['Proxy Select'], all: ['Japan 01', 'Japan 02', 'Hong Kong 01', 'Singapore 01', 'US 01'] },
          'Japan 01': { type: 'Vless' },
          'Japan 02': { type: 'Vless' },
          'Hong Kong 01': { type: 'Vless' },
          'Singapore 01': { type: 'Vless' },
          'US 01': { type: 'Vless' },
          DIRECT: { type: 'Direct' }
        }
      }));
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/proxies/') && url.pathname.endsWith('/delay')) {
      const name = decodeURIComponent(url.pathname.split('/')[2]);
      const delay = nodeOutcome(name, url.searchParams.get('url') || '', state.scenario);
      res.writeHead(delay ? 200 : 504, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(delay ? { delay } : { message: 'demo timeout' }));
      return;
    }
    if (req.method === 'PUT' && url.pathname.startsWith('/proxies/')) {
      const group = decodeURIComponent(url.pathname.split('/')[2]);
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      if (state.active[group] && typeof body.name === 'string') {
        state.active[group] = body.name;
        res.writeHead(204);
        res.end();
        return;
      }
    }
    if (req.method === 'GET' && url.pathname === '/demo/state') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...state, scenarios: [...SCENARIOS] }));
      return;
    }
    if (req.method === 'PUT' && url.pathname === '/demo/scenario') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      if (!SCENARIOS.has(body.scenario)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'unknown scenario' }));
        return;
      }
      state.scenario = body.scenario;
      state.active = initialActive();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...state, scenarios: [...SCENARIOS] }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'not found' }));
  });
  return { server, state };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const demoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clash-node-pilot-demo-'));
  const fake = createFakeController(options);
  const fakePort = await listen(fake.server);
  const pilotPort = await findPilotPort();
  const configPath = path.join(demoRoot, 'config.yaml');
  fs.writeFileSync(configPath, `external-controller: ${HOST}:${fakePort}\n`, 'utf8');

  process.env.APPDATA = path.join(demoRoot, 'Roaming');
  process.env.LOCALAPPDATA = path.join(demoRoot, 'Local');
  process.env.CLASH_CONFIG = configPath;
  process.env.CLASH_PILOT_STATE = path.join(demoRoot, 'state.json');
  process.env.CLASH_TARGET_GROUP = 'Proxy Select';
  process.env.PORT = String(pilotPort);
  process.env.CLASH_PILOT_DEMO = '1';
  process.env.CLASH_PILOT_DISABLE_OS_INTEGRATION = '1';
  process.env.CLASH_PILOT_DISABLE_AUTO_LOOP = '1';
  process.env.CLASH_PILOT_DEMO_AUTO = options.auto ? '1' : '0';
  delete process.env.V2RAYN_HOME;

  const { server } = require('../server');
  const boundPilotPort = await listen(server, pilotPort);
  console.log(`Clash Node Pilot demo: http://${HOST}:${boundPilotPort}`);
  console.log(`Fake Mihomo Controller: http://${HOST}:${fakePort}`);
  console.log(`Scenario: ${options.scenario}`);
  console.log(`Automatic checks: ${options.auto ? 'enabled' : 'disabled'}`);
  console.log(`Demo state directory: ${demoRoot}`);
  console.log('Press Ctrl+C to stop.');

  if (!options.auto) return;
  const { token } = await (await fetch(`http://${HOST}:${boundPilotPort}/api/session`)).json();
  const runScheduledCheck = () => {
    fetch(`http://${HOST}:${boundPilotPort}/api/auto-optimize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-pilot-session': token },
      body: '{}'
    }).catch(() => {});
  };
  setTimeout(runScheduledCheck, 3000);
  setInterval(runScheduledCheck, 15000);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
