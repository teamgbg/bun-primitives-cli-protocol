/**
 * @system cli-session
 * @status handwritten
 * @edit edit directly
 *
 * Converts parsed Claude Code JSONL lines into FeedMessage objects.
 */

import type { FeedMessage } from "@teamscala/session-contracts/feed-message";
import type { OrchestratorSession } from "@teamscala/session-contracts/orchestrator-session-type";

export function parseClaudeLine(raw: string): Record<string, unknown> | null {
	if (!raw.trim()) return null;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

export function convertClaudeLine(
	evt: Record<string, unknown>,
	session: OrchestratorSession,
): FeedMessage | null {
	const type = evt.type as string | undefined;

	if (
		type === "compact_boundary" ||
		(type === "system" && (evt.subtype as string) === "compact_boundary")
	) {
		return {
			id: `claude-compact-${Date.now()}`,
			role: "system",
			parts: [{ type: "compaction" }],
			tokensInput: null,
			tokensOutput: null,
			tokensReasoning: null,
			observedAt: String(evt.timestamp ?? new Date().toISOString()),
			source: "claude-code",
			slotName: "Claude",
			sessionId: session.id,
			isSubagent: false,
			provider: "claude-code",
			model: session.model ?? null,
			agent: null,
		};
	}

	if (type !== "user" && type !== "assistant") return null;

	const message = (evt.message ?? {}) as Record<string, unknown>;
	const role = (message.role as string) ?? type;
	const content = message.content as
		| string
		| Array<Record<string, unknown>>
		| undefined;
	const uuid = String(evt.uuid ?? "");
	const ts = String(evt.timestamp ?? new Date().toISOString());

	const parts: FeedMessage["parts"] = [];
	if (typeof content === "string") {
		parts.push({ type: "text", text: content });
	} else if (Array.isArray(content)) {
		for (const block of content) {
			const bt = block.type as string | undefined;
			if (bt === "text") {
				parts.push({ type: "text", text: String(block.text ?? "") });
			} else if (bt === "thinking") {
				parts.push({
					type: "reasoning",
					text: String(block.thinking ?? block.text ?? ""),
				});
			} else if (bt === "tool_use") {
				parts.push({
					type: "tool",
					tool: String(block.name ?? ""),
					title: String(block.name ?? ""),
					state: {
						status: "running",
						input: (block.input as Record<string, unknown>) ?? {},
					},
				});
			} else if (bt === "tool_result") {
				parts.push({
					type: "tool",
					tool: String(block.tool_use_id ?? ""),
					title: "tool_result",
					state: {
						status: "completed",
						output:
							typeof block.content === "string"
								? block.content
								: JSON.stringify(block.content),
					},
				});
			}
		}
	}

	if (evt.isMeta === true || evt.isSidechain === true) return null;
	if (parts.length === 0) return null;

	const usage = (message.usage ?? undefined) as
		| {
				input_tokens?: number;
				output_tokens?: number;
				cache_read_input_tokens?: number;
		  }
		| undefined;
	return {
		id: uuid,
		role: role === "assistant" ? "assistant" : "user",
		parts,
		tokensInput: usage?.input_tokens ?? null,
		tokensOutput: usage?.output_tokens ?? null,
		tokensReasoning: usage?.cache_read_input_tokens ?? null,
		observedAt: ts,
		source: "claude-code",
		slotName: role === "assistant" ? "Claude" : "You",
		sessionId: session.id,
		isSubagent: false,
		provider: "claude-code",
		model: (message.model as string) ?? session.model ?? null,
		agent: null,
	};
}
