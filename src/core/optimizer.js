const GROUP_TYPES = new Set(['Selector', 'URLTest', 'Fallback', 'LoadBalance', 'Relay']);

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
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

async function measureNodeStable(controllerRequest, name, testUrl, timeout, samples = 2) {
  const attempts = [];
  for (let index = 0; index < samples; index++) attempts.push(await measureNode(controllerRequest, name, testUrl, timeout));
  const delays = attempts.filter((item) => item.ok).map((item) => item.delay).sort((a, b) => a - b);
  if (!delays.length) return { name, delay: null, ok: false, error: attempts.at(-1)?.error || 'All samples failed', samples: attempts };
  return { name, delay: delays[Math.floor(delays.length / 2)], ok: true, samples: attempts };
}

function healthScore(result, health = {}) {
  const nodeHealth = health[result.name] || { success: 0, failure: 0 };
  const total = nodeHealth.success + nodeHealth.failure;
  const failureRate = total ? nodeHealth.failure / total : 0;
  return result.delay + failureRate * 200;
}

function updateHealth(health, results) {
  for (const result of results) {
    const item = health[result.name] || { success: 0, failure: 0, latencies: [] };
    if (result.ok) {
      item.success++;
      item.latencies.unshift(result.delay);
      item.latencies = item.latencies.slice(0, 20);
    } else item.failure++;
    item.updatedAt = new Date().toISOString();
    health[result.name] = item;
  }
}

module.exports = {
  GROUP_TYPES,
  healthScore,
  mapLimit,
  measureNode,
  measureNodeStable,
  selectorGroupsFromPayload,
  updateHealth
};
