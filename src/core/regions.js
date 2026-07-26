const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_REGION_DEFS = [
  { id: 'jp', label: 'Japan', flag: 'JP', pattern: /日本|东京|大阪|\bjp\b|japan|tokyo|osaka/i },
  { id: 'hk', label: 'Hong Kong', flag: 'HK', pattern: /香港|\bhk\b|hong\s*kong/i },
  { id: 'tw', label: 'Taiwan', flag: 'TW', pattern: /台湾|台北|高雄|\btw\b|taiwan|taipei/i },
  { id: 'sg', label: 'Singapore', flag: 'SG', pattern: /新加坡|狮城|\bsg\b|singapore/i },
  { id: 'us', label: 'United States', flag: 'US', pattern: /美国|美國|洛杉矶|洛杉磯|西雅图|西雅圖|纽约|紐約|\bus\b|usa\b|united states|los angeles|seattle|san jose/i },
  { id: 'kr', label: 'Korea', flag: 'KR', pattern: /韩国|韓國|首尔|首爾|\bkr\b|korea|seoul/i },
  { id: 'de', label: 'Germany', flag: 'DE', pattern: /德国|德國|法兰克福|法蘭克福|\bde\b|germany|frankfurt/i },
  { id: 'uk', label: 'United Kingdom', flag: 'UK', pattern: /英国|英國|伦敦|倫敦|\buk\b|britain|london/i }
];

function loadRegions(rootDir) {
  try {
    const customRegions = JSON.parse(fs.readFileSync(path.join(rootDir, 'regions.json'), 'utf8'));
    return DEFAULT_REGION_DEFS.map((region) => ({
      ...region,
      pattern: customRegions[region.id] ? new RegExp(customRegions[region.id].join('|'), 'i') : region.pattern
    }));
  } catch {
    return DEFAULT_REGION_DEFS;
  }
}

function createRegionResolver(regions) {
  return function regionFor(name) {
    return regions.find((region) => region.pattern.test(name))?.id || 'other';
  };
}

function summarizeRegions(members, regions, regionFor) {
  const counts = new Map(regions.map((region) => [region.id, 0]));
  for (const member of members) {
    const id = regionFor(member);
    if (counts.has(id)) counts.set(id, counts.get(id) + 1);
  }
  return regions.map(({ id, label, flag }) => ({ id, label, flag, count: counts.get(id) })).filter((item) => item.count > 0);
}

module.exports = {
  DEFAULT_REGION_DEFS,
  createRegionResolver,
  loadRegions,
  summarizeRegions
};
