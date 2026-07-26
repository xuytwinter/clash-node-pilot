const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'clash-node-pilot-api-test-'));
process.env.APPDATA = path.join(sandbox, 'Roaming');
process.env.LOCALAPPDATA = path.join(sandbox, 'Local');
process.env.USERPROFILE = sandbox;
process.env.HOME = sandbox;
process.env.CLASH_PILOT_STATE = path.join(sandbox, 'state.json');
process.env.CLASH_PILOT_DISABLE_AUTO_LOOP = '1';

const { server } = require('../server');

function listen() {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function close() {
  return new Promise((resolve) => server.close(resolve));
}

test('pairing API stores only non-secret metadata in runtime state', async () => {
  const port = await listen();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/pairings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'manual-test',
        name: 'Manual Test Controller',
        controller: 'http://127.0.0.1:41001',
        secret: 'do-not-return'
      })
    });
    const saved = await response.json();
    assert.equal(response.status, 201);
    assert.equal(saved.id, 'manual-test');
    assert.equal(saved.secret, undefined);
    assert.equal(saved.secretStored, true);

    const listed = await (await fetch(`http://127.0.0.1:${port}/api/pairings`)).json();
    assert.deepEqual(listed.pairings, [{ id: 'manual-test', name: 'Manual Test Controller', controller: 'http://127.0.0.1:41001' }]);
    assert.doesNotMatch(fs.readFileSync(process.env.CLASH_PILOT_STATE, 'utf8'), /do-not-return/);

    const deleted = await fetch(`http://127.0.0.1:${port}/api/pairings/manual-test`, { method: 'DELETE' });
    assert.equal(deleted.status, 200);
  } finally {
    await close();
  }
});
