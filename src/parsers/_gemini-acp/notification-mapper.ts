/**
 * @system cli-session
 * @status handwritten
 * @edit edit directly
 *
 * Maps ACP notification sessionUpdate types to ParsedEvent. One exported
 * function per ACP session-update subtype (agent_thought_chunk,
 * agent_message_chunk, tool_call, tool_call_update) plus the ignored-set
 * predicate and the content-text extractor. Same shape as Claude
 * normalize-map.ts — annotated for the same reason: the dispatching
 * mapNotification() in gemini-acp.ts imports the whole surface together
 * and routes by subtype.
 */

import type {
	AssistantBlock,
	ParsedAssistantEvent,
	ParsedEvent,
	ParsedRawEvent,
} from "@teamscala/session-contracts/types";

export interface UpdateContent {
	sessionUpdate: string;
	toolCallId?: string;
	title?: string;
	kind?: string;
	status?: string;
	content?: Array<{
		type: string;
		content?: { type: string; text?: string };
		text?: string;
		path?: string;
		oldText?: string;
		newText?: string;
	}>;
	entries?: Array<{ content: string; priority?: string; status?: string }>;
	availableCommands?: Array<{ name: string; description: string }>;
	[key: string]: unknown;
}

const IGNORED_UPDATE_TYPES = new Set([
	"available_commands_update",
	"plan",
	"session_info_update",
]);

export function extractContentText(content: UpdateContent["content"]): string {
	if (!content) return "";
	if (Array.isArray(content)) {
		return content[0]?.content?.text ?? content[0]?.text ?? "";
	}
	return ((content as Record<string, unknown>).text as string) ?? "";
}

export function isIgnoredUpdate(updateType: string): boolean {
	return IGNORED_UPDATE_TYPES.has(updateType);
}

export function mapThoughtChunk(
	sessionId: string,
	update: UpdateContent,
): ParsedAssistantEvent {
	const text = extractContentText(update.content);
	const blocks: AssistantBlock[] = [{ type: "thinking", text }];
	return { type: "assistant", id: sessionId, content: blocks };
}

export function mapMessageChunk(
	sessionId: string,
	update: UpdateContent,
): ParsedAssistantEvent {
	const text = extractContentText(update.content);
	const blocks: AssistantBlock[] = [{ type: "text", text }];
	return { type: "assistant", id: sessionId, content: blocks };
}

export function mapToolCall(
	sessionId: string,
	update: UpdateContent,
): ParsedAssistantEvent {
	const toolCallId = update.toolCallId ?? "";
	const title = update.title ?? "unknown";
	const blocks: AssistantBlock[] = [
		{
			type: "tool_use",
			id: toolCallId,
			name: title,
			input: { status: update.status ?? "pending", kind: update.kind },
		},
	];
	return { type: "assistant", id: sessionId, content: blocks };
}

export function mapToolCallUpdate(
	sessionId: string,
	update: UpdateContent,
): ParsedEvent | null {
	const toolCallId = update.toolCallId;
	if (!toolCallId) return null;

	const status = update.status ?? "unknown";
	if (status === "completed" || status === "failed") {
		const textParts: string[] = [];
		for (const c of update.content ?? []) {
			if (c.type === "content" && c.content?.text) {
				textParts.push(c.content.text);
			}
		}
		const blocks: AssistantBlock[] = [
			{
				type: "tool_use",
				id: toolCallId,
				name: update.title ?? "tool",
				input: { status, content: textParts.join("\n") },
			},
		];
		return { type: "assistant", id: sessionId, content: blocks };
	}

	return {
		type: "raw",
		provider_type: "gemini-acp",
		raw: update,
	} as ParsedRawEvent;
}
