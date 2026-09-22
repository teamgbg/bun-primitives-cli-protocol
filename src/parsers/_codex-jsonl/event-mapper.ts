/**
 * @system cli-session
 * @status handwritten
 * @edit edit directly
 *
 * Maps codex-jsonl parsed objects to ParsedEvent. One exported function per
 * codex-jsonl event subtype (thread_started, turn_started, turn_completed,
 * turn_failed, item_started, item_completed). Same shape as the Claude
 * stream-json mapping surface — annotated for the same reason: splitting
 * forces the orchestrating dispatcher to import from N paths and obscures
 * the 1:1 subtype↔mapper correspondence.
 */

import type {
	AssistantBlock,
	ParsedAssistantEvent,
	ParsedEvent,
	ParsedInitEvent,
	ParsedRawEvent,
	ParsedResultEvent,
	ParsedStatusEvent,
	TokenUsage,
} from "@teamscala/session-contracts/types";

export function mapThreadStarted(
	obj: Record<string, unknown>,
): ParsedInitEvent {
	return {
		type: "init",
		session_id: String(obj.thread_id ?? ""),
	};
}

export function mapTurnStarted(): ParsedStatusEvent {
	return { type: "status", session_status: "running" };
}

export function mapTurnCompleted(
	obj: Record<string, unknown>,
): ParsedResultEvent {
	const rawUsage = obj.usage as Record<string, unknown> | undefined;
	const usage: TokenUsage | undefined = rawUsage
		? {
				input_tokens: Number(rawUsage.input_tokens ?? 0),
				output_tokens: Number(rawUsage.output_tokens ?? 0),
				cached_input_tokens:
					rawUsage.cached_input_tokens != null
						? Number(rawUsage.cached_input_tokens)
						: undefined,
			}
		: undefined;

	return {
		type: "result",
		is_error: false,
		usage,
	};
}

export function mapItemStarted(
	obj: Record<string, unknown>,
): ParsedEvent | null {
	const item = obj.item as Record<string, unknown> | undefined;
	if (!item) return null;

	if (item.type === "command_execution") {
		return {
			type: "status",
			session_status: "running",
		} as ParsedStatusEvent;
	}

	return null;
}

export function mapItemCompleted(
	obj: Record<string, unknown>,
): ParsedAssistantEvent | ParsedEvent | null {
	const item = obj.item as Record<string, unknown> | undefined;
	if (!item) return null;

	if (item.type === "agent_message") {
		const blocks: AssistantBlock[] = [
			{ type: "text", text: String(item.text ?? "") },
		];
		return {
			type: "assistant",
			id: String(item.id ?? ""),
			content: blocks,
		};
	}

	if (item.type === "command_execution") {
		return {
			type: "raw",
			provider_type: "codex",
			raw: {
				item_type: "command_execution",
				id: item.id,
				command: item.command,
				exit_code: item.exit_code,
				output: item.aggregated_output,
			},
		} as ParsedRawEvent;
	}

	return {
		type: "raw",
		provider_type: "codex",
		raw: obj,
	} as ParsedRawEvent;
}

export function mapTurnFailed(obj: Record<string, unknown>): ParsedResultEvent {
	const errText = String(obj.error ?? "turn failed");
	const lower = errText.toLowerCase();
	const isRateLimit =
		/quota|rate[ _-]?limit|resource[ _-]?exhausted|too many request/.test(
			lower,
		);
	return {
		type: "result",
		is_error: true,
		result: isRateLimit ? `[rate_limit] ${errText}` : errText,
	};
}
