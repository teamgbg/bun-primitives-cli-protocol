/**
 * @system cli-session
 * @status handwritten
 * @edit edit directly
 *
 * Type exports for http-sse transport.
 */

import type { ParsedEvent } from "@teamscala/session-contracts/types";

export type ParseOpenCodeEventFn = (event: unknown) => ParsedEvent | null;
