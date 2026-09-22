/**
 * @system cli-session
 * @status handwritten
 * @edit edit directly
 *
 * Loads raw lines from a Claude Code session JSONL file.
 */

import { createLogger } from "@teamscala/logger/creator";
import type { OrchestratorSession } from "@teamscala/session-contracts/orchestrator-session-type";
import { claudeProjectsStore } from "#cli-session/session-stores/claude-projects.ts";

const logger = createLogger({ service: "cli-session" });

export interface LoadedSessionLines {
	lines: string[];
	filePath: string | null;
}

export async function loadClaudeSessionLines(
	session: OrchestratorSession,
): Promise<LoadedSessionLines> {
	const sid = session.session_identifier;
	if (!sid) return { lines: [], filePath: null };
	const file = claudeProjectsStore.path(session.workdir, sid);
	if (!(await Bun.file(file).exists())) return { lines: [], filePath: null };
	try {
		return { lines: (await Bun.file(file).text()).split("\n"), filePath: file };
	} catch (err) {
		logger.warn(`[history-readers/claude] failed to read ${file}:`, err);
		return { lines: [], filePath: null };
	}
}
