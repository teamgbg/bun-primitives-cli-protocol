/**
 * @system cli-session
 * @status handwritten
 * @edit edit directly
 *
 * Handles incoming lines from stdio-acp stdout.
 */

import type { ParsedEvent } from "@teamscala/session-contracts/types";
import { isResponse } from "#cli-session/parsers/_gemini-acp/type-guards.ts";
import type { RpcTracker } from "./rpc-tracker";

export function handleLine(
	line: string,
	rpc: RpcTracker,
	dispatch: (evt: ParsedEvent) => void,
	parseAcpFrame: (frame: string) => ParsedEvent | null,
): void {
	if (!line.trim()) return;
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		return;
	}

	if (typeof parsed !== "object" || parsed === null) return;
	const obj = parsed as Record<string, unknown>;

	if (typeof obj.id === "number" && isResponse(obj)) {
		rpc.resolveResponse(
			obj as { id: number; result?: unknown; error?: { message?: string } },
		);
		return;
	}

	if (obj.method === "session/update") {
		const event = parseAcpFrame(line);
		if (event) dispatch(event);
	}
}
