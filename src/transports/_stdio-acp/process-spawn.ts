/**
 * @system cli-session
 * @status handwritten
 * @edit edit directly
 *
 * Spawns the long-lived ACP child with all three protocol pipes available.
 */

import { spawnRaw } from "@teamscala/os/spawn/spawn";
import type { StdioAcpConfig } from "@teamscala/session-contracts/types";

export interface SpawnedAcpProcess {
	pid: number;
	stdin: { write(data: Uint8Array): unknown; flush(): void; end(): void };
	stdout: ReadableStream<Uint8Array>;
	stderr: ReadableStream<Uint8Array>;
	exited: Promise<number>;
	label: string;
}

export function spawnAcpProcess(
	spec: StdioAcpConfig,
	args: string[],
	workdir: string,
	env: Record<string, string>,
): SpawnedAcpProcess {
	const label = `scala-orch-${spec.binary}`;
	const proc = spawnRaw({
		name: label,
		command: ["bash", "-c", 'exec -a "$0" "$@"', label, spec.binary, ...args],
		cwd: workdir,
		env,
		stdin: "pipe",
	});
	return {
		pid: proc.pid,
		stdin: proc.stdin as unknown as SpawnedAcpProcess["stdin"],
		stdout: proc.stdout as unknown as ReadableStream<Uint8Array>,
		stderr: proc.stderr as unknown as ReadableStream<Uint8Array>,
		exited: proc.exited,
		label,
	};
}
