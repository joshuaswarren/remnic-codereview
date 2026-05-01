# Contributing to Remnic

## Code style

Use TypeScript strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. All new files must pass `pnpm typecheck` with zero errors.

## Commit messages

Use Conventional Commits format: `feat(scope): description`. Scope should be a module name or area like `cli`, `ingest`, `memory`, `review`.

## Pull request process

1. Create a feature branch from `main`.
2. Implement with tests (TDD preferred).
3. Ensure `pnpm typecheck && pnpm test && pnpm lint` all pass.
4. Open a PR with a clear description of what changed and why.

## Adding new source kinds

When adding a new ingestion source:
- Add the variant to the `IngestSource` discriminated union in `src/schemas/ingest-source.ts`.
- Add the source_kind value to the `SourceKind` enum in `src/schemas/lesson.ts`.
- Create an extraction module in `src/ingest/`.
- Wire it into the CLI in `src/cli.ts`.
