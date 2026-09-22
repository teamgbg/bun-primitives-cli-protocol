/**
 * @system cli-session
 * @status handwritten
 * @edit edit directly
 *
 * Maps a parsed JSON object to ParsedEvent for Claude Code stream-json.
 *
 * Marked: this file IS the Claude-Code stream-json mapping
 * surface — isKnownType (gate), the eight map* functions (one per top-level
 * event subtype), and toRawEvent (fallback for unknown types) are inseparable
 * by design. Splitting forces the orchestrating dispatcher to import from N
 * paths and obscures the 1:1 correspondence between subtype and mapper.
 */

import type {
	AssistantBlock,
	ParsedAssistantEvent,
	ParsedCompactBoundaryEvent,
	ParsedEvent,
	ParsedInitEvent,
	ParsedRateLimitEvent,
	ParsedRawEvent,
	ParsedResultEvent,
	ParsedStatusEvent,
	ParsedUserEvent,
	UserBlock,
} from "@teamscala/session-contracts/types";
import { extractUsage } from "./usage-extractor";

const KNOWN_TOP_LEVEL_TYPES = new Set([
	"system",
	"assistant",
	"user",
	"result",
	"rate_limit_event",
]);

export function isKnownType(obj: Record<string, unknown>): boolean {
	return KNOWN_TOP_LEVEL_TYPES.has(obj.type as string);
}

export function mapSystemSubtype(
	obj: Record<string, unknown>,
): ParsedEvent | null {
	if (obj.subtype === "init") return mapInit(obj);
	if (obj.subtype === "status") return mapStatus(obj);
	if (obj.subtype === "compact_boundary") return mapCompactBoundary(obj);
	return null;
}

export function mapInit(obj: Record<string, unknown>): ParsedInitEvent {
	return {
		type: "init",
		session_id: String(obj.session_id ?? ""),
		model: obj.model != null ? String(obj.model) : undefined,
		permission_mode:
			obj.permissionMode != null ? String(obj.permissionMode) : undefined,
	};
}

export function mapStatus(obj: Record<string, unknown>): ParsedStatusEvent {
	const raw = obj.status;
	const status = raw === "compacting" ? "compacting" : "idle";
	return { type: "status", session_status: status };
}

export function mapCompactBoundary(
	_obj: Record<string, unknown>,
): ParsedCompactBoundaryEvent {
	return { type: "compact_boundary" };
}

export function mapAssistant(
	obj: Record<string, unknown>,
): ParsedAssistantEvent {
	const msg = obj.message as Record<string, unknown> | undefined;
	const content =
		(msg?.content as Array<Record<string, unknown>> | undefined) ?? [];
	const blocks: AssistantBlock[] = content.map((block) => {
		if (block.type === "text")
			return { type: "text", text: String(block.text ?? "") };
		if (block.type === "thinking")
			return { type: "thinking", text: String(block.thinking ?? "") };
		if (block.type === "tool_use") {
			return {
				type: "tool_use",
				id: String(block.id ?? ""),
				name: String(block.name ?? ""),
				input: (block.input as Record<string, unknown>) ?? {},
			};
		}
		return { type: "text", text: JSON.stringify(block) };
	});

	const usage = extractUsage(msg?.usage);

	return {
		type: "assistant",
		id: String(obj.uuid ?? ""),
		content: blocks,
		model: msg?.model != null ? String(msg.model) : undefined,
		usage,
	};
}

export function mapUser(obj: Record<string, unknown>): ParsedUserEvent {
	const msg = obj.message as Record<string, unknown> | undefined;
	const content =
		(msg?.content as Array<Record<string, unknown>> | undefined) ?? [];
	const blocks: UserBlock[] = content.map((block) => {
		if (block.type === "text")
			return { type: "text", text: String(block.text ?? "") };
		if (block.type === "tool_result") {
			return {
				type: "tool_result",
				tool_use_id: String(block.tool_use_id ?? ""),
				content: String(block.content ?? ""),
			};
		}
		return { type: "text", text: JSON.stringify(block) };
	});

	return { type: "user", content: blocks };
}

export function mapResult(obj: Record<string, unknown>): ParsedResultEvent {
	const usage = extractUsage(obj.usage);
	const modelUsage = obj.modelUsage as
		| Record<string, { contextWindow?: number }>
		| undefined;
	const modelName = obj.model as string | undefined;
	const contextWindow: number | undefined = modelName
		? modelUsage?.[modelName]?.contextWindow
		: undefined;

	return {
		type: "result",
		is_error: obj.is_error === true,
		result: obj.result != null ? String(obj.result) : undefined,
		usage,
		context_window: contextWindow,
		total_cost_usd:
			obj.total_cost_usd != null ? Number(obj.total_cost_usd) : undefined,
	};
}

export function mapRateLimit(
	obj: Record<string, unknown>,
): ParsedRateLimitEvent {
	const info = obj.rate_limit_info as Record<string, unknown> | undefined;
	return {
		type: "rate_limit",
		status: String(info?.status ?? "unknown"),
		resets_at: info?.resetsAt != null ? Number(info.resetsAt) : undefined,
		utilization:
			info?.utilization != null ? Number(info.utilization) : undefined,
		raw: obj,
	};
}

export function toRawEvent(obj: Record<string, unknown>): ParsedRawEvent {
	return { type: "raw", provider_type: "claude-code", raw: obj };
}
