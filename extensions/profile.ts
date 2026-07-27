import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
	getAgentDir,
	SettingsManager,
	type ExtensionAPI,
	type ExtensionContext,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
type ProfileColor = "red" | "orange" | "yellow" | "green" | "blue" | "indigo" | "violet" | "cyan" | "pink" | "gray" | "white";
type BuiltinId = "interrogate" | "implement" | "review" | "diagnose";

interface Profile {
	id: string;
	name: string;
	provider: string;
	model: string;
	thinkingLevel: ThinkingLevel;
	color: ProfileColor;
	enabled: boolean;
	builtin: boolean;
}

interface ProfileConfig {
	version: 1;
	order: string[];
	profiles: Record<string, Profile>;
}

interface SessionProfileState {
	activeId: string | null;
}

interface Baseline {
	model: Model<Api> | undefined;
	thinkingLevel: ThinkingLevel;
}

interface PickerAction {
	type: "activate" | "add" | "edit" | "delete" | "toggle" | "color" | "move" | "close";
	id?: string;
	direction?: -1 | 1;
}

const BUILTIN_IDS: BuiltinId[] = ["interrogate", "implement", "review", "diagnose"];
const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
// ROYGBIV first, followed by useful terminal extras.
const COLORS: ProfileColor[] = ["red", "orange", "yellow", "green", "blue", "indigo", "violet", "cyan", "pink", "gray", "white"];
const COLOR_CODES: Record<ProfileColor, number> = {
	red: 203,
	orange: 208,
	yellow: 220,
	green: 114,
	blue: 75,
	indigo: 63,
	violet: 135,
	cyan: 81,
	pink: 205,
	gray: 245,
	white: 255,
};
const CONFIG_PATH = join(getAgentDir(), "profiles.json");
const STATE_ENTRY = "profile-state";
const STATUS_KEY = "profile";

const BUILTIN_META: Record<BuiltinId, Pick<Profile, "name" | "thinkingLevel" | "color">> = {
	interrogate: { name: "Interrogate", thinkingLevel: "high", color: "blue" },
	implement: { name: "Implement", thinkingLevel: "medium", color: "green" },
	review: { name: "Review", thinkingLevel: "high", color: "violet" },
	diagnose: { name: "Diagnose", thinkingLevel: "xhigh", color: "red" },
};

function createDefaultConfig(provider: string, model: string): ProfileConfig {
	const profiles: Record<string, Profile> = {};
	for (const id of BUILTIN_IDS) {
		profiles[id] = {
			id,
			...BUILTIN_META[id],
			provider,
			model,
			enabled: true,
			builtin: true,
		};
	}
	return { version: 1, order: [...BUILTIN_IDS], profiles };
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
	return typeof value === "string" && THINKING_LEVELS.includes(value as ThinkingLevel);
}

function isColor(value: unknown): value is ProfileColor {
	return typeof value === "string" && COLORS.includes(value as ProfileColor);
}

function normalizeColor(value: unknown, fallback: ProfileColor): ProfileColor {
	if (isColor(value)) return value;
	const legacyColors: Record<string, ProfileColor> = {
		accent: "blue",
		success: "green",
		warning: "yellow",
		error: "red",
		muted: "gray",
		thinkingHigh: "violet",
		syntaxFunction: "violet",
		magenta: "violet",
	};
	return typeof value === "string" ? legacyColors[value] ?? fallback : fallback;
}

function colorText(color: ProfileColor, text: string): string {
	return `\x1b[38;5;${COLOR_CODES[color]}m${text}\x1b[39m`;
}

function sanitizeId(value: string): string {
	return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

function loadConfig(provider: string, model: string): ProfileConfig {
	const fallback = createDefaultConfig(provider, model);
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
	} catch {
		return fallback;
	}

	if (!raw || typeof raw !== "object") return fallback;
	const source = raw as Partial<ProfileConfig>;
	const profiles: Record<string, Profile> = {};
	const sourceProfiles = source.profiles && typeof source.profiles === "object" ? source.profiles : {};

	for (const id of BUILTIN_IDS) {
		const candidate = sourceProfiles[id] as Partial<Profile> | undefined;
		profiles[id] = {
			...fallback.profiles[id]!,
			provider: typeof candidate?.provider === "string" ? candidate.provider : provider,
			model: typeof candidate?.model === "string" ? candidate.model : model,
			thinkingLevel: isThinkingLevel(candidate?.thinkingLevel)
				? candidate.thinkingLevel
				: BUILTIN_META[id].thinkingLevel,
			color: normalizeColor(candidate?.color, BUILTIN_META[id].color),
			enabled: typeof candidate?.enabled === "boolean" ? candidate.enabled : true,
		};
	}

	for (const [key, value] of Object.entries(sourceProfiles)) {
		if (BUILTIN_IDS.includes(key as BuiltinId) || !value || typeof value !== "object") continue;
		const candidate = value as Partial<Profile>;
		const id = sanitizeId(typeof candidate.id === "string" ? candidate.id : key);
		if (
			!id ||
			typeof candidate.name !== "string" ||
			typeof candidate.provider !== "string" ||
			typeof candidate.model !== "string" ||
			!isThinkingLevel(candidate.thinkingLevel)
		) continue;
		profiles[id] = {
			id,
			name: candidate.name,
			provider: candidate.provider,
			model: candidate.model,
			thinkingLevel: candidate.thinkingLevel,
			color: normalizeColor(candidate.color, "gray"),
			enabled: typeof candidate.enabled === "boolean" ? candidate.enabled : true,
			builtin: false,
		};
	}

	const requestedOrder = Array.isArray(source.order) ? source.order.filter((id): id is string => typeof id === "string") : [];
	const order = [...new Set([...requestedOrder.filter((id) => profiles[id]), ...BUILTIN_IDS, ...Object.keys(profiles)])];
	return { version: 1, order, profiles };
}

function saveConfig(config: ProfileConfig): void {
	mkdirSync(dirname(CONFIG_PATH), { recursive: true });
	const temporaryPath = `${CONFIG_PATH}.tmp`;
	writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
	renameSync(temporaryPath, CONFIG_PATH);
}

function splitModel(value: string): { provider: string; model: string } | undefined {
	const slash = value.indexOf("/");
	if (slash <= 0 || slash === value.length - 1) return undefined;
	return { provider: value.slice(0, slash), model: value.slice(slash + 1) };
}

function titleCase(value: string): string {
	return value.length > 0 ? value[0]!.toUpperCase() + value.slice(1) : value;
}

class ProfilePicker {
	private selected: number;

	constructor(
		private readonly config: ProfileConfig,
		private readonly activeId: string | undefined,
		selectedId: string | undefined,
		private readonly theme: Theme,
		private readonly done: (action: PickerAction) => void,
	) {
		this.selected = Math.max(0, this.items().findIndex((id) => id === selectedId));
	}

	private items(): Array<string | undefined> {
		return [undefined, ...this.config.order];
	}

	handleInput(data: string): void {
		const items = this.items();
		const id = items[this.selected];
		if (matchesKey(data, Key.escape)) return this.done({ type: "close" });
		if (matchesKey(data, Key.up)) this.selected = Math.max(0, this.selected - 1);
		else if (matchesKey(data, Key.down)) this.selected = Math.min(items.length - 1, this.selected + 1);
		else if (matchesKey(data, Key.enter)) this.done({ type: "activate", id });
		else if (matchesKey(data, Key.space) && id) this.done({ type: "toggle", id });
		else if (matchesKey(data, Key.alt("up")) && id) this.done({ type: "move", id, direction: -1 });
		else if (matchesKey(data, Key.alt("down")) && id) this.done({ type: "move", id, direction: 1 });
		else if (data.toLowerCase() === "c" && id) this.done({ type: "color", id });
		else if (data.toLowerCase() === "a") this.done({ type: "add" });
		else if (data.toLowerCase() === "e" && id) this.done({ type: "edit", id });
		else if ((data.toLowerCase() === "d" || matchesKey(data, Key.delete)) && id) this.done({ type: "delete", id });
	}

	render(width: number): string[] {
		const th = this.theme;
		const inner = Math.max(1, width - 2);
		const line = (content = "") => {
			const clipped = truncateToWidth(content, inner, "…");
			return th.fg("border", "│") + clipped + " ".repeat(Math.max(0, inner - visibleWidth(clipped))) + th.fg("border", "│");
		};
		const lines = [
			th.fg("borderAccent", `╭${"─".repeat(inner)}╮`),
			line(` ${th.fg("accent", th.bold("Profiles"))}  ${th.fg("dim", "model + reasoning effort")}`),
			line(` ${th.fg("muted", "Profiles change only model and reasoning effort.")}`),
			line(` ${th.fg("dim", "They do not change prompts, tools, permissions, skills, or behavior.")}`),
			line(),
		];

		const items = this.items();
		const visibleCount = 6;
		const start = Math.max(0, Math.min(this.selected - Math.floor(visibleCount / 2), items.length - visibleCount));
		const visibleItems = items.slice(start, start + visibleCount);
		if (start > 0) lines.push(line(` ${th.fg("dim", `↑ ${start} more`)}`));
		for (const [offset, id] of visibleItems.entries()) {
			const index = start + offset;
			const selected = index === this.selected;
			const prefix = selected ? th.fg("accent", " ▶ ") : "   ";
			if (!id) {
				const active = !this.activeId ? th.fg("success", "●") : " ";
				lines.push(line(`${prefix}${active} ${selected ? th.bold("No profile") : "No profile"}`));
				continue;
			}
			const profile = this.config.profiles[id]!;
			const active = this.activeId === id ? th.fg("success", "●") : " ";
			const dot = colorText(profile.color, "●");
			const nameText = selected ? th.bold(profile.name) : profile.name;
			const name = profile.enabled ? colorText(profile.color, nameText) : th.fg("dim", nameText);
			const disabled = profile.enabled ? "" : th.fg("dim", " [disabled]");
			const builtin = profile.builtin ? th.fg("dim", "  built-in") : "";
			lines.push(line(`${prefix}${active} ${dot} ${name}${disabled}${builtin}`));
			lines.push(line(`       ${th.fg("dim", `${profile.provider}/${profile.model} • ${profile.thinkingLevel}`)}`));
		}

		if (start + visibleItems.length < items.length) {
			lines.push(line(` ${th.fg("dim", `↓ ${items.length - start - visibleItems.length} more`)}`));
		}
		lines.push(line());
		lines.push(line(` ${th.fg("dim", "↑↓ navigate  enter activate  space enable  alt+↑↓ reorder")}`));
		lines.push(line(` ${th.fg("dim", "a add  e edit  c color  d delete custom  esc close")}`));
		lines.push(th.fg("borderAccent", `╰${"─".repeat(inner)}╯`));
		return lines;
	}

	invalidate(): void {}
}

export default function profileExtension(pi: ExtensionAPI) {
	let config: ProfileConfig | undefined;
	let activeId: string | undefined;
	let baseline: Baseline | undefined;
	let applying = false;

	function orderedProfiles(): Profile[] {
		if (!config) return [];
		return config.order.map((id) => config!.profiles[id]).filter((profile): profile is Profile => Boolean(profile));
	}

	function updateStatus(ctx: ExtensionContext): void {
		const profile = activeId && config?.profiles[activeId];
		ctx.ui.setStatus(STATUS_KEY, profile ? colorText(profile.color, `● ${profile.name}`) : undefined);
	}

	function persistActive(): void {
		pi.appendEntry<SessionProfileState>(STATE_ENTRY, { activeId: activeId ?? null });
	}

	async function activate(id: string | undefined, ctx: ExtensionContext, persist = true): Promise<boolean> {
		if (!config) return false;
		if (!id) {
			applying = true;
			try {
				if (baseline?.model) await pi.setModel(baseline.model);
				if (baseline) pi.setThinkingLevel(baseline.thinkingLevel);
				activeId = undefined;
			} finally {
				applying = false;
			}
			if (persist) persistActive();
			updateStatus(ctx);
			return true;
		}

		const profile = config.profiles[id];
		if (!profile) {
			ctx.ui.notify(`Unknown profile "${id}"`, "error");
			return false;
		}
		if (!profile.enabled) {
			ctx.ui.notify(`Profile "${profile.name}" is disabled`, "warning");
			return false;
		}
		const model = ctx.modelRegistry.find(profile.provider, profile.model);
		if (!model) {
			ctx.ui.notify(`Profile "${profile.name}": model ${profile.provider}/${profile.model} was not found`, "error");
			return false;
		}
		baseline ??= { model: ctx.model, thinkingLevel: pi.getThinkingLevel() };
		applying = true;
		try {
			if (!(await pi.setModel(model))) {
				ctx.ui.notify(`Profile "${profile.name}": no authentication for ${profile.provider}/${profile.model}`, "error");
				return false;
			}
			pi.setThinkingLevel(profile.thinkingLevel);
			activeId = id;
		} finally {
			applying = false;
		}
		if (persist) persistActive();
		updateStatus(ctx);
		return true;
	}

	function moveProfile(id: string, direction: -1 | 1): void {
		if (!config) return;
		const from = config.order.indexOf(id);
		const to = from + direction;
		if (from < 0 || to < 0 || to >= config.order.length) return;
		[config.order[from], config.order[to]] = [config.order[to]!, config.order[from]!];
		saveConfig(config);
	}

	function cycleColor(id: string): void {
		const profile = config?.profiles[id];
		if (!profile || !config) return;
		profile.color = COLORS[(COLORS.indexOf(profile.color) + 1) % COLORS.length]!;
		saveConfig(config);
	}

	function getScopedModelNames(ctx: ExtensionContext): string[] {
		const settings = SettingsManager.create(ctx.cwd, getAgentDir(), { projectTrusted: ctx.isProjectTrusted() });
		const patterns = settings.getEnabledModels() ?? [];
		if (patterns.length === 0) return [];

		const available = ctx.modelRegistry.getAvailable();
		const selected: string[] = [];
		for (const rawPattern of patterns) {
			const parts = rawPattern.split(":");
			if (isThinkingLevel(parts.at(-1))) parts.pop();
			const pattern = parts.join(":").toLowerCase();
			const hasWildcard = pattern.includes("*") || pattern.includes("?");
			const wildcard = hasWildcard
				? new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i")
				: undefined;

			for (const model of available) {
				const canonical = `${model.provider}/${model.id}`;
				const fields = [canonical, model.id, model.name ?? ""].map((value) => value.toLowerCase());
				const matches = wildcard
					? fields.some((value) => wildcard.test(value))
					: fields.some((value) => value === pattern || value.includes(pattern));
				if (matches && !selected.includes(canonical)) selected.push(canonical);
			}
		}
		return selected;
	}

	async function chooseModel(ctx: ExtensionContext): Promise<{ provider: string; model: string } | undefined> {
		if (!ctx.hasUI) return undefined;
		const values = getScopedModelNames(ctx);
		if (values.length === 0) {
			ctx.ui.notify("No scoped models are available. Configure them with /scoped-models first.", "warning");
			return undefined;
		}
		const selected = await ctx.ui.select("Profile model (scoped models)", values);
		return selected ? splitModel(selected) : undefined;
	}

	async function addProfile(ctx: ExtensionContext, supplied?: { name: string; pair: string; effort: string; color?: string }): Promise<void> {
		if (!config) return;
		let name = supplied?.name;
		if (!name && ctx.hasUI) name = await ctx.ui.input("Profile name", "e.g. fast");
		if (!name) return;
		const id = sanitizeId(name);
		if (!id || config.profiles[id]) {
			ctx.ui.notify(id ? `Profile "${id}" already exists` : "Profile name must contain a letter or number", "error");
			return;
		}

		let pair = supplied?.pair ? splitModel(supplied.pair) : undefined;
		if (!pair) pair = await chooseModel(ctx);
		if (!pair) return;
		if (!ctx.modelRegistry.find(pair.provider, pair.model)) {
			ctx.ui.notify(`Model ${pair.provider}/${pair.model} was not found`, "error");
			return;
		}
		let effort = isThinkingLevel(supplied?.effort) ? supplied.effort : undefined;
		if (!effort && ctx.hasUI) {
			const value = await ctx.ui.select("Reasoning effort", THINKING_LEVELS);
			if (isThinkingLevel(value)) effort = value;
		}
		if (!effort) return;
		let color = isColor(supplied?.color) ? supplied.color : undefined;
		if (!color && ctx.hasUI) {
			const value = await ctx.ui.select("Profile color", COLORS);
			if (isColor(value)) color = value;
		}
		color ??= "gray";
		config.profiles[id] = { id, name: name.trim(), ...pair, thinkingLevel: effort, color, enabled: true, builtin: false };
		config.order.push(id);
		saveConfig(config);
		ctx.ui.notify(`Added profile "${name.trim()}"`, "info");
	}

	async function editProfile(id: string, ctx: ExtensionContext): Promise<void> {
		const profile = config?.profiles[id];
		if (!profile || !config) return;
		const pair = await chooseModel(ctx);
		if (!pair) return;
		const effort = await ctx.ui.select("Reasoning effort", THINKING_LEVELS);
		if (!isThinkingLevel(effort)) return;
		Object.assign(profile, pair, { thinkingLevel: effort });
		saveConfig(config);
		if (activeId === id) await activate(id, ctx);
	}

	async function removeProfile(id: string, ctx: ExtensionContext): Promise<void> {
		const profile = config?.profiles[id];
		if (!profile || !config) {
			ctx.ui.notify(`Unknown profile "${id}"`, "error");
			return;
		}
		if (profile.builtin) {
			ctx.ui.notify(`Built-in profile "${profile.name}" cannot be deleted; disable it instead`, "warning");
			return;
		}
		if (ctx.hasUI && !(await ctx.ui.confirm("Delete profile?", `Delete custom profile "${profile.name}"?`))) return;
		if (activeId === id) await activate(undefined, ctx);
		delete config.profiles[id];
		config.order = config.order.filter((profileId) => profileId !== id);
		saveConfig(config);
		ctx.ui.notify(`Removed profile "${profile.name}"`, "info");
	}

	async function showPicker(ctx: ExtensionContext): Promise<void> {
		if (ctx.mode !== "tui" || !config) {
			ctx.ui.notify("The profile picker requires TUI mode", "error");
			return;
		}
		let open = true;
		let selectedId = activeId;
		while (open) {
			const action = await ctx.ui.custom<PickerAction>(
				(tui, theme, _keybindings, done) => {
					const picker = new ProfilePicker(config!, activeId, selectedId, theme, done);
					return {
						render: (width) => picker.render(width),
						invalidate: () => picker.invalidate(),
						handleInput: (data) => { picker.handleInput(data); tui.requestRender(); },
					};
				},
				{ overlay: true, overlayOptions: { width: 76, minWidth: 56, maxHeight: "90%", anchor: "center", margin: 1 } },
			);
			if (!action || action.type === "close") break;
			if (action.id !== undefined) selectedId = action.id;
			switch (action.type) {
				case "activate":
					if (await activate(action.id, ctx)) open = false;
					break;
				case "add": await addProfile(ctx); break;
				case "edit": if (action.id) await editProfile(action.id, ctx); break;
				case "delete": if (action.id) await removeProfile(action.id, ctx); break;
				case "toggle": {
					const profile = action.id && config.profiles[action.id];
					if (profile) {
						profile.enabled = !profile.enabled;
						if (!profile.enabled && activeId === profile.id) await activate(undefined, ctx);
						saveConfig(config);
					}
					break;
				}
				case "color": if (action.id) { cycleColor(action.id); updateStatus(ctx); } break;
				case "move": if (action.id && action.direction) moveProfile(action.id, action.direction); break;
			}
		}
	}

	async function cycleProfile(ctx: ExtensionContext): Promise<void> {
		const enabled = orderedProfiles().filter((profile) => profile.enabled).map((profile) => profile.id);
		const cycle = [undefined, ...enabled];
		const current = cycle.indexOf(activeId);
		const next = cycle[(current < 0 ? 0 : current + 1) % cycle.length];
		if (await activate(next, ctx)) {
			const label = next ? config?.profiles[next]?.name : "No profile";
			ctx.ui.notify(`Profile: ${label}`, "info");
		}
	}

	pi.registerShortcut(Key.ctrlShift("l"), { description: "Open profile selector", handler: showPicker });
	pi.registerShortcut(Key.ctrlShift("u"), { description: "Cycle profiles", handler: cycleProfile });

	pi.registerCommand("profile", {
		description: "Select or manage model + reasoning profiles",
		getArgumentCompletions: (prefix) => {
			const options = ["none", "add", "remove", "enable", "disable", ...(config?.order ?? [])];
			const matches = options.filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value }));
			return matches.length ? matches : null;
		},
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/).filter(Boolean);
			if (!parts.length) return showPicker(ctx);
			const command = parts[0]!.toLowerCase();
			if (command === "none" || command === "off") {
				await activate(undefined, ctx);
				return;
			}
			if (command === "add") {
				const supplied = parts.length >= 4 ? { name: parts[1]!, pair: parts[2]!, effort: parts[3]!, color: parts[4] } : undefined;
				if (!supplied && ctx.mode !== "tui") {
					ctx.ui.notify("Usage: /profile add <name> <provider/model> <effort> [color]", "error");
					return;
				}
				await addProfile(ctx, supplied);
				return;
			}
			if (command === "remove") {
				if (!parts[1]) return void ctx.ui.notify("Usage: /profile remove <name>", "error");
				await removeProfile(sanitizeId(parts[1]), ctx);
				return;
			}
			if (command === "enable" || command === "disable") {
				const id = sanitizeId(parts[1] ?? "");
				const profile = config?.profiles[id];
				if (!profile || !config) return void ctx.ui.notify(`Unknown profile "${id}"`, "error");
				profile.enabled = command === "enable";
				if (!profile.enabled && activeId === id) await activate(undefined, ctx);
				saveConfig(config);
				updateStatus(ctx);
				return;
			}
			await activate(sanitizeId(command), ctx);
		},
	});

	pi.on("session_start", async (event, ctx) => {
		const provider = ctx.model?.provider ?? "openai-codex";
		const model = ctx.model?.id ?? "gpt-5.6-sol";
		config = loadConfig(provider, model);
		baseline = { model: ctx.model, thinkingLevel: pi.getThinkingLevel() };
		activeId = undefined;

		let restored: string | null | undefined;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "custom" && entry.customType === STATE_ENTRY) {
				restored = (entry.data as SessionProfileState | undefined)?.activeId;
			}
		}
		if (restored !== undefined) {
			await activate(restored ?? undefined, ctx, false);
		} else {
			const startId = config.profiles.interrogate?.enabled
				? "interrogate"
				: orderedProfiles().find((profile) => profile.enabled)?.id;
			await activate(startId, ctx, event.reason !== "reload");
		}
		updateStatus(ctx);
	});

	pi.on("model_select", (event, ctx) => {
		if (applying || !activeId || !config) return;
		const profile = config.profiles[activeId];
		if (profile && (event.model.provider !== profile.provider || event.model.id !== profile.model)) {
			activeId = undefined;
			persistActive();
			updateStatus(ctx);
		}
	});

	pi.on("thinking_level_select", (event, ctx) => {
		if (applying || !activeId || !config) return;
		const profile = config.profiles[activeId];
		if (profile && event.level !== profile.thinkingLevel) {
			activeId = undefined;
			persistActive();
			updateStatus(ctx);
		}
	});
}
