const { probeConfigBackend } = require('../core/controller');
const { createCapabilities, CapabilityState } = require('../core/capabilities');
const { MACOS_CLIENT_ADAPTERS, manualPairingBackend } = require('./macos');
const { windowsConfigBackends } = require('./windows');

function configuredBackends({ env = process.env, pairings = [], secureStore }) {
  const custom = env.CLASH_CONFIG ? [{
    id: 'custom',
    name: 'Custom Clash/Mihomo',
    configPath: env.CLASH_CONFIG,
    platform: 'custom',
    capabilities: createCapabilities({
      discovery: CapabilityState.REQUIRES_PAIRING,
      authenticatedControl: CapabilityState.SUPPORTED,
      switching: CapabilityState.SUPPORTED
    })
  }] : [];
  const platformBackends = process.platform === 'darwin' ? MACOS_CLIENT_ADAPTERS : windowsConfigBackends(env);
  const manual = secureStore ? pairings.map((pairing) => manualPairingBackend(pairing, secureStore)) : [];
  return [...custom, ...platformBackends, ...manual];
}

async function discoverBackends(options = {}) {
  const backends = configuredBackends(options);
  return Promise.all(backends.map((backend) => probeConfigBackend(backend, options)));
}

module.exports = {
  configuredBackends,
  discoverBackends
};
