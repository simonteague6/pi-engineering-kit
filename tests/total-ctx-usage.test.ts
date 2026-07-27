import { describe, expect, test } from "bun:test";
import totalContextUsage from "../extensions/total-ctx-usage.ts";

type TurnEndHandler = (event: unknown, ctx: unknown) => unknown;

function createHarness(tokens: number | null | undefined) {
	let turnEnd: TurnEndHandler | undefined;
	const statusCalls: Array<{ key: string; value: string | undefined }> = [];
	const pi = {
		on(event: string, handler: TurnEndHandler) {
		if (event === "turn_end") turnEnd = handler;
		},
	};
	const ctx = {
		getContextUsage: () => tokens === undefined ? undefined : { tokens },
		ui: {
			setStatus(key: string, value: string | undefined) {
				statusCalls.push({ key, value });
			},
		},
	};

	totalContextUsage(pi as never);
	return { turnEnd: turnEnd!, ctx, statusCalls };
}

describe("total context usage", () => {
	test.each([
		[0, "ctx 0k"],
		[999, "ctx 0k"],
		[1_999, "ctx 1k"],
		[117_999, "ctx 117k"],
	])("displays floored thousands for %i tokens", (tokens, expected) => {
		const { turnEnd, ctx, statusCalls } = createHarness(tokens);

		turnEnd({ turnIndex: 0 }, ctx);

		expect(statusCalls).toEqual([{ key: "total-ctx-usage", value: expected }]);
	});

	test.each([null, undefined])("clears the status when usage is %p", (tokens) => {
		const { turnEnd, ctx, statusCalls } = createHarness(tokens);

		turnEnd({ turnIndex: 0 }, ctx);

		expect(statusCalls).toEqual([{ key: "total-ctx-usage", value: undefined }]);
	});
});
