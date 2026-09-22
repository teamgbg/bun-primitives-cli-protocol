/**
 * @system cli-session
 * @status handwritten
 * @edit edit directly
 *
 * Reads from a stream and dispatches parsed events via a callback.
 */

import type { ParsedEvent } from "@teamscala/session-contracts/types";

export type LineParser = (line: string) => ParsedEvent | null;

export async function runStreamReader(
	stdout: ReadableStreamDefaultReader<Uint8Array>,
	stderr: ReadableStreamDefaultReader<Uint8Array>,
	parser: LineParser,
	dispatch: (evt: ParsedEvent) => void,
	binaryLabel: string,
	closedRef: { value: boolean },
): Promise<void> {
	const decoder = new TextDecoder();
	let buffer = "";

	const readStdout = async () => {
		try {
			while (true) {
				const { done, value } = await stdout.read();
				if (done || closedRef.value) break;
				const text = decoder.decode(value, { stream: true });
				const lines = (buffer + text).split("\n");
				buffer = lines.pop() ?? "";
				for (const line of lines) {
					if (!line.trim()) continue;
					const evt = parser(line);
					if (evt) dispatch(evt);
				}
			}
		} catch {}
	};

	const readStderr = async () => {
		const errDecoder = new TextDecoder();
		try {
			while (true) {
				const { done, value } = await stderr.read();
				if (done || closedRef.value) break;
				const text = errDecoder.decode(value, { stream: true });
				process.stderr.write(`[${binaryLabel}] ${text}`);
			}
		} catch {}
	};

	await Promise.all([readStdout(), readStderr()]);
}

export function dispatchExitEvent(
	dispatch: (evt: ParsedEvent) => void,
	exitCode: number,
): void {
	dispatch({
		type: "result",
		is_error: exitCode !== 0,
		result: `Process exited with code ${exitCode}`,
	} as ParsedEvent);
}
