/**
 * @system cli-session
 * @status handwritten
 * @edit edit directly
 *
 * Sends JSON-RPC messages over stdin.
 */

type StdinWriter = {
	write(data: Uint8Array): unknown;
};

export function sendRpc(
	writer: StdinWriter,
	id: number,
	method: string,
	params: object,
): void {
	const msg = `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
	writer.write(new TextEncoder().encode(msg));
}

export function sendNotification(
	writer: StdinWriter,
	method: string,
	params: object,
): void {
	const msg = `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`;
	writer.write(new TextEncoder().encode(msg));
}
