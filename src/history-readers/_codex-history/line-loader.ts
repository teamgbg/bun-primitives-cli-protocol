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

import { createLogger } from "@teamscala/logger/creator";
import { codexRolloutStore } from "#cli-session/session-stores/codex-rollout.ts";

const logger = createLogger({ service: "cli-session" });

export interface CodexLineContext {
	sessionId: string;
	workdir: string;
}

export async function loadCodexRawLines(ctx: CodexLineContext): Promise<string[]> {
	const file = codexRolloutStore.path(ctx.workdir, ctx.sessionId);
	if (!file || !(await Bun.file(file).exists())) return [];
	try {
		return (await Bun.file(file).text()).split("\n");
	} catch (err) {
		logger.warn(`[history-readers/codex] failed to read ${file}:`, err);
		return [];
	}
}
