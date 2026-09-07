let testTime = null;

function now() {
  return testTime === null ? Date.now() : testTime;
}

function setForTesting(epochMs) {
  if (!Number.isFinite(epochMs)) throw new TypeError('Clock time must be finite');
  testTime = epochMs;
}

function reset() {
  testTime = null;
}

module.exports = { now, setForTesting, reset };
