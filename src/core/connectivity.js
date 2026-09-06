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
  const checks = [current, ...results].flatMap((result) => (result?.checks || []).map((check) => ({ node: result.name, ...check })));
  return targetIds.map((id) => {
    const targetChecks = checks.filter((check) => check.id === id);
    const successes = targetChecks.filter((check) => check.ok).length;
    const nodes = unique(targetChecks.map((check) => check.node));
    return { id, checks: targetChecks.length, nodes: nodes.length, successes, allFailed: targetChecks.length > 0 && successes === 0 };
  });
}

function targetOutageDiagnosis(current, results, targetIds) {
  const summary = targetOutageSummary(current, results, targetIds);
  const covered = summary.filter((item) => item.checks > 0);
  const allCoveredTargetsFailed = covered.length > 0 && covered.every((item) => item.successes === 0);
  if (allCoveredTargetsFailed) {
    return {
      code: 'common-probe-failure',
      confidence: 'indeterminate',
      targetSummary: summary
    };
  }

  const likelyTarget = covered.find((item) => item.nodes >= 2 && item.allFailed);
  if (likelyTarget && covered.some((item) => item.id !== likelyTarget.id && item.successes > 0)) {
    return {
      code: 'target-service-outage',
      confidence: 'likely',
      targetId: likelyTarget.id,
      targetSummary: summary
    };
  }

  return {
    code: 'all-candidates-failed',
    confidence: 'unknown',
    targetSummary: summary
  };
}

function hasLikelyTargetOutage(current, results, targetIds) {
  return targetOutageDiagnosis(current, results, targetIds).code === 'target-service-outage';
}

module.exports = {
  DEFAULT_CONNECTIVITY_TARGETS,
  connectivityGroupCandidates,
  hasLikelyTargetOutage,
  isRealNode,
  realMembers,
  resolveEffectiveSelector,
  targetOutageDiagnosis,
  targetOutageSummary,
  unique
};
