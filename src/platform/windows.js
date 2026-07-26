const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { CapabilityState, createCapabilities } = require('../core/capabilities');

function windowsConfigBackends(env = process.env) {
  const appData = env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return [
    {
      id: 'clash-verge',
      name: 'Clash Verge Rev',
      configPath: path.join(appData, 'io.github.clash-verge-rev.clash-verge-rev', 'config.yaml'),
      platform: 'windows',
      capabilities: createCapabilities({
        discovery: CapabilityState.SUPPORTED,
        authenticatedControl: CapabilityState.SUPPORTED,
        switching: CapabilityState.SUPPORTED,
        startupBackground: CapabilityState.SUPPORTED
      })
    },
    {
      id: 'clash-for-windows',
      name: 'Clash for Windows',
      configPath: path.join(os.homedir(), '.config', 'clash', 'config.yaml'),
      platform: 'windows',
      capabilities: createCapabilities({
        discovery: CapabilityState.SUPPORTED,
        authenticatedControl: CapabilityState.SUPPORTED,
        switching: CapabilityState.SUPPORTED
      })
    }
  ];
}

function clashVergeLevelDbPath(env = process.env) {
  return path.join(
    env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
    'io.github.clash-verge-rev.clash-verge-rev',
    'EBWebView',
    'Default',
    'Local Storage',
    'leveldb'
  );
}

function discoverV2rayNHome(env = process.env) {
  if (env.V2RAYN_HOME && fsSync.existsSync(path.join(env.V2RAYN_HOME, 'v2rayN.exe'))) return env.V2RAYN_HOME;
  if (process.platform !== 'win32') return null;
  try {
    const executable = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-Process v2rayN -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Path)'], { encoding: 'utf8', timeout: 2000, windowsHide: true }).trim();
    return executable ? path.dirname(executable) : null;
  } catch {
    return null;
  }
}

function detectV2rayN(env = process.env) {
  const home = discoverV2rayNHome(env);
  if (!home) return { id: 'v2rayn', name: 'v2rayN', online: false, writable: false };
  try {
    const configPath = path.join(home, 'guiConfigs', 'guiNConfig.json');
    const config = JSON.parse(fsSync.readFileSync(configPath, 'utf8'));
    const result = { id: 'v2rayn', name: 'v2rayN', online: true, writable: false, mode: 'read-only' };
    try {
      const { DatabaseSync } = require('node:sqlite');
      const database = new DatabaseSync(path.join(home, 'guiConfigs', 'guiNDB.db'), { readOnly: true });
      const current = database.prepare('select p.Remarks as name, p.Subid as groupId, coalesce(e.Delay,0) as delay from ProfileItem p left join ProfileExItem e on e.IndexId=p.IndexId where p.IndexId=?').get(config.IndexId);
      const count = database.prepare('select count(*) as count from ProfileItem').get().count;
      database.close();
      result.current = current ? { name: current.name, delay: current.delay } : null;
      result.nodeCount = count;
    } catch {
      result.current = null;
    }
    return result;
  } catch {
    return { id: 'v2rayn', name: 'v2rayN', online: true, writable: false, mode: 'read-only', error: 'Configuration could not be read' };
  }
}

function startupStatus() {
  if (process.platform !== 'win32') return { supported: false, enabled: false, source: null };
  try {
    execFileSync('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'Clash Node Pilot Startup'], { stdio: 'ignore', timeout: 1500, windowsHide: true });
    execFileSync('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'Clash Node Pilot Optimizer'], { stdio: 'ignore', timeout: 1500, windowsHide: true });
    return { supported: true, enabled: true, source: 'current-user' };
  } catch {
    /* check elevated scheduled tasks next */
  }
  try {
    execFileSync('schtasks.exe', ['/Query', '/TN', 'Clash Node Pilot Startup'], { stdio: 'ignore', timeout: 1500, windowsHide: true });
    execFileSync('schtasks.exe', ['/Query', '/TN', 'Clash Node Pilot Watchdog'], { stdio: 'ignore', timeout: 1500, windowsHide: true });
    execFileSync('schtasks.exe', ['/Query', '/TN', 'Clash Node Pilot Optimizer'], { stdio: 'ignore', timeout: 1500, windowsHide: true });
    return { supported: true, enabled: true, source: 'scheduled-task' };
  } catch {
    return { supported: true, enabled: false, source: null };
  }
}

function setStartupEnabled(enabled, rootDir) {
  if (process.platform !== 'win32') throw new Error('Startup management is currently available on Windows only');
  const current = startupStatus();
  if (!enabled && current.source === 'scheduled-task') throw new Error('Current startup recovery uses administrator scheduled tasks. Run uninstall-autostart.ps1 as administrator to disable it.');
  const script = path.join(rootDir, enabled ? 'install-pilot-autostart.ps1' : 'uninstall-pilot-autostart.ps1');
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { stdio: 'ignore', timeout: 10000, windowsHide: true });
  return startupStatus();
}

module.exports = {
  clashVergeLevelDbPath,
  detectV2rayN,
  discoverV2rayNHome,
  setStartupEnabled,
  startupStatus,
  windowsConfigBackends
};
