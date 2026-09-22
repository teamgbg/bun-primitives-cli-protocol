/**
 * @system cli-session
 * @status handwritten
 * @edit edit directly
 *
 * Spawns a long-lived stdio child process for stream-json CLIs.
 */

import { spawnRaw } from "@teamscala/os/spawn/spawn";
import type { StdioStreamJsonConfig } from "@teamscala/session-contracts/types";

export interface SpawnedProcess {
	pid: number;
	stdin: { write(data: Uint8Array): void; close(): void };
	stderr: ReadableStream<Uint8Array>;
	stdout: ReadableStream<Uint8Array>;
	exited: Promise<number>;
	label: string;
}

export function spawnStdioProcess(
	spec: StdioStreamJsonConfig,
	workdir: string,
	extraEnv: Record<string, string> = {},
): SpawnedProcess {
	const args = [...spec.args];
	const label = `scala-orch-${spec.binary}`;
	const proc = spawnRaw({
		name: label,
		command: ["bash", "-c", 'exec -a "$0" "$@"', label, spec.binary, ...args],
		cwd: workdir,
		env: Object.fromEntries(Object.entries({ ...process.env, ...extraEnv }).filter(([, v]) => v !== undefined)) as Record<string, string>,
	});
	return {
		pid: proc.pid,
		stdin: proc.stdin as unknown as SpawnedProcess["stdin"],
		stderr: proc.stderr as unknown as ReadableStream<Uint8Array>,
		stdout: proc.stdout as unknown as ReadableStream<Uint8Array>,
		exited: proc.exited,
		label,
	};
}
