# DEV Challenge Submission

## Project

**remnic-codereview** - a memory-augmented code review bot that learns from a
team's own review history and uses those lessons to review future pull requests.

Repository: https://github.com/joshuaswarren/remnic-codereview

## Short Submission Post

I built `remnic-codereview`, a code review system with institutional memory.
It ingests prior PR reviews, repo rules, CHANGELOG entries, ADRs, post-mortems,
closed issues, and fix/revert commits into a Remnic-backed memory store. When a
new PR opens, it chunks the diff by hunk, retrieves relevant lessons, asks an
OpenAI judge whether each lesson really applies, then posts inline GitHub review
comments with `<oai-mem-citation>` blocks back to the original incident.

This is not a prompt with a UI. It is a stateful system: ingestion pipelines,
memory storage, retrieval, hunk-level judging, citation composition, GitHub
posting, incremental PR-merge webhook ingestion, and a dashboard for browsing
lessons and review logs.

Repo: https://github.com/joshuaswarren/remnic-codereview

## What I Built

`remnic-codereview` gives a repository a reusable review memory. Instead of
generic lint-style feedback, it can say: "this team already hit this exact
failure mode, and here is the original review or incident where the lesson came
from."

The system includes:

- A CLI for setup, ingestion, lesson browsing, PR review, and serving a dashboard.
- Ingestion from rules docs, GitHub PR review surfaces, CHANGELOG, ADRs,
  post-mortems, closed issues, and fix/revert/bug commits.
- Hunk-level diff review with retrieval, OpenAI judging, and citation composition.
- A GitHub Action for PR-triggered review.
- A merged-PR webhook endpoint for incremental lesson ingestion.
- An Express API and React dashboard for lessons and review history.

## How It Uses OpenAI APIs

- **Responses API** for extracting structured lessons from unstructured review
  comments, rules docs, post-mortems, and commit history.
- **Structured Outputs** for lesson extraction and review verdict schemas, so
  the system can store and act on typed data instead of free-form text.
- **OpenAI judge calls** to decide whether a retrieved lesson genuinely applies
  to a specific diff hunk.
- **Embeddings through Remnic** for semantic/hybrid lesson recall.

OpenAI is used where fixed logic is too brittle: turning messy human review
history into durable lessons, matching those lessons to new code, and filtering
false positives before anything reaches a reviewer.

## Why AI Was Necessary

The hard part is not posting a GitHub comment. The hard part is understanding
unstructured institutional knowledge and applying it to a different future diff.

A static linter cannot reliably turn review comments like "this reset path can
race with late extraction" or "guard `slice(-n)` because `slice(-0)` returns all
entries" into reusable, cited, hunk-level feedback. This system uses AI to
extract the lesson, retrieve it later by meaning, judge applicability, and cite
the source.

## How To Run

```bash
git clone https://github.com/joshuaswarren/remnic-codereview.git
cd remnic-codereview
pnpm install --frozen-lockfile
pnpm build

export OPENAI_API_KEY=...
export GITHUB_TOKEN=...

node dist/cli.js init --owner <owner> --repo <repo>
node dist/cli.js ingest --all <owner>/<repo>
node dist/cli.js review <owner>/<repo> <pr-number> --dry-run
node dist/cli.js serve
```

Then open `http://localhost:4317/`.

## Demo Artifacts

- Written proof plan: `docs/REAL_WORLD_TEST_PLAN.md`
- Web demo page: `docs/challenge-demo/index.html`
- Video render script: `scripts/render-challenge-demo.mjs`
- Demo video: `docs/challenge-demo/demo.mp4`
- Deterministic dogfood script: `bash scripts/demo.sh`

## Verification

Fresh clone verification:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm build
env -u GITHUB_TOKEN pnpm test
pnpm --dir admin-console install --frozen-lockfile
pnpm --dir admin-console build
pnpm --dir admin-console typecheck
```

Current automated test suite: 367 tests.

The deterministic demo (`bash scripts/demo.sh`) seeds lessons, plants a
`slice(-n)` bug, runs the review pipeline, and verifies the resulting review
contains the correct Pattern #27 citation block.
