import { spawn } from "node:child_process";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

interface CodeBlock {
	body: string;
	language: string;
	lineCount: number;
	turn: number;
	preview: string;
}

type PickerResult = { type: "copied"; block: CodeBlock } | { type: "cancelled" };

function lineCount(body: string): number {
	if (body.length === 0) return 0;
	const lines = body.split(/\r?\n/);
	return lines.at(-1) === "" ? lines.length - 1 : lines.length;
}

function firstNonblankLine(body: string): string {
	return body.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? "(blank)";
}

function extractCodeBlocks(text: string, turn: number): CodeBlock[] {
	const blocks: CodeBlock[] = [];
	const openingFence = /^(?<fence>`{3,}|~{3,})[ \t]*(?<info>[^\r\n]*)\r?\n/gm;
	let opening: RegExpExecArray | null;

	while ((opening = openingFence.exec(text))) {
		const fence = opening.groups?.fence;
		if (!fence) continue;
		const closingFence = new RegExp(`^${fence[0]}{${fence.length},}[ \\t]*(?:\\r?\\n|$)`, "gm");
		closingFence.lastIndex = openingFence.lastIndex;
		const closing = closingFence.exec(text);
		if (!closing) break;

		const body = text.slice(openingFence.lastIndex, closing.index);
		const language = opening.groups?.info?.trim().split(/\s+/, 1)[0] || "plain text";
		blocks.push({ body, language, lineCount: lineCount(body), turn, preview: firstNonblankLine(body) });
		openingFence.lastIndex = closing.index + closing[0].length;
	}

	return blocks;
}

function collectCodeBlocks(ctx: ExtensionContext): CodeBlock[] {
	const blocks: CodeBlock[] = [];
	let turn = 0;

	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message") continue;
		if (entry.message.role === "user") {
			turn++;
			continue;
		}
		if (entry.message.role !== "assistant") continue;
		for (const content of entry.message.content) {
			if (content.type === "text") blocks.push(...extractCodeBlocks(content.text, turn));
		}
	}

	return blocks;
}

function runClipboardCommand(command: string, args: readonly string[], input: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: ["pipe", "ignore", "pipe"] });
		let stderr = "";
		child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) resolve();
			else reject(new Error(stderr.trim() || `${command} exited with status ${code ?? "unknown"}`));
		});
		child.stdin.end(input);
	});
}

/** Non-macOS clipboard backends are intentionally untested. */
async function copyToClipboard(text: string): Promise<void> {
	if (process.platform === "darwin") return runClipboardCommand("pbcopy", [], text);
	if (process.platform === "win32") return runClipboardCommand("clip", [], text);

	const failures: string[] = [];
	for (const [command, args] of [["wl-copy", []], ["xclip", ["-selection", "clipboard"]], ["xsel", ["--clipboard", "--input"]]] as const) {
		try {
			await runClipboardCommand(command, args, text);
			return;
		} catch (error) {
			failures.push(`${command}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	throw new Error(`No Linux clipboard backend succeeded (${failures.join("; ")})`);
}

class CodePicker {
	private filter = "";
	private selected = 0;
	private error: string | undefined;
	private copying = false;

	constructor(
		private readonly blocks: CodeBlock[],
		private readonly theme: Theme,
		private readonly done: (result: PickerResult) => void,
		private readonly requestRender: () => void,
	) {}

	private matches(): CodeBlock[] {
		const query = this.filter.toLowerCase();
		return this.blocks.filter((block) =>
			`${block.language} ${block.preview} turn ${block.turn}`.toLowerCase().includes(query),
		);
	}

	private normalizeSelection(): CodeBlock[] {
		const matches = this.matches();
		this.selected = Math.min(this.selected, Math.max(0, matches.length - 1));
		return matches;
	}

	handleInput(data: string): void {
		const matches = this.normalizeSelection();
		if (matchesKey(data, Key.escape)) return this.done({ type: "cancelled" });
		if (matchesKey(data, Key.up)) this.selected = Math.max(0, this.selected - 1);
		else if (matchesKey(data, Key.down)) this.selected = Math.min(matches.length - 1, this.selected + 1);
		else if (matchesKey(data, Key.backspace)) {
			this.filter = this.filter.slice(0, -1);
			this.selected = 0;
		} else if (matchesKey(data, Key.enter) && matches[this.selected] && !this.copying) {
			this.copy(matches[this.selected]!);
		} else if (/^[^\x00-\x1F\x7F]+$/.test(data)) {
			this.filter += data;
			this.selected = 0;
		}
		this.requestRender();
	}

	private async copy(block: CodeBlock): Promise<void> {
		this.copying = true;
		this.error = undefined;
		this.requestRender();
		try {
			await copyToClipboard(block.body);
			this.done({ type: "copied", block });
		} catch (error) {
			this.error = error instanceof Error ? error.message : String(error);
		} finally {
			this.copying = false;
			this.requestRender();
		}
	}

	render(width: number): string[] {
		const inner = Math.max(1, width - 2);
		const line = (content = "") => {
			const clipped = truncateToWidth(content, inner, "…");
			return this.theme.fg("border", "│") + clipped + " ".repeat(Math.max(0, inner - visibleWidth(clipped))) + this.theme.fg("border", "│");
		};
		const matches = this.normalizeSelection();
		const lines = [
			this.theme.fg("borderAccent", `╭${"─".repeat(inner)}╮`),
			line(` ${this.theme.fg("accent", this.theme.bold("Copy code"))}  ${this.theme.fg("dim", `${this.blocks.length} block${this.blocks.length === 1 ? "" : "s"}`)}`),
			line(` ${this.theme.fg("muted", "filter: ")}${this.filter || this.theme.fg("dim", "type to search")}`),
			line(),
		];

		if (matches.length === 0) {
			lines.push(line(` ${this.theme.fg("warning", "No matching code blocks")}`));
		} else {
			const visibleCount = 8;
			const start = Math.max(0, Math.min(this.selected - Math.floor(visibleCount / 2), matches.length - visibleCount));
			if (start > 0) lines.push(line(` ${this.theme.fg("dim", `↑ ${start} more`)}`));
			for (const [offset, block] of matches.slice(start, start + visibleCount).entries()) {
				const selected = start + offset === this.selected;
				const marker = selected ? this.theme.fg("accent", "▶ ") : "  ";
				const metadata = `${block.language} · ${block.lineCount} line${block.lineCount === 1 ? "" : "s"} · turn ${block.turn}`;
				lines.push(line(` ${marker}${selected ? this.theme.bold(metadata) : metadata}`));
				lines.push(line(`    ${this.theme.fg("dim", block.preview)}`));
			}
			if (start + visibleCount < matches.length) lines.push(line(` ${this.theme.fg("dim", `↓ ${matches.length - start - visibleCount} more`)}`));
		}
		if (this.error) lines.push(line(` ${this.theme.fg("error", `Copy failed: ${this.error}`)}`));
		lines.push(line());
		lines.push(line(` ${this.theme.fg("dim", this.copying ? "Copying…" : "↑↓ navigate  enter copy  esc cancel")}`));
		lines.push(this.theme.fg("borderAccent", `╰${"─".repeat(inner)}╯`));
		return lines;
	}

	invalidate(): void {}
}

export default function copyCodeExtension(pi: ExtensionAPI): void {
	pi.registerCommand("copy-code", {
		description: "Copy a fenced code block from an assistant reply",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				const message = "/copy-code requires interactive TUI mode";
				console.error(message);
				ctx.ui.notify(message, "error");
				return;
			}
			const blocks = collectCodeBlocks(ctx);
			if (blocks.length === 0) {
				ctx.ui.notify("No fenced code blocks found in completed assistant replies", "info");
				return;
			}
			const result = await ctx.ui.custom<PickerResult>((tui, theme, _keybindings, done) => {
				const picker = new CodePicker(blocks, theme, done, () => tui.requestRender());
				return {
					render: (width) => picker.render(width),
					invalidate: () => picker.invalidate(),
					handleInput: (data) => picker.handleInput(data),
				};
			}, { overlay: true, overlayOptions: { width: 84, minWidth: 52, maxHeight: "90%", anchor: "center", margin: 1 } });
			if (result?.type === "copied") {
				ctx.ui.notify(`Copied ${result.block.language} (${result.block.lineCount} line${result.block.lineCount === 1 ? "" : "s"})`, "info");
			}
		},
	});
}
