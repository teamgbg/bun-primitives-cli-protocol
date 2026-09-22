/**
 * @system cli-session
 * @status handwritten
 * @edit edit directly
 *
 * Extracts token usage from ACP quota objects.
 */

import type { TokenUsage } from "@teamscala/session-contracts/types";

export function extractUsage(
	quota:
		| { token_count?: { input_tokens: number; output_tokens: number } }
		| undefined,
): TokenUsage | undefined {
	if (!quota?.token_count) return undefined;
	return {
		input_tokens: quota.token_count.input_tokens ?? 0,
		output_tokens: quota.token_count.output_tokens ?? 0,
	};
}
