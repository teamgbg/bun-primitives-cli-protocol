// @system codegen
// @status generated
// @edit change the suite in the owned-suites band, then re-run codegen. Hand-edits are overwritten.
//
// This suite's assertions are OWNED by the codegen band: the band module
// carries them verbatim, this file is the emission, and hand edits here are
// overwritten on the next run. The rationale each assertion carries moved
// with it into the band.

import { expect, mock, test } from "bun:test";
import { createStdioAcpTransport } from "./stdio-acp.ts";

type RpcFrame = {
	id?: number;
	method?: string;
	params?: Record<string, unknown>;
};

let stdoutController!: ReadableStreamDefaultController<Uint8Array>;
const writes: RpcFrame[] = [];
const encoder = new TextEncoder();

function emit(frame: Record<string, unknown>): void {
	stdoutController.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`));
}

const stdin = {
	write(data: Uint8Array) {
		const frame = JSON.parse(new TextDecoder().decode(data)) as RpcFrame;
		writes.push(frame);
		if (frame.method === "initialize") {
			emit({ jsonrpc: "2.0", id: frame.id, result: { agentCapabilities: {} } });
		}
		if (frame.method === "session/new") {
			emit({ jsonrpc: "2.0", id: frame.id, result: { sessionId: "native-session" } });
		}
	},
	flush() {},
	end() {},
};

const spawnAcpProcess = mock(() => ({
	pid: 73,
	stdin,
	stdout: new ReadableStream<Uint8Array>({
		start(controller) {
			stdoutController = controller;
		},
	}),
	stderr: new ReadableStream<Uint8Array>(),
	exited: new Promise<number>(() => {}),
}));

async function flushMicrotasks(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

test("session/prompt delivery does not await its terminal JSON-RPC response", async () => {
	writes.splice(0);
	const events: unknown[] = [];
	const transport = createStdioAcpTransport({
		spec: { kind: "stdio-acp", binary: "/bin/agent", args: ["--acp"] },
		workdir: "/workspace",
		onEvent: (event) => events.push(event),
	}, { spawnProcess: spawnAcpProcess });

	await transport.send("first prompt");
	const first = writes.find(
		(frame) =>
			frame.method === "session/prompt" &&
			(frame.params?.prompt as Array<{ text?: string }> | undefined)?.[0]?.text ===
				"first prompt",
	);
	expect(first?.id).toBeNumber();

	let secondAccepted = false;
	const secondDelivery = transport.send("second prompt").then(() => {
		secondAccepted = true;
	});
	await flushMicrotasks();

	expect(secondAccepted).toBe(false);
	expect(writes.filter((frame) => frame.method === "session/prompt")).toHaveLength(1);

	emit({ jsonrpc: "2.0", id: first!.id, result: { stopReason: "end_turn" } });
	await secondDelivery;

	expect(secondAccepted).toBe(true);
	const prompts = writes.filter((frame) => frame.method === "session/prompt");
	expect(prompts).toHaveLength(2);
	expect(
		(prompts[1]?.params?.prompt as Array<{ text?: string }> | undefined)?.[0]?.text,
	).toBe("second prompt");

	emit({ jsonrpc: "2.0", id: prompts[1]!.id, result: { stopReason: "end_turn" } });
	await flushMicrotasks();
	expect(events.some((event) => (event as { type?: string }).type === "result")).toBe(true);

	transport.close();
	stdoutController.close();
});
