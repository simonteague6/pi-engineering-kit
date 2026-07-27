import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

const WIDGET_KEY = "context-usage-meter";
const DISPLAY_THRESHOLD = 100_000;
const URGENT_THRESHOLD = 130_000;

function updateMeter(ctx: ExtensionContext): void {
	const tokens = ctx.getContextUsage()?.tokens;
	if (tokens === null || tokens === undefined || tokens < DISPLAY_THRESHOLD) {
		ctx.ui.setWidget(WIDGET_KEY, undefined);
		return;
	}

	const marker = `${Math.floor(tokens / 1_000)}k`;
	const urgent = tokens >= URGENT_THRESHOLD;
	const message = urgent
		? `${marker} · Reasoning quality may be degraded · /handoff now`
		: `${marker} · Reasoning quality may be declining · /handoff recommended`;

	ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => new Text(theme.fg(urgent ? "error" : "warning", message), 0, 0));
}

export default function contextUsageMeter(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setWidget(WIDGET_KEY, undefined);
	});

	pi.on("turn_end", (_event, ctx) => {
		updateMeter(ctx);
	});
}
