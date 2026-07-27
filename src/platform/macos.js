const os = require('node:os');
const fsSync = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { CapabilityState, DiagnosticCode, createCapabilities, diagnostic } = require('../core/capabilities');

const LAUNCH_AGENT_LABEL = 'com.clash-node-pilot.service';

const MACOS_CLIENT_ADAPTERS = [
  {
    id: 'macos-clash-verge-rev',
    name: 'Clash Verge Rev for macOS',
    configPath: path.join(os.homedir(), 'Library', 'Application Support', 'io.github.clash-verge-rev.clash-verge-rev', 'config.yaml')
  },
  {
    id: 'macos-clash-nyanpasu',
    name: 'Clash Nyanpasu for macOS',
    configPath: path.join(os.homedir(), 'Library', 'Application Support', 'clash-nyanpasu', 'config.yaml')
  },
  {
    id: 'macos-clashx-meta',
    name: 'ClashX Meta for macOS',
    configPath: path.join(os.homedir(), '.config', 'clash', 'config.yaml')
  }
].map((adapter) => ({
  ...adapter,
  platform: 'macos',
  capabilities: createCapabilities({
    discovery: CapabilityState.SUPPORTED,
    authenticatedControl: CapabilityState.SUPPORTED,
    switching: CapabilityState.SUPPORTED,
    startupBackground: CapabilityState.SUPPORTED
  })
}));

function manualPairingBackend(pairing, secureStore) {
  const secret = secureStore.get(pairing.id);
  return {
    id: pairing.id,
    name: pairing.name || 'Manual Clash/Mihomo Controller',
    platform: 'manual',
    config: { controller: pairing.controller, secret },
    paired: true,
    capabilities: createCapabilities({
      discovery: CapabilityState.REQUIRES_PAIRING,
      authenticatedControl: CapabilityState.SUPPORTED,
      switching: CapabilityState.SUPPORTED
    })
  };
}

function macosLaunchAgentPath(env = process.env) {
  return path.join(env.HOME || os.homedir(), 'Library', 'LaunchAgents', `${LAUNCH_AGENT_LABEL}.plist`);
}

function packagedNodePath(rootDir) {
  const bundled = path.join(rootDir, 'runtime', 'node');
  return fsSync.existsSync(bundled) ? bundled : process.execPath;
}

function macosStartupStatus({ platform = process.platform, env = process.env } = {}) {
  const plistPath = macosLaunchAgentPath(env);
  return {
    supported: platform === 'darwin',
    enabled: platform === 'darwin' && fsSync.existsSync(plistPath),
    source: platform === 'darwin' ? 'launch-agent-preview' : null,
    plistPath: platform === 'darwin' ? plistPath : null,
    diagnostic: platform === 'darwin'
      ? diagnostic(DiagnosticCode.OK, 'LaunchAgent preview startup is managed in the current user session.')
      : diagnostic(DiagnosticCode.UNSUPPORTED_API, 'macOS LaunchAgent support is unavailable on this platform.')
  };
}

function setMacosStartupEnabled(enabled, rootDir, { platform = process.platform, env = process.env, execFile = execFileSync, uid = process.getuid?.() } = {}) {
  if (platform !== 'darwin') throw new Error('Startup management is currently available on macOS only');
  if (uid === undefined || uid === null) throw new Error('macOS user session id is unavailable for LaunchAgent management');
  const plistPath = macosLaunchAgentPath(env);
  const target = `gui/${uid}/${LAUNCH_AGENT_LABEL}`;

  if (!enabled) {
    try {
      execFile('launchctl', ['bootout', target], { stdio: 'ignore', timeout: 5000 });
    } catch {
      /* The agent may not be loaded in this user session. */
    }
    fsSync.rmSync(plistPath, { force: true });
    return macosStartupStatus({ platform, env });
  }

  fsSync.mkdirSync(path.dirname(plistPath), { recursive: true });
  fsSync.writeFileSync(plistPath, createLaunchAgentPlist({
    programPath: packagedNodePath(rootDir),
    workingDirectory: rootDir,
    port: Number(env.PORT || 3210)
  }), { encoding: 'utf8', mode: 0o644 });

  try {
    execFile('launchctl', ['bootout', target], { stdio: 'ignore', timeout: 5000 });
  } catch {
    /* Replace if absent or already unloaded. */
  }
  try {
    execFile('launchctl', ['bootstrap', `gui/${uid}`, plistPath], { stdio: 'ignore', timeout: 5000 });
  } catch (error) {
    fsSync.rmSync(plistPath, { force: true });
    throw error;
  }
  return macosStartupStatus({ platform, env });
}

function createLaunchAgentPlist({ label = LAUNCH_AGENT_LABEL, programPath, workingDirectory, port = 3210 }) {
  const escapedProgram = escapeXml(programPath);
  const escapedWorkingDirectory = escapeXml(workingDirectory);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${escapeXml(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapedProgram}</string>
    <string>server.js</string>
  </array>
  <key>WorkingDirectory</key><string>${escapedWorkingDirectory}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key><string>${escapeXml(String(port))}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${escapeXml(path.join(os.homedir(), 'Library', 'Logs', 'ClashNodePilot.log'))}</string>
  <key>StandardErrorPath</key><string>${escapeXml(path.join(os.homedir(), 'Library', 'Logs', 'ClashNodePilot.err.log'))}</string>
</dict>
</plist>
`;
}

function escapeXml(value) {
  return String(value).replace(/[<>&'"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[char]);
}

module.exports = {
  MACOS_CLIENT_ADAPTERS,
  createLaunchAgentPlist,
  macosLaunchAgentPath,
  macosStartupStatus,
  setMacosStartupEnabled,
  manualPairingBackend
};
