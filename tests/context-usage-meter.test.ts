import { describe, expect, test } from "bun:test";
import contextUsageMeter from "../extensions/context-usage-meter.ts";

type EventHandler = (event: unknown, ctx: unknown) => unknown;
type WidgetContent = string[] | ((tui: unknown, theme: { fg(color: "warning" | "error", text: string): string }) => { render(width: number): string[] }) | undefined;

function createHarness(tokens: number | null | undefined) {
	const handlers = new Map<string, EventHandler>();
	const widgetCalls: Array<{ key: string; content: WidgetContent }> = [];
	const registrations = { commands: 0, shortcuts: 0 };
	const pi = {
		on(event: string, handler: EventHandler) {
			handlers.set(event, handler);
		},
		registerCommand() {
			registrations.commands++;
		},
		registerShortcut() {
			registrations.shortcuts++;
		},
	};
	const ctx = {
		getContextUsage: () => tokens === undefined ? undefined : { tokens, contextWindow: 200_000, percent: null },
		ui: {
			setWidget(key: string, content: WidgetContent) {
				widgetCalls.push({ key, content });
			},
		},
	};

	contextUsageMeter(pi as never);
	return { handlers, widgetCalls, ctx, registrations };
}

function renderedWidget(content: WidgetContent): string | undefined {
	if (!content) return undefined;
	if (Array.isArray(content)) return content.join("\n");
	return content({} as never, { fg: (color, text) => `${color}:${text}` }).render(200).join("\n").trimEnd();
}

describe("context-usage meter", () => {
	test("shows the amber warning after a completed turn at 100k tokens", () => {
		const { handlers, widgetCalls, ctx } = createHarness(100_000);

		handlers.get("turn_end")!({ turnIndex: 0, toolResults: [] }, ctx);

		expect(widgetCalls).toEqual([{ key: "context-usage-meter", content: expect.any(Function) }]);
		expect(renderedWidget(widgetCalls[0]!.content)).toBe(
			"warning:100k · Reasoning quality may be declining · /handoff recommended",
		);
	});

	test.each([
		[99_999, undefined],
		[100_000, "warning:100k · Reasoning quality may be declining · /handoff recommended"],
		[129_999, "warning:129k · Reasoning quality may be declining · /handoff recommended"],
		[130_000, "error:130k · Reasoning quality may be degraded · /handoff now"],
		[130_999, "error:130k · Reasoning quality may be degraded · /handoff now"],
	])("uses the correct boundary state at %i tokens", (tokens, expected) => {
		const { handlers, widgetCalls, ctx } = createHarness(tokens);

		handlers.get("turn_end")!({ turnIndex: 0, toolResults: [] }, ctx);

		expect(renderedWidget(widgetCalls[0]!.content)).toBe(expected);
	});

	test("clears the widget on session start and when usage is unavailable", () => {
		const { handlers, widgetCalls, ctx } = createHarness(null);

		handlers.get("session_start")!({ reason: "new" }, ctx);
		handlers.get("turn_end")!({ turnIndex: 0, toolResults: [] }, ctx);

		expect(widgetCalls).toEqual([
			{ key: "context-usage-meter", content: undefined },
			{ key: "context-usage-meter", content: undefined },
		]);
	});

	test("clears the widget when the context usage object is missing", () => {
		const { handlers, widgetCalls, ctx } = createHarness(undefined);

		handlers.get("turn_end")!({ turnIndex: 0, toolResults: [] }, ctx);

		expect(widgetCalls).toEqual([{ key: "context-usage-meter", content: undefined }]);
	});

	test("updates once at turn end even when the completed turn has tool results", () => {
		const { handlers, widgetCalls, ctx } = createHarness(117_999);

		handlers.get("turn_end")!({ turnIndex: 3, toolResults: [{ toolName: "read" }, { toolName: "bash" }] }, ctx);

		expect(widgetCalls).toHaveLength(1);
		expect(renderedWidget(widgetCalls[0]!.content)).toBe(
			"warning:117k · Reasoning quality may be declining · /handoff recommended",
		);
	});

	test("does not register a handoff command or shortcut", () => {
		const { registrations } = createHarness(100_000);

		expect(registrations).toEqual({ commands: 0, shortcuts: 0 });
	});
});
