const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_REGION_DEFS = [
  { id: 'jp', label: '日本', flag: '🇯🇵', pattern: /🇯🇵|日本|东京|東京|大阪|名古屋|jp\b|japan|tokyo|osaka/i },
  { id: 'hk', label: '香港', flag: '🇭🇰', pattern: /🇭🇰|香港|港(?!口)|hk\b|hong\s*kong/i },
  { id: 'tw', label: '台湾', flag: '🇹🇼', pattern: /🇹🇼|台湾|臺灣|台北|臺北|高雄|tw\b|taiwan|taipei/i },
  { id: 'sg', label: '新加坡', flag: '🇸🇬', pattern: /🇸🇬|新加坡|狮城|獅城|sg\b|singapore/i },
  { id: 'us', label: '美国', flag: '🇺🇸', pattern: /🇺🇸|美国|美國|洛杉矶|洛杉磯|圣何塞|聖何塞|西雅图|西雅圖|纽约|紐約|us\b|usa\b|united states|los angeles|seattle|san jose/i },
  { id: 'kr', label: '韩国', flag: '🇰🇷', pattern: /🇰🇷|韩国|韓國|首尔|首爾|kr\b|korea|seoul/i },
  { id: 'de', label: '德国', flag: '🇩🇪', pattern: /🇩🇪|德国|德國|法兰克福|法蘭克福|de\b|germany|frankfurt/i },
  { id: 'uk', label: '英国', flag: '🇬🇧', pattern: /🇬🇧|英国|英國|伦敦|倫敦|uk\b|britain|london/i }
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
