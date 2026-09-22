/**
 * @system cli-session
 * @status handwritten
 * @edit edit directly
 *
 * SSE stream runner with reconnect logic via @teamscala/retry.
 */

import { createReconnectLoop } from "@teamscala/retry/reconnect-loop";
import { exponentialBackoff } from "@teamscala/retry/backoff";
import type { ParsedEvent } from "@teamscala/session-contracts/types";
import type { ParseOpenCodeEventFn } from "./types";

export interface SseRunnerOptions {
	stream: () => AsyncIterable<unknown>;
	specSdkId: string;
	resumeSessionId: string | null;
	parseOpenCodeEvent: ParseOpenCodeEventFn;
	dispatch: (evt: ParsedEvent) => void;
	onSessionIdFromEvent?: (sessionId: string) => void;
}

export function runSseWithReconnect(opts: SseRunnerOptions): () => void {
	const handle = createReconnectLoop(
		async (signal) => {
			for await (const event of opts.stream()) {
				if (signal.aborted) break;
				const parsed = opts.parseOpenCodeEvent(event);
				if (!parsed) continue;
				const props = (event as Record<string, unknown>).properties as
					| Record<string, unknown>
					| undefined;
				const sessionIdFromEvent = props?.sessionID as string | undefined;
				if (sessionIdFromEvent && sessionIdFromEvent !== opts.resumeSessionId)
					continue;
				if (sessionIdFromEvent) opts.onSessionIdFromEvent?.(sessionIdFromEvent);
				opts.dispatch(parsed);
			}
		},
		{
			backoff: exponentialBackoff({ baseMs: 1000, maxMs: 30_000, jitter: true }),
		},
	);

	return () => handle.stop();
}
