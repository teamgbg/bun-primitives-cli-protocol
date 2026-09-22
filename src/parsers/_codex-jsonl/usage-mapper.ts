/**
 * @system cli-session
 * @status handwritten
 * @edit edit directly
 *
 * Maps a parsed Codex rollout `token_count` usage meter into the fleet's
 * canonical `message.updated` ingest payload — the SAME shape the Pi/Claude
 * transcript tails and the OpenCode transport emit — so Codex native usage lands
 * on the five-dim contract (input/output/reasoning/cache_read/cache_write) with
 * the producer's OWN native identity for idempotent dedup.
 *
 * Codex's rollout meter (confirmed from a live rollout `event_msg` of
 * `payload.type:"token_count"`, `payload.info.total_token_usage`):
 *   { input_tokens, output_tokens, cached_input_tokens, cache_write_input_tokens,
 *     reasoning_output_tokens, total_tokens }
 * This is the FULL five-dimension meter — Codex reports cache-WRITE AND
 * reasoning (overturns llm-usage-accounting §3 which marked Codex `partial`).
 * Map: cached_input_tokens → cache_read; cache_write_input_tokens → cache_write;
 * reasoning_output_tokens → reasoning. NULL-not-zero: an absent dim stays NULL.
 *
 * Codex's meter is SESSION-CUMULATIVE (total_token_usage grows across the run),
 * so the tail emits ONE message.updated per token_count event with a STABLE
 * per-session source_event_id (the codex session id); recordEvent MAX-merges by
 * (run, "codex", session_id) → one row per run holding the final cumulative
 * totals (never sums per-line emissions, which would over-count).
 *
 * PURE — no DB, no side effects — unit-tests without a transport. The
 * codex→fleet transport bridge (codex-transcript-tail) calls this per
 * token_count event.
 */

/** Codex's native rollout usage meter (total_token_usage / last_token_usage). */
/**
 * Map ONE parsed Codex rollout line to a fleet `message.updated` usage event, or
 * null when the line carries no usage (only `event_msg` lines whose payload is a
 * `token_count` carry the meter). Uses `total_token_usage` (SESSION-CUMULATIVE)
 * so recordEvent MAX-merges every token_count emission — keyed on the stable
 * per-session sourceEventId — into ONE row per run holding the final totals
 * (never sums per-line emissions, which would over-count a cumulative meter).
 *
 * PURE — no DB, no side effects, no @teamscala imports — so it unit-tests
 * without a transport. The codex transcript tail reads rollout lines + calls this.
 */

export interface CodexNativeUsage {
	input_tokens?: number;
	output_tokens?: number;
	/** Prompt-cache READ tokens. */
	cached_input_tokens?: number;
	/** Prompt-cache WRITE tokens. */
	cache_write_input_tokens?: number;
	/** Reasoning-model output tokens. */
	reasoning_output_tokens?: number;
	/**
	 * Codex's own total. DECLARED but not consumed: the mapper derives totals
	 * from the component counts, so trusting a producer-supplied total would be a
	 * second source for one fact. It is declared because codex genuinely emits it
	 * on the wire — a type that omits a field the producer sends makes the real
	 * payload untypeable, which is what the co-located test was already asserting
	 * against before this field existed.
	 */
	total_tokens?: number;
}

export interface CodexUsageToIngestOpts {
	/** The producer's OWN native identity for this usage event (the codex
	 *  session id — the meter is session-cumulative, so one stable id per run lets
	 *  recordEvent MAX-merge every token_count emission into one final-totals
	 *  row). Absent ⇒ no dedup. Never a payload hash. */
	sourceEventId?: string;
	/** Codex's OWN reported context window — `model_context_window` from the
	 *  rollout's `task_started` event_msg (captured by the tail). The CLI's
	 *  MEASURED limit, the single per-CLI source per `lane-context-percent-is-
	 *  cli-sourced` — never a registry constant. When present + >0 the mapper
	 *  derives context% from it; when absent the emission carries no context_pct
	 *  (EMPTY, never a proxy). */
	contextWindow?: number;
}

/**
 * Map a Codex native usage meter to the fleet `message.updated` info payload, or
 * null when the meter reported nothing (a meter-less turn is coverage
 * unsupported — NULL — not a zero row). Unreported dims are OMITTED (the ingest
 * normalizer turns undefined → NULL via normaliseTokenDim), preserving
 * NULL-not-zero.
 */
export function codexUsageToIngestPayload(
	usage: CodexNativeUsage | null | undefined,
	opts: CodexUsageToIngestOpts = {},
): { info: Record<string, unknown> } | null {
	if (!usage) return null;
	// Only emit when the meter reported at least one dimension.
	if (
		usage.input_tokens == null &&
		usage.output_tokens == null &&
		usage.cached_input_tokens == null &&
		usage.cache_write_input_tokens == null &&
		usage.reasoning_output_tokens == null
	) {
		return null;
	}
	const tokens: Record<string, number> = {};
	if (usage.input_tokens != null) tokens.input = usage.input_tokens;
	if (usage.output_tokens != null) tokens.output = usage.output_tokens;
	// cached_input_tokens = prompt-cache READ; cache_write_input_tokens = WRITE;
	// reasoning_output_tokens = reasoning. camelCase keys match the fleet
	// contract the Pi/Claude/OpenCode tails emit (cacheRead/cacheCreation/reasoning).
	if (usage.cached_input_tokens != null) tokens.cacheRead = usage.cached_input_tokens;
	if (usage.cache_write_input_tokens != null) tokens.cacheCreation = usage.cache_write_input_tokens;
	if (usage.reasoning_output_tokens != null) tokens.reasoning = usage.reasoning_output_tokens;
	const info: Record<string, unknown> = {
		role: "assistant",
		producer: "codex",
		...(opts.sourceEventId ? { source_event_id: opts.sourceEventId } : {}),
		tokens,
	};
	// Codex's OWN context% (lane-context-percent-is-cli-sourced): the window is
	// codex's OWN `model_context_window` (the CLI's measured limit, captured from
	// the rollout's task_started event by the tail — never a registry constant or
	// proxy). Occupancy = the full PROMPT size (input + cacheRead + cacheCreation)
	// ÷ window, mirroring the Pi/Claude tails. The meter is session-cumulative, so
	// the latest emission holds the current context size. Omitted entirely when no
	// window is resolvable (the card leaves ctx unset rather than showing a
	// fabricated value — the EMPTY-not-fallback contract).
	if (opts.contextWindow && opts.contextWindow > 0) {
		const promptSize =
			(usage.input_tokens ?? 0) +
			(usage.cached_input_tokens ?? 0) +
			(usage.cache_write_input_tokens ?? 0);
		if (promptSize > 0) {
			info.context_pct = Math.min(100, Math.round((promptSize / opts.contextWindow) * 100));
			info.context_window = opts.contextWindow;
		}
	}
	return { info };
}

/** A parsed Codex rollout JSONL line (one record per line). */
export interface CodexRolloutLine {
	timestamp?: string;
	type?: string;
	payload?: Record<string, unknown> | undefined;
}

/** A fleet lane-event synthesized from a codex rollout line. */
export interface CodexFleetEvent {
	eventType: "message.updated";
	payload: { info: Record<string, unknown> };
}

export function codexRolloutLineToIngestEvent(
	line: CodexRolloutLine | null | undefined,
	sessionId: string,
	contextWindow?: number,
): CodexFleetEvent | null {
	if (!line || line.type !== "event_msg") return null;
	const payload = line.payload;
	if (!payload || payload.type !== "token_count") return null;
	const info = payload.info as { total_token_usage?: CodexNativeUsage } | undefined;
	const mapped = codexUsageToIngestPayload(info?.total_token_usage, {
		sourceEventId: sessionId,
		...(contextWindow != null ? { contextWindow } : {}),
	});
	if (!mapped) return null;
	return { eventType: "message.updated", payload: mapped };
}

/**
 * Read codex's OWN reported `model_context_window` from a `task_started`
 * event_msg line — the CLI's measured context limit (codex emits it per turn).
 * The tail captures this so every later token_count emission derives its
 * context% against the CLI's OWN window, never a registry constant. Returns
 * undefined for any other line shape (the tail then keeps the previously-captured
 * window). A non-numeric / non-positive value is ignored (unresolvable ⇒ EMPTY).
 */
export function extractCodexModelContextWindow(
	line: CodexRolloutLine | null | undefined,
): number | undefined {
	if (!line || line.type !== "event_msg") return undefined;
	const payload = line.payload;
	if (!payload || payload.type !== "task_started") return undefined;
	const w = payload.model_context_window;
	return typeof w === "number" && w > 0 ? w : undefined;
}
