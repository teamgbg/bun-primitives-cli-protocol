/**
 * @system cli-session
 * @status handwritten
 * @edit edit directly
 *
 * Reads and parses a oneshot stdout stream.
 */

import type { ParsedEvent } from "@teamscala/session-contracts/types";

export type LineParser = (line: string) => ParsedEvent | null;

export interface ParseResult {
	events: ParsedEvent[];
	sessionId: string | null;
}

export async function readOneshotOutput(
	stdout: ReadableStreamDefaultReader<Uint8Array>,
	parser: LineParser,
): Promise<ParseResult> {
	const decoder = new TextDecoder();
	let buffer = "";
	const events: ParsedEvent[] = [];
	let sessionId: string | null = null;

	while (true) {
		const { done, value } = await stdout.read();
		if (done) break;
		const text = decoder.decode(value, { stream: true });
		buffer += text;
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";
		for (const line of lines) {
			if (!line.trim()) continue;
			const evt = parser(line);
			if (evt) {
				if (
					evt.type === "init" &&
					(evt as { session_id?: string }).session_id
				) {
					sessionId = (evt as { session_id: string }).session_id;
				}
				events.push(evt);
			}
		}
	}

	const remaining = buffer.trim();
	if (remaining) {
		const evt = parser(remaining);
		if (evt) {
			if (evt.type === "init" && (evt as { session_id?: string }).session_id) {
				sessionId = (evt as { session_id: string }).session_id;
			}
			events.push(evt);
		}
	}

	return { events, sessionId };
}

export async function drainStderr(
	stderr: ReadableStreamDefaultReader<Uint8Array>,
	binaryLabel: string,
): Promise<void> {
	const decoder = new TextDecoder();
	try {
		while (true) {
			const { done, value } = await stderr.read();
			if (done) break;
			const text = decoder.decode(value, { stream: true });
			process.stderr.write(`[${binaryLabel}] ${text}`);
		}
	} catch {}
}
