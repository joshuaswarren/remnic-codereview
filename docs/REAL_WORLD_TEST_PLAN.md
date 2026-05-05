# Real-World Proof Plan

This is the live validation plan for proving `remnic-codereview` works beyond
unit tests and deterministic fixtures.

## Goal

Prove the bot can:

1. Build and install from a clean public GitHub clone.
2. Ingest real repository knowledge into a Remnic-backed store.
3. Review a real pull request diff.
4. Produce inline GitHub comments with `<oai-mem-citation>` provenance.
5. Incrementally ingest lessons when a PR is merged.
6. Expose the resulting lessons and review log in the dashboard.

## Prerequisites

- Node `>=22.12.0 <26`
- pnpm 10+
- `OPENAI_API_KEY`
- `GITHUB_TOKEN` with repo read/write access for a sandbox repository
- A disposable public or private sandbox repo where the bot can post comments

Never run the first live posting test against a high-traffic production PR.

## Sandbox Setup

Use a small repo such as `joshuaswarren/remnic-codereview-sandbox`.

Create two branches:

- `main`: contains a tiny TypeScript file and `AGENTS.md`.
- `bug/slice-zero`: adds a known bug using `items.slice(-maxEntries)` without a
  `maxEntries <= 0` guard.

Seed `AGENTS.md` with a real rule:

```md
## Review Rule: Guard slice(-n)

If code calls `items.slice(-n)`, check that `n > 0` first. In JavaScript,
`slice(-0)` is equivalent to `slice(0)`, which returns all entries.
```

Open a pull request from `bug/slice-zero` to `main`.

## Live Verification Commands

From a clean clone of `remnic-codereview`:

```bash
pnpm install --frozen-lockfile
pnpm build

export OPENAI_API_KEY=...
export GITHUB_TOKEN=...

MEM_DIR=/tmp/remnic-codereview-live-proof
rm -rf "$MEM_DIR"

node dist/cli.js init \
  --owner joshuaswarren \
  --repo remnic-codereview-sandbox \
  --memory-dir "$MEM_DIR" \
  --force

node dist/cli.js ingest \
  --rules /path/to/remnic-codereview-sandbox \
  --memory-dir "$MEM_DIR"

node dist/cli.js review \
  joshuaswarren/remnic-codereview-sandbox \
  <PR_NUMBER> \
  --dry-run \
  --memory-dir "$MEM_DIR"
```

Dry-run pass criteria:

- The output names the file containing `slice(-maxEntries)`.
- It produces at least one comment.
- It includes `<oai-mem-citation>`.
- The citation source points back to the seeded rule.

Then post for real:

```bash
node dist/cli.js review \
  joshuaswarren/remnic-codereview-sandbox \
  <PR_NUMBER> \
  --memory-dir "$MEM_DIR"
```

Posting pass criteria:

- The PR receives a GitHub review comment.
- The comment is attached to the changed line.
- The comment contains the citation block.
- The dashboard lists the posted review.

## Webhook Verification

Start the server:

```bash
node dist/cli.js serve --port 4317 --memory-dir "$MEM_DIR"
```

Expose it temporarily with a tunnel such as `ngrok` or Cloudflare Tunnel, then
configure a GitHub webhook:

- Payload URL: `https://<tunnel-host>/api/webhooks/github`
- Content type: `application/json`
- Event: `Pull requests`

Merge the sandbox PR.

Webhook pass criteria:

- GitHub returns `2xx` for the webhook delivery.
- `POST /api/webhooks/github` returns `{ "status": "ok" }`.
- `node dist/cli.js lessons list --memory-dir "$MEM_DIR"` shows new PR-review
  lessons from the merged PR.

## Evidence Checklist

Save these artifacts for the challenge submission:

- Clean-clone command log.
- Dry-run review output.
- Screenshot of the real GitHub PR comment.
- Screenshot of the dashboard lesson browser.
- Screenshot of the dashboard review log.
- Short demo clip showing ingest -> review -> citation -> dashboard.

## Current Automated Proof

The repository currently passes:

```bash
pnpm lint
pnpm typecheck
pnpm build
env -u GITHUB_TOKEN pnpm test
pnpm --dir admin-console build
pnpm --dir admin-console typecheck
bash scripts/demo.sh
```

The deterministic demo proves the end-to-end system path without spending API
credits or mutating GitHub. The live plan above is the final proof for real
OpenAI and GitHub behavior.
