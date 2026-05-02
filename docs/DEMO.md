# Demo Recording Recipe

Step-by-step instructions for recording a 90-second demo of `remnic-codereview`.

## Prerequisites

- Node 22.12.0+ and pnpm 10+ installed
- `OPENAI_API_KEY` set in environment (for real OpenAI calls during extraction)
- `GITHUB_TOKEN` set in environment (for GitHub API access)
- Terminal set to a dark theme with a large, readable font (recommended: 18pt+)
- Screen recording tool (e.g., macOS Screen Recording, OBS, or `ffmpeg -f avfoundation`)

## Environment Setup

```bash
# 1. Clone and build
git clone https://github.com/joshuaswarren/remnic-codereview.git
cd remnic-codereview
pnpm install --frozen-lockfile
pnpm build

# 2. Set up secrets
cp .env.example .env
# Edit .env with your real keys (never commit this file)
```

## Recording Steps

### Part 1: Ingest (≈30 seconds)

1. **Initialize memory store:**

   ```bash
   node dist/cli.js init --owner joshuaswarren --repo remnic --memory-dir /tmp/demo-memory
   ```

2. **Ingest rules from the Remnic monorepo:**

   ```bash
   node dist/cli.js ingest --rules /path/to/remnic --memory-dir /tmp/demo-memory
   ```

3. **Ingest PR reviews (last 10 PRs):**

   ```bash
   node dist/cli.js ingest --pr-reviews joshuaswarren/remnic --max-prs 10 --memory-dir /tmp/demo-memory
   ```

4. **Show ingested lessons:**

   ```bash
   node dist/cli.js lessons list --memory-dir /tmp/demo-memory
   ```

### Part 2: Bot reviews a PR (≈30 seconds)

5. **Run the review bot in dry-run mode against a known-bug PR:**

   ```bash
   node dist/cli.js review joshuaswarren/remnic 42 --dry-run --memory-dir /tmp/demo-memory
   ```

6. **Show the citation block** — point out how the bot cites the original PR review where the pattern was learned.

### Part 3: Dashboard (≈30 seconds)

7. **Start the serve command:**

   ```bash
   node dist/cli.js serve --port 4317 --memory-dir /tmp/demo-memory
   ```

8. **Open browser to `http://localhost:4317/`**

9. **Browse the Lessons page** — search, filter by severity, click a lesson to see full detail with source URL.

10. **Navigate to the Reviews page** — show the posted review log with PR links.

11. **Stop the server** with `Ctrl+C`.

## What to Record

Record the following in a single continuous clip:

1. **Terminal**: Show the ingest commands and their stats output
2. **Terminal**: Show the review dry-run output with citation blocks
3. **Browser**: Show the Lessons browser with search/filter/detail
4. **Browser**: Show the Reviews log with clickable PR URLs

Target duration: 60–90 seconds.

## Output

Save the recording as:

- `docs/demo.mp4` (H.264, 1080p recommended)

Upload the final clip to the submission thread.
