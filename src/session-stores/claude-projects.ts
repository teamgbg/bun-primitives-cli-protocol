/**
 * @system cli-session
 * @status handwritten
 * @edit edit directly
 *
 * Session store for Claude Code's project-level session files.
 * Claude stores session state at ~/.claude/projects/<escaped-cwd>/<uuid>.jsonl.
 * Ported from scala-agents/src/orchestrators/runtime.ts:claudeSessionFileExists().
 */

/**
 * Resolve a Claude session's transcript JSONL by SESSION ID — cwd-INDEPENDENT.
 * Claude writes the transcript at the cwd the session was LAUNCHED in
 * (~/.claude/projects/<escaped-launch-cwd>/<id>.jsonl), but a lane's workdir
 * CHANGES as it cd's between repos, so deriving the path from the CURRENT
 * workdir tails the WRONG file (the RPM=0 / ctx-stale root cause after a tail
 * restore used the lane's since-changed cwd). Scanning every project dir for
 * the session id finds the real transcript regardless of where the lane has
 * since cd'd. Falls back to the workdir-derived path (correct for a lane whose
 * cwd hasn't changed since launch). One readdirSync at tail-start — cheap (a
 * handful of project dirs), never per-tick.
 */

import { readdir } from "node:fs/promises";
import { createSafeFallback } from "@teamscala/safe-fallback/create-safe-fallback";
import { join } from "node:path";
import { userHome } from "@teamscala/os/host-paths";
import type { SessionStore } from "@teamscala/session-contracts/types";

export const claudeProjectsStore: SessionStore = {
	exists(workdir: string, sessionId: string): boolean {
		return existsSync(
			claudeProjectsStore.path(workdir, sessionId),
		);
	},
	path(workdir: string, sessionId: string): string {
		const escaped = workdir.replace(/\//g, "-");
		return join(
			process.env.HOME ?? `${userHome()}`,
			".claude",
			"projects",
			escaped,
			`${sessionId}.jsonl`,
		);
	},
};

/**
 * The project directory holding all of a workdir's Claude session transcripts
 * (~/.claude/projects/<escaped-cwd>/). Used by the fleet transcript tail to
 * DISCOVER the newest .jsonl — Claude mints its own session id on a fresh
 * spawn (no --session-id flag exists), so the filename can't be known ahead.
 */
export function claudeProjectsDir(workdir: string): string {
	const escaped = workdir.replace(/\//g, "-");
	return join(process.env.HOME ?? `${userHome()}`, ".claude", "projects", escaped);
}

// The transcript-dir scan is a protective layer: a readdir failure (dir
// absent, permission) must fall back to the workdir-derived path, and the
// fallback is the layer's declared degraded result — routed through
// createSafeFallback per protective-layers-fail-explicitly (bare catches
// around upstream calls are blocked by the no-bare-catch gate).
const _transcriptScan = createSafeFallback<string | null>({
	name: "cli-session:claude-transcript-scan",
	onFailure: "fail-open-silent",
	degradedResult: null,
});

export async function resolveClaudeTranscriptPath(
	sessionId: string,
	workdir: string,
): Promise<string> {
	const projectsRoot = join(
		process.env.HOME ?? `${userHome()}`,
		".claude",
		"projects",
	);
	const found = await _transcriptScan.call(async () => {
		for (const dir of await readdir(projectsRoot)) {
			const candidate = join(projectsRoot, dir, `${sessionId}.jsonl`);
			if (await Bun.file(candidate).exists()) return candidate;
		}
		return null;
	});
	return found ?? claudeProjectsStore.path(workdir, sessionId);
}
