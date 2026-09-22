// @system codegen
// @status generated
// @edit change the suite in the owned-suites band, then re-run codegen. Hand-edits are overwritten.
//
// This suite's assertions are OWNED by the codegen band: the band module
// carries them verbatim, this file is the emission, and hand edits here are
// overwritten on the next run. The rationale each assertion carries moved
// with it into the band.

import { afterAll, expect, mock, test } from "bun:test";
import { mockModuleRestorable, restoreMockedModules } from "#cli-session/session-daemon/mock-module-restore.ts";

const spawnRaw = mock(() => ({
	pid: 17,
	stdin: { write() {}, flush() {}, end() {} },
	stdout: new ReadableStream<Uint8Array>(),
	stderr: new ReadableStream<Uint8Array>(),
	exited: new Promise<number>(() => {}),
}));

await mockModuleRestorable("@teamscala/os/spawn/spawn", (real) => ({
	...real,
	spawnRaw,
}));
afterAll(() => restoreMockedModules());

const { spawnAcpProcess } = await import("./process-spawn");

test("ACP child is spawned with a writable stdin protocol pipe", () => {
	const child = spawnAcpProcess(
		{ kind: "stdio-acp", binary: "/bin/agent", args: ["--acp"] },
		["--acp"],
		"/workspace",
		{ TOKEN: "value" },
	);

	expect(child.stdin).toBeDefined();
	expect(spawnRaw).toHaveBeenCalledWith(
		expect.objectContaining({
			stdin: "pipe",
			cwd: "/workspace",
		}),
	);
});
