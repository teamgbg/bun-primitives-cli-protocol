/**
 * @system cli-session
 * @status handwritten
 * @edit edit directly
 *
 * Input encoder registry. Each encoder maps a prompt string to the format
 * expected by a specific CLI's stdin protocol.
 */

import type { EncodeInputFn } from "@teamscala/session-contracts/types";

export const INPUT_ENCODERS: Record<string, EncodeInputFn> = {
	"stream-json-user": (prompt: string) => {
		return JSON.stringify({
			type: "user",
			message: {
				role: "user",
				content: prompt,
			},
		});
	},
	"oneshot-arg": (prompt: string) => {
		return prompt;
	},
};
