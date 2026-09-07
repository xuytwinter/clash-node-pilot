const os = require('node:os');
const path = require('node:path');

function homeDir(env = process.env) {
  return env.HOME || env.USERPROFILE || os.homedir();
}

function windowsLocalAppData(env = process.env) {
  return env.LOCALAPPDATA || path.join(homeDir(env), 'AppData', 'Local');
}

function windowsRoamingAppData(env = process.env) {
  return env.APPDATA || path.join(homeDir(env), 'AppData', 'Roaming');
}

function macosApplicationSupport(env = process.env) {
  return path.posix.join(homeDir(env), 'Library', 'Application Support');
}

function resolvePilotDataDir(env = process.env, platform = process.platform) {
  if (platform === 'darwin') return path.posix.join(macosApplicationSupport(env), 'ClashNodePilot');
  return path.join(windowsLocalAppData(env), 'ClashNodePilot');
}

function resolveStatePath(env = process.env, platform = process.platform) {
  return env.CLASH_PILOT_STATE ? path.resolve(env.CLASH_PILOT_STATE)
    : (platform === 'darwin' ? path.posix : path).join(resolvePilotDataDir(env, platform), 'state.json');
}

function customConfigBackends(env = process.env, demoMode = false) {
  return env.CLASH_CONFIG ? [{
    id: demoMode ? 'demo' : 'custom',
    name: demoMode ? 'Demo Fake Mihomo' : 'Custom Clash/Mihomo',
    configPath: env.CLASH_CONFIG,
  }] : [];
}

function windowsConfigBackends(env = process.env) {
  return [
    {
      id: 'clash-verge',
      name: 'Clash Verge Rev',
      configPath: path.join(windowsRoamingAppData(env), 'io.github.clash-verge-rev.clash-verge-rev', 'config.yaml'),
    },
    {
      id: 'clash-for-windows',
      name: 'Clash for Windows',
      configPath: path.join(homeDir(env), '.config', 'clash', 'config.yaml'),
    }
  ];
}

function macosConfigBackends(env = process.env) {
  const support = macosApplicationSupport(env);
  return [
    {
      id: 'macos-clash-verge-rev',
      name: 'Clash Verge Rev for macOS',
      configPath: path.posix.join(support, 'io.github.clash-verge-rev.clash-verge-rev', 'config.yaml')
    },
    {
      id: 'macos-clash-nyanpasu',
      name: 'Clash Nyanpasu for macOS',
      configPath: path.posix.join(support, 'clash-nyanpasu', 'config.yaml')
    },
    {
      id: 'macos-clashx-meta',
      name: 'ClashX Meta for macOS',
      configPath: path.posix.join(homeDir(env), '.config', 'clash', 'config.yaml')
    }
  ];
}

function platformConfigBackends(env = process.env, platform = process.platform) {
  if (platform === 'darwin') return macosConfigBackends(env);
  return windowsConfigBackends(env);
}

function configBackends({ env = process.env, platform = process.platform, demoMode = false } = {}) {
  return [
    ...customConfigBackends(env, demoMode),
    ...(!demoMode ? platformConfigBackends(env, platform) : [])
  ];
}

function clashVergeLevelDbPath(env = process.env, platform = process.platform) {
  if (platform !== 'win32') return null;
  return path.join(
    windowsLocalAppData(env),
    'io.github.clash-verge-rev.clash-verge-rev',
    'EBWebView',
    'Default',
    'Local Storage',
    'leveldb'
  );
}

module.exports = {
  clashVergeLevelDbPath,
  configBackends,
  customConfigBackends,
  macosConfigBackends,
  resolvePilotDataDir,
  resolveStatePath,
  windowsConfigBackends
};
