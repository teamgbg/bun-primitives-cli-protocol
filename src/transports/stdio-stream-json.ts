/**
 * @system cli-session
 * @status handwritten
 * @edit edit directly
 *
 * Long-lived stdio transport for CLIs that speak stream-json over stdin/stdout.
 * Used by Claude Code and any similar persistent-process CLI.
 * Ported from scala-agents/src/adapters/claude-code/{spawn,transport}.ts.
 */

import { createEventBus } from "@teamscala/event-bus/create-event-bus";
import { PARSERS } from "@teamscala/session-contracts/parsers-registry";
import type {
	ParsedEvent,
	StdioStreamJsonConfig,
	TransportHandle,
} from "@teamscala/session-contracts/types";
import { TransportNotSupportedError } from "@teamscala/session-contracts/types";
import { INPUT_ENCODERS } from "../input-encoders/index";
import { spawnStdioProcess } from "./_stdio-stream-json/process-spawn";
import {
	dispatchExitEvent,
	runStreamReader,
} from "./_stdio-stream-json/stream-reader";

export interface StdioStreamJsonTransportOptions {
	spec: StdioStreamJsonConfig;
	workdir: string;
	resumeId?: string;
	sessionId?: string;
	model?: string;
	extraEnv?: Record<string, string>;
	onEvent?: (evt: ParsedEvent) => void;
}

export function createStdioStreamJsonTransport(
	opts: StdioStreamJsonTransportOptions,
): TransportHandle {
	const { spec, workdir, resumeId, sessionId, model } = opts;

	const parseLine = PARSERS[spec.output_parser_id];
	if (!parseLine) {
		throw new Error(
			`No parser registered for "${spec.output_parser_id}". Available: ${Object.keys(PARSERS).join(", ")}`,
		);
	}

	const encodeInput = INPUT_ENCODERS[spec.input_encoder_id];
	if (!encodeInput) {
		throw new Error(
			`No input encoder registered for "${spec.input_encoder_id}". Available: ${Object.keys(INPUT_ENCODERS).join(", ")}`,
		);
	}

	const args = [...spec.args];
	if (model && spec.model_flag) args.push(spec.model_flag, model);
	if (resumeId) args.push(spec.resume_flag, resumeId);
	else if (sessionId && spec.session_id_flag)
		args.push(spec.session_id_flag, sessionId);

	const capturedSessionId: string | null = sessionId ?? resumeId ?? null;
	let closed = false;
	const closedRef = { value: false };
	const bus = createEventBus<ParsedEvent>(`stdio-stream-json:${spec.binary}`);

	if (opts.onEvent) bus.on("*", opts.onEvent);

	const proc = spawnStdioProcess(spec, workdir, opts.extraEnv ?? {});

	runStreamReader(
		proc.stdout.getReader(),
		proc.stderr.getReader(),
		parseLine,
		(evt) => bus.emit(evt),
		proc.label,
		closedRef,
	).catch(() => {});

	proc.exited.then((code) => {
		if (!closed) {
			closedRef.value = true;
			dispatchExitEvent((evt) => bus.emit(evt), code);
		}
	});

	return {
		async send(prompt: string): Promise<void> {
			if (closed) return;
			const encoded = encodeInput(prompt);
			try {
				await proc.stdin.write(new TextEncoder().encode(`${encoded}\n`));
			} catch (err) {
				process.stderr.write(
					`[${spec.binary}-transport] stdin write failed: ${err}\n`,
				);
			}
		},
		onEvent(cb: (evt: ParsedEvent) => void): () => void {
			return bus.on("*", cb);
		},
		async interrupt(): Promise<void> {
			if (closed) return;
			try {
				process.kill(proc.pid, "SIGINT");
			} catch {}
		},
		async compact(): Promise<void> {
			throw new TransportNotSupportedError("compact", "stdio-stream-json");
		},
		close(): void {
			if (closed) return;
			closed = true;
			closedRef.value = true;
			bus.clear();
			try {
				proc.stdin.close();
			} catch {}
			try {
				process.kill(proc.pid, "SIGTERM");
			} catch {}
		},
		get pid() {
			return proc.pid;
		},
		get sessionId() {
			return capturedSessionId;
		},
	};
}
