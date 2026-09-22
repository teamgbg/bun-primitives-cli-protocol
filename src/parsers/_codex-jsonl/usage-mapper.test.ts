// @system codegen
// @status generated
// @edit change the suite in the owned-suites band, then re-run codegen. Hand-edits are overwritten.
//
// This suite's assertions are OWNED by the codegen band: the band module
// carries them verbatim, this file is the emission, and hand edits here are
// overwritten on the next run. The rationale each assertion carries moved
// with it into the band.

import { describe, expect, test } from "bun:test";
import {
	codexRolloutLineToIngestEvent,
	codexUsageToIngestPayload,
	extractCodexModelContextWindow,
} from "./usage-mapper.ts";

describe("codexUsageToIngestPayload", () => {
	test("maps the FULL codex rollout meter: all FIVE dimensions", () => {
		// Real codex rollout token_count total_token_usage shape — Codex reports
		// cache-WRITE AND reasoning (overturns llm-usage-accounting §3 "partial").
		const payload = codexUsageToIngestPayload(
			{
				input_tokens: 185517,
				output_tokens: 153,
				cached_input_tokens: 6912,
				cache_write_input_tokens: 0,
				reasoning_output_tokens: 39,
				total_tokens: 185670,
			},
			{ sourceEventId: "019faddd-6071-7c91-8b82-656447f5e809" },
		);
		expect(payload).not.toBeNull();
		const info = payload!.info as Record<string, unknown>;
		expect(info.role).toBe("assistant");
		expect(info.producer).toBe("codex");
		expect(info.source_event_id).toBe("019faddd-6071-7c91-8b82-656447f5e809");
		const tokens = info.tokens as Record<string, number>;
		expect(tokens.input).toBe(185517);
		expect(tokens.output).toBe(153);
		// cached_input_tokens → cache_read.
		expect(tokens.cacheRead).toBe(6912);
		// cache_write_input_tokens → cache_write (Codex DOES report cache-write).
		expect(tokens.cacheCreation).toBe(0);
		// reasoning_output_tokens → reasoning (Codex DOES report reasoning).
		expect(tokens.reasoning).toBe(39);
	});

	test("a cached turn with cache-write + reasoning maps fully", () => {
		const payload = codexUsageToIngestPayload({
			input_tokens: 1000,
			output_tokens: 200,
			cached_input_tokens: 12000,
			cache_write_input_tokens: 500,
			reasoning_output_tokens: 80,
		});
		const tokens = payload!.info.tokens as Record<string, number>;
		expect(tokens.cacheRead).toBe(12000);
		expect(tokens.cacheCreation).toBe(500);
		expect(tokens.reasoning).toBe(80);
	});

	test("sourceEventId is optional (no dedup key when absent)", () => {
		const payload = codexUsageToIngestPayload({ input_tokens: 5, output_tokens: 5 });
		expect((payload!.info as Record<string, unknown>).source_event_id).toBeUndefined();
	});

	test("a meter-less turn yields null (coverage unsupported, NOT a zero row)", () => {
		// No usage object / all-absent → null. The transport then emits no
		// message.updated, so no token columns (NULL), distinguishable from a
		// measured-zero turn — coverage unsupported, never fabricated as zero.
		expect(codexUsageToIngestPayload(null)).toBeNull();
		expect(codexUsageToIngestPayload(undefined)).toBeNull();
		expect(codexUsageToIngestPayload({})).toBeNull();
	});

	test("a genuine zero is preserved (0 ≠ omitted)", () => {
		// cache_write_input_tokens: 0 is a real measurement (wrote zero cache) →
		// emitted as 0, distinct from absent (unreported → NULL).
		const payload = codexUsageToIngestPayload({
			input_tokens: 100,
			output_tokens: 0,
			cache_write_input_tokens: 0,
		});
		const tokens = payload!.info.tokens as Record<string, number>;
		expect(tokens.output).toBe(0);
		expect(tokens.cacheCreation).toBe(0);
	});

	test("pure + deterministic: same usage yields the same payload", () => {
		const usage = {
			input_tokens: 1,
			output_tokens: 2,
			cached_input_tokens: 3,
			cache_write_input_tokens: 4,
			reasoning_output_tokens: 5,
		};
		expect(codexUsageToIngestPayload(usage, { sourceEventId: "x" })).toEqual(
			codexUsageToIngestPayload(usage, { sourceEventId: "x" }),
		);
	});

	test("derives context_pct from codex's OWN contextWindow (the CLI's measured limit)", () => {
		// promptSize = input + cacheRead + cacheCreation = 185517 + 6912 + 0 = 192429.
		// ÷ codex's model_context_window (258400) = 74.47% → 74 (capped at 100).
		// The window is codex's OWN report (task_started.model_context_window), the
		// single per-CLI source — never a registry constant or guess.
		const payload = codexUsageToIngestPayload(
			{
				input_tokens: 185517,
				cached_input_tokens: 6912,
				cache_write_input_tokens: 0,
			},
			{ contextWindow: 258400 },
		);
		const info = payload!.info as Record<string, unknown>;
		expect(info.context_pct).toBe(74);
		expect(info.context_window).toBe(258400);
	});

	test("context_pct caps at 100 when the prompt exceeds the window", () => {
		const payload = codexUsageToIngestPayload(
			{ input_tokens: 300_000, cached_input_tokens: 0, cache_write_input_tokens: 0 },
			{ contextWindow: 258400 },
		);
		expect((payload!.info as Record<string, unknown>).context_pct).toBe(100);
	});

	test("NO contextWindow ⇒ NO context_pct (EMPTY, never a fallback/proxy)", () => {
		// The EMPTY-not-fallback contract (lane-context-percent-is-cli-sourced): a
		// CLI that has not yet reported — or genuinely does not expose — its window
		// must leave ctx unset, never fabricate a value against an invented limit.
		const payload = codexUsageToIngestPayload({ input_tokens: 185517, cached_input_tokens: 6912 });
		const info = payload!.info as Record<string, unknown>;
		expect(info.context_pct).toBeUndefined();
		expect(info.context_window).toBeUndefined();
	});
});

describe("extractCodexModelContextWindow — codex's OWN reported window", () => {
	test("reads model_context_window from a task_started event_msg line", () => {
		// Real codex rollout task_started shape (per-turn). The CLI reports its OWN
		// context limit here — the source the tail captures to derive context%.
		expect(
			extractCodexModelContextWindow({
				type: "event_msg",
				payload: {
					type: "task_started",
					turn_id: "t1",
					started_at: 1782261677,
					model_context_window: 258400,
					collaboration_mode_kind: "default",
				},
			}),
		).toBe(258400);
	});

	test("returns undefined for non-task_started lines (window stays captured from the last task_started)", () => {
		expect(
			extractCodexModelContextWindow({
				type: "event_msg",
				payload: { type: "token_count", info: { total_token_usage: { input_tokens: 1 } } },
			}),
		).toBeUndefined();
		expect(extractCodexModelContextWindow({ type: "response_item" })).toBeUndefined();
		expect(extractCodexModelContextWindow({ type: "session_meta" })).toBeUndefined();
		expect(extractCodexModelContextWindow(null)).toBeUndefined();
	});

	test("ignores a non-positive / non-numeric window (unresolvable ⇒ EMPTY)", () => {
		expect(
			extractCodexModelContextWindow({
				type: "event_msg",
				payload: { type: "task_started", model_context_window: 0 },
			}),
		).toBeUndefined();
		expect(
			extractCodexModelContextWindow({
				type: "event_msg",
				payload: { type: "task_started" },
			}),
		).toBeUndefined();
	});
});

describe("codexRolloutLineToIngestEvent — rollout line → fleet event", () => {
	const SID = "019faddd-6071-7c91-8b82-656447f5e809";

	test("a token_count event_msg line → message.updated with all 5 dims + session source_event_id", () => {
		// Real codex rollout line shape (event_msg wrapping payload.type token_count).
		const evt = codexRolloutLineToIngestEvent(
			{
				timestamp: "2026-07-29T12:33:46.362Z",
				type: "event_msg",
				payload: {
					type: "token_count",
					info: {
						total_token_usage: {
							input_tokens: 185517,
							output_tokens: 153,
							cached_input_tokens: 6912,
							cache_write_input_tokens: 0,
							reasoning_output_tokens: 39,
							total_tokens: 185670,
						},
					},
				},
			},
			SID,
		);
		expect(evt).not.toBeNull();
		expect(evt!.eventType).toBe("message.updated");
		const info = evt!.payload.info as Record<string, unknown>;
		expect(info.producer).toBe("codex");
		expect(info.source_event_id).toBe(SID);
		const tokens = info.tokens as Record<string, number>;
		expect(tokens.input).toBe(185517);
		expect(tokens.cacheRead).toBe(6912);
		expect(tokens.cacheCreation).toBe(0);
		expect(tokens.reasoning).toBe(39);
	});

	test("non-event_msg lines yield null (response_item / message / session_meta carry no meter)", () => {
		expect(codexRolloutLineToIngestEvent({ type: "response_item" }, SID)).toBeNull();
		expect(codexRolloutLineToIngestEvent({ type: "session_meta" }, SID)).toBeNull();
		expect(codexRolloutLineToIngestEvent({ type: "message" }, SID)).toBeNull();
	});

	test("an event_msg that is NOT token_count yields null", () => {
		expect(
			codexRolloutLineToIngestEvent({ type: "event_msg", payload: { type: "update" } }, SID),
		).toBeNull();
		expect(codexRolloutLineToIngestEvent({ type: "event_msg" }, SID)).toBeNull();
	});

	test("null / malformed line yields null", () => {
		expect(codexRolloutLineToIngestEvent(null, SID)).toBeNull();
		expect(codexRolloutLineToIngestEvent(undefined, SID)).toBeNull();
		expect(codexRolloutLineToIngestEvent({}, SID)).toBeNull();
	});

	test("every token_count emission carries the SAME per-session source_event_id (MAX-merge converges)", () => {
		// Codex's meter is session-cumulative: many token_count lines, same session.
		// Using the session id as source_event_id means recordEvent MAX-merges them
		// into ONE final-totals row (never sums per-line emissions → no over-count).
		const mk = (input: number) => ({
			type: "event_msg" as const,
			payload: { type: "token_count", info: { total_token_usage: { input_tokens: input } } },
		});
		const a = codexRolloutLineToIngestEvent(mk(100), SID)!;
		const b = codexRolloutLineToIngestEvent(mk(185517), SID)!;
		expect(a.payload.info.source_event_id).toBe(SID);
		expect(b.payload.info.source_event_id).toBe(SID);
	});
});
