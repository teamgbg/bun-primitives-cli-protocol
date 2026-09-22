/**
 * @system cli-session
 * @status handwritten
 * @edit edit directly
 *
 * Spawns a oneshot stdio process for Codex exec.
 */

import { spawnRaw } from "@teamscala/os/spawn/spawn";
import type { StdioOneshotJsonlConfig } from "@teamscala/session-contracts/types";

export interface OneshotSpawnResult {
	pid: number;
	stdin: { write(data: Uint8Array): void; close(): void };
	stdout: ReadableStream<Uint8Array>;
	stderr: ReadableStream<Uint8Array>;
	exited: Promise<number>;
	label: string;
}

export function spawnOneshotProcess(
	spec: StdioOneshotJsonlConfig,
	workdir: string,
	args: string[],
	extraEnv: Record<string, string>,
): OneshotSpawnResult {
	const label = `scala-orch-${spec.binary}`;
	const proc = spawnRaw({
		name: label,
		command: ["bash", "-c", 'exec -a "$0" "$@"', label, spec.binary, ...args],
		cwd: workdir,
		env: Object.fromEntries(Object.entries({ ...process.env, ...extraEnv }).filter(([, v]) => v !== undefined)) as Record<string, string>,
	});
	return {
		pid: proc.pid,
		stdin: proc.stdin as unknown as OneshotSpawnResult["stdin"],
		stdout: proc.stdout as unknown as ReadableStream<Uint8Array>,
		stderr: proc.stderr as unknown as ReadableStream<Uint8Array>,
		exited: proc.exited,
		label,
	};
}
