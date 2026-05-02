// Fetch diff — retrieves unified diff for a PR via GitHub client.

import type { GitHubClient } from "../github/client.js";

/**
 * Fetch the unified diff for a pull request.
 *
 * @param client - GitHub client with auth
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param prNumber - Pull request number
 * @returns Raw unified diff string
 * @throws Error with clear message on 404 or other failures
 */
export async function fetchDiff(
	client: GitHubClient,
	owner: string,
	repo: string,
	prNumber: number,
): Promise<string> {
	try {
		return await client.getDiff(owner, repo, prNumber);
	} catch (err: unknown) {
		const httpError = err as { status?: number; message?: string };
		if (httpError.status === 404) {
			throw new Error(
				`PR #${prNumber} not found in ${owner}/${repo}. ` +
					`Verify the PR number and repository slug are correct.`,
			);
		}
		throw err;
	}
}
