/**
 * @system cli-session
 * @status handwritten
 * @edit edit directly
 *
 * Type guards for ACP JSON-RPC parsing — isNotification and isResponse
 * are the discriminator pair for the JsonRpc message union. They narrow
 * to disjoint shapes from the same parent so they share no type anchor
 * by reference-graph, but they are operationally one canonical unit
 * (the JSON-RPC frame classifier).
 */

interface JsonRpcNotification {
	jsonrpc: "2.0";
	method: string;
	params: {
		sessionId: string;
		update: Record<string, unknown>;
		[key: string]: unknown;
	};
}

interface JsonRpcResponse {
	jsonrpc: "2.0";
	id: number;
	result?: Record<string, unknown>;
	error?: { code: number; message: string; data?: unknown };
}

export function isNotification(obj: unknown): obj is JsonRpcNotification {
	const o = obj as Record<string, unknown>;
	return (
		o?.jsonrpc === "2.0" && typeof o?.method === "string" && o?.id === undefined
	);
}

export function isResponse(obj: unknown): obj is JsonRpcResponse {
	const o = obj as Record<string, unknown>;
	return (
		o?.jsonrpc === "2.0" && typeof o?.id === "number" && o?.method === undefined
	);
}
