# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org).

## Unreleased

### Added

- Biome lint, now part of `pnpm check`.
- `examples/demo.mjs` and its output image in the README.
- Contributing guide, code of conduct, security policy, issue and PR templates.

### Fixed

- Lint findings: listeners loop no longer returns values from `forEach`, no assignment inside an expression in `jsonSource`.

## 0.1.0 - 2026-11-18

### Added

- Initial release: `defineFlags`, `createFlags`, rules (users, attributes, percentage, date windows), dev overrides, `jsonSource` and `ts-flags/react`.
