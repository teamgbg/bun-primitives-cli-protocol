/**
 * @system cli-session
 * @status handwritten
 * @edit edit directly
 *
 * Persistent stdio transport for `codex app-server`. JSON-RPC 2.0 over
 * newline-delimited JSON. One long-lived child per orchestrator session;
 * every turn flows through the same process so latency is small and the
 * thread id is stable.
 * Protocol ref: https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md
 */

import { createEventBus } from "@teamscala/event-bus/create-event-bus";
import type {
	ParsedAssistantEvent,
	ParsedEvent,
	StdioAppServerConfig,
	TransportHandle,
} from "@teamscala/session-contracts/types";
import { TransportNotSupportedError } from "@teamscala/session-contracts/types";
import { handleAppServerNotification } from "./_stdio-app-server/notification-dispatcher";
import { spawnAppServerProcess } from "./_stdio-app-server/process-spawn";

export interface StdioAppServerTransportOptions {
	spec: StdioAppServerConfig;
	workdir: string;
	resumeThreadId?: string | null;
	model?: string;
	extraEnv?: Record<string, string>;
	onEvent?: (event: ParsedEvent) => void;
}

export function createStdioAppServerTransport(
	opts: StdioAppServerTransportOptions,
): TransportHandle {
	const { spec, workdir, resumeThreadId, model, onEvent } = opts;

	const proc = spawnAppServerProcess(spec, workdir, opts.extraEnv ?? {});

	let threadId: string | null = null;
	let currentTurnId: string | null = null;
	let promptInFlight = false;
	let stopped = false;
	let buffer = "";
	let turnCounter = 0;

	const _turnTextByItem = new Map<string, string>();

	const pending = new Map<
		number,
		{
			resolve: (v: unknown) => void;
			reject: (e: Error) => void;
			timer: ReturnType<typeof setTimeout>;
		}
	>();
	const bus = createEventBus<ParsedEvent>(`stdio-app-server:${spec.binary}`);
	if (onEvent) bus.on("*", onEvent);

	const stdin = proc.stdin;

	function sendRpc(method: string, params: object): number {
		const id = ++rpcId;
		const msg = `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
		stdin.write(new TextEncoder().encode(msg));
		return id;
	}

	function sendNotification(method: string, params: object): void {
		const msg = `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`;
		stdin.write(new TextEncoder().encode(msg));
	}

	let rpcId = 0;

	function dispatch(evt: ParsedEvent): void {
		let tagged: ParsedEvent = evt;
		if (evt.type === "assistant" && turnCounter > 0) {
			const baseId = (evt as ParsedAssistantEvent).id ?? "";
			tagged = { ...evt, id: `${baseId}-t${turnCounter}` } as ParsedEvent;
		}
		bus.emit(tagged);
	}

	function handleNotification(
		method: string,
		params: Record<string, unknown>,
	): void {
		handleAppServerNotification(method, params, {
			model,
			turnCounter,
			dispatch,
		});
	}

	function handleLine(line: string): void {
		if (!line.trim()) return;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			return;
		}
		if (typeof parsed !== "object" || parsed === null) return;
		const obj = parsed as Record<string, unknown>;

		if (
			typeof obj.id === "number" &&
			(obj.result !== undefined || obj.error !== undefined)
		) {
			const req = pending.get(obj.id as number);
			if (req) {
				clearTimeout(req.timer);
				pending.delete(obj.id as number);
				if (obj.error) {
					const e = obj.error as Record<string, unknown>;
					const err = new Error(String(e.message ?? "RPC error")) as Error & {
						code?: number;
						data?: unknown;
					};
					if (typeof e.code === "number") err.code = e.code;
					if (e.data !== undefined) err.data = e.data;
					req.reject(err);
				} else {
					req.resolve(obj.result);
				}
			}
			return;
		}

		if (typeof obj.method === "string") {
			handleNotification(
				obj.method,
				(obj.params as Record<string, unknown>) ?? {},
			);
		}
	}

	proc.stdout
		.pipeThrough(
			new TextDecoderStream() as unknown as TransformStream<Uint8Array, string>,
		)
		.pipeTo(
			new WritableStream({
				write(chunk) {
					buffer += chunk;
					const lines = buffer.split("\n");
					buffer = lines.pop() ?? "";
					for (const l of lines) handleLine(l);
				},
				close() {
					if (buffer.trim()) handleLine(buffer);
				},
			}),
		);

	proc.stderr
		.pipeThrough(
			new TextDecoderStream() as unknown as TransformStream<Uint8Array, string>,
		)
		.pipeTo(
			new WritableStream({
				write(chunk) {
					process.stderr.write(`[${spec.binary}:${proc.pid}] ${chunk}`);
				},
			}),
		);

	async function rpc(
		method: string,
		params: object,
		timeoutMs = 30000,
	): Promise<unknown> {
		const id = sendRpc(method, params);
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				pending.delete(id);
				reject(new Error(`RPC ${method} timed out after ${timeoutMs}ms`));
			}, timeoutMs);
			pending.set(id, { resolve, reject, timer });
		});
	}

	async function send(prompt: string): Promise<void> {
		await initDone;
		if (!threadId) throw new Error("No active thread");
		if (promptInFlight) throw new Error("Prompt already in flight");

		promptInFlight = true;
		turnCounter++;
		try {
			const startParams: Record<string, unknown> = {
				threadId,
				input: [{ type: "text", text: prompt }],
			};
			if (model) startParams.model = model;
			const turnResult = await rpc("turn/start", startParams, 60000);
			const turn = (turnResult as Record<string, unknown> | null)?.turn as
				| Record<string, unknown>
				| undefined;
			if (turn?.id) currentTurnId = String(turn.id);
		} catch (err) {
			const raw =
				err && typeof err === "object"
					? (err as { message?: string; data?: unknown })
					: { message: String(err) };
			const msg = (raw.message ?? "").toLowerCase();
			const details =
				raw.data && typeof raw.data === "object"
					? JSON.stringify(raw.data).toLowerCase()
					: "";
			const isRateLimit =
				/quota|rate[ _-]?limit|resource[ _-]?exhausted|too many request|usage[ _-]?limit/.test(
					`${msg} ${details}`,
				);
			if (isRateLimit)
				dispatch({ type: "rate_limit", status: "rejected", raw });
			dispatch({
				type: "result",
				is_error: true,
				result: raw.message ?? "codex app-server error",
			});
			throw err;
		} finally {
			promptInFlight = false;
		}
	}

	function close(): void {
		if (stopped) return;
		stopped = true;
		if (promptInFlight && threadId && currentTurnId) {
			try {
				sendNotification("turn/interrupt", { threadId, turnId: currentTurnId });
			} catch {}
		}
		try {
			stdin.close();
		} catch {}
		try {
			process.kill(proc.pid, "SIGTERM");
		} catch {}
		bus.clear();
	}

	const initDone = (async () => {
		await rpc(
			"initialize",
			{
				clientInfo: {
					name: "scala-fleet",
					title: "Scala fleet orchestrator",
					version: "0.1.0",
				},
			},
			15000,
		);
		sendNotification("initialized", {});

		if (resumeThreadId) {
			try {
				const resumed = await rpc(
					"thread/resume",
					{ threadId: resumeThreadId },
					30000,
				);
				const t = (resumed as Record<string, unknown> | null)?.thread as
					| Record<string, unknown>
					| undefined;
				if (t?.id) {
					threadId = String(t.id);
					dispatch({ type: "init", session_id: threadId, model });
					return;
				}
			} catch {}
		}

		const startParams: Record<string, unknown> = {
			cwd: workdir,
			approvalPolicy: spec.approval_policy ?? "never",
			sandbox: spec.sandbox ?? "danger-full-access",
		};
		if (model) startParams.model = model;
		const started = await rpc("thread/start", startParams, 30000);
		const t = (started as Record<string, unknown> | null)?.thread as
			| Record<string, unknown>
			| undefined;
		if (t?.id) {
			threadId = String(t.id);
			const resolvedModel =
				((started as Record<string, unknown>).model as string | undefined) ??
				model;
			dispatch({ type: "init", session_id: threadId, model: resolvedModel });
		}
	})().catch((err) => {
		stopped = true;
		try {
			dispatch({
				type: "result",
				is_error: true,
				result: `app-server transport failed: ${err instanceof Error ? err.message : String(err)}`,
			});
		} catch {}
		try {
			stdin.close();
		} catch {}
	});

	proc.exited.then((code) => {
		if (!stopped) {
			stopped = true;
			dispatch({
				type: "result",
				is_error: true,
				result: `process exited with code ${code}`,
			});
		}
	});

	async function interrupt(): Promise<void> {
		if (!threadId || !currentTurnId) return;
		try {
			sendNotification("turn/interrupt", { threadId, turnId: currentTurnId });
		} catch {}
	}

	async function compact(): Promise<void> {
		throw new TransportNotSupportedError("compact", "stdio-app-server");
	}

	return {
		send,
		interrupt,
		compact,
		onEvent(cb) {
			return bus.on("*", cb);
		},
		close,
		get pid() {
			return proc.pid;
		},
		get sessionId() {
			return threadId;
		},
	};
}
