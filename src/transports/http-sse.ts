/**
 * @system cli-session
 * @status handwritten
 * @edit edit directly
 *
 * HTTP/SSE transport for OpenCode — uses SDK factory from sdks/index.ts.
 * Package stays sdk-agnostic; consumer registers the factory at boot.
 * Session lifecycle:
 * - start(): create new session or resume existing; emit synthetic init event
 * - send(): promptAsync to live session
 * - close(): unsubscribe SSE; do NOT close session (server keeps it for resume)
 */

import { createEventBus } from "@teamscala/event-bus/create-event-bus";
import { getParser } from "@teamscala/session-contracts/parsers-registry";
import { getSdkClient } from "@teamscala/session-contracts/sdks-registry";
import type {
	HttpSseConfig,
	ParsedEvent,
	TransportHandle,
} from "@teamscala/session-contracts/types";
import { TransportNotSupportedError } from "@teamscala/session-contracts/types";
import { runSseWithReconnect } from "./_http-sse/sse-runner";

export interface HttpSseTransportOptions {
	spec: HttpSseConfig;
	resumeSessionId?: string | null;
	onEvent?: (event: ParsedEvent) => void;
}

interface SdkClient {
	session: {
		create(opts: {
			body: { title: string; metadata?: { tmux_pane?: string } };
			query?: { directory?: string };
		}): Promise<{ data?: { id?: string } }>;
		get(opts: { path: { id: string } }): Promise<unknown>;
		promptAsync(opts: {
			path: { id: string };
			body: {
				parts: Array<{ type: string; text: string }>;
				model?: { providerID: string; modelID: string };
				system?: string;
			};
		}): Promise<void>;
		abort(opts: { path: { id: string } }): Promise<void>;
	};
	event: {
		subscribe(): Promise<{ stream: AsyncIterable<unknown> }>;
	};
}

export function createHttpSseTransport(
	opts: HttpSseTransportOptions,
): TransportHandle {
	const { spec, resumeSessionId } = opts;
	let activeSessionId: string | null = resumeSessionId ?? null;
	let _stopped = false;
	const bus = createEventBus<ParsedEvent>(`http-sse:${spec.sdk_id}`);

	if (opts.onEvent) bus.on("*", opts.onEvent);

	let _cleanupReconnect: (() => void) | null = null;

	async function start(): Promise<string> {
		const client = getSdkClient(spec.sdk_id) as SdkClient;

		if (activeSessionId) {
			try {
				await client.session.get({ path: { id: activeSessionId } });
			} catch {
				activeSessionId = null;
			}
		}

		if (!activeSessionId) {
			const tmuxPane = process.env.TMUX_PANE;
			const createBody: { title: string; metadata?: { tmux_pane?: string } } = {
				title: "orchestrator",
			};
			if (tmuxPane) createBody.metadata = { tmux_pane: tmuxPane };
			const result = await client.session.create({
				body: createBody,
				query: {},
			});
			activeSessionId = result.data?.id ?? null;
			if (!activeSessionId)
				throw new Error("Failed to create OpenCode session");
		}

		bus.emit({ type: "init", session_id: activeSessionId } as ParsedEvent);

		const sseParser = getParser("opencode-sse");
		if (!sseParser) {
			throw new Error(
				"opencode-sse parser not registered. Did the @teamscala/opencode adapter mount?",
			);
		}
		_cleanupReconnect = runSseWithReconnect({
			stream: async function* () {
				const result = await client.event.subscribe();
				yield* result.stream;
			},
			specSdkId: spec.sdk_id,
			resumeSessionId: activeSessionId,
			parseOpenCodeEvent: (ev: unknown) =>
				sseParser(typeof ev === "string" ? ev : JSON.stringify(ev)),
			dispatch: (evt) => bus.emit(evt),
			onSessionIdFromEvent: (sid) => {
				if (sid !== activeSessionId) activeSessionId = sid;
			},
		});

		return activeSessionId;
	}

	async function send(prompt: string): Promise<void> {
		if (!activeSessionId) throw new Error("No active session");
		const client = getSdkClient(spec.sdk_id) as SdkClient;
		await client.session.promptAsync({
			path: { id: activeSessionId },
			body: { parts: [{ type: "text", text: prompt }] },
		});
	}

	function close(): void {
		_stopped = true;
		_cleanupReconnect?.();
		_cleanupReconnect = null;
		bus.clear();
	}

	const _initPromise = start();

	async function interrupt(): Promise<void> {
		if (!activeSessionId) return;
		const client = getSdkClient(spec.sdk_id) as SdkClient;
		await client.session.abort({ path: { id: activeSessionId } });
	}

	async function compact(): Promise<void> {
		throw new TransportNotSupportedError("compact", "http-sse");
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
			return undefined;
		},
		get sessionId() {
			return activeSessionId;
		},
	};
}
