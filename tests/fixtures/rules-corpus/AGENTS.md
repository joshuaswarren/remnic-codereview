# Agent Guidelines

## Security: Never commit secrets

API keys, tokens, and passwords must NEVER appear in committed files. Always add `.env*`, `secrets.env`, and `*.key` to `.gitignore`. Redact secret values in logs using pattern matching.

## Testing: No silenced failures

CI quality gates must NOT silence failures. Never use `|| true`, `continue-on-error: true`, or missing `set -e` on lint/test/typecheck steps. Every failure must be visible.

## Style: No inline comments

Do not use inline comments unless they explain non-obvious *why*. Two-line file header comments describing the file's purpose are encouraged.

## Performance: Batch API usage

When extracting lessons at scale (>100 lessons), prefer the OpenAI Batch API to reduce cost by ~50%. Standard extraction uses the synchronous Responses API.
