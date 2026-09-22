/**
 * @system cli-session
 * @status handwritten
 * @edit edit directly
 *
 * Extracts usage from raw token objects in Claude Code events.
 */

import type { TokenUsage } from "@teamscala/session-contracts/types";

export function extractUsage(raw: unknown): TokenUsage | undefined {
	if (typeof raw !== "object" || raw === null) return undefined;
	const u = raw as Record<string, unknown>;
	return {
		input_tokens: Number(u.input_tokens ?? 0),
		output_tokens: Number(u.output_tokens ?? 0),
		cache_creation_input_tokens:
			u.cache_creation_input_tokens != null
				? Number(u.cache_creation_input_tokens)
				: undefined,
		cache_read_input_tokens:
			u.cache_read_input_tokens != null
				? Number(u.cache_read_input_tokens)
				: undefined,
	};
}
