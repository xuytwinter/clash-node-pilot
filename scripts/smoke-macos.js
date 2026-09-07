const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');

const [, , sourceApp, root, arch] = process.argv;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const children = new Set();
let output = '';
let active = 'Japan 01';
let puts = 0;
let readsAfterPut = 0;
const fake = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
  if (req.headers.authorization !== 'Bearer smoke-secret') { res.statusCode = 401; return json({}); }
  if (url.pathname === '/version') return json({ version: '1.0.0' });
  if (url.pathname === '/proxies') {
    if (puts) readsAfterPut++;
    return json({ proxies: {
      'Proxy Select': { type: 'Selector', now: active, all: ['Japan 01', 'US 01'] },
      'Japan 01': { type: 'Vless' }, 'US 01': { type: 'Vless' }
    } });
  }
  if (url.pathname.endsWith('/delay')) return json({ delay: 50 });
  if (req.method === 'PUT' && decodeURIComponent(url.pathname) === '/proxies/Proxy Select') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    active = JSON.parse(Buffer.concat(chunks)).name;
    puts++;
    res.statusCode = 204;
    return res.end();
  }
  res.statusCode = 404;
  json({});
});
const blocker = http.createServer((req, res) => res.end('unrelated'));
async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}
async function close(server) {
  if (!server.listening) return;
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
function start(bin, env) {
  const child = spawn(bin, [], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  child.on('error', error => { output += error.message; });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output = (output + data).slice(-16000); });
  return child;
}
const ended = child => child.exitCode !== null || child.signalCode !== null;
async function until(predicate, message, milliseconds = 15000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await wait(100);
  }
  throw new Error(`${message}\n${output}`);
}
async function stop(child) {
  if (!ended(child)) child.kill('SIGTERM');
  await until(() => ended(child), 'Launcher did not quit', 8000);
  children.delete(child);
}
async function main() {
  assert.equal(process.platform, 'darwin');
  assert.equal(process.arch, arch);
  // Exercise a real installed bundle after ejecting its distribution volume.
  const app = path.join(root, '\u5e94\u7528\u7a0b\u5e8f with spaces.app');
  fs.renameSync(sourceApp, app);
  const appRoot = path.join(app, 'Contents/Resources/app');
  const node = path.join(appRoot, 'runtime/node');
  const bin = path.join(app, 'Contents/MacOS/ClashNodePilot');
  const metadata = JSON.parse(fs.readFileSync(path.join(appRoot, 'BUILD-INFO.json')));
  assert.equal(metadata.architecture, arch);
  assert.equal(metadata.sourceWorkingTree, 'clean');
  assert.equal(metadata.sourceSha, execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim());
  execFileSync('codesign', ['--verify', '--deep', '--strict', app]);
  assert.equal(execFileSync(node, ['-p', 'process.arch'], { encoding: 'utf8' }).trim(), arch);
  const controllerPort = await listen(fake);
  const port = await listen(blocker);
  await close(blocker);
  const config = path.join(root, 'controller.yaml');
  const state = path.join(root, 'state.json');
  fs.writeFileSync(config, `external-controller: 127.0.0.1:${controllerPort}\nsecret: smoke-secret\n`);
  const env = { ...process.env, HOME: root, PORT: String(port), CLASH_CONFIG: config,
    CLASH_PILOT_STATE: state, CLASH_PILOT_NO_BROWSER: '1', CLASH_PILOT_DEMO: '1',
    CLASH_PILOT_DISABLE_AUTO_LOOP: '1', CLASH_PILOT_DISABLE_OS_INTEGRATION: '1', CLASH_TARGET_GROUP: 'Proxy Select' };
  const base = `http://127.0.0.1:${port}`;
  const request = (route, options = {}) => fetch(base + route, { ...options, signal: AbortSignal.timeout(3000) });
  async function health(child) {
    let result;
    await until(async () => {
      assert.ok(!ended(child), 'Launcher exited before readiness');
      try { result = await (await request('/api/health')).json(); return result.ok; } catch { return false; }
    }, 'Application health timeout');
    assert.equal(result.version, metadata.version);
    assert.equal(result.port, port);
    assert.match(result.instance, /^[0-9a-f-]{36}$/i);
    await wait(600);
    assert.ok(!ended(child));
    return result;
  }
  let child = start(bin, env);
  const first = await health(child);
  const nodePID = Number(execFileSync('pgrep', ['-P', String(child.pid)], { encoding: 'utf8' }).trim());
  assert.ok(Number.isInteger(nodePID) && nodePID > 1);
  assert.equal((await request('/api/diagnostics')).status, 403);
  const { token } = await (await request('/api/session')).json();
  const headers = { 'x-pilot-session': token, 'Content-Type': 'application/json' };
  const post = async (route, body) => {
    const response = await request(route, { method: 'POST', headers, body: JSON.stringify(body) });
    const value = await response.json();
    assert.equal(response.status, 200, JSON.stringify(value));
    return value;
  };
  const selected = await post('/api/optimize', { group: 'Proxy Select', region: 'us', switch: true });
  assert.equal(selected.active, 'US 01');
  assert.equal(selected.commit?.verified, true);
  assert.equal(puts, 1);
  assert.ok(readsAfterPut > 0);
  await post('/api/automation', { action: 'monitor', value: true });
  const report = await (await request('/api/diagnostics', { headers })).json();
  assert.equal(report.runtime.platform, 'darwin');
  assert.ok(!JSON.stringify(report).includes('smoke-secret'));
  const saved = fs.readFileSync(state, 'utf8');
  const second = start(bin, env);
  await until(() => ended(second), 'Repeated launch created a second persistent application', 8000);
  assert.equal(second.exitCode, 0);
  assert.equal((await health(child)).instance, first.instance);
  await stop(child);
  await until(() => { try { process.kill(nodePID, 0); return false; } catch { return true; } }, 'Owned Node process survived quit');
  child = start(bin, env);
  const restarted = await health(child);
  assert.notEqual(restarted.instance, first.instance);
  assert.equal(fs.readFileSync(state, 'utf8'), saved);
  assert.equal((await request('/api/status', { headers })).status, 403, 'Old session must not survive restart');
  const newSession = await (await request('/api/session')).json();
  const status = await (await request('/api/status', { headers: { 'x-pilot-session': newSession.token } })).json();
  assert.equal(status.automation.monitorOnly, true);
  await stop(child);
  blocker.listen(port, '127.0.0.1');
  await once(blocker, 'listening');
  const conflict = start(bin, env);
  await until(() => ended(conflict), 'Occupied-port check hung', 8000);
  assert.notEqual(conflict.exitCode, 0);
  assert.equal(await (await request('/')).text(), 'unrelated');
  console.log(JSON.stringify({ ok: true, architecture: arch, source: metadata.sourceSha,
    checks: ['dmg-install', 'signature', 'unicode-path', 'sessions', 'selector-readback', 'diagnostics', 'repeat-launch', 'state-restart', 'quit-cleanup', 'occupied-port'] }));
}
main().catch(error => { console.error(error.stack, output); process.exitCode = 1; }).finally(async () => {
  for (const child of children) {
    try { await stop(child); } catch (error) { child.kill('SIGKILL'); console.error(error.message); process.exitCode = 1; }
  }
  await close(fake);
  await close(blocker);
});
