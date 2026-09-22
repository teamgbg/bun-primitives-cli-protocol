/**
 * @system cli-session
 * @status handwritten
 * @edit edit directly
 *
 * Parser for Claude Code stream-json output. Maps Claude SDK wire events
 * to the package's canonical ParsedEvent shape. Ported from
 * scala-agents/src/adapters/claude-code/{parse-events,to-feed-message}.ts.
 */

import type { ParsedEvent } from "@teamscala/session-contracts/types";
import {
	isKnownType,
	mapAssistant,
	mapRateLimit,
	mapResult,
	mapSystemSubtype,
	mapUser,
	toRawEvent,
} from "./_claude-stream-json/normalize-map";

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
	if (!isKnownType(obj)) return null;

	if (obj.type === "system") {
		const sub = mapSystemSubtype(obj);
		if (sub) return sub;
	}
	if (obj.type === "assistant") return mapAssistant(obj);
	if (obj.type === "user") return mapUser(obj);
	if (obj.type === "result") return mapResult(obj);
	if (obj.type === "rate_limit_event") return mapRateLimit(obj);

	return toRawEvent(obj);
}
