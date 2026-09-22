/**
 * @system cli-session
 * @status handwritten
 * @edit edit directly
 *
 * Converts parsed Codex JSONL lines into FeedMessage objects.
 */

import type { FeedMessage } from "@teamscala/session-contracts/feed-message";
import type { OrchestratorSession } from "@teamscala/session-contracts/orchestrator-session-type";

/**
 * A payload status, or an explicit absent-marker when the field never arrived.
 *
 * The `?? "completed"` this replaces fabricated an OUTCOME: a captured turn
 * asserted it finished successfully on the strength of a field the payload did
 * not carry (a-component-may-not-report-a-state-it-has-not-verified). The
 * absence is the information, so it is recorded rather than coerced.
 */
function statusOrAbsent(value: unknown): string {
	return value === undefined ? "unknown" : String(value);
}


export interface ParsedCodexLine {
	type: string;
	timestamp?: string;
	payload: Record<string, unknown>;
}

export function parseCodexLine(raw: string): ParsedCodexLine | null {
	if (!raw.trim()) return null;
	try {
		const obj = JSON.parse(raw);
		if (typeof obj !== "object" || obj === null) return null;
		return obj as ParsedCodexLine;
	} catch {
		return null;
	}
}

export function convertCodexLineToFeedMessage(
	evt: ParsedCodexLine,
	session: OrchestratorSession,
): FeedMessage | null {
	const ts = String(evt.timestamp ?? new Date().toISOString());
	const payload = (evt.payload ?? {}) as Record<string, unknown>;
	const ptype = payload.type as string | undefined;

	if (ptype === "message") {
		const role = payload.role as string | undefined;
		if (role === "assistant") {
			const content = payload.content as
				| Array<Record<string, unknown>>
				| undefined;
			const parts: FeedMessage["parts"] = [];
			if (Array.isArray(content)) {
				for (const block of content) {
					const t = block.type as string | undefined;
					if (t === "input_text" || t === "output_text" || t === "text") {
						const text = String(block.text ?? "");
						parts.push({ type: "text", text });
					} else if (t === "output_tool_call" || t === "tool_call") {
						parts.push({
							type: "tool",
							tool: String(block.name ?? block.tool ?? ""),
							title: String(block.name ?? ""),
							state: {
								status: "running",
								input:
									(block.arguments as Record<string, unknown>) ??
									(block.input as Record<string, unknown>) ??
									{},
							},
						});
					}
				}
			}
			if (parts.length === 0) return null;
			return buildAssistantMessage(parts, ts, session);
		} else if (role === "user") {
			const content = payload.content as
				| Array<Record<string, unknown>>
				| undefined;
			const parts: FeedMessage["parts"] = [];
			if (Array.isArray(content)) {
				for (const block of content) {
					const t = block.type as string | undefined;
					if (t === "input_text" || t === "text") {
						const text = String(block.text ?? "");
						if (
							text.startsWith("# AGENTS.md") ||
							text.startsWith("<permissions instructions>") ||
							text.startsWith("<environment_context>")
						) {
							continue;
						}
						parts.push({ type: "text", text });
					}
				}
			}
			if (parts.length === 0) return null;
			return buildUserMessage(parts, ts, session);
		}
	} else if (
		ptype === "function_call" ||
		ptype === "local_shell_call" ||
		ptype === "web_search_call" ||
		ptype === "reasoning"
	) {
		return convertMetaEvent(ptype, payload, ts, session);
	}
	return null;
}

function buildAssistantMessage(
	parts: FeedMessage["parts"],
	ts: string,
	session: OrchestratorSession,
): FeedMessage {
	const sid = session.session_identifier ?? "";
	return {
		id: `codex-${sid}-${Date.now()}`,
		role: "assistant",
		parts,
		tokensInput: null,
		tokensOutput: null,
		tokensReasoning: null,
		observedAt: ts,
		source: "codex",
		slotName: "Codex",
		sessionId: session.id,
		isSubagent: false,
		provider: "codex",
		model: session.model ?? null,
		agent: null,
	};
}

function buildUserMessage(
	parts: FeedMessage["parts"],
	ts: string,
	session: OrchestratorSession,
): FeedMessage {
	const sid = session.session_identifier ?? "";
	return {
		id: `codex-${sid}-${Date.now()}`,
		role: "user",
		parts,
		tokensInput: null,
		tokensOutput: null,
		tokensReasoning: null,
		observedAt: ts,
		source: "codex",
		slotName: "You",
		sessionId: session.id,
		isSubagent: false,
		provider: "codex",
		model: session.model ?? null,
		agent: null,
	};
}

function convertMetaEvent(
	ptype: string,
	payload: Record<string, unknown>,
	ts: string,
	session: OrchestratorSession,
): FeedMessage | null {
	let tool = "";
	let text = "";
	let state: {
		status: string;
		input?: Record<string, unknown>;
		output?: string;
	} = {
		status: "completed",
	};
	if (ptype === "function_call") {
		tool = String(payload.name ?? "tool");
		state = {
			status: statusOrAbsent(payload.status),
			input: (payload.arguments as Record<string, unknown>) ?? {},
			output:
				typeof payload.result === "string"
					? payload.result
					: JSON.stringify(payload.result ?? null),
		};
	} else if (ptype === "local_shell_call") {
		tool = "shell";
		state = {
			status: statusOrAbsent(payload.status),
			input: { command: payload.command },
			output:
				typeof payload.stdout === "string"
					? payload.stdout
					: JSON.stringify(payload.stdout ?? null),
		};
	} else if (ptype === "web_search_call") {
		tool = "web_search";
		state = {
			status: statusOrAbsent(payload.status),
			input: { query: payload.query },
			output:
				typeof payload.result === "string"
					? payload.result
					: JSON.stringify(payload.result ?? null),
		};
	} else if (ptype === "reasoning") {
		tool = "";
		text = String(payload.text ?? "");
	}
	if (ptype === "reasoning" && !text) return null;
	const sid = session.session_identifier ?? "";
	const parts: FeedMessage["parts"] =
		ptype === "reasoning"
			? [{ type: "reasoning" as const, text }]
			: [{ type: "tool" as const, tool, title: tool || "tool", state }];
	return {
		id: `codex-${sid}-${Date.now()}-${ptype}`,
		role: "assistant",
		parts,
		tokensInput: null,
		tokensOutput: null,
		tokensReasoning: null,
		observedAt: ts,
		source: "codex",
		slotName: "Codex",
		sessionId: session.id,
		isSubagent: false,
		provider: "codex",
		model: session.model ?? null,
		agent: null,
	};
}
