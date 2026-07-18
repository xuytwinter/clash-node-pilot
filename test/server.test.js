const test = require('node:test');
const assert = require('node:assert/strict');
const { parseConfig, regionFor, summarizeRegions, mapLimit, detectSelectedGroupFromBuffer } = require('../server');

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
