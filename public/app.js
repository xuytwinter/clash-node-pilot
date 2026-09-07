const state = {
  status: null,
  group: '',
  region: '',
  resultsSource: null,
  displayedResults: null,
  operations: new Map(),
  operationSeq: 0,
  manualSeq: 0,
  statusSeq: 0,
  messagePinnedUntil: 0,
  lang: localStorage.getItem('clash-node-pilot-lang') || 'en'
};

const $ = (id) => document.getElementById(id);

const text = {
  en: {
    brandTitle: 'Node Pilot',
    brandSub: 'Local Mihomo control',
    startup: 'Startup',
    startupOn: 'Startup On',
    startupTask: 'Startup On (Task)',
    diagnostics: 'Diagnostics',
    docs: 'Docs',
    connecting: 'Connecting',
    currentExit: 'Current Exit',
    proxyClient: 'Proxy Client',
    settings: 'Settings',
    demoScenario: 'Demo Scenario',
    selectorGroup: 'Selector Group',
    targetRegion: 'Target Region',
    switchAfterTest: 'Switch after test',
    monitorOnly: 'Monitor only',
    nodePilot: 'Node Pilot',
    settingsTitle: 'Optimization Settings',
    autoInterval: 'Auto interval (min)',
    manualTestUrl: 'Manual probe URL',
    manualTimeout: 'Manual timeout (ms)',
    switchThreshold: 'Switch threshold (score ms)',
    switchCooldown: 'Switch cooldown (min)',
    healthHalfLife: 'Health half-life (min)',
    samples: 'Samples per node',
    manualPause: 'Manual protection (min)',
    connectivityInterval: 'Connectivity interval (min)',
    connectivityTimeout: 'Connectivity timeout (ms)',
    cancel: 'Cancel',
    saveSettings: 'Save Settings',
    runTest: 'Test and Select',
    latestRun: 'Latest Run',
    ranking: 'Node Ranking',
    emptyTitle: 'No measurements yet',
    emptySub: 'Choose a region and run a test to rank nodes',
    loadingNode: 'Loading...',
    readingController: 'Reading Mihomo controller',
    noGroup: 'No selector group selected',
    groupMeta: 'Group: {name} · {count} available nodes',
    countNodes: '{count} nodes',
    oneNode: '1 node',
    refreshTitle: 'Refresh status',
    online: 'online',
    offline: 'offline',
    connected: 'Mihomo connected',
    disconnected: 'Mihomo offline',
    cannotConnectTitle: 'Cannot connect Mihomo',
    cannotConnectSub: 'Check that Clash Verge and the Mihomo core are running',
    syncStatus: 'Syncing Mihomo status...',
    syncReady: 'Status synced. Ready to run a measurement.',
    v2rayRunning: 'v2rayN detected: {name}{delay} · read-only',
    v2rayOffline: 'v2rayN not running',
    lock: 'Lock {minutes} min',
    unlock: 'Unlock ({minutes} min)',
    cancelJob: 'Cancel Current Job',
    cancelNamedJob: 'Cancel {job}',
    manualJob: 'manual test',
    autoJob: 'auto optimization',
    healJob: 'connectivity check',
    genericJob: 'job',
    jobRunning: '{job} running · backend {backend} · deadline {deadline}',
    lockedStatus: 'Manual protection active for about {minutes} min · next optimization {next}',
    monitorStatus: 'Monitor-only mode: selector writes are skipped · optimization {next} · connectivity {healNext}',
    autoStatus: 'Auto optimization every {interval} min · connectivity every {healInterval} min · tracking {tracked} nodes',
    readOnlyState: 'Runtime state is read-only: {reason}',
    waitingNext: 'waiting',
    recentTrend: 'Recent Latency Trend',
    noRun: 'No run yet',
    pendingAuto: 'Waiting for automation',
    sourceManual: 'Manual test',
    sourceAutomatic: 'Auto optimization',
    sourceHeal: 'Connectivity check',
    resultCount: '{source}{time} · {count} nodes',
    enabledBadge: 'Current',
    fixedProbe: 'fixed probes {passed}/{total} passed',
    sampled: 'samples {passed}/{total} passed',
    testOk: 'test passed',
    failed: 'failed',
    best: 'Best',
    recommended: 'Recommended',
    score: 'score {score}',
    scoreAndSamples: 'score {score} · samples {passed}/{total}',
    optimizeRunning: 'Testing nodes in parallel...',
    optimizeStart: 'Keep Mihomo running while measurements complete. This job can be cancelled before commit.',
    oldManualResult: 'A measurement finished for a previous group or backend. Current view was kept unchanged.',
    manualMonitor: 'Monitor-only: best measured latency {score} ms, no selector write.',
    manualExternal: 'External selector change was detected during measurement; current choice was preserved.',
    manualDisabled: 'Best measured latency {score} ms; switching was disabled.',
    manualWriteMiss: 'Controller accepted the write but readback did not confirm the selector change.',
    manualSwitched: 'Switched to the fastest measured node, {score} ms.',
    manualHeld: 'Best measured latency {score} ms; current node was kept.',
    buttonReady: 'Test and Select',
    backendChanged: 'Proxy client changed.',
    startupEnabled: 'Startup enabled.',
    startupDisabled: 'Startup disabled.',
    cancelRequested: 'Cancel requested for the current job.',
    cancelIdle: 'No job is currently running.',
    monitorEnabled: 'Monitor-only mode enabled. Selector writes are paused.',
    monitorDisabled: 'Monitor-only mode disabled. Switching is allowed by policy.',
    lockEnabled: 'Current selection is under manual protection.',
    lockDisabled: 'Manual protection cleared.',
    settingsSaved: 'Optimization settings saved.',
    scenarioChanged: 'Demo scenario changed.',
    diagnosticsDownloaded: 'Diagnostics report downloaded.',
    decisionAction: 'Action',
    decisionReason: 'Reason',
    decisionTarget: 'Target',
    decisionScore: 'Score Delta',
    decisionThreshold: 'Threshold',
    decisionCooldown: 'Cooldown',
    decisionEvidence: 'Evidence',
    cooldownNone: 'none',
    cooldownRemaining: '{seconds}s remaining',
    currentBest: 'Current node has the best score',
    belowThreshold: 'Improvement below threshold',
    cooldownActive: 'Cooldown keeps the current healthy node',
    monitorOnlyDecision: 'Monitor-only mode forbids writes',
    switchDisabledDecision: 'Switching disabled for this run',
    switchApproved: 'Switch approved by score policy',
    switched: 'Selector write verified',
    writeNotApplied: 'Write was not confirmed by readback',
    writeResultUnknown: 'Selector write result is unknown',
    alreadyActive: 'Target selector is already active',
    noHealthyCandidate: 'No healthy candidate',
    commonProbeFailure: 'Common probe failure, kept current node',
    targetServiceOutage: 'Target probe likely unavailable',
    allCandidatesFailed: 'All candidates failed',
    currentHealthy: 'Current connectivity probes passed',
    manualProtection: 'Manual protection is active',
    externalChange: 'External selector change preserved',
    unsupportedSelector: 'Selector chain is not writable',
    uncertain: 'uncertain',
    hold: 'hold',
    switch: 'switch',
    healthy: 'healthy',
    degraded: 'degraded',
    regionalOutage: 'regional outage',
    targetOutage: 'target outage'
  },
  zh: {
    brandTitle: '节点优选',
    brandSub: 'Mihomo 本地控制台',
    startup: '开机启动',
    startupOn: '开机启动已开启',
    startupTask: '开机启动已开启（任务计划）',
    diagnostics: '诊断报告',
    docs: '文档',
    connecting: '正在连接',
    currentExit: '当前出口',
    proxyClient: '代理客户端',
    settings: '设置',
    demoScenario: '演示场景',
    selectorGroup: '切换代理组',
    targetRegion: '目标地区',
    switchAfterTest: '测速后自动切换',
    monitorOnly: '仅监控，不切换',
    nodePilot: '节点优选',
    settingsTitle: '优选设置',
    autoInterval: '自动测速间隔（分钟）',
    manualTestUrl: '手动测速地址',
    manualTimeout: '手动超时（毫秒）',
    switchThreshold: '切换阈值（评分毫秒）',
    switchCooldown: '切换冷却（分钟）',
    healthHalfLife: '健康历史半衰期（分钟）',
    samples: '每个节点测速次数',
    manualPause: '手动保护（分钟）',
    connectivityInterval: '保通检查间隔（分钟）',
    connectivityTimeout: '保通超时（毫秒）',
    cancel: '取消',
    saveSettings: '保存设置',
    runTest: '开始测速并优选',
    latestRun: '最近任务',
    ranking: '节点排名',
    emptyTitle: '尚未开始测速',
    emptySub: '选择地区后运行测速查看节点排名',
    loadingNode: '读取中...',
    readingController: '正在读取 Mihomo 控制器',
    noGroup: '未选择代理组',
    groupMeta: '代理组：{name} · {count} 个可用节点',
    countNodes: '{count} 节点',
    oneNode: '1 个节点',
    refreshTitle: '刷新状态',
    online: '在线',
    offline: '离线',
    connected: 'Mihomo 已连接',
    disconnected: 'Mihomo 未连接',
    cannotConnectTitle: '无法连接 Mihomo',
    cannotConnectSub: '请确认 Clash Verge 与 Mihomo 内核正在运行',
    syncStatus: '正在同步 Mihomo 状态...',
    syncReady: '状态已同步，可以开始测速。',
    v2rayRunning: 'v2rayN 已检测：{name}{delay} · 只读',
    v2rayOffline: 'v2rayN 未运行',
    lock: '锁定 {minutes} 分钟',
    unlock: '解除保护（{minutes} 分钟）',
    cancelJob: '取消当前任务',
    cancelNamedJob: '取消{job}',
    manualJob: '手动测速',
    autoJob: '自动优化',
    healJob: '保通检查',
    genericJob: '任务',
    jobRunning: '{job}运行中 · 后端 {backend} · 截止 {deadline}',
    lockedStatus: '手动保护中约 {minutes} 分钟 · 下次优化 {next}',
    monitorStatus: '仅监控：节点写入会跳过 · 自动优化 {next} · 保通 {healNext}',
    autoStatus: '自动优化每 {interval} 分钟运行 · 保通每 {healInterval} 分钟检查 · 跟踪 {tracked} 个节点',
    readOnlyState: '运行状态只读：{reason}',
    waitingNext: '等待下一轮',
    recentTrend: '最近延迟趋势',
    noRun: '尚未测速',
    pendingAuto: '等待自动测速',
    sourceManual: '手动测速',
    sourceAutomatic: '自动优化',
    sourceHeal: '保通检查',
    resultCount: '{source}{time} · {count} 节点',
    enabledBadge: '当前已启用',
    fixedProbe: '固定探测 {passed}/{total} 通过',
    sampled: '采样 {passed}/{total} 成功',
    testOk: '测速成功',
    failed: '失败',
    best: '最快',
    recommended: '推荐',
    score: '评分 {score}',
    scoreAndSamples: '评分 {score} · 采样 {passed}/{total}',
    optimizeRunning: '正在并发测速...',
    optimizeStart: '测速期间请保持 Mihomo 运行，提交切换前可取消。',
    oldManualResult: '上一组或上一后端的测速已完成，当前视图已保持不变。',
    manualMonitor: '仅监控已启用，最佳测量延迟 {score} 毫秒，未写入代理组。',
    manualExternal: '测速期间检测到外部手动切换，已保留当前选择。',
    manualDisabled: '最佳测量延迟 {score} 毫秒，未执行切换。',
    manualWriteMiss: '控制器接受写入，但读回未确认代理组已切换。',
    manualSwitched: '已切换到本次测量最快节点，延迟 {score} 毫秒。',
    manualHeld: '最佳测量延迟 {score} 毫秒，当前无需切换。',
    buttonReady: '开始测速并优选',
    backendChanged: '代理客户端已切换。',
    startupEnabled: '开机启动已开启。',
    startupDisabled: '开机启动已关闭。',
    cancelRequested: '已请求取消当前任务。',
    cancelIdle: '当前没有正在运行的任务。',
    monitorEnabled: '仅监控已启用，节点写入已暂停。',
    monitorDisabled: '仅监控已关闭，允许按规则切换。',
    lockEnabled: '当前选择已进入手动保护。',
    lockDisabled: '手动保护已解除。',
    settingsSaved: '优选设置已保存。',
    scenarioChanged: '演示场景已切换。',
    diagnosticsDownloaded: '诊断报告已下载。',
    decisionAction: '动作',
    decisionReason: '原因',
    decisionTarget: '目标',
    decisionScore: '评分差',
    decisionThreshold: '阈值',
    decisionCooldown: '冷却',
    decisionEvidence: '证据',
    cooldownNone: '无',
    cooldownRemaining: '剩余 {seconds} 秒',
    currentBest: '当前节点评分最佳',
    belowThreshold: '提升低于阈值',
    cooldownActive: '冷却期保留健康当前节点',
    monitorOnlyDecision: '仅监控禁止写入',
    switchDisabledDecision: '本次请求禁用切换',
    switchApproved: '评分策略批准切换',
    switched: '代理组写入已读回确认',
    writeNotApplied: '写入未被读回确认',
    writeResultUnknown: '代理组写入结果未知',
    alreadyActive: '目标节点已是当前选择',
    noHealthyCandidate: '没有健康候选',
    commonProbeFailure: '共同探测失败，保留当前节点',
    targetServiceOutage: '目标探测服务疑似不可用',
    allCandidatesFailed: '所有候选失败',
    currentHealthy: '当前保通探测通过',
    manualProtection: '手动保护中',
    externalChange: '外部手动切换已保留',
    unsupportedSelector: '代理组链路不可安全写入',
    uncertain: '不确定',
    hold: '保持',
    switch: '切换',
    healthy: '健康',
    degraded: '退化',
    regionalOutage: '地区故障',
    targetOutage: '目标故障'
  }
};

const regionNames = {
  en: { jp: 'Japan', hk: 'Hong Kong', sg: 'Singapore', us: 'United States', tw: 'Taiwan', kr: 'Korea', other: 'Other' },
  zh: { jp: '日本', hk: '香港', sg: '新加坡', us: '美国', tw: '台湾', kr: '韩国', other: '其他' }
};

const scenarioLabels = {
  healthy: 'healthy',
  degraded: 'degraded',
  'regional-outage': 'regionalOutage',
  'target-outage': 'targetOutage'
};

const codeLabels = {
  'current-best': 'currentBest',
  'below-threshold': 'belowThreshold',
  'cooldown-active': 'cooldownActive',
  'monitor-only': 'monitorOnlyDecision',
  'switch-disabled': 'switchDisabledDecision',
  'switch-approved': 'switchApproved',
  switched: 'switched',
  'write-not-applied': 'writeNotApplied',
  'write-result-unknown': 'writeResultUnknown',
  'already-active': 'alreadyActive',
  'no-healthy-candidate': 'noHealthyCandidate',
  'common-probe-failure': 'commonProbeFailure',
  'target-service-outage': 'targetServiceOutage',
  'all-candidates-failed': 'allCandidatesFailed',
  'current-healthy': 'currentHealthy',
  'manual-protection': 'manualProtection',
  'external-change': 'externalChange',
  'unsupported-selector-chain': 'unsupportedSelector'
};

function tr(key, values = {}) {
  let template = text[state.lang]?.[key] || text.en[key] || key;
  for (const [name, value] of Object.entries(values)) {
    template = template.replaceAll(`{${name}}`, String(value));
  }
  return template;
}

function localizeStatic() {
  document.documentElement.lang = state.lang === 'zh' ? 'zh-CN' : 'en';
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = tr(element.dataset.i18n);
  });
  $('langButton').textContent = state.lang === 'en' ? '中文' : 'EN';
  $('refreshButton').title = tr('refreshTitle');
  $('refreshButton').setAttribute('aria-label', tr('refreshTitle'));
  $('trendHeading').textContent = tr('recentTrend');
  if (!state.status) {
    $('activeNode').textContent = tr('loadingNode');
    $('activeGroup').textContent = tr('readingController');
    $('resultCount').textContent = tr('noRun');
    $('automationStatus').textContent = tr('pendingAuto');
  }
}

function setConnection(connected, label) {
  $('connection').className = `connection ${connected ? 'online' : 'offline'}`;
  $('connection').lastElementChild.textContent = label;
}

function setMessage(message, type = '', pinMs = 0) {
  $('message').textContent = message;
  $('message').className = `message ${type}`.trim();
  if (pinMs) state.messagePinnedUntil = Date.now() + pinMs;
}

function setBackgroundMessage(message, type = '') {
  if (!isBusy() && Date.now() > state.messagePinnedUntil) setMessage(message, type);
}

function setSettingsError(message = '') {
  $('settingsError').textContent = message;
  $('settingsError').hidden = !message;
}

function isBusy() {
  return state.operations.size > 0;
}

function beginOperation(name) {
  const id = ++state.operationSeq;
  state.operations.set(id, name);
  updateButton();
  return id;
}

function endOperation(id) {
  state.operations.delete(id);
  updateButton();
}

function stateWritable() {
  return state.status?.persistence?.writable !== false || state.status?.persistence?.code === 'state-save-failed';
}

async function readResponse(response) {
  const textContent = await response.text();
  const data = textContent ? JSON.parse(textContent) : {};
  if (!response.ok) {
    const error = new Error(data.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function postJson(url, body) {
  const response = await sessionFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return readResponse(response);
}

let sessionToken = null;
let sessionRequest = null;
async function sessionFetch(url, options = {}) {
  if (!sessionToken) {
    sessionRequest ||= fetch('/api/session', { cache: 'no-store' }).then(readResponse).then((data) => data.token).finally(() => { sessionRequest = null; });
    sessionToken = await sessionRequest;
  }
  const response = await fetch(url, { ...options, cache: 'no-store', headers: { ...options.headers, 'x-pilot-session': sessionToken } });
  if (response.status === 403) sessionToken = null;
  return response;
}

function diagnosticsFilename(data) {
  const stamp = String(data?.generatedAt || new Date().toISOString()).replace(/[:.]/g, '-');
  return `clash-node-pilot-diagnostics-${stamp}.json`;
}

async function downloadDiagnostics() {
  const op = beginOperation('diagnostics');
  const button = $('diagnosticsButton');
  button.disabled = true;
  try {
    const response = await sessionFetch('/api/diagnostics');
    const data = await readResponse(response);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = diagnosticsFilename(data);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage(tr('diagnosticsDownloaded'), '', 5000);
  } catch (error) {
    setMessage(error.message, 'error', 8000);
  } finally {
    button.disabled = false;
    endOperation(op);
  }
}

function selectedGroup() {
  return state.status?.groups.find((group) => group.name === state.group);
}

function regionLabel(item) {
  return regionNames[state.lang]?.[item.id] || item.label || item.id;
}

function nodeLabel(count) {
  return count === 1 ? tr('oneNode') : tr('countNodes', { count });
}

function renderRegions() {
  const group = selectedGroup();
  const regions = group?.regions || [];
  if (!regions.some((item) => item.id === state.region)) state.region = regions[0]?.id || '';
  $('regions').textContent = '';
  for (const item of regions) {
    const button = document.createElement('button');
    button.className = `region ${item.id === state.region ? 'selected' : ''}`;
    button.dataset.region = item.id;
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(item.id === state.region));
    button.innerHTML = `<span class="flag">${item.flag}</span><span class="meta"><strong>${escapeHtml(regionLabel(item))}</strong><small>${escapeHtml(nodeLabel(item.count))}</small></span>`;
    button.addEventListener('click', () => {
      state.region = button.dataset.region;
      renderRegions();
      updateButton();
    });
    $('regions').appendChild(button);
  }
  updateCurrent();
  updateButton();
}

function updateCurrent() {
  const group = selectedGroup();
  $('activeNode').textContent = group?.now || tr('noGroup');
  $('activeGroup').textContent = group ? tr('groupMeta', { name: group.name, count: group.nodeCount }) : tr('selectorGroup');
}

function updateButton() {
  const writable = stateWritable();
  $('optimizeButton').disabled = isBusy() || !state.group || !state.region || !state.status || !writable;
  $('backendSelect').disabled = isBusy() || !writable;
  $('groupSelect').disabled = isBusy();
  $('demoScenarioSelect').disabled = isBusy() || Boolean(state.status?.automation?.running);
  $('settingsButton').disabled = isBusy() || !writable;
  $('monitorOnly').disabled = isBusy() || !writable;
  $('lockButton').disabled = isBusy() || !writable;
}

function formatClock(value) {
  return value ? new Date(value).toLocaleTimeString(state.lang === 'zh' ? 'zh-CN' : 'en-US') : tr('waitingNext');
}

function jobLabel(kind) {
  return ({ 'manual-optimize': tr('manualJob'), 'auto-optimize': tr('autoJob'), 'connectivity-heal': tr('healJob') })[kind] || tr('genericJob');
}

function renderTrend(history) {
  const trend = (history || []).filter((item) => item.best?.delay).slice(0, 20).reverse();
  const maxDelay = Math.max(1, ...trend.map((item) => item.best.delay));
  const trendEl = $('trend');
  $('trendHeading').hidden = !trend.length;
  trendEl.textContent = '';
  for (const item of trend) {
    const height = Math.max(10, Math.round(item.best.delay / maxDelay * 100));
    const bucket = Math.min(100, Math.max(10, Math.ceil(height / 10) * 10));
    const bar = document.createElement('div');
    bar.className = `trend-bar h${bucket} ${item.switched ? 'switched' : ''}`;
    bar.dataset.label = `${item.best.delay} ms · ${new Date(item.at).toLocaleTimeString()}`;
    trendEl.appendChild(bar);
  }
}

function renderAutomation(data) {
  const automation = data.automation || {};
  const settings = automation.settings || {};
  const lock = Math.ceil((automation.lockMs || 0) / 60000);
  $('monitorOnly').checked = Boolean(automation.monitorOnly);
  $('cancelJobButton').hidden = !automation.running;
  $('cancelJobButton').disabled = !automation.running;
  $('cancelJobButton').textContent = automation.currentJob ? tr('cancelNamedJob', { job: jobLabel(automation.currentJob.kind) }) : tr('cancelJob');
  if (!$('settingsDialog').open) {
    $('autoInterval').value = settings.autoIntervalMinutes ?? 3;
    $('testUrl').value = settings.manualTestUrl ?? data.defaults?.testUrl ?? '';
    $('timeout').value = settings.manualTimeoutMs ?? data.defaults?.timeout ?? 5000;
    $('switchThreshold').value = settings.switchThresholdMs ?? 25;
    $('switchCooldown').value = settings.switchCooldownMinutes ?? 5;
    $('healthHalfLife').value = settings.healthHalfLifeMinutes ?? 60;
    $('samples').value = settings.samples ?? 2;
    $('pauseMinutes').value = settings.manualPauseMinutes ?? 15;
    $('connectivityInterval').value = settings.connectivityCheckMinutes ?? 1;
    $('connectivityTimeout').value = settings.connectivityTimeoutMs ?? 5000;
  }
  $('lockButton').textContent = lock ? tr('unlock', { minutes: lock }) : tr('lock', { minutes: settings.manualPauseMinutes ?? 15 });

  const next = formatClock(automation.nextRunAt);
  const healNext = formatClock(automation.nextConnectivityCheckAt);
  if (data.persistence?.writable === false) {
    $('automationStatus').textContent = tr('readOnlyState', { reason: data.persistence.message || data.persistence.code });
  } else if (automation.currentJob) {
    $('automationStatus').textContent = tr('jobRunning', { job: jobLabel(automation.currentJob.kind), backend: automation.currentJob.backendId || tr('currentExit'), deadline: formatClock(automation.currentJob.deadlineAt) });
  } else if (lock) {
    $('automationStatus').textContent = tr('lockedStatus', { minutes: lock, next });
  } else if (automation.monitorOnly) {
    $('automationStatus').textContent = tr('monitorStatus', { next, healNext });
  } else if (automation.schedulerEnabled === false) {
    $('automationStatus').textContent = state.lang === 'zh' ? '自动检查已关闭' : 'Automatic checks are disabled';
  } else {
    $('automationStatus').textContent = tr('autoStatus', { interval: settings.autoIntervalMinutes ?? 3, healInterval: settings.connectivityCheckMinutes ?? 1, tracked: automation.trackedNodes || 0 });
  }
  renderTrend(automation.history);
}

function renderDemo(data) {
  const demo = data.demo || {};
  $('demoScenarioRow').hidden = !demo.enabled;
  if (!demo.enabled) return;
  $('demoScenarioSelect').innerHTML = (demo.scenarios || []).map((scenario) => `<option value="${escapeHtml(scenario)}">${escapeHtml(tr(scenarioLabels[scenario] || scenario))}</option>`).join('');
  $('demoScenarioSelect').value = demo.scenario || '';
}

function renderPersistedResults(data) {
  const saved = data?.automation?.lastResults;
  if (!saved?.results?.length) return;
  if (saved.backend && saved.backend !== data.backend?.id) return;
  if (saved.group && saved.group !== state.group && saved.controlGroup !== state.group) return;
  if (state.resultsSource?.type === 'manual') {
    const savedAt = Date.parse(saved.at || '');
    if (!Number.isFinite(savedAt) || savedAt <= state.resultsSource.at) return;
  }
  renderResults(saved, { source: saved.source || 'automatic', at: saved.at });
  state.resultsSource = { type: saved.source || 'automatic', at: Date.parse(saved.at || '') || Date.now(), backend: saved.backend, group: saved.group || saved.controlGroup };
}

async function loadStatus({ quiet = false } = {}) {
  const seq = ++state.statusSeq;
  if (!quiet) setBackgroundMessage(tr('syncStatus'));
  try {
    const response = await sessionFetch('/api/status');
    const data = await readResponse(response);
    if (seq !== state.statusSeq) return;
    state.status = data;
    $('startupButton').hidden = !data.startup?.supported;
    $('startupButton').classList.toggle('enabled', Boolean(data.startup?.enabled));
    $('startupButton').textContent = data.startup?.enabled ? (data.startup.source === 'scheduled-task' ? tr('startupTask') : tr('startupOn')) : tr('startup');
    renderAutomation(data);
    renderDemo(data);
    $('backendSelect').innerHTML = (data.backends || []).map((backend) => `<option value="${escapeHtml(backend.id)}" ${backend.online ? '' : 'disabled'}>${escapeHtml(backend.name)} · ${backend.online ? `${tr('online')} ${escapeHtml(backend.version || '')}` : tr('offline')}</option>`).join('');
    $('backendSelect').value = data.backend?.id || '';
    const v2rayN = (data.detectedClients || []).find((client) => client.id === 'v2rayn');
    $('clientInfo').hidden = Boolean(data.demo?.enabled);
    $('clientInfo').textContent = v2rayN?.online
      ? tr('v2rayRunning', { name: v2rayN.current?.name || tr('noGroup'), delay: v2rayN.current?.delay ? ` · ${v2rayN.current.delay} ms` : '' })
      : tr('v2rayOffline');
    if (!data.groups.some((group) => group.name === state.group)) {
      state.group = data.groups.find((group) => group.name === data.targetGroup)?.name || data.groups[0]?.name || '';
      state.resultsSource = null;
      state.manualSeq += 1;
    }
    $('groupSelect').innerHTML = data.groups.map((group) => `<option value="${escapeHtml(group.name)}">${escapeHtml(group.name)} · ${escapeHtml(nodeLabel(group.nodeCount))}</option>`).join('');
    $('groupSelect').value = state.group;
    renderPersistedResults(data);
    setConnection(true, tr('connected'));
    setBackgroundMessage(tr('syncReady'));
    renderRegions();
  } catch (error) {
    if (seq !== state.statusSeq) return;
    state.status = null;
    setConnection(false, tr('disconnected'));
    $('activeNode').textContent = tr('cannotConnectTitle');
    $('activeGroup').textContent = tr('cannotConnectSub');
    setBackgroundMessage(error.message, 'error');
    updateButton();
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function sampleText(item) {
  const total = (item.successCount || 0) + (item.failureCount || 0);
  if (total > 1) return tr('sampled', { passed: item.successCount || 0, total });
  return tr('testOk');
}

function resultSubText(item, active) {
  if (active) return `<span class="active-badge">${escapeHtml(tr('enabledBadge'))}</span>`;
  if (item.checks?.length) {
    const passed = item.checks.filter((check) => check.ok).length;
    return escapeHtml(tr('fixedProbe', { passed, total: item.checks.length }));
  }
  if (item.ok) {
    const score = item.score ?? item.scoring?.score;
    if (score !== undefined) {
      const total = (item.successCount || 0) + (item.failureCount || 0);
      return escapeHtml(total > 1 ? tr('scoreAndSamples', { score, passed: item.successCount || 0, total }) : tr('score', { score }));
    }
    return escapeHtml(sampleText(item));
  }
  return escapeHtml(item.error || tr('failed'));
}

function decisionMessage(code) {
  return tr(codeLabels[code] || code || 'decisionAction');
}

function renderDecision(data) {
  const event = data.decision;
  const code = data.reasonCode || data.code || event?.code;
  if (!event && !code) {
    $('decisionPanel').hidden = true;
    return;
  }
  $('decisionPanel').hidden = false;
  $('decisionTitle').textContent = decisionMessage(code);
  $('decisionMeta').textContent = event?.at ? new Date(event.at).toLocaleTimeString() : '';
  const rows = [];
  if (event?.action) rows.push([tr('decisionAction'), tr(event.action)]);
  if (event?.reason) rows.push([tr('decisionReason'), decisionMessage(event.code)]);
  if (event?.target) rows.push([tr('decisionTarget'), event.target]);
  const scoreDelta = event?.scoreDeltaRoundedMs ?? event?.scoreDeltaMs;
  if (scoreDelta !== undefined && scoreDelta !== null) rows.push([tr('decisionScore'), `${scoreDelta} ms`]);
  if (event?.thresholdMs !== undefined && event.thresholdMs !== null) rows.push([tr('decisionThreshold'), `${event.thresholdMs} ms`]);
  if (event?.protection) {
    rows.push([tr('decisionCooldown'), event.protection.remainingCooldownMs ? tr('cooldownRemaining', { seconds: Math.ceil(event.protection.remainingCooldownMs / 1000) }) : tr('cooldownNone')]);
  }
  if (event?.evidence?.best) {
    const best = event.evidence.best;
    const current = event.evidence.current;
    rows.push([tr('decisionEvidence'), `${best.name}: ${best.scoreMs ?? '-'}${current && current.name !== best.name ? ` · ${current.name}: ${current.scoreMs ?? '-'}` : ''}`]);
  }
  if (!rows.length) rows.push([tr('decisionReason'), decisionMessage(code)]);
  $('decisionDetails').innerHTML = rows.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`).join('');
}

function renderResults(data, meta = {}) {
  state.displayedResults = { data, meta };
  $('empty').style.display = 'none';
  $('results').className = 'results visible';
  renderDecision(data);
  const time = meta.at ? new Date(meta.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const sourceLabel = meta.source === 'connectivity-heal' ? tr('sourceHeal') : meta.source === 'automatic' ? tr('sourceAutomatic') : tr('sourceManual');
  $('resultCount').textContent = tr('resultCount', { source: sourceLabel, time: time ? ` · ${time}` : '', count: data.results.length });
  $('results').innerHTML = data.results.map((item, index) => {
    const active = item.name === data.active;
    const delayClass = !item.ok ? 'failed' : item.delay > 500 ? 'slow' : '';
    const badgeLabel = meta.source === 'manual' || !meta.source ? tr('best') : tr('recommended');
    const badge = index === 0 && item.ok ? `<span class="badge">${escapeHtml(badgeLabel)}</span>` : '';
    return `<div class="result ${index === 0 && item.ok ? 'best' : ''}">
      <div class="rank">${String(index + 1).padStart(2, '0')}</div>
      <div><div class="node-name">${escapeHtml(item.name)}${badge}</div><div class="node-sub">${resultSubText(item, active)}</div></div>
      <div class="delay ${delayClass}">${item.ok ? `${item.delay} ms` : escapeHtml(tr('failed'))}</div>
    </div>`;
  }).join('');
}

function scoreForMessage(data) {
  return data.best?.score ?? data.best?.delay ?? '-';
}

function manualResultMessage(data) {
  if (data.reasonCode === 'monitor-only') return tr('manualMonitor', { score: scoreForMessage(data) });
  if (data.reasonCode === 'external-change') return tr('manualExternal');
  if (data.reasonCode === 'switch-disabled') return tr('manualDisabled', { score: scoreForMessage(data) });
  if (data.reasonCode === 'write-not-applied') return tr('manualWriteMiss');
  if (data.reasonCode === 'write-result-unknown') return tr('writeResultUnknown');
  if (data.switched) return tr('manualSwitched', { score: scoreForMessage(data) });
  return tr('manualHeld', { score: scoreForMessage(data) });
}

async function optimize() {
  const op = beginOperation('manual');
  const context = {
    seq: ++state.manualSeq,
    backend: state.status?.backend?.id || '',
    group: state.group,
    region: state.region
  };
  const sameContext = () => context.seq === state.manualSeq
    && context.backend === (state.status?.backend?.id || '')
    && context.group === state.group
    && context.region === state.region;
  const button = $('optimizeButton');
  button.classList.add('loading');
  button.querySelector('span:last-child').textContent = tr('optimizeRunning');
  $('cancelJobButton').hidden = false;
  $('cancelJobButton').disabled = false;
  $('cancelJobButton').textContent = tr('cancelNamedJob', { job: tr('manualJob') });
  setMessage(tr('optimizeStart'));
  updateButton();
  try {
    const data = await postJson('/api/optimize', {
      group: context.group,
      region: context.region,
      switch: $('autoSwitch').checked,
      testUrl: $('testUrl').value,
      timeout: Number($('timeout').value)
    });
    if (!sameContext()) {
      setMessage(tr('oldManualResult'), '', 7000);
      return;
    }
    renderResults(data, { source: 'manual' });
    state.resultsSource = { type: 'manual', at: Date.now(), backend: context.backend, group: context.group };
    const group = selectedGroup();
    if (group && data.active) group.now = data.active;
    updateCurrent();
    setMessage(manualResultMessage(data), '', 6000);
  } catch (error) {
    if (!sameContext()) return;
    if (error.data?.commit?.verified) {
      const group = selectedGroup();
      if (group) group.now = error.data.active;
      updateCurrent();
      setMessage(state.lang === 'zh' ? '节点切换已确认，但本地记录保存失败。' : 'Selector switch confirmed, but local state could not be saved.', 'error', 8000);
      return;
    }
    if (error.data?.results) renderResults({ ...error.data, active: selectedGroup()?.now }, { source: 'manual' });
    setMessage(error.message, 'error', 8000);
  } finally {
    endOperation(op);
    button.classList.remove('loading');
    button.querySelector('span:last-child').textContent = tr('buttonReady');
    $('cancelJobButton').hidden = !state.status?.automation?.running;
    updateButton();
    loadStatus({ quiet: true });
  }
}

$('langButton').addEventListener('click', () => {
  state.lang = state.lang === 'en' ? 'zh' : 'en';
  localStorage.setItem('clash-node-pilot-lang', state.lang);
  localizeStatic();
  if (state.status) {
    renderAutomation(state.status);
    renderDemo(state.status);
    renderRegions();
    renderPersistedResults(state.status);
  }
  if (state.displayedResults) renderResults(state.displayedResults.data, state.displayedResults.meta);
});

$('groupSelect').addEventListener('change', (event) => {
  state.group = event.target.value;
  state.region = '';
  state.resultsSource = null;
  state.displayedResults = null;
  state.manualSeq += 1;
  $('results').className = 'results';
  $('empty').style.display = 'flex';
  $('decisionPanel').hidden = true;
  $('resultCount').textContent = tr('pendingAuto');
  renderRegions();
  renderPersistedResults(state.status);
});

$('backendSelect').addEventListener('change', async (event) => {
  const op = beginOperation('backend');
  state.manualSeq += 1;
  try {
    await postJson('/api/automation', { action: 'backend', value: event.target.value });
    state.group = '';
    state.region = '';
    state.resultsSource = null;
    state.displayedResults = null;
    setMessage(tr('backendChanged'), '', 4000);
    await loadStatus({ quiet: true });
  } catch (error) {
    $('backendSelect').value = state.status?.backend?.id || '';
    setMessage(error.message, 'error', 8000);
  } finally {
    endOperation(op);
  }
});

$('demoScenarioSelect').addEventListener('change', async (event) => {
  const op = beginOperation('demo-scenario');
  state.manualSeq += 1;
  try {
    await postJson('/api/demo-scenario', { scenario: event.target.value });
    state.group = '';
    state.region = '';
    state.resultsSource = null;
    state.displayedResults = null;
    $('results').className = 'results';
    $('empty').style.display = 'flex';
    $('decisionPanel').hidden = true;
    $('resultCount').textContent = tr('noRun');
    setMessage(tr('scenarioChanged'), '', 4000);
    await loadStatus({ quiet: true });
  } catch (error) {
    setMessage(error.message, 'error', 8000);
    await loadStatus({ quiet: true });
  } finally {
    endOperation(op);
  }
});

$('startupButton').addEventListener('click', async () => {
  const op = beginOperation('startup');
  const enabled = !state.status?.startup?.enabled;
  $('startupButton').disabled = true;
  try {
    const data = await postJson('/api/startup', { enabled });
    setMessage(data.enabled ? tr('startupEnabled') : tr('startupDisabled'), '', 5000);
    await loadStatus({ quiet: true });
  } catch (error) {
    setMessage(error.message, 'error', 8000);
  } finally {
    endOperation(op);
    $('startupButton').disabled = false;
  }
});

$('settingsButton').addEventListener('click', () => {
  setSettingsError('');
  $('settingsDialog').showModal();
});
$('closeSettings').addEventListener('click', () => $('settingsDialog').close());
$('cancelSettings').addEventListener('click', () => $('settingsDialog').close());
$('refreshButton').addEventListener('click', () => loadStatus());
$('diagnosticsButton').addEventListener('click', downloadDiagnostics);
$('optimizeButton').addEventListener('click', optimize);

$('cancelJobButton').addEventListener('click', async () => {
  $('cancelJobButton').disabled = true;
  try {
    const data = await postJson('/api/automation', { action: 'cancel' });
    setMessage(data.cancelled ? tr('cancelRequested') : tr('cancelIdle'), '', 5000);
  } catch (error) {
    setMessage(error.message, 'error', 8000);
  } finally {
    await loadStatus({ quiet: true });
  }
});

$('monitorOnly').addEventListener('change', async (event) => {
  const op = beginOperation('monitor');
  try {
    await postJson('/api/automation', { action: 'monitor', value: event.target.checked });
    setMessage(event.target.checked ? tr('monitorEnabled') : tr('monitorDisabled'), '', 5000);
    await loadStatus({ quiet: true });
  } catch (error) {
    event.target.checked = !event.target.checked;
    setMessage(error.message, 'error', 8000);
  } finally {
    endOperation(op);
  }
});

$('lockButton').addEventListener('click', async () => {
  const op = beginOperation('lock');
  const locked = $('lockButton').textContent.includes('Unlock') || $('lockButton').textContent.includes('解除');
  try {
    await postJson('/api/automation', { action: locked ? 'unlock' : 'lock' });
    setMessage(locked ? tr('lockDisabled') : tr('lockEnabled'), '', 5000);
    await loadStatus({ quiet: true });
  } catch (error) {
    setMessage(error.message, 'error', 8000);
  } finally {
    endOperation(op);
  }
});

$('saveSettings').addEventListener('click', async () => {
  const op = beginOperation('settings');
  $('saveSettings').disabled = true;
  setSettingsError('');
  try {
    await postJson('/api/automation', {
      action: 'settings',
      settings: {
        autoIntervalMinutes: Number($('autoInterval').value),
        manualTestUrl: $('testUrl').value,
        manualTimeoutMs: Number($('timeout').value),
        switchThresholdMs: Number($('switchThreshold').value),
        switchCooldownMinutes: Number($('switchCooldown').value),
        healthHalfLifeMinutes: Number($('healthHalfLife').value),
        samples: Number($('samples').value),
        manualPauseMinutes: Number($('pauseMinutes').value),
        connectivityCheckMinutes: Number($('connectivityInterval').value),
        connectivityTimeoutMs: Number($('connectivityTimeout').value)
      }
    });
    $('settingsDialog').close();
    setMessage(tr('settingsSaved'), '', 5000);
    await loadStatus({ quiet: true });
  } catch (error) {
    setSettingsError(error.message);
  } finally {
    endOperation(op);
    $('saveSettings').disabled = false;
  }
});

localizeStatic();
loadStatus();
setInterval(() => loadStatus({ quiet: true }), 15000);
