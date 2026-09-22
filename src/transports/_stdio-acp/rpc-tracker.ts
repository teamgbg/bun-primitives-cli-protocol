/**
 * @system cli-session
 * @status handwritten
 * @edit edit directly
 *
 * Manages pending ACP JSON-RPC requests and timeouts.
 */

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (err: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

export function makeRpcTracker() {
	let rpcId = 0;
	const pending = new Map<number, PendingRequest>();

	function nextId(): number {
		return ++rpcId;
	}

	function addRequest(
		id: number,
		resolve: (value: unknown) => void,
		reject: (err: Error) => void,
		timeoutMs: number,
	): void {
		const timer = setTimeout(() => {
			pending.delete(id);
			reject(new Error(`RPC timed out after ${timeoutMs}ms`));
		}, timeoutMs);
		pending.set(id, { resolve, reject, timer });
	}

	function resolveRequest(id: number, result: unknown): void {
		const req = pending.get(id);
		if (!req) return;
		clearTimeout(req.timer);
		pending.delete(id);
		req.resolve(result);
	}

	function rejectRequest(id: number, errMsg: string): void {
		const req = pending.get(id);
		if (!req) return;
		clearTimeout(req.timer);
		pending.delete(id);
		req.reject(new Error(errMsg));
	}

	function resolveResponse(obj: {
		id: number;
		result?: unknown;
		error?: { message?: string };
	}): boolean {
		const req = pending.get(obj.id);
		if (!req) return false;
		clearTimeout(req.timer);
		pending.delete(obj.id);
		if (obj.error) {
			req.reject(
				new Error(
					String((obj.error as Record<string, unknown>).message ?? "RPC error"),
				),
			);
		} else {
			req.resolve(obj.result);
		}
		return true;
	}

	return {
		nextId,
		addRequest,
		resolveRequest,
		rejectRequest,
		resolveResponse,
		pending,
	};
}

export type RpcTracker = ReturnType<typeof makeRpcTracker>;
