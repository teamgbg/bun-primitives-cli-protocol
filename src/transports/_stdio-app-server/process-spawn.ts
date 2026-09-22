/**
 * @system cli-session
 * @status handwritten
 * @edit edit directly
 *
 * Spawns the codex app-server child process.
 */

import { spawnRaw } from "@teamscala/os/spawn/spawn";
import type { StdioAppServerConfig } from "@teamscala/session-contracts/types";

export interface SpawnedProcess {
	pid: number;
	stdin: { write(data: Uint8Array): void; close(): void };
	stdout: ReadableStream<Uint8Array>;
	stderr: ReadableStream<Uint8Array>;
	exited: Promise<number>;
	label: string;
}

export function spawnAppServerProcess(
	spec: StdioAppServerConfig,
	workdir: string,
	extraEnv: Record<string, string>,
): SpawnedProcess {
	const label = `scala-orch-${spec.binary}`;
	const proc = spawnRaw({
		name: label,
		command: ["bash", "-c", 'exec -a "$0" "$@"', label, spec.binary, ...spec.args],
		cwd: workdir,
		stdin: "pipe",
		env: Object.fromEntries(Object.entries({ ...process.env, ...extraEnv }).filter(([, v]) => v !== undefined)) as Record<string, string>,
	});
	return {
		pid: proc.pid,
		stdin: proc.stdin as unknown as SpawnedProcess["stdin"],
		stdout: proc.stdout as unknown as ReadableStream<Uint8Array>,
		stderr: proc.stderr as unknown as ReadableStream<Uint8Array>,
		exited: proc.exited,
		label,
	};
}
