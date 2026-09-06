const state = { status: null, group: '', region: '', resultsSource: null, busy: false, statusSeq: 0, messagePinnedUntil: 0 };
const $ = (id) => document.getElementById(id);

function setConnection(connected, text) {
  $('connection').className = `connection ${connected ? 'online' : 'offline'}`;
  $('connection').lastChild.textContent = text;
}

function setMessage(text, type = '', pinMs = 0) {
  $('message').textContent = text;
  $('message').className = `message ${type}`.trim();
  if (pinMs) state.messagePinnedUntil = Date.now() + pinMs;
}

function setBackgroundMessage(text, type = '') {
  if (!state.busy && Date.now() > state.messagePinnedUntil) setMessage(text, type);
}

async function readResponse(response) {
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const error = new Error(data.error || `请求失败：HTTP ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return readResponse(response);
}

function selectedGroup() {
  return state.status?.groups.find((group) => group.name === state.group);
}

function renderRegions() {
  const group = selectedGroup();
  const regions = group?.regions || [];
  if (!regions.some((item) => item.id === state.region)) state.region = regions[0]?.id || '';
  $('regions').innerHTML = regions.map((item) => `
    <button class="region ${item.id === state.region ? 'selected' : ''}" data-region="${item.id}" role="radio" aria-checked="${item.id === state.region}">
      <span class="flag">${item.flag}</span><span class="meta"><strong>${item.label}</strong><small>${item.count} 个节点</small></span>
    </button>`).join('');
  $('regions').querySelectorAll('.region').forEach((button) => button.addEventListener('click', () => {
    state.region = button.dataset.region;
    renderRegions();
    updateButton();
  }));
  updateCurrent();
  updateButton();
}

function updateCurrent() {
  const group = selectedGroup();
  $('activeNode').textContent = group?.now || '未选择代理组';
  $('activeGroup').textContent = group ? `代理组：${group.name} · ${group.nodeCount} 个可用节点` : '请选择代理组';
}

function updateButton() {
  $('optimizeButton').disabled = state.busy || !state.group || !state.region || !state.status;
}

function formatClock(value) {
  return value ? new Date(value).toLocaleTimeString() : '等待下一轮';
}

function jobLabel(kind) {
  return ({ 'manual-optimize': '手动测速', 'auto-optimize': '自动测速', 'connectivity-heal': '保通检查' })[kind] || '任务';
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
  $('cancelJobButton').textContent = automation.currentJob ? `取消${jobLabel(automation.currentJob.kind)}` : '取消当前任务';
  if (!$('settingsDialog').open) {
    $('autoInterval').value = settings.autoIntervalMinutes ?? 3;
    $('switchThreshold').value = settings.switchThresholdMs ?? 25;
    $('samples').value = settings.samples ?? 2;
    $('pauseMinutes').value = settings.manualPauseMinutes ?? 15;
    $('connectivityInterval').value = settings.connectivityCheckMinutes ?? 1;
    $('connectivityTimeout').value = settings.connectivityTimeoutMs ?? 5000;
  }
  $('lockButton').textContent = lock ? `解除保护（${lock} 分钟）` : `锁定 ${settings.manualPauseMinutes ?? 15} 分钟`;

  const next = formatClock(automation.nextRunAt);
  const healNext = formatClock(automation.nextConnectivityCheckAt);
  if (automation.currentJob) {
    $('automationStatus').textContent = `${jobLabel(automation.currentJob.kind)}运行中 · 后端 ${automation.currentJob.backendId || '当前'} · 截止 ${formatClock(automation.currentJob.deadlineAt)}`;
  } else if (lock) {
    $('automationStatus').textContent = `手动保护中：自动测速与保通切换暂停约 ${lock} 分钟 · 下次测速 ${next}`;
  } else if (automation.monitorOnly) {
    $('automationStatus').textContent = `仅监控已启用：所有自动与手动写入都会跳过 · 自动测速 ${next} · 保通 ${healNext}`;
  } else {
    const interval = settings.autoIntervalMinutes ?? 3;
    const healInterval = settings.connectivityCheckMinutes ?? 1;
    $('automationStatus').textContent = `自动测速每 ${interval} 分钟运行 · 保通每 ${healInterval} 分钟检查 · 跟踪 ${automation.trackedNodes || 0} 个节点`;
  }
  renderTrend(automation.history);
}

function renderPersistedResults(data) {
  const saved = data.automation?.lastResults;
  if (!saved?.results?.length || state.resultsSource === 'manual') return;
  if (saved.backend && saved.backend !== data.backend?.id) return;
  if (saved.group && saved.group !== state.group && saved.controlGroup !== state.group) return;
  renderResults(saved, { source: saved.source || 'automatic', at: saved.at });
  state.resultsSource = saved.source || 'automatic';
}

async function loadStatus({ quiet = false } = {}) {
  const seq = ++state.statusSeq;
  if (!quiet) setBackgroundMessage('正在同步 Clash Verge 状态...');
  try {
    const response = await fetch('/api/status');
    const data = await readResponse(response);
    if (seq !== state.statusSeq) return;
    state.status = data;
    $('startupButton').hidden = !data.startup?.supported;
    $('startupButton').classList.toggle('enabled', Boolean(data.startup?.enabled));
    $('startupButton').textContent = data.startup?.enabled ? `开机启动 · 已开启${data.startup.source === 'scheduled-task' ? '（任务计划）' : ''}` : '开机启动';
    renderAutomation(data);
    $('backendSelect').innerHTML = (data.backends || []).map((backend) => `<option value="${escapeHtml(backend.id)}" ${backend.online ? '' : 'disabled'}>${escapeHtml(backend.name)} · ${backend.online ? `在线 ${escapeHtml(backend.version || '')}` : '离线'}</option>`).join('');
    $('backendSelect').value = data.backend?.id || '';
    const v2rayN = (data.detectedClients || []).find((client) => client.id === 'v2rayn');
    $('clientInfo').textContent = v2rayN?.online ? `v2rayN 已检测：${v2rayN.current?.name || '当前节点未知'}${v2rayN.current?.delay ? ` · 历史延迟 ${v2rayN.current.delay} ms` : ''} · 只读` : 'v2rayN 未运行';
    if (!data.groups.some((group) => group.name === state.group)) {
      state.group = data.groups.find((group) => group.name === data.targetGroup)?.name || data.groups[0]?.name || '';
      state.resultsSource = null;
    }
    $('groupSelect').innerHTML = data.groups.map((group) => `<option value="${escapeHtml(group.name)}">${escapeHtml(group.name)} · ${group.nodeCount} 节点</option>`).join('');
    $('groupSelect').value = state.group;
    renderPersistedResults(data);
    $('testUrl').value ||= data.defaults.testUrl;
    $('timeout').value ||= data.defaults.timeout;
    setConnection(true, 'Mihomo 已连接');
    setBackgroundMessage('状态已同步，可以开始测速。');
    renderRegions();
  } catch (error) {
    if (seq !== state.statusSeq) return;
    state.status = null;
    setConnection(false, 'Mihomo 未连接');
    $('activeNode').textContent = '无法连接 Clash Verge';
    $('activeGroup').textContent = '请确认 Clash Verge 与 Mihomo 内核正在运行';
    setBackgroundMessage(error.message, 'error');
    updateButton();
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]);
}

function resultSubText(item, active) {
  if (active) return '<span class="active-badge">当前已启用</span>';
  if (item.checks?.length) {
    const passed = item.checks.filter((check) => check.ok).length;
    return `固定探测 ${passed}/${item.checks.length} 通过`;
  }
  if (item.ok) {
    const total = (item.successCount || 0) + (item.failureCount || 0);
    return total > 1 ? `采样 ${item.successCount}/${total} 成功` : '测速成功';
  }
  return escapeHtml(item.error || '连接失败');
}

function renderResults(data, meta = {}) {
  $('empty').style.display = 'none';
  $('results').className = 'results visible';
  const time = meta.at ? new Date(meta.at).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : '';
  const sourceLabel = meta.source === 'connectivity-heal' ? '保通检查' : meta.source === 'automatic' ? '自动测速' : '本次测速';
  $('resultCount').textContent = `${sourceLabel}${time ? ` · ${time}` : ''} · ${data.results.length} 节点`;
  $('results').innerHTML = data.results.map((item, index) => {
    const active = item.name === data.active;
    const delayClass = !item.ok ? 'failed' : item.delay > 500 ? 'slow' : '';
    const badge = index === 0 && item.ok ? `<span class="badge">${meta.source === 'manual' || !meta.source ? '最快' : '推荐'}</span>` : '';
    return `<div class="result ${index === 0 && item.ok ? 'best' : ''}">
      <div class="rank">${String(index + 1).padStart(2, '0')}</div>
      <div><div class="node-name">${escapeHtml(item.name)}${badge}</div><div class="node-sub">${resultSubText(item, active)}</div></div>
      <div class="delay ${delayClass}">${item.ok ? `${item.delay} ms` : '失败'}</div>
    </div>`;
  }).join('');
}

function manualResultMessage(data) {
  if (data.reasonCode === 'monitor-only') return `仅监控已启用，推荐节点 ${data.best.delay} ms，未写入代理组。`;
  if (data.reasonCode === 'external-change') return '测速期间检测到外部手动切换，已保留当前选择并进入保护。';
  if (data.reasonCode === 'switch-disabled') return `最快节点为 ${data.best.delay} ms，未执行切换。`;
  if (data.switched) return `已切换到最快节点，延迟 ${data.best.delay} ms。`;
  return `最快节点为 ${data.best.delay} ms，当前无需切换。`;
}

async function optimize() {
  const button = $('optimizeButton');
  state.busy = true;
  button.classList.add('loading');
  button.querySelector('span:last-child').textContent = '正在并发测速...';
  $('cancelJobButton').hidden = false;
  $('cancelJobButton').disabled = false;
  $('cancelJobButton').textContent = '取消手动测速';
  setMessage('测速期间请保持 Clash Verge 运行。任务可取消，完成前不会覆盖新的手动选择。');
  updateButton();
  try {
    const data = await postJson('/api/optimize', {
      group: state.group,
      region: state.region,
      switch: $('autoSwitch').checked,
      testUrl: $('testUrl').value,
      timeout: Number($('timeout').value)
    });
    renderResults(data, { source:'manual' });
    state.resultsSource = 'manual';
    const group = selectedGroup();
    if (group) group.now = data.active;
    updateCurrent();
    setMessage(manualResultMessage(data), '', 6000);
  } catch (error) {
    if (error.data?.results) renderResults({ ...error.data, active: selectedGroup()?.now }, { source:'manual' });
    setMessage(error.message, 'error', 8000);
  } finally {
    state.busy = false;
    button.classList.remove('loading');
    button.querySelector('span:last-child').textContent = '开始测速并优选';
    $('cancelJobButton').hidden = true;
    updateButton();
    loadStatus({ quiet: true });
  }
}

$('groupSelect').addEventListener('change', (event) => {
  state.group = event.target.value;
  state.region = '';
  state.resultsSource = null;
  $('results').className = 'results';
  $('empty').style.display = 'flex';
  $('resultCount').textContent = '等待自动测速';
  renderRegions();
  renderPersistedResults(state.status);
});

$('backendSelect').addEventListener('change', async (event) => {
  state.busy = true;
  updateButton();
  try {
    await postJson('/api/automation', { action:'backend', value:event.target.value });
    state.group = '';
    state.region = '';
    state.resultsSource = null;
    setMessage('代理客户端已切换。', '', 4000);
    await loadStatus({ quiet: true });
  } catch (error) {
    $('backendSelect').value = state.status?.backend?.id || '';
    setMessage(error.message, 'error', 8000);
  } finally {
    state.busy = false;
    updateButton();
  }
});

$('startupButton').addEventListener('click', async () => {
  const enabled = !state.status?.startup?.enabled;
  $('startupButton').disabled = true;
  try {
    const data = await postJson('/api/startup', { enabled });
    setMessage(data.enabled ? '开机启动已开启。' : '开机启动已关闭。', '', 5000);
    await loadStatus({ quiet: true });
  } catch(error) {
    setMessage(error.message, 'error', 8000);
  } finally {
    $('startupButton').disabled = false;
  }
});

$('settingsButton').addEventListener('click', () => $('settingsDialog').showModal());
$('closeSettings').addEventListener('click', () => $('settingsDialog').close());
$('cancelSettings').addEventListener('click', () => $('settingsDialog').close());
$('refreshButton').addEventListener('click', () => loadStatus());
$('optimizeButton').addEventListener('click', optimize);

$('cancelJobButton').addEventListener('click', async () => {
  $('cancelJobButton').disabled = true;
  try {
    const data = await postJson('/api/automation', { action:'cancel' });
    setMessage(data.cancelled ? '已请求取消当前任务。' : '当前没有正在运行的任务。', '', 5000);
  } catch (error) {
    setMessage(error.message, 'error', 8000);
  } finally {
    await loadStatus({ quiet: true });
  }
});

$('monitorOnly').addEventListener('change', async (event) => {
  try {
    await postJson('/api/automation', { action:'monitor', value:event.target.checked });
    setMessage(event.target.checked ? '仅监控已启用，节点写入已暂停。' : '仅监控已关闭，允许按规则切换。', '', 5000);
    await loadStatus({ quiet: true });
  } catch (error) {
    event.target.checked = !event.target.checked;
    setMessage(error.message, 'error', 8000);
  }
});

$('lockButton').addEventListener('click', async () => {
  const locked = $('lockButton').textContent.includes('解除');
  try {
    await postJson('/api/automation', { action:locked ? 'unlock' : 'lock' });
    setMessage(locked ? '手动保护已解除。' : '当前选择已进入手动保护。', '', 5000);
    await loadStatus({ quiet: true });
  } catch (error) {
    setMessage(error.message, 'error', 8000);
  }
});

$('saveSettings').addEventListener('click', async () => {
  $('saveSettings').disabled = true;
  try {
    await postJson('/api/automation', {
      action:'settings',
      settings:{
        autoIntervalMinutes:Number($('autoInterval').value),
        switchThresholdMs:Number($('switchThreshold').value),
        samples:Number($('samples').value),
        manualPauseMinutes:Number($('pauseMinutes').value),
        connectivityCheckMinutes:Number($('connectivityInterval').value),
        connectivityTimeoutMs:Number($('connectivityTimeout').value)
      }
    });
    $('settingsDialog').close();
    setMessage('自动测速与保通设置已保存。', '', 5000);
    await loadStatus({ quiet: true });
  } catch (error) {
    setMessage(error.message, 'error', 8000);
  } finally {
    $('saveSettings').disabled = false;
  }
});

loadStatus();
setInterval(() => loadStatus({ quiet: true }), 15000);
