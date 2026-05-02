# 1. Use Remnic for Memory Storage

Date: 2026-03-15

## Status

Accepted

## Context

We need a persistent memory store for code review lessons. Options considered:
1. Plain JSON files — simple but no search capability
2. SQLite directly — requires manual schema management
3. Remnic (QMD-backed) — provides hybrid search, structured storage, and dedup

## Decision

We will use Remnic (`@remnic/core`) as the memory backend. It provides:
- QMD-powered hybrid search (keyword + semantic)
- Structured markdown storage with YAML frontmatter
- Built-in dedup via content hashing
- `EngramAccessService` as the single entrypoint

## Consequences

- All lesson storage goes through `MemoryAdapter` → `EngramAccessService`
- We cannot bypass the adapter to write directly to the filesystem
- QMD binary must be available on PATH
