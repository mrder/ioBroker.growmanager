# Changelog

All notable changes to the GrowManager ioBroker adapter are documented here.

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
