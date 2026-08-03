// PROTOTYPE — throwaway TUI exploration for issue #12.
// Question: can a sparse, full-screen current-session control center make a run and its graph obvious at a glance?
// Run with `/subagents-prototype`; all state is in memory and intentionally fake.

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type Tab = "runs" | "settings";
type State = "working" | "queued" | "complete";
type Agent = {
	name: string;
	definition: string;
	state: State;
	progress: string;
	context: string;
	cost: string;
	model: string;
	reasoning: "medium" | "high";
};

type Snapshot = { tab: Tab; selected: number; agents: Agent[] };
type Action = { type: "close" } | { type: "tab" } | { type: "move"; offset: -1 | 1 } | { type: "reasoning" } | { type: "open" };

function initialAgents(): Agent[] {
	return [
		{ name: "FastAPI exploration", definition: "architecture-scout", state: "complete", progress: "18k · $0.22", context: "18k", cost: "$0.22", model: "gpt-5.6", reasoning: "high" },
		{ name: "Backend implementer", definition: "implementation-worker", state: "working", progress: "42k · $0.71", context: "42k", cost: "$0.71", model: "gpt-5.6", reasoning: "medium" },
		{ name: "Standards review", definition: "standards-reviewer", state: "queued", progress: "—", context: "—", cost: "—", model: "gpt-5.6", reasoning: "high" },
		{ name: "Spec review", definition: "spec-reviewer", state: "queued", progress: "—", context: "—", cost: "—", model: "gpt-5.6", reasoning: "high" },
	];
}

class ControlCenterPrototype {
	private tab: Tab;
	private selected: number;
	private readonly agents: Agent[];

	constructor(private readonly theme: Theme, private readonly done: (action: Action) => void, snapshot?: Snapshot) {
		this.tab = snapshot?.tab ?? "runs";
		this.selected = snapshot?.selected ?? 1;
		this.agents = snapshot?.agents ?? initialAgents();
	}

	snapshot(): Snapshot { return { tab: this.tab, selected: this.selected, agents: this.agents }; }

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape)) return this.done({ type: "close" });
		if (matchesKey(data, Key.tab) || matchesKey(data, Key.left) || matchesKey(data, Key.right) || data === "h" || data === "l") return this.done({ type: "tab" });
		if (matchesKey(data, Key.up) || data === "k") return this.done({ type: "move", offset: -1 });
		if (matchesKey(data, Key.down) || data === "j") return this.done({ type: "move", offset: 1 });
		if (data === "r" && this.tab === "settings") return this.done({ type: "reasoning" });
		if (matchesKey(data, Key.enter)) return this.done({ type: "open" });
	}

	apply(action: Action): void {
		if (action.type === "tab") this.tab = this.tab === "runs" ? "settings" : "runs";
		if (action.type === "move") this.selected = (this.selected + action.offset + this.agents.length) % this.agents.length;
		if (action.type === "reasoning") this.agent.reasoning = this.agent.reasoning === "medium" ? "high" : "medium";
	}

	render(width: number): string[] {
		const inner = Math.max(56, width - 2);
		const lines = [
			this.theme.fg("borderAccent", `╭${"─".repeat(inner)}╮`),
			this.line(inner, ` ${this.theme.fg("accent", this.theme.bold("SUBAGENTS"))}   ${this.tabLabel("runs", "Runs")}   ${this.tabLabel("settings", "Settings")}`),
			this.line(inner),
		];
		lines.push(...(this.tab === "runs" ? this.runs(inner) : this.settings(inner)));
		lines.push(this.line(inner));
		lines.push(this.line(inner, this.tab === "runs"
			? ` ${this.theme.fg("dim", "↑↓/jk select · enter open child conversation · tab/←→ settings · esc close")}`
			: ` ${this.theme.fg("dim", "↑↓/jk select · r change reasoning · tab/←→ runs · esc close")}`));
		lines.push(this.theme.fg("borderAccent", `╰${"─".repeat(inner)}╯`));
		return lines;
	}

	private get agent(): Agent { return this.agents[this.selected]!; }

	private tabLabel(tab: Tab, label: string): string {
		return tab === this.tab ? this.theme.fg("text", this.theme.bold(`[ ${label} ]`)) : this.theme.fg("dim", label);
	}

	private runs(width: number): string[] {
		const left = Math.max(42, Math.floor(width * 0.39));
		const right = width - left - 3;
		const leftRows = [
			this.theme.fg("muted", "THIS SESSION  ·  5 agents  ·  1 working  ·  $0.93"),
			"",
			...this.agents.map((agent) => this.agentRow(agent, left)),
		];
		const graphRows = this.graph(right);
		const rows = Math.max(leftRows.length, graphRows.length);
		const lines: string[] = [];
		for (let index = 0; index < rows; index++) {
			const lhs = this.pad(leftRows[index] ?? "", left);
			const rhs = graphRows[index] ?? "";
			lines.push(this.line(width, ` ${lhs} ${this.theme.fg("border", "│")} ${rhs}`));
		}
		return lines;
	}

	private agentRow(agent: Agent, width: number): string {
		const selected = agent === this.agent;
		const prefix = selected ? this.theme.fg("accent", "›") : " ";
		const name = this.theme.fg(selected ? "text" : "muted", selected ? this.theme.bold(agent.name) : agent.name);
		const definition = this.theme.fg("dim", agent.definition);
		const detail = this.theme.fg("dim", agent.progress);
		return truncateToWidth(`${prefix} ${this.dot(agent.state)} ${name}  ${definition}  ${detail}`, width, "…");
	}

	private graph(width: number): string[] {
		const box = (name: string, state: State, selected = false) => {
			const label = `${this.dot(state)} ${name}`;
			return this.theme.fg(selected ? "accent" : "border", `╭${"─".repeat(Math.max(12, visibleWidth(label) + 2))}╮`) + "\n"
				+ this.theme.fg(selected ? "accent" : "border", "│") + ` ${label} ` + this.theme.fg(selected ? "accent" : "border", "│") + "\n"
				+ this.theme.fg(selected ? "accent" : "border", `╰${"─".repeat(Math.max(12, visibleWidth(label) + 2))}╯`);
		};
		const scout = box("Scout", "complete", this.selected === 0).split("\n");
		const work = box("Implement", "working", this.selected === 1).split("\n");
		const standards = box("Standards", "queued", this.selected === 2).split("\n");
		const spec = box("Spec", "queued", this.selected === 3).split("\n");

		const indent = (text: string, amount: number) => " ".repeat(amount) + text;
		return [
			this.theme.fg("muted", "RUN GRAPH"),
			...scout.map((line) => indent(line, 4)),
			indent(this.theme.fg("dim", "      │"), 4),
			...work.map((line) => indent(line, 4)),
			indent(this.theme.fg("dim", "   ┌──┴──┐"), 4),
			...standards.map((line, index) => `${indent(line, 0)}    ${spec[index] ?? ""}`),
			indent(this.theme.fg("dim", "   └──┬──┘"), 4),
			indent(this.theme.fg("dim", "   results return to parent"), 4),
		].map((line) => truncateToWidth(line, width, "…"));
	}

	private settings(width: number): string[] {
		const lines = [
			this.theme.fg("muted", "USER DEFAULTS"),
			this.theme.fg("dim", "Model and reasoning apply when the parent launches this role."),
			"",
			...this.agents.map((agent) => {
				const selected = agent === this.agent;
				const marker = selected ? this.theme.fg("accent", "›") : " ";
				return `${marker} ${this.theme.fg(selected ? "text" : "muted", selected ? this.theme.bold(agent.name) : agent.name)}  ${this.theme.fg("dim", agent.definition)}  ${this.theme.fg("accent", `${agent.model} · ${agent.reasoning}`)}`;
			}),
			"",
			this.theme.fg("dim", `Selected definition: agents/${this.agent.definition}.md  ·  Enter edits its model, then reasoning.`),
			this.theme.fg("dim", "To add an agent definition, add a definition file. It will appear here."),
		];
		return lines.map((line) => this.line(width, ` ${line}`));
	}

	private dot(state: State): string {
		const color: Record<State, "accent" | "warning" | "success"> = { working: "accent", queued: "warning", complete: "success" };
		const symbol: Record<State, string> = { working: "●", queued: "○", complete: "●" };
		return this.theme.fg(color[state], symbol[state]);
	}

	private line(width: number, text = ""): string {
		const clipped = truncateToWidth(text, width, "…");
		return this.theme.fg("border", "│") + clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped))) + this.theme.fg("border", "│");
	}

	private pad(value: string, width: number): string {
		const clipped = truncateToWidth(value, width, "…");
		return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
	}
}

async function openPrototype(ctx: ExtensionContext): Promise<void> {
	if (ctx.mode !== "tui") {
		ctx.ui.notify("The subagent prototype requires TUI mode.", "error");
		return;
	}
	let open = true;
	let state: Snapshot | undefined;
	while (open) {
		let prototype: ControlCenterPrototype | undefined;
		const action = await ctx.ui.custom<Action>((tui, theme, _keybindings, done) => {
			prototype = new ControlCenterPrototype(theme, done, state);
			return {
				render: (width) => prototype!.render(width),
				invalidate: () => {},
				handleInput: (data) => { prototype!.handleInput(data); tui.requestRender(); },
			};
		}, { overlay: true, overlayOptions: { width: "100%", minWidth: 56, maxHeight: "100%", anchor: "center", margin: 0 } });
		if (!action || action.type === "close") break;
		if (action.type === "open") {
			const snapshot = prototype!.snapshot();
			const agent = snapshot.agents[snapshot.selected]!;
			if (snapshot.tab === "runs") {
				ctx.ui.notify(`Prototype: Enter would open ${agent.name}'s conversation.`, "info");
			} else {
				const model = await ctx.ui.select("Model (scoped models)", ["openai/gpt-5.6", "openai/gpt-5.4-mini"]);
				if (model) {
					const reasoning = await ctx.ui.select("Reasoning effort", ["medium", "high"]);
					if (reasoning === "medium" || reasoning === "high") {
						agent.model = model.replace("openai/", "");
						agent.reasoning = reasoning;
					}
				}
			}
			state = snapshot;
			continue;
		}
		prototype!.apply(action);
		state = prototype!.snapshot();
	}
}

export default function subagentFleetPrototype(pi: ExtensionAPI): void {
	pi.registerCommand("subagents-prototype", {
		description: "Open the throwaway subagent control-center prototype",
		handler: async (_args, ctx) => openPrototype(ctx),
	});
}
