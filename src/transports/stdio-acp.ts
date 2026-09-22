/**
 * @system cli-session
 * @status handwritten
 * @edit edit directly
 *
 * Stdio ACP transport for gemini --acp (JSON-RPC 2.0 over stdio).
 * Handles initialize handshake, session lifecycle, prompt/response cycle,
 * and dispatches session/update notifications to the parser.
 */

import { createEventBus } from "@teamscala/event-bus/create-event-bus";
import type { AcpHttpServer } from "@teamscala/mcp-client-pool/resolve-acp-session-server";
import type {
	ParsedEvent,
	StdioAcpConfig,
	TransportHandle,
} from "@teamscala/session-contracts/types";
import { TransportNotSupportedError } from "@teamscala/session-contracts/types";
import { parseAcpFrame } from "../parsers/gemini-acp";
import {
	mapNewSessionResponse,
	mapPromptResponse,
} from "../parsers/gemini-acp-responses";
import {
	mergeAssistantBlocks,
	mergeUserBlocks,
} from "./_stdio-acp/block-merger";
import { handleLine } from "./_stdio-acp/line-handler";
import { requireAcpMcpCapabilities } from "./_stdio-acp/mcp-capabilities";
import { createPromptQueue } from "./_stdio-acp/prompt-queue";
import { makeRpcTracker } from "./_stdio-acp/rpc-tracker";
import { spawnAcpProcess } from "./_stdio-acp/process-spawn";
import { sendNotification, sendRpc } from "./_stdio-acp/stdin-writer";

export interface StdioAcpTransportOptions {
	spec: StdioAcpConfig;
	workdir: string;
	resumeSessionId?: string | null;
	model?: string;
	extraEnv?: Record<string, string>;
	mcpServers?: AcpHttpServer[];
	onEvent?: (event: ParsedEvent) => void;
}

type StdioAcpTransportDeps = {
	spawnProcess: typeof spawnAcpProcess;
};

export function createStdioAcpTransport(
	opts: StdioAcpTransportOptions,
	overrides: Partial<StdioAcpTransportDeps> = {},
): TransportHandle {
	const deps: StdioAcpTransportDeps = {
		spawnProcess: spawnAcpProcess,
		...overrides,
	};
	const { spec, workdir, resumeSessionId, onEvent } = opts;
	const mcpServers = opts.mcpServers ?? [];
	const args = [...spec.args];
	if (opts.model) args.push("--model", opts.model);

 	const label = `scala-orch-${spec.binary}`;
	const mergedEnv: Record<string, string> = {};
	for (const [k, v] of Object.entries({ ...process.env, ...spec.env, ...opts.extraEnv })) {
		if (v !== undefined) mergedEnv[k] = v;
	}
	const proc = deps.spawnProcess(spec, args, workdir, mergedEnv);

	if (!(proc.stdout instanceof ReadableStream)) {
		throw new Error(`${label}: expected stdout pipe`);
	}
	if (!(proc.stderr instanceof ReadableStream)) {
		throw new Error(`${label}: expected stderr pipe`);
	}
	const stdin: { write(data: Uint8Array): unknown; flush(): void; end(): void } = (() => {
		const s = proc.stdin;
		if (!s || typeof s === "number") throw new Error(`${label}: expected stdin pipe`);
		return s;
	})();

	const rpc = makeRpcTracker();
	let activeSessionId: string | null = null;
	let stopped = false;
	let buffer = "";
	let turnCounter = 0;

	type AssistantBlocksUnion =
		import("@teamscala/session-contracts/types").AssistantBlock[];
	type UserBlocksUnion = import("@teamscala/session-contracts/types").UserBlock[];
	const turnAssistant = new Map<number, AssistantBlocksUnion>();
	const turnUser = new Map<number, UserBlocksUnion>();
	const turnAssistantModel = new Map<number, string | undefined>();

	const bus = createEventBus<ParsedEvent>(`stdio-acp:${spec.binary}`);
	if (onEvent) bus.on("*", onEvent);

	function dispatch(event: ParsedEvent): void {
		let tagged: ParsedEvent = event;
		if (event.type === "assistant" && turnCounter > 0) {
			const existingBlocks = turnAssistant.get(turnCounter) ?? [];
			const newBlocks = mergeAssistantBlocks(existingBlocks, event.content);
			turnAssistant.set(turnCounter, newBlocks);
			const model = event.model ?? turnAssistantModel.get(turnCounter);
			if (event.model) turnAssistantModel.set(turnCounter, event.model);
			const baseId = (event as { id?: string }).id ?? "";
			tagged = {
				...event,
				id: `${baseId}-t${turnCounter}`,
				content: newBlocks,
				model,
			} as ParsedEvent;
		} else if (event.type === "user" && turnCounter > 0) {
			const existingBlocks = turnUser.get(turnCounter) ?? [];
			const newBlocks = mergeUserBlocks(
				existingBlocks,
				event.content as UserBlocksUnion,
			);
			turnUser.set(turnCounter, newBlocks);
			const baseId = (event as { id?: string }).id ?? "";
			tagged = {
				...event,
				id: `${baseId}-t${turnCounter}`,
				content: newBlocks,
			} as ParsedEvent;
		}
		bus.emit(tagged);
	}

	proc.stdout.pipeThrough(new TextDecoderStream()).pipeTo(
		new WritableStream({
			write(chunk) {
				buffer += chunk;
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";
				for (const l of lines) handleLine(l, rpc, dispatch, parseAcpFrame);
			},
			close() {
				if (buffer.trim()) handleLine(buffer, rpc, dispatch, parseAcpFrame);
			},
		}),
	);

	proc.stderr.pipeThrough(new TextDecoderStream()).pipeTo(
		new WritableStream({
			write(chunk) {
				process.stderr.write(chunk);
			},
	}),
);

	async function rpcCall(
		method: string,
		params: object,
		timeoutMs = 30000,
	): Promise<unknown> {
		const id = rpc.nextId();
		return new Promise((resolve, reject) => {
			rpc.addRequest(id, resolve, reject, timeoutMs);
			sendRpc(stdin, id, method, params);
		});
	}

	function startPrompt(prompt: string): Promise<void> {
		if (!activeSessionId) throw new Error("No active session");
		turnCounter++;
		return rpcCall(
			"session/prompt",
			{
				sessionId: activeSessionId,
				prompt: [{ type: "text", text: prompt }],
			},
			120000,
		).then((result) => {
			const event = mapPromptResponse({
				result: result as Record<string, unknown>,
			});
			if (event) dispatch(event);
		});
	}

	function recordPromptFailure(err: unknown): void {
		const raw =
			err && typeof err === "object"
				? (err as { code?: number; message?: string; data?: unknown })
				: { message: String(err) };
		const msg = (raw.message ?? "").toLowerCase();
		const details =
			raw.data && typeof raw.data === "object"
				? JSON.stringify(raw.data).toLowerCase()
				: "";
		const isRateLimit =
			/quota|rate[ _-]?limit|resource[ _-]?exhausted|too many request/.test(
				`${msg} ${details}`,
			);
		if (isRateLimit)
			dispatch({ type: "rate_limit", status: "rejected", raw: raw });
		dispatch({
			type: "result",
			is_error: true,
			result: raw.message ?? "ACP prompt failed",
		});
	}

	const promptQueue = createPromptQueue({
		start: startPrompt,
		onTerminalFailure: recordPromptFailure,
	});

	async function send(prompt: string): Promise<void> {
		await initDone;
		if (stopped) throw new Error("ACP transport is closed");
		if (!activeSessionId) throw new Error("No active session");
		await promptQueue.enqueue(prompt);
	}

	function close(): void {
		stopped = true;
		promptQueue.close();
		if (promptQueue.active && activeSessionId) {
			try {
				sendNotification(stdin, "session/cancel", {
					sessionId: activeSessionId,
				});
			} catch {}
		}
		try {
			stdin.end();
		} catch {}
		bus.clear();
	}

	const initDone = (async () => {
		await Bun.sleep(500);
		const initializeResult = await rpcCall(
			"initialize",
			{
				clientInfo: { name: "scala-fleet", version: "0.0.1" },
				protocolVersion: 1,
			},
			15000,
		);
		requireAcpMcpCapabilities(initializeResult, mcpServers);

		if (resumeSessionId) {
			try {
				await rpcCall(
					"session/load",
					{ sessionId: resumeSessionId, cwd: workdir, mcpServers },
					30000,
				);
				activeSessionId = resumeSessionId;
			} catch {
				activeSessionId = null;
			}
		}

		if (!activeSessionId) {
			const newSessionResult = (await rpcCall(
				"session/new",
				{ cwd: workdir, mcpServers },
				30000,
			)) as Record<string, unknown> | null;
			activeSessionId = (newSessionResult?.sessionId as string) ?? null;
			if (activeSessionId) {
				const initEvent = mapNewSessionResponse({
					result: newSessionResult as Record<string, unknown>,
				});
				if (initEvent) dispatch(initEvent);
			}
		}

		proc.exited.then((code: number) => {
			if (!stopped) {
				stopped = true;
				dispatch({
					type: "result",
					is_error: true,
					result: `process exited with code ${code}`,
				});
			}
		});
	})().catch((err) => {
		stopped = true;
		try {
			dispatch({
				type: "result",
				is_error: true,
				result: `acp transport failed: ${err instanceof Error ? err.message : String(err)}`,
			});
		} catch {}
		try {
			stdin.end();
		} catch {}
	});

	async function interrupt(): Promise<void> {
		if (!activeSessionId) return;
		try {
			sendNotification(stdin, "session/cancel", { sessionId: activeSessionId });
		} catch {}
	}

	async function compact(): Promise<void> {
		await initDone;
		if (!activeSessionId)
			throw new TransportNotSupportedError("compact", "stdio-acp");
		await send("/compact");
		await promptQueue.waitForIdle();
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
			return activeSessionId;
		},
	};
}
