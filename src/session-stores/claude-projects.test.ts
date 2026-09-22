// @system codegen
// @status generated
// @edit change the suite in the owned-suites band, then re-run codegen. Hand-edits are overwritten.
//
// This suite's assertions are OWNED by the codegen band: the band module
// carries them verbatim, this file is the emission, and hand edits here are
// overwritten on the next run. The rationale each assertion carries moved
// with it into the band.

import { mkdir, rm } from "node:fs/promises";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { join } from "node:path";
import * as os from "node:os";
import { resolveClaudeTranscriptPath } from "./claude-projects.ts";
import { getAppLogger } from "@teamscala/logger/app-loggers";

const tmp = mkdtemp();
function mkdtemp(): string {
	return `${os.tmpdir()}/claude-proj-test-${Math.random().toString(36).slice(2)}`;
}

afterEach(async () => {
	try {
		await rm(tmp, { recursive: true, force: true });
	} catch (error) {
		getAppLogger().warn("claude-projects.test.ts: bare catch around upstream call — logged, continuing (protective-layers-fail-explicitly)", error);
	}
});

// resolveClaudeTranscriptPath reads process.env.HOME at CALL time, so a
// static import is safe — no cache-busting needed (and the dynamic import
// re-registered the safe-fallback layer, which the registry forbids).

describe("resolveClaudeTranscriptPath", () => {
	it("finds the transcript by session id across project dirs regardless of the workdir passed", async () => {
		const prev = process.env.HOME;
		process.env.HOME = tmp;
		try {
			// Transcript written at the LAUNCH cwd (workspace root), but the lane
			// has since cd'd to scala-db — the passed workdir must NOT mislead.
			const launchDir = join(tmp, ".claude", "projects", "-home-x-workspace");
			const otherDir = join(tmp, ".claude", "projects", "-home-x-workspace-scala-db");
			await mkdir(launchDir, { recursive: true });
			await mkdir(otherDir, { recursive: true });
			await Bun.file(join(launchDir, "sess-1.jsonl")).write("{}");
			await Bun.file(join(otherDir, "decoy.jsonl")).write("{}");
			expect(await resolveClaudeTranscriptPath("sess-1", "/home/x/workspace/scala-db")).toBe(
				join(launchDir, "sess-1.jsonl"),
			);
		} finally {
			process.env.HOME = prev;
		}
	});

	it("falls back to the workdir-derived path when the session id is not found", async () => {
		const prev = process.env.HOME;
		process.env.HOME = tmp;
		try {
			const p = await resolveClaudeTranscriptPath("no-such-session", "/home/x/workspace");
			expect(p).toContain("no-such-session.jsonl");
			expect(p).toContain("-home-x-workspace");
		} finally {
			process.env.HOME = prev;
		}
	});
});
