const fsSync = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SERVICE = 'Clash Node Pilot';

function accountFor(id) {
  return `controller:${id}`;
}

function fallbackPath(rootDir, id) {
  return path.join(rootDir, 'secrets', `${encodeURIComponent(id)}.txt`);
}

function createSecureStore({ platform = process.platform, dataDir }) {
  if (platform === 'darwin') {
    return {
      backend: 'macos-keychain',
      set(id, secret) {
        execFileSync('security', ['add-generic-password', '-U', '-s', SERVICE, '-a', accountFor(id), '-w', secret || ''], { stdio: 'ignore', timeout: 5000 });
      },
      get(id) {
        try {
          return execFileSync('security', ['find-generic-password', '-s', SERVICE, '-a', accountFor(id), '-w'], { encoding: 'utf8', timeout: 5000 }).trim();
        } catch {
          return '';
        }
      },
      delete(id) {
        try {
          execFileSync('security', ['delete-generic-password', '-s', SERVICE, '-a', accountFor(id)], { stdio: 'ignore', timeout: 5000 });
        } catch {
          /* already absent */
        }
      }
    };
  }

  return {
    backend: 'local-profile-file',
    set(id, secret) {
      const file = fallbackPath(dataDir, id);
      fsSync.mkdirSync(path.dirname(file), { recursive: true });
      fsSync.writeFileSync(file, secret || '', { encoding: 'utf8', mode: 0o600 });
    },
    get(id) {
      try {
        return fsSync.readFileSync(fallbackPath(dataDir, id), 'utf8');
      } catch {
        return '';
      }
    },
    delete(id) {
      fsSync.rmSync(fallbackPath(dataDir, id), { force: true });
    }
  };
}

module.exports = { createSecureStore };
