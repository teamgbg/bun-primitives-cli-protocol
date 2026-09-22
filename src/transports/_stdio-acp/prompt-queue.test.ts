// @system codegen
// @status generated
// @edit change the suite in the owned-suites band, then re-run codegen. Hand-edits are overwritten.
//
// This suite's assertions are OWNED by the codegen band: the band module
// carries them verbatim, this file is the emission, and hand edits here are
// overwritten on the next run. The rationale each assertion carries moved
// with it into the band.

import { expect, test } from "bun:test";
import { createPromptQueue } from "./prompt-queue.ts";

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

test("accepts a written prompt before its terminal ACP response settles", async () => {
	const terminal = deferred<void>();
	const started: string[] = [];
	const queue = createPromptQueue({
		start(prompt) {
			started.push(prompt);
			return terminal.promise;
		},
		onTerminalFailure() {},
	});

	let accepted = false;
	void queue.enqueue("long turn").then(() => {
		accepted = true;
	});
	await flushMicrotasks();

	expect(started).toEqual(["long turn"]);
	expect(accepted).toBe(true);

	terminal.resolve();
	await flushMicrotasks();
});

test("queues a second prompt until the active turn settles, then accepts it when written", async () => {
	const first = deferred<void>();
	const second = deferred<void>();
	const terminals = [first, second];
	const started: string[] = [];
	const queue = createPromptQueue({
		start(prompt) {
			started.push(prompt);
			return terminals[started.length - 1]!.promise;
		},
		onTerminalFailure() {},
	});

	await queue.enqueue("first");
	let secondAccepted = false;
	void queue.enqueue("second").then(() => {
		secondAccepted = true;
	});
	await flushMicrotasks();

	expect(started).toEqual(["first"]);
	expect(secondAccepted).toBe(false);

	first.resolve();
	await flushMicrotasks();

	expect(started).toEqual(["first", "second"]);
	expect(secondAccepted).toBe(true);

	second.resolve();
	await flushMicrotasks();
});

test("a 120000ms terminal deadline is evidence and does not poison the next prompt", async () => {
	const first = deferred<void>();
	const second = deferred<void>();
	const terminals = [first, second];
	const failures: unknown[] = [];
	const started: string[] = [];
	const queue = createPromptQueue({
		start(prompt) {
			started.push(prompt);
			return terminals[started.length - 1]!.promise;
		},
		onTerminalFailure(error) {
			failures.push(error);
		},
	});

	await queue.enqueue("first");
	const secondAccepted = queue.enqueue("second");
	first.reject(new Error("RPC timed out after 120000ms"));
	await secondAccepted;

	expect(failures).toHaveLength(1);
	expect((failures[0] as Error).message).toBe("RPC timed out after 120000ms");
	expect(started).toEqual(["first", "second"]);

	second.resolve();
	await flushMicrotasks();
});

test("closing rejects prompts that have not yet been written", async () => {
	const terminal = deferred<void>();
	const queue = createPromptQueue({
		start() {
			return terminal.promise;
		},
		onTerminalFailure() {},
	});

	await queue.enqueue("first");
	const queued = queue.enqueue("second");
	queue.close();

	expect(queued).rejects.toThrow("ACP prompt queue is closed");
	terminal.resolve();
	await flushMicrotasks();
});

test("waitForIdle preserves operations that require terminal completion", async () => {
	const terminal = deferred<void>();
	const queue = createPromptQueue({
		start() {
			return terminal.promise;
		},
		onTerminalFailure() {},
	});

	await queue.enqueue("compact");
	let idle = false;
	void queue.waitForIdle().then(() => {
		idle = true;
	});
	await flushMicrotasks();
	expect(idle).toBe(false);

	terminal.resolve();
	await queue.waitForIdle();
	expect(idle).toBe(true);
});
