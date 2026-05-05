import { Router } from "express";
import type { QualityPreset } from "../../cli.js";
import { getGitHubClient } from "../../github/client.js";
import { type GitHubClientLike, ingestPrReviews } from "../../ingest/pr-reviews.js";

interface PullRequestPayload {
	action?: string;
	repository?: {
		full_name?: string;
	};
	pull_request?: {
		number?: number;
		title?: string;
		state?: string;
		merged?: boolean;
		merged_at?: string | null;
		html_url?: string;
		user?: { login?: string } | null;
		created_at?: string;
		updated_at?: string;
	};
}

export interface WebhookRouterOptions {
	memoryDir?: string | undefined;
	quality?: QualityPreset | undefined;
	githubClient?: GitHubClientLike | undefined;
}

function isPullRequestPayload(body: unknown): body is PullRequestPayload {
	return typeof body === "object" && body !== null && "pull_request" in body;
}

function parseRepoSlug(fullName: string | undefined): { owner: string; repo: string } | null {
	const parts = fullName?.split("/") ?? [];
	const owner = parts[0];
	const repo = parts[1];
	if (parts.length !== 2 || !owner || !repo) return null;
	return { owner, repo };
}

function singlePullRequestClient(
	client: GitHubClientLike,
	payload: Required<Pick<PullRequestPayload, "pull_request">> & PullRequestPayload,
): GitHubClientLike {
	const pr = payload.pull_request;
	return {
		async listPRs() {
			return [
				{
					number: pr.number as number,
					title: pr.title ?? `PR #${pr.number}`,
					state: pr.state ?? "closed",
					merged: pr.merged === true,
					merged_at: pr.merged_at ?? null,
					html_url: pr.html_url ?? "",
					user: pr.user?.login ? { login: pr.user.login } : null,
					created_at: pr.created_at ?? pr.merged_at ?? new Date().toISOString(),
					updated_at: pr.updated_at ?? pr.merged_at ?? new Date().toISOString(),
				},
			];
		},
		listReviews: client.listReviews.bind(client),
		listReviewComments: client.listReviewComments.bind(client),
		listIssueComments: client.listIssueComments.bind(client),
	};
}

export function webhooksRouter(opts: WebhookRouterOptions): Router {
	const router = Router();

	router.post("/github", async (req, res, next) => {
		try {
			if (!opts.memoryDir) {
				res.status(503).json({
					error: {
						code: "WEBHOOKS_NOT_CONFIGURED",
						message: "Webhook ingestion requires a configured memory directory.",
					},
				});
				return;
			}

			const event = req.header("X-GitHub-Event");
			if (event !== "pull_request") {
				res.status(202).json({ status: "ignored", reason: "unsupported_event" });
				return;
			}

			if (!isPullRequestPayload(req.body)) {
				res.status(400).json({
					error: { code: "BAD_PAYLOAD", message: "Expected a GitHub pull_request payload." },
				});
				return;
			}

			const repoSlug = parseRepoSlug(req.body.repository?.full_name);
			const pr = req.body.pull_request;
			if (!repoSlug || typeof pr?.number !== "number") {
				res.status(400).json({
					error: {
						code: "BAD_PAYLOAD",
						message: "Payload must include repository.full_name and pull_request.number.",
					},
				});
				return;
			}

			if (req.body.action !== "closed" || pr.merged !== true || !pr.merged_at) {
				res.status(202).json({ status: "ignored", reason: "pull_request_not_merged" });
				return;
			}

			const githubClient = opts.githubClient ?? (await getGitHubClient());
			const result = await ingestPrReviews(
				{
					owner: repoSlug.owner,
					repo: repoSlug.repo,
					memoryDir: opts.memoryDir,
					quality: opts.quality ?? "default",
					dryRun: false,
					includeBots: false,
					since: undefined,
					maxPrs: 1,
				},
				singlePullRequestClient(
					githubClient,
					req.body as PullRequestPayload & {
						pull_request: NonNullable<PullRequestPayload["pull_request"]>;
					},
				),
			);

			res.status(200).json({
				status: "ok",
				owner: repoSlug.owner,
				repo: repoSlug.repo,
				pr_number: pr.number,
				stats: result.stats,
			});
		} catch (err) {
			next(err);
		}
	});

	return router;
}
