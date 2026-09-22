/**
 * @system cli-session
 * @status handwritten
 * @edit edit directly
 *
 * Merges streamed content blocks per turn. Symmetric pair:
 * mergeAssistantBlocks (concatenates adjacent same-kind text/thinking,
 * preserves tool_use by id) and mergeUserBlocks (append-only). They
 * operate on disjoint block unions so share no type anchor, but they
 * are operationally one canonical unit — the streaming-block merger
 * for an ACP turn.
 */

import type {
	AssistantBlock,
	UserBlock,
} from "@teamscala/session-contracts/types";

type AssistantBlocksUnion = AssistantBlock[];
type UserBlocksUnion = UserBlock[];

export function mergeAssistantBlocks(
	existing: AssistantBlocksUnion,
	incoming: AssistantBlocksUnion,
): AssistantBlocksUnion {
	const merged = [...existing, ...incoming];
	const out: AssistantBlocksUnion = [];
	for (const b of merged) {
		const last = out[out.length - 1];
		if (
			last &&
			last.type === b.type &&
			(b.type === "text" || b.type === "thinking")
		) {
			(last as { text: string }).text += (b as { text: string }).text;
		} else {
			out.push(b);
		}
	}
	return out;
}

export function mergeUserBlocks(
	existing: UserBlocksUnion,
	incoming: UserBlocksUnion,
): UserBlocksUnion {
	return [...existing, ...incoming] as UserBlocksUnion;
}
