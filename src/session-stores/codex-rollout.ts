/**
 * @system cli-session
 * @status handwritten
 * @edit edit directly
 *
 * Session store for Codex CLI rollout files.
 * Codex stores sessions at ~/.codex/sessions/<Y>/<M>/<D>/rollout-*<SESSION_ID>.jsonl.
 * Uses glob to locate the file by session ID suffix.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { userHome } from "@teamscala/os/host-paths";
import type { SessionStore } from "@teamscala/session-contracts/types";

const CODEX_SESSIONS_ROOT = join(
	process.env.HOME ?? `${userHome()}`,
	".codex",
	"sessions",
);

export const codexRolloutStore: SessionStore = {
	exists(workdir: string, sessionId: string): boolean {
		return codexRolloutStore.path(workdir, sessionId) !== "";
	},
	path(_workdir: string, sessionId: string): string {
		const found = findRolloutFile(sessionId);
		return found ?? "";
	},
};

function findRolloutFile(sessionId: string): string | null {
	if (!existsSync(CODEX_SESSIONS_ROOT)) return null;

	const today = new Date();
	const year = String(today.getFullYear());
	const month = String(today.getMonth() + 1).padStart(2, "0");
	const day = String(today.getDate()).padStart(2, "0");

	const todayDir = join(CODEX_SESSIONS_ROOT, year, month, day);
	const found = searchDir(todayDir, sessionId);
	if (found) return found;

	for (let d = 1; d <= 30; d++) {
		const past = new Date(today.getTime() - d * 86400000);
		const py = String(past.getFullYear());
		const pm = String(past.getMonth() + 1).padStart(2, "0");
		const pd = String(past.getDate()).padStart(2, "0");
		const dir = join(CODEX_SESSIONS_ROOT, py, pm, pd);
		const result = searchDir(dir, sessionId);
		if (result) return result;
	}

	return null;
}

function searchDir(dir: string, sessionId: string): string | null {
	if (!existsSync(dir)) return null;
	try {
		const entries = readdirSync(dir, "utf-8");
		for (const entry of entries) {
			if (entry.includes(sessionId)) {
			return join(dir, entry);
			}
		}
	} catch {}
	return null;
}
