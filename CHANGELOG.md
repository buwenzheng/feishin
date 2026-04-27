# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.11.1] - 2026-04-28

### Fixed

- Windows MPV playback and settings: reload behavior, WASAPI exclusive options visibility, and related i18n.
- Windows packaging: `electron-builder` dependency collection when `pnpm` lives under a path with spaces (e.g. Volta under `Program Files`), via `pnpm` patch for `app-builder-lib`.

### Changed

- Auto-update and in-app GitHub links use the fork repository (`src/shared/github-release-repo.ts`); keep in sync with `electron-builder.yml` `publish`.

### Added

- `package:release:win` (alias of `package:win`); `package:win:dev` / `package:win:dev:dir` for local builds behind an HTTP proxy.
- Chinese README, MPV setup scripts, and optional git HTTP proxy helper scripts.
- CI: fetch bundled MPV for Windows publish jobs.

### Notes

- GitHub Actions desktop publish workflows remain **manual** (`workflow_dispatch`); push does not auto-publish releases.
