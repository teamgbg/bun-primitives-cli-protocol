/**
 * @system cli-session
 * @status handwritten
 * @edit edit directly
 *
 * Parser for OpenCode SDK events. Maps OpenCode session/message wire events
 * to the canonical ParsedEvent shape, so the unified capture pipeline stores
 * ONE normalized vocabulary regardless of CLI. The event shapes mapped here
 * are those the live ingest (fleet-procedures event-dispatcher) already
 * consumes — authoritative, not inferred: session.created, message.updated
 * (info.role assistant|user), session.busy/idle/status, session.compacted,
 * session.error, session.closed.
 */

import type {
	ParsedEvent,
	ParsedAssistantEvent,
	ParsedUserEvent,
	ParsedStatusEvent,
	ParsedResultEvent,
	ParsedInitEvent,
	TokenUsage,
} from "@teamscala/session-contracts/types";

interface OpenCodeTokens {
	input: number;
	output: number;
	reasoning?: number;
	cacheRead?: number;
	cacheCreation?: number;
}

interface OpenCodePart {
	type: string;
	text?: string;
}

interface OpenCodeInfo {
	id?: string;
	role?: string;
	model?: string;
	tokens?: OpenCodeTokens;
	parts?: OpenCodePart[];
}

interface OpenCodeEvent {
	type: string;
	info?: OpenCodeInfo;
	status?: string;
	error?: unknown;
	message?: unknown;
	[key: string]: unknown;
}

export function parseLine(line: string): ParsedEvent | null {
	const trimmed = line.trim();
	if (!trimmed) return null;

	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return null;
	}

	if (typeof parsed !== "object" || parsed === null) return null;
	const evt = parsed as OpenCodeEvent;
	if (typeof evt.type !== "string") return null;

	return mapOpenCodeEvent(evt);
}

function mapOpenCodeEvent(evt: OpenCodeEvent): ParsedEvent {
	switch (evt.type) {
		case "session.created":
			return mapInit(evt);
		case "message.updated":
			return mapMessage(evt);
		case "session.busy":
			return { type: "status", session_status: "running" };
		case "session.idle":
			return { type: "status", session_status: "idle" };
		case "session.status":
			return mapStatus(evt);
		case "session.compacted":
			return { type: "compact_boundary" };
		case "session.error":
			return mapError(evt);
		case "session.closed":
			return { type: "status", session_status: "idle" };
		// message.part.updated is a streaming chunk (per-token); preserved as raw
		// until an accumulator composes it into a full assistant message. Mapping
		// each chunk to a separate ParsedAssistantEvent would forge N events per
		// turn (the 97.9%-null-transition disease recorded in event-dispatcher).
		default:
			return { type: "raw", provider_type: "opencode", raw: evt };
	}
}

function mapInit(evt: OpenCodeEvent): ParsedEvent {
	const init: ParsedInitEvent = {
		type: "init",
		session_id:
			(typeof evt.sessionId === "string" && evt.sessionId) ||
			(typeof evt.id === "string" && evt.id) ||
			"",
	};
	if (typeof evt.model === "string") init.model = evt.model;
	return init;
}

function mapMessage(evt: OpenCodeEvent): ParsedEvent {
	const info = evt.info;
	if (!info) return { type: "raw", provider_type: "opencode", raw: evt };
	const role = info.role || "unknown";
	if (role === "assistant") return mapAssistant(info);
	if (role === "user") return mapUser(info);
	return { type: "raw", provider_type: "opencode", raw: evt };
}

function mapAssistant(info: OpenCodeInfo): ParsedAssistantEvent {
	const content = (info.parts ?? [])
		.filter((p) => typeof p.text === "string")
		.map((p) => ({ type: "text" as const, text: p.text as string }));
	const evt: ParsedAssistantEvent = {
		type: "assistant",
		id: info.id ?? "",
		content,
	};
	if (info.model) evt.model = info.model;
	const usage = mapUsage(info.tokens);
	if (usage) evt.usage = usage;
	return evt;
}

function mapUser(info: OpenCodeInfo): ParsedUserEvent {
	const content = (info.parts ?? [])
		.filter((p) => typeof p.text === "string")
		.map((p) => ({ type: "text" as const, text: p.text as string }));
	return { type: "user", content };
}

function mapStatus(evt: OpenCodeEvent): ParsedStatusEvent {
	const status = typeof evt.status === "string" ? evt.status : "";
	// OpenCode session.status carries payload.status ∈ busy|idle|error|...
	if (status === "busy") return { type: "status", session_status: "running" };
	if (status === "error") return { type: "status", session_status: "error" };
	if (status === "compacting")
		return { type: "status", session_status: "compacting" };
	return { type: "status", session_status: "idle" };
}

function mapError(evt: OpenCodeEvent): ParsedResultEvent {
	const rawErr = evt.error ?? evt.message;
	const message =
		typeof rawErr === "string"
			? rawErr
			: rawErr != null
				? JSON.stringify(rawErr)
				: undefined;
	return {
		type: "result",
		is_error: true,
		...(message ? { result: message } : {}),
	};
}

function mapUsage(tokens: OpenCodeTokens | undefined): TokenUsage | undefined {
	if (!tokens) return undefined;
	return {
		input_tokens: tokens.input ?? 0,
		output_tokens: tokens.output ?? 0,
		...(tokens.cacheRead != null
			? { cache_read_input_tokens: tokens.cacheRead }
			: {}),
		...(tokens.cacheCreation != null
			? { cache_creation_input_tokens: tokens.cacheCreation }
			: {}),
	};
}
