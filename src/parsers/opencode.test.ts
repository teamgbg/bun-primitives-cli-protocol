// @system codegen
// @status generated
// @edit change the suite in the owned-suites band, then re-run codegen. Hand-edits are overwritten.
//
// This suite's assertions are OWNED by the codegen band: the band module
// carries them verbatim, this file is the emission, and hand edits here are
// overwritten on the next run. The rationale each assertion carries moved
// with it into the band.

import { describe, expect, it } from "bun:test";
import { parseLine } from "./opencode";

describe("opencode parser", () => {
	it("returns null for empty / non-JSON input", () => {
		expect(parseLine("")).toBeNull();
		expect(parseLine("   ")).toBeNull();
		expect(parseLine("{not json")).toBeNull();
	});

	it("returns null for a non-object JSON value", () => {
		expect(parseLine('"hello"')).toBeNull();
		expect(parseLine("42")).toBeNull();
		expect(parseLine("null")).toBeNull();
	});

	it("returns null when the event has no string type", () => {
		expect(parseLine(JSON.stringify({ info: {} }))).toBeNull();
		expect(parseLine(JSON.stringify({ type: 5 }))).toBeNull();
	});

	it("maps session.created → init", () => {
		const evt = parseLine(
			JSON.stringify({
				type: "session.created",
				sessionId: "ses-abc",
				model: "glm-5.2",
			}),
		);
		expect(evt).toEqual({
			type: "init",
			session_id: "ses-abc",
			model: "glm-5.2",
		});
	});

	it("maps message.updated assistant (with tokens) → assistant + usage", () => {
		const evt = parseLine(
			JSON.stringify({
				type: "message.updated",
				info: {
					id: "msg-1",
					role: "assistant",
					model: "glm-5.2",
					tokens: {
						input: 1200,
						output: 340,
						cacheRead: 900,
						cacheCreation: 50,
					},
					parts: [{ type: "text", text: "hello" }],
				},
			}),
		);
		expect(evt).toEqual({
			type: "assistant",
			id: "msg-1",
			content: [{ type: "text", text: "hello" }],
			model: "glm-5.2",
			usage: {
				input_tokens: 1200,
				output_tokens: 340,
				cache_read_input_tokens: 900,
				cache_creation_input_tokens: 50,
			},
		});
	});

	it("maps message.updated user → user", () => {
		const evt = parseLine(
			JSON.stringify({
				type: "message.updated",
				info: {
					role: "user",
					parts: [{ type: "text", text: "do the thing" }],
				},
			}),
		);
		expect(evt).toEqual({
			type: "user",
			content: [{ type: "text", text: "do the thing" }],
		});
	});

	it("maps message.updated unknown role → raw", () => {
		const evt = parseLine(
			JSON.stringify({ type: "message.updated", info: { role: "tool" } }),
		);
		expect(evt?.type).toBe("raw");
	});

	it("maps message.part.updated → raw (streaming chunk, not a forged assistant event)", () => {
		const evt = parseLine(
			JSON.stringify({ type: "message.part.updated", part: { text: "he" } }),
		);
		expect(evt?.type).toBe("raw");
	});

	it("maps session.busy → status running", () => {
		expect(parseLine(JSON.stringify({ type: "session.busy" }))).toEqual({
			type: "status",
			session_status: "running",
		});
	});

	it("maps session.idle → status idle", () => {
		expect(parseLine(JSON.stringify({ type: "session.idle" }))).toEqual({
			type: "status",
			session_status: "idle",
		});
	});

	it("maps session.status payload.status → status", () => {
		expect(
			parseLine(JSON.stringify({ type: "session.status", status: "busy" })),
		).toEqual({ type: "status", session_status: "running" });
		expect(
			parseLine(JSON.stringify({ type: "session.status", status: "idle" })),
		).toEqual({ type: "status", session_status: "idle" });
		expect(
			parseLine(JSON.stringify({ type: "session.status", status: "error" })),
		).toEqual({ type: "status", session_status: "error" });
	});

	it("maps session.compacted → compact_boundary", () => {
		expect(
			parseLine(
				JSON.stringify({ type: "session.compacted", contextPercent: 45 }),
			),
		).toEqual({ type: "compact_boundary" });
	});

	it("maps session.error → result is_error with message", () => {
		const evt = parseLine(
			JSON.stringify({ type: "session.error", error: "boom" }),
		);
		expect(evt).toEqual({ type: "result", is_error: true, result: "boom" });
	});

	it("maps session.closed → status idle", () => {
		expect(parseLine(JSON.stringify({ type: "session.closed" }))).toEqual({
			type: "status",
			session_status: "idle",
		});
	});

	it("maps an unknown event type → raw", () => {
		const evt = parseLine(JSON.stringify({ type: "something.new", x: 1 }));
		expect(evt?.type).toBe("raw");
	});
});
