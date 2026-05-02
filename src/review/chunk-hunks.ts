// Hunk chunker — parses unified diff into Hunk[] with file/line/language.
// Handles binary diffs, renames, and multiple files.

/** A parsed diff hunk with location metadata. */
export interface Hunk {
	/** File path (uses the new path for renames). */
	file: string;
	/** Starting line number of the hunk in the new file. */
	startLine: number;
	/** Ending line number of the hunk in the new file. */
	endLine: number;
	/** Inferred programming language from file extension. */
	language: string;
	/** The raw hunk text including + and - lines. */
	hunkText: string;
	/** Surrounding context (function/class names from @@ header). */
	surroundingContext: string;
}

/** Map of file extension to language identifier. */
const EXT_TO_LANG: Record<string, string> = {
	ts: "ts",
	tsx: "tsx",
	js: "js",
	jsx: "jsx",
	py: "py",
	rs: "rs",
	go: "go",
	java: "java",
	rb: "rb",
	php: "php",
	c: "c",
	cpp: "cpp",
	h: "c",
	hpp: "cpp",
	cs: "cs",
	swift: "swift",
	kt: "kt",
	scala: "scala",
	md: "md",
	json: "json",
	yaml: "yaml",
	yml: "yaml",
	toml: "toml",
	css: "css",
	scss: "scss",
	html: "html",
	sql: "sql",
	sh: "sh",
	bash: "bash",
	zsh: "zsh",
};

/**
 * Infer the programming language from a file path extension.
 */
function inferLanguage(filePath: string): string {
	const dotIdx = filePath.lastIndexOf(".");
	if (dotIdx === -1) return "";
	const ext = filePath.slice(dotIdx + 1).toLowerCase();
	return EXT_TO_LANG[ext] ?? ext;
}

/**
 * Parse a unified diff string into an array of Hunk objects.
 *
 * Handles:
 * - Multiple files in one diff
 * - Binary diffs (skipped)
 * - Renamed files (uses new path)
 * - @@ headers with optional context labels
 */
export function chunkHunks(diff: string): Hunk[] {
	if (!diff || diff.trim() === "") return [];

	const hunks: Hunk[] = [];
	const lines = diff.split("\n");

	let currentFile = "";
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];

		// Parse file header: "diff --git a/old b/new"
		if (line?.startsWith("diff --git ") === true) {
			// Extract the new file path from "b/new-path"
			const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
			if (match?.[2]) {
				currentFile = match[2];
			}
			i++;
			continue;
		}

		// Skip binary diffs
		if (line?.startsWith("Binary files") === true || line?.includes("Binary files")) {
			currentFile = "";
			i++;
			continue;
		}

		// Parse hunk header: "@@ -old_start,old_count +new_start,new_count @@ context"
		if (line?.startsWith("@@") === true) {
			const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@\s*(.*)$/);
			if (hunkMatch) {
				const startLine = Number.parseInt(hunkMatch[1] ?? "1", 10);
				const newCount = Number.parseInt(hunkMatch[2] ?? "1", 10);
				const context = hunkMatch[3]?.trim() ?? "";

				// Collect hunk text lines
				i++; // Move past @@ line
				const hunkLines: string[] = [];
				let addedLines = 0;

				while (i < lines.length) {
					const hline = lines[i];
					// Stop at next diff/hunk header or end
					if (hline === undefined || hline.startsWith("diff --git ") || hline.startsWith("@@")) {
						break;
					}
					hunkLines.push(hline);
					if (hline.startsWith("+") || hline.startsWith(" ")) {
						addedLines++;
					}
					i++;
				}

				const endLine = startLine + Math.max(newCount - 1, addedLines - 1);
				const hunkText = hunkLines.join("\n");

				if (currentFile) {
					hunks.push({
						file: currentFile,
						startLine,
						endLine,
						language: inferLanguage(currentFile),
						hunkText,
						surroundingContext: context,
					});
				}
				continue;
			}
		}

		i++;
	}

	return hunks;
}
