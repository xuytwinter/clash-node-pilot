const state = { status: null, group: '', region: '' };
const $ = (id) => document.getElementById(id);

function setConnection(connected, text) {
  $('connection').className = `connection ${connected ? 'online' : 'offline'}`;
  $('connection').lastChild.textContent = text;
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
  $('optimizeButton').disabled = !state.group || !state.region || !state.status;
}

function renderAutomation(data) {
  const automation = data.automation || {};
  const lock = Math.ceil((automation.lockMs || 0) / 60000);
  $('monitorOnly').checked = Boolean(automation.monitorOnly);
  if ($('advanced').hidden) {
    $('switchThreshold').value = automation.settings?.switchThresholdMs ?? 25;
    $('samples').value = automation.settings?.samples ?? 2;
    $('pauseMinutes').value = automation.settings?.manualPauseMinutes ?? 15;
  }
  $('lockButton').textContent = lock ? `解除保护（${lock} 分钟）` : '锁定 15 分钟';
  const next = automation.nextRunAt ? new Date(automation.nextRunAt).toLocaleTimeString() : '等待下一轮';
  $('automationStatus').textContent = lock ? `自动切换已暂停，剩余约 ${lock} 分钟 · 下次轮询 ${next}` : `自动轮询每 3 分钟运行 · 跟踪 ${automation.trackedNodes || 0} 个节点 · 下次运行 ${next}`;
  const history = (automation.history || []).slice(0, 5);
  $('history').innerHTML = history.length ? history.map((item) => `<div class="history-item"><span><strong>${escapeHtml(item.group || '')}</strong> · ${escapeHtml(item.reason || (item.switched ? '已切换' : '保持当前'))}</span><span class="${item.skipped ? 'skip' : 'ok'}">${new Date(item.at).toLocaleTimeString()}</span></div>`).join('') : '';
  const trend = (automation.history || []).filter((item) => item.best?.delay).slice(0, 20).reverse();
  const maxDelay = Math.max(1, ...trend.map((item) => item.best.delay));
  $('trend').innerHTML = trend.map((item) => `<div class="trend-bar ${item.switched ? 'switched' : ''}" style="--height:${Math.max(10, Math.round(item.best.delay / maxDelay * 100))}%" data-label="${item.best.delay} ms · ${new Date(item.at).toLocaleTimeString()}"></div>`).join('');
}

async function loadStatus() {
  $('message').textContent = '正在同步 Clash Verge 状态...';
  $('message').className = 'message';
  try {
    const response = await fetch('/api/status');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    state.status = data;
    renderAutomation(data);
    if (!data.groups.some((group) => group.name === state.group)) {
      state.group = data.groups.find((group) => group.name === data.targetGroup)?.name || data.groups[0]?.name || '';
    }
    $('groupSelect').innerHTML = data.groups.map((group) => `<option value="${escapeHtml(group.name)}">${escapeHtml(group.name)} · ${group.nodeCount} 节点</option>`).join('');
    $('groupSelect').value = state.group;
    $('testUrl').value ||= data.defaults.testUrl;
    $('timeout').value ||= data.defaults.timeout;
    setConnection(true, 'Mihomo 已连接');
    $('message').textContent = '状态已同步，可以开始测速。';
    renderRegions();
  } catch (error) {
    state.status = null;
    setConnection(false, 'Mihomo 未连接');
    $('activeNode').textContent = '无法连接 Clash Verge';
    $('activeGroup').textContent = '请确认 Clash Verge 与 Mihomo 内核正在运行';
    $('message').textContent = error.message;
    $('message').className = 'message error';
    updateButton();
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]);
}

function renderResults(data) {
  $('empty').style.display = 'none';
  $('results').className = 'results visible';
  $('resultCount').textContent = `${data.results.length} 个节点`;
  $('results').innerHTML = data.results.map((item, index) => {
    const active = item.name === data.active;
    const delayClass = !item.ok ? 'failed' : item.delay > 500 ? 'slow' : '';
    return `<div class="result ${index === 0 && item.ok ? 'best' : ''}">
      <div class="rank">${String(index + 1).padStart(2, '0')}</div>
      <div><div class="node-name">${escapeHtml(item.name)}${index === 0 && item.ok ? '<span class="badge">最快</span>' : ''}</div><div class="node-sub">${active ? '<span class="active-badge">当前已启用</span>' : item.ok ? '测速成功' : escapeHtml(item.error || '连接失败')}</div></div>
      <div class="delay ${delayClass}">${item.ok ? `${item.delay} ms` : '失败'}</div>
    </div>`;
  }).join('');
}

async function optimize() {
  const button = $('optimizeButton');
  button.disabled = true;
  button.classList.add('loading');
  button.querySelector('span:last-child').textContent = '正在并发测速...';
  $('message').textContent = '测速期间请保持 Clash Verge 运行，通常需要 5–15 秒。';
  $('message').className = 'message';
  try {
    const response = await fetch('/api/optimize', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ group:state.group, region:state.region, switch:$('autoSwitch').checked, testUrl:$('testUrl').value, timeout:Number($('timeout').value) }) });
    const data = await response.json();
    if (!response.ok) {
      if (data.results) renderResults({ ...data, active: selectedGroup()?.now });
      throw new Error(data.error);
    }
    renderResults(data);
    const group = selectedGroup();
    if (group) group.now = data.active;
    updateCurrent();
    $('message').textContent = data.switched ? `已切换到最快节点，延迟 ${data.best.delay} ms。` : `最快节点为 ${data.best.delay} ms${$('autoSwitch').checked ? '，当前已是该节点。' : '，未执行切换。'}`;
  } catch (error) {
    $('message').textContent = error.message;
    $('message').className = 'message error';
  } finally {
    button.classList.remove('loading');
    button.querySelector('span:last-child').textContent = '开始测速并优选';
    updateButton();
  }
}

$('groupSelect').addEventListener('change', (event) => { state.group = event.target.value; state.region = ''; renderRegions(); });
$('settingsButton').addEventListener('click', () => { $('advanced').hidden = !$('advanced').hidden; });
$('refreshButton').addEventListener('click', loadStatus);
$('optimizeButton').addEventListener('click', optimize);
document.getElementById('monitorOnly').addEventListener('change', async (event) => { await fetch('/api/automation', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action:'monitor', value:event.target.checked }) }); loadStatus(); });
document.getElementById('lockButton').addEventListener('click', async () => { const locked = document.getElementById('lockButton').textContent.includes('解除'); await fetch('/api/automation', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action:locked ? 'unlock' : 'lock' }) }); loadStatus(); });
document.getElementById('saveSettings').addEventListener('click', async () => { await fetch('/api/automation', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action:'settings', settings:{ switchThresholdMs:Number($('switchThreshold').value), samples:Number($('samples').value), manualPauseMinutes:Number($('pauseMinutes').value) } }) }); $('message').textContent='自动设置已保存。'; loadStatus(); });
loadStatus();
setInterval(loadStatus, 15000);
