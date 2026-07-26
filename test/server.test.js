const test = require('node:test');
const assert = require('node:assert/strict');
const { parseConfig, regionFor, summarizeRegions, mapLimit, detectSelectedGroupFromBuffer, resolveEffectiveSelector, realMembers } = require('../server');

test('parses controller config without requiring YAML dependency', () => {
  assert.deepEqual(parseConfig("external-controller: 127.0.0.1:9097\nsecret: 'abc'\n"), { controller: '127.0.0.1:9097', secret: 'abc' });
});

test('recognizes common region labels', () => {
  assert.equal(regionFor('🇯🇵 日本东京 01'), 'jp');
  assert.equal(regionFor('Tokyo Premium'), 'jp');
  assert.equal(regionFor('🇺🇸 美国 02'), 'us');
  assert.equal(regionFor('Singapore 03'), 'sg');
  assert.equal(regionFor('套餐剩余流量'), 'other');
});

test('summarizes only supported regions', () => {
  assert.deepEqual(summarizeRegions(['日本 01', 'Tokyo 02', '香港 01', '流量信息']).map(({ id, count }) => ({ id, count })), [{ id: 'jp', count: 2 }, { id: 'hk', count: 1 }]);
});

test('mapLimit preserves result order', async () => {
  const result = await mapLimit([3, 1, 2], 2, async (value) => value * 2);
  assert.deepEqual(result, [6, 2, 4]);
});

test('uses the latest Clash Verge UI selected group record', () => {
  const key = Buffer.from('clash-verge-selected-proxy-group:profile');
  const oldRecord = Buffer.concat([key, Buffer.from('🐟漏网之鱼', 'utf16le')]);
  const newRecord = Buffer.concat([key, Buffer.from('🚀节点选择', 'utf16le')]);
  const groups = [{ name: '🐟漏网之鱼' }, { name: '🚀节点选择' }];
  assert.equal(detectSelectedGroupFromBuffer(Buffer.concat([oldRecord, newRecord]), groups), '🚀节点选择');
});

test('resolves nested selector chain to the selector that owns the real node', () => {
  const proxies = new Map([
    ['🤖AI网站', { type: 'Selector', now: '🚀节点选择', all: ['🚀节点选择', '美国 01'] }],
    ['🚀节点选择', { type: 'Selector', now: '日本 01', all: ['日本 01', '日本 02'] }],
    ['日本 01', { type: 'Vless' }],
    ['日本 02', { type: 'Vless' }],
    ['美国 01', { type: 'Vless' }]
  ]);
  assert.deepEqual(resolveEffectiveSelector(proxies, '🤖AI网站'), {
    group: '🤖AI网站',
    chain: [{ name: '🤖AI网站', now: '🚀节点选择' }, { name: '🚀节点选择', now: '日本 01' }],
    controlGroup: '🚀节点选择',
    leaf: '日本 01'
  });
  assert.deepEqual(realMembers(proxies, '🤖AI网站'), ['美国 01']);
  assert.deepEqual(realMembers(proxies, '🚀节点选择'), ['日本 01', '日本 02']);
});
