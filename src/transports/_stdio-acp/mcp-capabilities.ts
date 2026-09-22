/**
 * @system cli-session
 * @status handwritten
 * @edit edit directly
 *
 * Enforces ACP's advertised transport capabilities before session setup.
 */

import type { AcpHttpServer } from "@teamscala/mcp-client-pool/resolve-acp-session-server";

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

export function requireAcpMcpCapabilities(
	initializeResult: unknown,
	servers: AcpHttpServer[],
): void {
	if (servers.length === 0) return;
	const capabilities = record(record(initializeResult).agentCapabilities);
	const mcpCapabilities = record(capabilities.mcpCapabilities);
	if (mcpCapabilities.http !== true) {
		throw new Error(
			"ACP agent does not advertise the required HTTP MCP transport",
		);
	}
}
