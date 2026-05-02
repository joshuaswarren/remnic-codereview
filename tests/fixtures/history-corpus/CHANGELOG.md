# Changelog

## [2.0.0] - 2026-04-15

### Breaking Changes

- **Dropped support for Node 18**: Minimum Node version is now 22.12.0. All consumers must upgrade.
  This was necessary to use the new `fs.mkdirSync({ recursive: true })` patterns and modern ESM support.

### Features

- **Added atomic write helper**: All file writes now use write-tmp-then-rename pattern (Rule #54).
  This prevents data corruption on crash or power loss during writes.

## [1.5.0] - 2026-03-10

### Features

- **Memory adapter pagination**: Added cursor-based pagination to `listLessons()` and `listReviews()`.
  Cursors are opaque base64 strings that encode the start index into the filtered result set.

### Bug Fixes

- **Fixed dedup on re-run**: Content hash now sorts object keys before hashing (Rule #38).
  Previous behavior produced different hashes for identical content when key order varied.

## [1.0.0] - 2026-01-01

### Initial Release

- First stable release with rules ingestion, memory adapter, and CLI.
