# Changelog

All notable changes to the GrowManager ioBroker adapter are documented here.

## [0.1.8] - 2026-07-02

### Fixed
- Socket bridge now works reliably in Firefox: `window.io` is checked immediately at startup
  before loading the script (covers the case where admin already loaded `socket.io.js`).
- Added polling fallback (every 250 ms, up to 10 s): if Firefox does not fire `onload` for
  a cached/duplicate script URL, the poll detects `window.io` as soon as it becomes available.
- Extracted `doConnect()` helper so all code paths (direct, onload, poll) share one connection
  setup — no risk of creating duplicate sockets.

---

## [0.1.7] - 2026-07-02

### Fixed
- Socket bridge: removed stale `window.io()` call in comment; `io.connect()` was already correct
  in 0.1.6 but onload path only — now all paths are consistent.

---

## [0.1.6] - 2026-07-02

### Fixed
- Socket bridge now also checks `window.io` in addition to `window.socket` / `parent.socket`
  before falling back to loading `socket.io.js` dynamically.

---

## [0.1.5] - 2026-07-02

### Fixed
- Socket bridge now uses ioBroker WebSockets v3.0.4 correctly:
  `globalThis.io` is an object `{ connect: fn }`, NOT a callable function.
  Previous code called `window.io()` which is not a function → fell through
  to fetch fallback → no save, no object picker.
  Fix: `window.io.connect('/', { name, pongTimeout, pingInterval })`.
- ioBroker SocketClient buffers `emit()` calls internally when not yet connected
  (`pending[]` array), so `wireSocket` no longer needs to wait for the `connect`
  event — the emit for `loadConfig` will replay automatically once the WebSocket
  handshake completes.
- Polling also checks `window.io` (was only checking `window.socket`), so the
  bridge connects within milliseconds of page load instead of timing out.

---

## [0.1.4] - 2026-07-02

### Added
- 5-level socket fallback bridge in `admin/src/index.tsx`
- Save feedback header indicator (● Verbunden / ○ Verbinde…)
- Auto-save on GroupEditor close (no second click required)

---

## [0.1.3] - 2026-07-02

### Added
- **Object tree picker**: "🔍 Wählen" button on all sensor/actuator state-ID fields opens a
  searchable modal showing all ioBroker states (ID, name, type, role) — no need to copy IDs
  from a separate tab anymore
- **Climate profile editor**: full day/night setpoint editor for temperature, humidity and VPD
  with phase selection (seedling / growth / bloom / drying) — was previously a placeholder
- **Save feedback**: header now shows "✓ Gespeichert" on success or "✗ Fehler beim Speichern"
  on failure instead of silently ignoring errors

### Fixed
- Socket bridge now tries `window.socket` (injected by ioBroker admin v6+) first before
  falling back to loading socket.io manually, which fixes the save-does-nothing bug

---

## [0.1.2] - 2026-07-02

### Fixed
- Added `"adminUI": { "config": "html" }` to `io-package.json` so ioBroker admin loads the
  React UI directly instead of looking for `jsonConfig.json` and showing
  "[JsonConfig] Cannot read file: Not exists"

---

## [0.1.1] - 2026-07-01

### Fixed
- `admin/` directory was not installed when using `npm install` from GitHub because npm v7+
  treats subdirectories containing a `package.json` as a separate package and skips them
- Fix: removed `admin/package.json`, `admin/vite.config.ts` and `admin/src/tsconfig.json`
  from git tracking (kept locally for development); added to `.gitignore`
- Added `.npmignore` to explicitly exclude dev sources (`src/`, `test/`, `admin/src/`,
  `admin/node_modules/`) from the npm package while keeping the compiled admin UI
- Removed `files` field from `package.json` (npm v10 ignores it for git-URL installs;
  without it, npm includes all git-tracked files minus `.npmignore`)

---

## [0.1.0] - 2026-06-30

### Added
- Initial release of the GrowManager ioBroker adapter
- **Core adapter**: TypeScript adapter based on `@iobroker/adapter-core` with daemon mode
- **Group management**: logical grow groups with sensors, actuators and irrigation zones
- **Climate control**: VPD, temperature and humidity regulation with PID controller
- **Alarm system**: multi-severity alarm engine with acknowledgement support
- **Schedule service**: light-on/off schedule with day/night transitions
- **Shared actor manager**: prevents conflicting simultaneous actuator commands
- **Web dashboard**: live status dashboard served on port 8097 (SSE-based real-time updates)
- **React admin UI**: ioBroker admin settings page for configuring groups, sensors, actuators
  and alarm channels (Vite + React 18, served via `admin/index.html`)
- **Adapter icon**: dark green circle icon (`admin/growmanager.png`)
- 116 unit tests (10 test suites) covering all core services

[0.1.3]: https://github.com/mrder/ioBroker.growmanager/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/mrder/ioBroker.growmanager/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/mrder/ioBroker.growmanager/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/mrder/ioBroker.growmanager/releases/tag/v0.1.0
