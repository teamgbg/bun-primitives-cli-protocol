/**
 * @system cli-session
 * @status handwritten
 * @edit edit directly
 *
 * ACP JSON-RPC notification parser. Maps a single parsed JSON-RPC frame
 * (the continuous `session/update` notification stream from gemini --acp)
 * to a ParsedEvent | null. Request/response handling lives in
 * gemini-acp-responses.ts.
 *
 * session/update notification types observed in live capture:
 *   - agent_thought_chunk  → thinking block
 *   - agent_message_chunk  → text block
 *   - tool_call             → tool_use block
 *   - tool_call_update      → tool result update
 *   - available_commands_update → ignored
 *   - plan                  → ignored (no TodoWrite equivalent)
 */

import type { ParsedEvent } from "@teamscala/session-contracts/types";
import {
	isIgnoredUpdate,
	mapMessageChunk,
	mapThoughtChunk,
	mapToolCall,
	mapToolCallUpdate,
	type UpdateContent,
} from "./_gemini-acp/notification-mapper";
import { isNotification } from "./_gemini-acp/type-guards";

export function parseAcpFrame(frame: string): ParsedEvent | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(frame);
	} catch {
		return null;
	}

	if (typeof parsed !== "object" || parsed === null) return null;

	if (isNotification(parsed)) {
		return mapNotification(parsed);
	}

	return null;
}

function mapNotification(notif: {
	params: { sessionId: string; update: Record<string, unknown> };
}): ParsedEvent | null {
	const { sessionId, update } = notif.params;
	const updateType = update.sessionUpdate as string;

	if (isIgnoredUpdate(updateType)) return null;
	if (updateType === "agent_thought_chunk")
		return mapThoughtChunk(sessionId, update as unknown as UpdateContent);
	if (updateType === "agent_message_chunk")
		return mapMessageChunk(sessionId, update as unknown as UpdateContent);
	if (updateType === "tool_call")
		return mapToolCall(sessionId, update as unknown as UpdateContent);
	if (updateType === "tool_call_update")
		return mapToolCallUpdate(sessionId, update as unknown as UpdateContent);
	if (updateType === "user_message_chunk") return null;

	return { type: "raw", provider_type: "gemini-acp", raw: notif };
}
