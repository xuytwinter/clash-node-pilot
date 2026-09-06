const DEFAULT_CONNECTIVITY_TARGETS = Object.freeze([
  { id: 'google-gstatic', label: 'Google connectivity probe', url: 'https://www.gstatic.com/generate_204' },
  { id: 'openai-trace', label: 'OpenAI edge reachability probe', url: 'https://chatgpt.com/cdn-cgi/trace' }
]);

function isRealNode(proxies, name, groupTypes) {
  const proxy = proxies.get(name);
  return proxy && !groupTypes.has(proxy.type) && !['DIRECT', 'REJECT'].includes(name);
}

function realMembers(proxies, groupName, groupTypes) {
  const proxy = proxies.get(groupName);
  return (proxy?.all || []).filter((name) => isRealNode(proxies, name, groupTypes));
}

function selectorGroupNames(proxies) {
  return [...proxies.entries()].filter(([, proxy]) => proxy.type === 'Selector').map(([name]) => name);
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function resolveEffectiveSelector(proxies, groupName) {
  const chain = [];
  const seen = new Set();
  let current = groupName;
  while (current && !seen.has(current)) {
    seen.add(current);
    const proxy = proxies.get(current);
    if (!proxy) return { group: groupName, chain, controlGroup: chain.at(-1)?.name || groupName, leaf: null, unsupported: 'missing-proxy' };
    if (proxy.type !== 'Selector') return { group: groupName, chain, controlGroup: chain.at(-1)?.name || groupName, leaf: current, unsupported: proxy.type };
    chain.push({ name: current, now: proxy.now });
    const next = proxy.now;
    const nextProxy = proxies.get(next);
    if (nextProxy?.type === 'Selector') {
      current = next;
      continue;
    }
    if (nextProxy && nextProxy.type !== 'Selector') return { group: groupName, chain, controlGroup: current, leaf: next };
    return { group: groupName, chain, controlGroup: current, leaf: next || null, unsupported: 'missing-leaf' };
  }
  return { group: groupName, chain, controlGroup: chain.at(-1)?.name || groupName, leaf: null, unsupported: 'selector-cycle' };
}

function connectivityGroupCandidates(proxies, groups, selectedName, fallbackGroupName) {
  const names = selectorGroupNames(proxies);
  return unique([
    ...names.filter((name) => /AI|OpenAI|ChatGPT|Gemini|Claude|google/i.test(name)),
    selectedName,
    fallbackGroupName,
    ...names.filter((name) => /节点选择|節點選擇|自[动動]|proxy|select/i.test(name)),
    ...names.filter((name) => /漏网之鱼|漏網之魚|final|match/i.test(name)),
    groups[0]?.name
  ]).filter((name) => proxies.get(name)?.type === 'Selector');
}

function targetOutageSummary(current, results, targetIds) {
  const checks = [current, ...results].flatMap((result) => result?.checks || []);
  return targetIds.map((id) => {
    const targetChecks = checks.filter((check) => check.id === id);
    const successes = targetChecks.filter((check) => check.ok).length;
    return { id, checks: targetChecks.length, successes, allFailed: targetChecks.length > 0 && successes === 0 };
  });
}

function hasLikelyTargetOutage(current, results, targetIds) {
  return targetOutageSummary(current, results, targetIds).some((item) => item.allFailed);
}

module.exports = {
  DEFAULT_CONNECTIVITY_TARGETS,
  connectivityGroupCandidates,
  hasLikelyTargetOutage,
  isRealNode,
  realMembers,
  resolveEffectiveSelector,
  targetOutageSummary,
  unique
};
