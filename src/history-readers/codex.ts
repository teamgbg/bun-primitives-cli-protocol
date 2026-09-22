/**
 * @system cli-session
 * @status handwritten
 * @edit edit directly
 *
 * Reads Codex's native rollout JSONL (one file per thread). Each relevant
 * line is a `response_item` with payload.type="message". We surface user &
 * assistant messages; developer/system prompts and tool scaffolding are
 * filtered out so the UI stays conversational.
 */

import type { FeedMessage } from "@teamscala/session-contracts/feed-message";
import type { OrchestratorSession } from "@teamscala/session-contracts/orchestrator-session-type";
import {
	convertCodexLineToFeedMessage,
	parseCodexLine,
} from "./_codex-history/content-parser";
import { loadCodexRawLines } from "./_codex-history/line-loader";

export async function readCodexHistory(
	session: OrchestratorSession,
): Promise<FeedMessage[]> {
	const sid = session.session_identifier;
	if (!sid) return [];
	const lines = await loadCodexRawLines({ sessionId: sid, workdir: session.workdir });
	const out: FeedMessage[] = [];
	for (const line of lines) {
		const evt = parseCodexLine(line);
		if (!evt) continue;
		if (evt.type !== "response_item") continue;
		const msg = convertCodexLineToFeedMessage(evt, session);
		if (msg) out.push(msg);
	}
	return out;
}
