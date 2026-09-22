/**
 * @system cli-session
 * @status handwritten
 * @edit edit directly
 *
 * One-shot JSONL transport for Codex CLI (codex exec). Each send() spawns
 * a new process, waits for exit, and streams events during execution.
 * Session ID is captured from the first thread.started event and reused
 * via codex exec resume for subsequent sends.
 */

import { createEventBus } from "@teamscala/event-bus/create-event-bus";
import { PARSERS } from "@teamscala/session-contracts/parsers-registry";
import type {
	ParsedEvent,
	StdioOneshotJsonlConfig,
	TransportHandle,
} from "@teamscala/session-contracts/types";
import { TransportNotSupportedError } from "@teamscala/session-contracts/types";
import { spawnOneshotProcess } from "./_stdio-oneshot-jsonl/process-spawn";
import {
	drainStderr,
	readOneshotOutput,
} from "./_stdio-oneshot-jsonl/stream-reader";

export interface StdioOneshotJsonlTransportOptions {
	spec: StdioOneshotJsonlConfig;
	workdir: string;
	extraEnv?: Record<string, string>;
	onEvent?: (evt: ParsedEvent) => void;
}

export function createStdioOneshotJsonlTransport(
	opts: StdioOneshotJsonlTransportOptions,
): TransportHandle {
	const { spec, workdir } = opts;
	const parseLine = PARSERS[spec.output_parser_id]!;
	if (!parseLine) {
		throw new Error(
			`No parser registered for "${spec.output_parser_id}". Available: ${Object.keys(PARSERS).join(", ")}`,
		);
	}

	let sessionId: string | null = null;
	let closed = false;
	let currentPid: number | undefined;
	let turnCounter = 0;
	const bus = createEventBus<ParsedEvent>(`stdio-oneshot-jsonl:${spec.binary}`);

	if (opts.onEvent) bus.on("*", opts.onEvent);

	function dispatch(evt: ParsedEvent): void {
		let tagged: ParsedEvent = evt;
		if ((evt.type === "assistant" || evt.type === "user") && turnCounter > 0) {
			const existing = (evt as { id?: string }).id ?? "";
			tagged = { ...evt, id: `${existing}-t${turnCounter}` } as ParsedEvent;
		}
		bus.emit(tagged);
	}

	async function send(prompt: string): Promise<void> {
		if (closed) return;
		turnCounter++;

		const args: string[] = [];
		if (sessionId) {
			args.push(...spec.resume_args, sessionId, spec.json_flag);
		} else {
			args.push(...spec.exec_args, spec.json_flag);
		}
		args.push(prompt);

		const proc = spawnOneshotProcess(spec, workdir, args, opts.extraEnv ?? {});
		currentPid = proc.pid;

		try {
			await proc.stdin.write(new TextEncoder().encode("\n"));
		} catch {}

		const [outputResult] = await Promise.all([
			readOneshotOutput(proc.stdout.getReader(), parseLine),
			drainStderr(proc.stderr.getReader(), `scala-orch-${spec.binary}`),
		]);

		currentPid = undefined;

		for (const evt of outputResult.events) {
			if (evt.type === "init" && (evt as { session_id?: string }).session_id) {
				sessionId = (evt as { session_id: string }).session_id;
			}
			dispatch(evt);
		}

		if (!closed) {
			const exitCode = await proc.exited;
			if (exitCode !== 0) {
				dispatch({
					type: "result",
					is_error: true,
					result: `Process exited with code ${exitCode}`,
				});
			}
		}
	}

	return {
		send,
		async interrupt(): Promise<void> {
			if (currentPid) {
				try {
					process.kill(currentPid, "SIGINT");
				} catch {}
			}
		},
		async compact(): Promise<void> {
			throw new TransportNotSupportedError("compact", "stdio-oneshot-jsonl");
		},
		onEvent(cb: (evt: ParsedEvent) => void): () => void {
			return bus.on("*", cb);
		},
		close(): void {
			closed = true;
			if (currentPid) {
				try {
					process.kill(currentPid, "SIGTERM");
				} catch {}
			}
			bus.clear();
		},
		get pid() {
			return currentPid;
		},
		get sessionId() {
			return sessionId;
		},
	};
}
