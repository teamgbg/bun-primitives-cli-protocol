/**
 * @system cli-session
 * @status handwritten
 * @edit edit directly
 *
 * Serialises ACP prompts while separating transport acceptance from the later
 * terminal response. An enqueue resolves only when its prompt has actually
 * started; queued prompts remain unresolved and therefore are not recorded as
 * delivered by the work-item comment drain.
 */

type PromptQueueInput = {
	start: (prompt: string) => Promise<void>;
	onTerminalFailure: (error: unknown) => void;
};

type PendingPrompt = {
	prompt: string;
	resolveAccepted: () => void;
	rejectAccepted: (error: unknown) => void;
};

export type PromptQueue = {
	enqueue: (prompt: string) => Promise<void>;
	waitForIdle: () => Promise<void>;
	close: () => void;
	readonly active: boolean;
};

export function createPromptQueue(input: PromptQueueInput): PromptQueue {
	const pending: PendingPrompt[] = [];
	const idleWaiters: Array<() => void> = [];
	let active = false;
	let closed = false;

	const resolveIdleWaiters = (): void => {
		if (active || pending.length > 0) return;
		for (const resolve of idleWaiters.splice(0)) resolve();
	};

	const startNext = (): void => {
		if (closed || active) return;
		const next = pending.shift();
		if (!next) return;

		let terminal: Promise<void>;
		try {
			terminal = input.start(next.prompt);
			active = true;
			next.resolveAccepted();
		} catch (error) {
			next.rejectAccepted(error);
			startNext();
			return;
		}

		void terminal
			.catch((error) => {
				input.onTerminalFailure(error);
			})
			.finally(() => {
				active = false;
				startNext();
				resolveIdleWaiters();
			});
	};

	return {
			enqueue(prompt) {
			if (closed) return Promise.reject(new Error("ACP prompt queue is closed"));
			return new Promise<void>((resolveAccepted, rejectAccepted) => {
				pending.push({ prompt, resolveAccepted, rejectAccepted });
				startNext();
			});
		},
		waitForIdle() {
			if (!active && pending.length === 0) return Promise.resolve();
			return new Promise<void>((resolve) => idleWaiters.push(resolve));
		},
		close() {
			if (closed) return;
			closed = true;
			const error = new Error("ACP prompt queue is closed");
			for (const item of pending.splice(0)) item.rejectAccepted(error);
			resolveIdleWaiters();
		},
		get active() {
			return active;
		},
	};
}
