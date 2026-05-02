// Demo review runner — executes the review pipeline against a local fixture diff.
// Used by scripts/demo.sh to run the review without a real PR number.
// Avoids calling GitHub by reading the diff from a local file.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = join(__dirname, "..");

const memDir = process.argv[2];
const diffPath = process.argv[3];
const outputFile = process.argv[4];

if (!memDir || !diffPath || !outputFile) {
  console.error("Usage: demo-run-review.mjs <memDir> <diffPath> <outputFile>");
  process.exit(1);
}

async function main() {
  // Import compiled modules
  const { MemoryAdapter } = await import(join(REPO_DIR, "dist/memory/adapter.js"));
  const { chunkHunks } = await import(join(REPO_DIR, "dist/review/chunk-hunks.js"));
  const { recall } = await import(join(REPO_DIR, "dist/review/recall.js"));
  const { judge } = await import(join(REPO_DIR, "dist/review/judge.js"));
  const { compose } = await import(join(REPO_DIR, "dist/review/composer.js"));
  const { renderReview } = await import(join(REPO_DIR, "dist/review/poster.js"));

  // Read the planted-bug diff
  const diff = readFileSync(diffPath, "utf-8");

  // Chunk the diff into hunks
  const hunks = chunkHunks(diff);
  if (hunks.length === 0) {
    console.error("No hunks found in diff");
    process.exit(1);
  }

  console.error(`Found ${hunks.length} hunk(s) in planted-bug diff`);

  // Initialize memory adapter
  const adapter = await MemoryAdapter.fromConfig({
    memory_dir: memDir,
    owner: "joshuaswarren",
    repo: "remnic",
  });

  try {
    // For each hunk, recall relevant lessons and judge
    const verdictInputs = [];

    for (const hunk of hunks) {
      const hits = await recall(adapter, hunk, { topK: 10 });
      console.error(`  Hunk ${hunk.file}:${hunk.startLine} — ${hits.length} recall hit(s)`);

      for (const hit of hits) {
        const verdict = await judge(hunk, hit.lesson, "gpt-5.4-nano");
        if (verdict.applies) {
          verdictInputs.push({
            file: hunk.file,
            line: hunk.startLine,
            lesson: hit.lesson,
            verdict,
          });
          console.error(
            `    Lesson ${hit.lesson.id}: applies=${verdict.applies} confidence=${verdict.confidence.toFixed(2)}`,
          );
        }
      }
    }

    // Compose comments with default threshold
    const comments = compose(verdictInputs, { threshold: 0.6 });

    // Build a PostedReview for rendering
    const review = {
      id: `rev_demo_${Date.now()}`,
      owner: "joshuaswarren",
      repo: "remnic",
      pr_number: 99999,
      posted_at: new Date().toISOString(),
      dry_run: true,
      comments,
    };

    // Store the review record
    await adapter.storeReview(review);

    // Render
    const rendered = renderReview(review);
    process.stdout.write(rendered);
    process.stdout.write("\n");

    // Write output to file
    writeFileSync(outputFile, rendered, "utf-8");

    // Summary
    console.error(`\nReview summary: ${comments.length} comment(s) across ${hunks.length} hunk(s)`);

    if (comments.length === 0) {
      console.error("WARNING: No comments produced. Check that lessons were ingested correctly.");
    }

    // List which lessons were cited
    for (const comment of comments) {
      const citationMatch = comment.body.match(
        /<field name="lesson_id">([^<]+)<\/field>/,
      );
      if (citationMatch) {
        console.error(`  Cited lesson: ${citationMatch[1]}`);
      }
    }
  } finally {
    await adapter.shutdown();
  }
}

main().catch((err) => {
  console.error("Demo review failed:", err.message);
  process.exit(1);
});
