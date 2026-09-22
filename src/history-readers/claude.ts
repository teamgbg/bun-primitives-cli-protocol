/**
 * @system cli-session
 * @status handwritten
 * @edit edit directly
 *
 * Reads Claude Code's native session JSONL at
 * ~/.claude/projects/<escaped-cwd>/<session_identifier>.jsonl.
 * Authoritative history for the long-lived claude orchestrator session.
 */

import type { FeedMessage } from "@teamscala/session-contracts/feed-message";
import type { OrchestratorSession } from "@teamscala/session-contracts/orchestrator-session-type";
import {
	convertClaudeLine,
	parseClaudeLine,
} from "./_claude-history/content-parser";
import { loadClaudeSessionLines } from "./_claude-history/line-loader";

export async function readClaudeHistory(
	session: OrchestratorSession,
): Promise<FeedMessage[]> {
	const { lines } = await loadClaudeSessionLines(session);
	if (!lines.length) return [];
	const out: FeedMessage[] = [];
	for (const raw of lines) {
		const evt = parseClaudeLine(raw);
		if (!evt) continue;
		const msg = convertClaudeLine(evt, session);
		if (msg) out.push(msg);
	}
	return out;
}
