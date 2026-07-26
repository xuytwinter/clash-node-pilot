const os = require('node:os');
const path = require('node:path');
const { CapabilityState, DiagnosticCode, createCapabilities, diagnostic } = require('../core/capabilities');

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

function macosStartupStatus() {
  return {
    supported: process.platform === 'darwin',
    enabled: false,
    source: process.platform === 'darwin' ? 'launch-agent-preview' : null,
    diagnostic: process.platform === 'darwin'
      ? diagnostic(DiagnosticCode.OK, 'Use the generated LaunchAgent plist for the unsigned Preview.')
      : diagnostic(DiagnosticCode.UNSUPPORTED_API, 'macOS LaunchAgent support is unavailable on this platform.')
  };
}

function createLaunchAgentPlist({ label = 'com.clash-node-pilot.service', programPath, workingDirectory, port = 3210 }) {
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
  macosStartupStatus,
  manualPairingBackend
};
