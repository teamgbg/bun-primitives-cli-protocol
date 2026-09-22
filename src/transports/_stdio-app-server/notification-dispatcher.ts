/**
 * @system cli-session
 * @status handwritten
 * @edit edit directly
 *
 * Dispatches JSON-RPC notifications from codex app-server to ParsedEvent.
 */

import type {
	AssistantBlock,
	ParsedEvent,
} from "@teamscala/session-contracts/types";

export interface AppServerContext {
	model?: string;
	turnCounter: number;
	dispatch: (evt: ParsedEvent) => void;
}

export function handleAppServerNotification(
	method: string,
	params: Record<string, unknown>,
	ctx: AppServerContext,
): void {
	switch (method) {
		case "thread/started": {
			const thread = params.thread as Record<string, unknown> | undefined;
			if (thread?.id) {
				ctx.dispatch({
					type: "init",
					session_id: String(thread.id),
					model: ctx.model ?? undefined,
				});
			}
			return;
		}
		case "turn/started": {
			const turn = params.turn as Record<string, unknown> | undefined;
			if (turn?.id) ctx.dispatch({ type: "status", session_status: "running" });
			return;
		}
		case "item/agentMessage/delta": {
			const itemId = String(params.itemId ?? "");
			if (!itemId) return;
			const blocks: AssistantBlock[] = [
				{ type: "text", text: String(params.delta ?? "") },
			];
			ctx.dispatch({
				type: "assistant",
				id: itemId,
				content: blocks,
				model: ctx.model,
			});
			return;
		}
		case "item/completed": {
			const item = params.item as Record<string, unknown> | undefined;
			if (!item) return;
			if (item.type === "agentMessage" && item.id) {
				const blocks: AssistantBlock[] = [
					{ type: "text", text: String(item.text ?? "") },
				];
				ctx.dispatch({
					type: "assistant",
					id: String(item.id),
					content: blocks,
					model: ctx.model,
				});
			}
			return;
		}
		case "thread/tokenUsage/updated": {
			const usage = params.tokenUsage as Record<string, unknown> | undefined;
			const total = usage?.total as Record<string, unknown> | undefined;
			if (total) {
				void total;
			}
			return;
		}
		case "turn/completed": {
			const turn = params.turn as Record<string, unknown> | undefined;
			// An absent status is recorded AS absent, never coerced to "completed".
			// The prior `?? "completed"` reported a turn as finished-successfully on
			// the strength of a field that never arrived, which is the outcome-
			// fabrication a-component-may-not-report-a-state-it-has-not-verified names.
			const status = turn?.status === undefined ? "unknown" : String(turn.status);
			const error = turn?.error as Record<string, unknown> | null | undefined;
			const isError = status === "failed" || !!error;
			ctx.dispatch({
				type: "result",
				is_error: isError,
				result: isError
					? String(error?.message ?? `turn ${status}`)
					: undefined,
			});
			return;
		}
		case "error": {
			const err = params.error as Record<string, unknown> | undefined;
			ctx.dispatch({
				type: "result",
				is_error: true,
				result: String(err?.message ?? "codex error"),
			});
			return;
		}
		case "thread/status/changed": {
			const status = params.status as Record<string, unknown> | undefined;
			const t = String(status?.type ?? "idle");
			if (t === "idle")
				ctx.dispatch({ type: "status", session_status: "idle" });
			return;
		}
		case "account/rateLimits/updated": {
			const rl = params.rateLimits as Record<string, unknown> | undefined;
			const primary = rl?.primary as Record<string, unknown> | undefined;
			const used = Number(primary?.usedPercent ?? 0);
			if (used >= 80) {
				ctx.dispatch({
					type: "rate_limit",
					status: "warning",
					resets_at:
						primary?.resetsAt != null ? Number(primary.resetsAt) : undefined,
					utilization: used / 100,
					raw: rl,
				});
			}
			return;
		}
	}
}
