const CapabilityState = Object.freeze({
  SUPPORTED: 'supported',
  READ_ONLY: 'read-only',
  UNSUPPORTED: 'unsupported',
  REQUIRES_PAIRING: 'requires-pairing',
  UNAVAILABLE: 'unavailable'
});

const DiagnosticCode = Object.freeze({
  OK: 'ok',
  CONTROLLER_UNAVAILABLE: 'controller-unavailable',
  AUTH_REQUIRED: 'authentication-required',
  UNSUPPORTED_API: 'unsupported-api',
  BACKGROUND_RESTRICTED: 'background-restricted',
  CLIENT_STOPPED: 'client-stopped',
  PAIRING_REVOKED: 'pairing-revoked'
});

function createCapabilities(overrides = {}) {
  return {
    discovery: CapabilityState.UNSUPPORTED,
    authenticatedControl: CapabilityState.UNSUPPORTED,
    switching: CapabilityState.UNSUPPORTED,
    startupBackground: CapabilityState.UNSUPPORTED,
    readOnly: CapabilityState.SUPPORTED,
    ...overrides
  };
}

function diagnostic(code, message, details = {}) {
  return { code, message, ...details };
}

module.exports = {
  CapabilityState,
  DiagnosticCode,
  createCapabilities,
  diagnostic
};
