const GROUP_TYPES = new Set(['Selector', 'URLTest', 'Fallback', 'LoadBalance', 'Relay']);
const { DEFAULT_DECISION_SETTINGS, decayedHealth, scoreNode } = require('./decision');

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : Object.assign(new Error('Operation cancelled'), { name: 'AbortError', code: 'operation-cancelled' });
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function jitter(values) {
  if (values.length < 2) return 0;
  const center = median(values);
  const deviations = values.map((value) => Math.abs(value - center)).sort((a, b) => a - b);
  return deviations[Math.floor(deviations.length / 2)];
}

function scopedNodeKey(scope = {}, name) {
  const backendId = scope.backendId || 'default';
  const group = scope.group || 'default';
  return `${encodeURIComponent(backendId)}|${encodeURIComponent(group)}|${encodeURIComponent(name)}`;
}

async function mapLimit(items, limit, mapper, options = {}) {
  const results = new Array(items.length);
  let cursor = 0;
  let firstError = null;
  const captureError = (error) => {
    if (!firstError) firstError = error;
  };

  async function worker() {
    while (cursor < items.length && !firstError) {
      try {
        throwIfAborted(options.signal);
        const index = cursor++;
        results[index] = await mapper(items[index], index);
        throwIfAborted(options.signal);
      } catch (error) {
        captureError(error);
        break;
      }
    }
  }
  await Promise.allSettled(Array.from({ length: Math.min(limit, items.length) }, worker));
  throwIfAborted(options.signal);
  if (firstError) throw firstError;
  return results;
}

function selectorGroupsFromPayload(payload) {
  const entries = Object.entries(payload.proxies || {});
  const proxies = new Map(entries);
  const groups = entries
    .filter(([, proxy]) => proxy.type === 'Selector')
    .map(([name, proxy]) => ({
      name,
      now: proxy.now,
      members: (proxy.all || []).filter((member) => {
        const item = proxies.get(member);
        return item && !GROUP_TYPES.has(item.type) && !['DIRECT', 'REJECT'].includes(member);
      })
    }))
    .filter((group) => group.members.length > 0);
  return { proxies, groups };
}

async function measureNode(controllerRequest, name, testUrl, timeout) {
  const route = `/proxies/${encodeURIComponent(name)}/delay?timeout=${timeout}&url=${encodeURIComponent(testUrl)}`;
  const started = Date.now();
  try {
    const result = await controllerRequest(route, { timeout: timeout + 1500 });
    return { name, delay: Number(result.delay), ok: Number(result.delay) > 0 };
  } catch (error) {
    return { name, delay: null, ok: false, error: error.message, elapsed: Date.now() - started };
  }
}

async function measureNodeStable(controllerRequest, name, testUrl, timeout, samples = 2, options = {}) {
  const attempts = [];
  for (let index = 0; index < samples; index++) {
    throwIfAborted(options.signal);
    attempts.push(await measureNode(controllerRequest, name, testUrl, timeout));
  }
  const delays = attempts.filter((item) => item.ok).map((item) => item.delay);
  const successCount = delays.length;
  const failureCount = attempts.length - successCount;
  if (!delays.length) {
    return { name, delay: null, ok: false, error: attempts.at(-1)?.error || 'All samples failed', samples: attempts, successCount, failureCount, jitter: null };
  }
  return { name, delay: median(delays), ok: true, samples: attempts, successCount, failureCount, jitter: jitter(delays) };
}

function healthScore(result, health = {}, scope = {}) {
  const key = scopedNodeKey(scope, result.name);
  return scoreNode(result, health[key] || health[result.name] || {}, key).score;
}

function updateHealth(health, results, scope = {}, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const halfLife = Math.max(60000, Number(options.healthHalfLifeMinutes || DEFAULT_DECISION_SETTINGS.healthHalfLifeMinutes) * 60000);
  for (const result of results) {
    const key = scopedNodeKey(scope, result.name);
    const previous = health[key] || {};
    const decayed = decayedHealth(previous, { now, halfLife });
    const item = { name: result.name, backendId: scope.backendId || null, group: scope.group || null, success: decayed.success, failure: decayed.failure, latencies: Array.isArray(previous.latencies) ? previous.latencies : [] };
    item.name = result.name;
    item.backendId = scope.backendId || null;
    item.group = scope.group || null;
    if (result.ok) {
      item.success += result.successCount ?? 1;
      item.failure += result.failureCount ?? 0;
      item.latencies.unshift(result.delay);
      item.latencies = item.latencies.slice(0, 20);
      item.jitter = Number(result.jitter) || 0;
    } else item.failure += result.failureCount ?? 1;
    item.updatedAt = new Date(now).toISOString();
    health[key] = item;
  }
}

module.exports = {
  GROUP_TYPES,
  healthScore,
  jitter,
  mapLimit,
  measureNode,
  measureNodeStable,
  scopedNodeKey,
  selectorGroupsFromPayload,
  throwIfAborted,
  updateHealth
};
