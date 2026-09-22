/**
 * @system cli-session
 * @status handwritten
 * @edit edit directly
 *
 * Parser for Codex CLI exec --json output. Maps Codex JSONL events
 * to the package's canonical ParsedEvent shape. Based on the spec at
 * ~/.cache/orchestrator-codex-spec.md.
 */

import type {
	ParsedEvent,
	ParsedRawEvent,
} from "@teamscala/session-contracts/types";
import {
	mapItemCompleted,
	mapItemStarted,
	mapThreadStarted,
	mapTurnCompleted,
	mapTurnFailed,
	mapTurnStarted,
} from "./_codex-jsonl/event-mapper";

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
	const obj = parsed as Record<string, unknown>;
	if (typeof obj.type !== "string") return null;

	if (obj.type === "thread.started") return mapThreadStarted(obj);
	if (obj.type === "turn.started") return mapTurnStarted();
	if (obj.type === "turn.completed") return mapTurnCompleted(obj);
	if (obj.type === "item.started") return mapItemStarted(obj);
	if (obj.type === "item.completed") return mapItemCompleted(obj);
	if (obj.type === "turn.failed") return mapTurnFailed(obj);

	return { type: "raw", provider_type: "codex", raw: parsed } as ParsedRawEvent;
}
