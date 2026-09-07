const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function dashboard() {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      textContent: '', innerHTML: '', value: '', style: {}, dataset: {},
      listeners: {}, classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(name, fn) { this.listeners[name] = fn; },
      setAttribute() {}, appendChild() {}, querySelector() { return element(`${id}-child`); }
    });
    return elements.get(id);
  };
  const context = vm.createContext({
    document: { getElementById: element, documentElement: {}, querySelectorAll: () => [], createElement: () => element('created') },
    localStorage: { getItem: () => 'en', setItem() {} },
    setInterval() {}, setTimeout() {}, console
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8').replace(/localizeStatic\(\);\s*loadStatus\(\);\s*setInterval[\s\S]*$/, ''), context);
  vm.runInContext(`
    loadStatus = async () => {};
    state.status = { backend: { id: 'demo' }, groups: [{ name: 'Proxy', now: 'Japan 01', nodeCount: 2, regions: [] }] };
    state.group = 'Proxy'; state.region = 'jp';
  `, context);
  return { context, element, run: (code) => vm.runInContext(code, context) };
}

test('late manual failure does not display results or errors in another region', async () => {
  const ui = dashboard();
  ui.run(`postJson = () => new Promise((resolve, reject) => { pendingReject = reject; });`);
  const operation = ui.run('optimize()');
  ui.run(`state.region = 'hk'; pendingReject(Object.assign(new Error('old Japan failure'), {data:{results:[{name:'Japan 01',ok:false}]}}));`);
  await operation;
  assert.equal(ui.element('results').innerHTML, '');
  assert.notEqual(ui.element('message').textContent, 'old Japan failure');
  assert.equal(ui.run('state.operations.size'), 0);
});

test('language change redraws the current manual result and deduplicates current best evidence', () => {
  const ui = dashboard();
  ui.run(`renderResults({active:'Japan 01',reasonCode:'already-active',results:[{name:'Japan 01',ok:true,delay:48}],decision:{action:'hold',code:'already-active',evidence:{best:{name:'Japan 01',scoreMs:48},current:{name:'Japan 01',scoreMs:48}}}}, {source:'manual'});`);
  assert.equal((ui.element('decisionDetails').innerHTML.match(/Japan 01/g) || []).length, 1);
  ui.run('state.status = null');
  ui.element('langButton').listeners.click();
  assert.match(ui.element('resultCount').textContent, /手动测速/);
  assert.match(ui.element('results').innerHTML, /当前已启用/);
  assert.doesNotMatch(ui.element('decisionDetails').innerHTML, /Action/);
});
