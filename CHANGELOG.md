# Changelog

All notable changes to the GrowManager ioBroker adapter are documented here.

## [0.1.10] - 2026-07-02

### Fixed
- Crash when opening the group editor: `climateProfiles` was missing from older saved configs
  and arrived as `undefined` instead of `[]`, causing `.map()` to throw. Config is now merged
  with array defaults on load so missing keys never reach the UI as `undefined`.
- Added `climateProfiles: []` to the `io-package.json` native defaults so new installations
  always have a well-formed initial config.

---

## [0.1.9] - 2026-07-02

### Fixed
- **Critical build fix**: `admin/index.html` was pointing to the previously compiled bundle
  instead of the TypeScript source entry (`./src/index.tsx`). Every build since v0.1.5 had
  been repackaging the same old bundle — no TypeScript changes were ever compiled into the
  shipped files. Resetting the entry point caused Vite to transform 30 modules (previously 3)
  and produce a correct bundle for the first time since v0.1.4.

---

## [0.1.8] - 2026-07-02

### Fixed
- Socket bridge now works reliably: `window.io` is checked immediately at startup before
  loading `socket.io.js` (handles the case where admin already loaded it).
- Added polling fallback (every 250 ms, up to 10 s) so the bridge connects even if Firefox
  does not fire `onload` for a cached/duplicate script URL.
- Extracted `doConnect()` helper shared by all connection paths (direct, onload, poll).

*Note: due to the build bug fixed in 0.1.9, the changes above only took effect from 0.1.9 onwards.*

---

## [0.1.5 – 0.1.7] - 2026-07-02

*Note: these versions were shipped with the build bug described in 0.1.9 — the TypeScript
source was never compiled, so their fixes had no effect at runtime.*

### Intended fixes (now active via 0.1.9)
- **0.1.7** Socket bridge cleanup: consistent use of `io.connect()` across all paths.
- **0.1.6** Bridge checks `window.io` before attempting to load `socket.io.js` again.
- **0.1.5** Use ioBroker WebSockets v3 API correctly: `window.io` is an object
  `{ connect: fn }`, not a callable function. Previous code called `window.io()` →
  TypeError → fell through to non-functional fetch fallback → config never loaded or saved.

---

## [0.1.4] - 2026-07-02

### Added
- Socket bridge with multiple fallback paths (`window.socket`, `parent.socket`, `socket.io.js`)
- Save feedback indicator in header (● Verbunden / ○ Verbinde…)
- Auto-save when GroupEditor closes

---

## [0.1.3] - 2026-07-02

### Added
- **Object tree picker**: "🔍 Wählen" button on all sensor/actuator state-ID fields opens a
  searchable modal showing all ioBroker states (ID, name, type, role)
- **Climate profile editor**: full day/night setpoint editor for temperature, humidity and VPD
  with phase selection (seedling / growth / bloom / drying)
- **Save feedback**: header shows "✓ Gespeichert" on success or "✗ Fehler beim Speichern"
  on failure

### Fixed
- Socket bridge tries `window.socket` (injected by ioBroker admin v6+) first

---

## [0.1.2] - 2026-07-02

### Fixed
- Added `"adminUI": { "config": "html" }` to `io-package.json` so ioBroker admin loads the
  React UI instead of looking for `jsonConfig.json`

---

## [0.1.1] - 2026-07-01

### Fixed
- `admin/` directory was missing after `npm install` from GitHub (npm v7+ skips subdirs with
  their own `package.json`). Removed build config files from git tracking, added `.npmignore`.

---

## [0.1.0] - 2026-06-30

### Added
- Initial release: core adapter, group management, climate control (VPD/PID), alarm system,
  schedule service, shared actor manager, web dashboard (port 8097), React admin UI, 116 tests
