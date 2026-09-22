// @system codegen
// @status generated
// @edit change the suite in the owned-suites band, then re-run codegen. Hand-edits are overwritten.
//
// This suite's assertions are OWNED by the codegen band: the band module
// carries them verbatim, this file is the emission, and hand edits here are
// overwritten on the next run. The rationale each assertion carries moved
// with it into the band.

import { expect, test } from "bun:test";
import { requireAcpMcpCapabilities } from "./mcp-capabilities.ts";

const server = {
	type: "http" as const,
	name: "scala-mcp",
	url: "https://mcp.scala.business/mcp",
	headers: [],
};

test("accepts an advertised HTTP MCP transport", () => {
	expect(() =>
		requireAcpMcpCapabilities(
			{ agentCapabilities: { mcpCapabilities: { http: true } } },
			[server],
		),
	).not.toThrow();
});

test("refuses a mission-ready session when HTTP MCP was not advertised", () => {
	expect(() => requireAcpMcpCapabilities({ agentCapabilities: {} }, [server])).toThrow(
		"does not advertise",
	);
});
