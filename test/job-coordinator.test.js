const test = require('node:test');
const assert = require('node:assert/strict');

const { JobCoordinator } = require('../src/core/jobs');

test('job coordinator rejects overlapping jobs and clears current owner on completion', async () => {
  const coordinator = new JobCoordinator({ now: () => 1000 });
  let finish;
  const running = coordinator.run('manual-optimize', { timeoutMs: 5000, backend: { id: 'a' } }, async () => {
    await new Promise((resolve) => { finish = resolve; });
    return 'done';
  });

  assert.equal(coordinator.snapshot().kind, 'manual-optimize');
  await assert.rejects(
    () => coordinator.run('auto-optimize', { timeoutMs: 5000 }, async () => 'unexpected'),
    { name: 'JobConflictError', code: 'job-conflict', status: 409 }
  );

  finish();
  assert.equal(await running, 'done');
  assert.equal(coordinator.snapshot(), null);
});

test('job coordinator cancellation propagates through the job signal', async () => {
  const coordinator = new JobCoordinator({ now: () => 2000 });
  const running = coordinator.run('manual-optimize', { timeoutMs: 5000 }, async (job) => {
    await new Promise((resolve, reject) => {
      job.signal.addEventListener('abort', () => reject(job.signal.reason), { once: true });
    });
  });

  assert.equal(coordinator.cancel('stop requested'), true);
  await assert.rejects(running, { name: 'JobCancelledError', code: 'job-cancelled', status: 409 });
  assert.equal(coordinator.snapshot(), null);
  assert.equal(coordinator.cancel(), false);
});

test('job coordinator rejects late success after cancellation', async () => {
  const coordinator = new JobCoordinator({ now: () => 3000 });
  let finish;
  const running = coordinator.run('manual-optimize', { timeoutMs: 5000 }, async () => {
    await new Promise((resolve) => { finish = resolve; });
    return 'late success';
  });

  assert.equal(coordinator.cancel('stop requested'), true);
  finish();

  await assert.rejects(running, { name: 'JobCancelledError', code: 'job-cancelled', status: 409 });
  assert.equal(coordinator.snapshot(), null);
});
