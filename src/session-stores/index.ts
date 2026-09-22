/**
 * @system cli-session
 * @status handwritten
 * @edit edit directly
 *
 * Session store registry. Maps store_id strings to their SessionStore implementations.
 */

import type { SessionStore } from "@teamscala/session-contracts/types";
import { claudeProjectsStore } from "./claude-projects";
import { codexRolloutStore } from "./codex-rollout";

export const SESSION_STORES: Record<string, SessionStore> = {
	"claude-projects": claudeProjectsStore,
	"codex-rollout": codexRolloutStore,
};
