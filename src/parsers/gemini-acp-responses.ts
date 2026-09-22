/**
 * @system cli-session
 * @status handwritten
 * @edit edit directly
 *
 * ACP JSON-RPC response handlers. Each request the transport sends produces
 * one response frame keyed by the request id; these mappers project that
 * frame into a ParsedEvent.
 *
 * Separate from gemini-acp.ts (which handles notifications — the continuous
 * `session/update` stream) because response shapes are different: they
 * carry stopReason + _meta.quota for prompts, or sessionId + models for
 * session/new.
 */

import type {
	ParsedInitEvent,
	ParsedResultEvent,
} from "@teamscala/session-contracts/types";
import { extractUsage } from "./_gemini-acp/usage-extractor";

export function mapPromptResponse(response: {
	result?: {
		stopReason?: string;
		_meta?: {
			quota?: { token_count?: { input_tokens: number; output_tokens: number } };
		};
	};
}): ParsedResultEvent | null {
	const result = response.result;
	if (!result) return null;

	const stopReason = result.stopReason ?? "end_turn";
	const is_error = stopReason === "max_tokens" || stopReason === "refusal";
	const quota = result._meta?.quota;
	const usage = extractUsage(quota);

	return {
		type: "result",
		is_error,
		result: stopReason,
		usage,
	};
}

export function mapNewSessionResponse(response: {
	result?: {
		sessionId?: string;
		models?: { availableModels?: Array<{ modelId?: string }> };
	};
}): ParsedInitEvent | null {
	const sid = response.result?.sessionId;
	if (!sid) return null;

	const models = response.result?.models as
		| { availableModels?: Array<{ modelId?: string }> }
		| undefined;
	const availableModels = models?.availableModels
		?.map((m) => m.modelId)
		.filter((id): id is string => typeof id === "string" && id.length > 0);

	return {
		type: "init",
		session_id: sid,
		available_models: availableModels?.length ? availableModels : undefined,
	};
}
