import { mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import { complete, type Message } from "@earendil-works/pi-ai/compat";
import { uuidv7 } from "@earendil-works/pi-ai";
import {
	convertToLlm,
	serializeConversation,
	sessionEntryToContextMessages,
	SessionManager,
	type ExtensionAPI,
	type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

const HANDOFF_CONTEXT_TYPE = "native-handoff-context";
const HANDOFF_MARKER_TYPE = "native-handoff-marker";

const HANDOFF_INSTRUCTIONS = `Write a handoff document summarising the current conversation so a fresh agent can continue the work.

Include a "suggested skills" section in the document, which suggests skills that the agent should invoke.

Do not duplicate content already captured in other artifacts (specs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.

Redact any sensitive information, such as API keys, passwords, or personally identifiable information.

If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.

Return only the handoff document. The extension, not you, persists it to a file.`;

export interface GeneratorPromptInput {
	conversation: string;
	resources: Array<{ path: string; content: string }>;
	focus?: string;
}

export function buildGeneratorPrompt(input: GeneratorPromptInput): { systemPrompt: string; userPrompt: string } {
	const resources = input.resources.length === 0
		? "(No loaded resource files.)"
		: input.resources.map(({ path, content }) => `### ${path}\n${content}`).join("\n\n");
	const focus = input.focus ? `\n\n## Next-session focus\n${input.focus}` : "";
	return {
		systemPrompt: HANDOFF_INSTRUCTIONS,
		userPrompt: `## Conversation context\n\n${input.conversation}\n\n## Loaded resource context\n\n${resources}${focus}`,
	};
}

export interface HandoffArtifact {
	directory: string;
	path: string;
	content: string;
}

/** Persist only complete, verified handoff artifacts outside the workspace. */
export async function writeHandoffArtifact(content: string): Promise<HandoffArtifact> {
	if (!content.trim()) throw new Error("Handoff generator returned an empty document");

	const directory = await mkdtemp(join(tmpdir(), "pi-handoff-"));
	const path = join(directory, "handoff.md");
	const temporaryPath = join(directory, `.handoff-${randomUUID()}.tmp`);
	try {
		await writeFile(temporaryPath, content, "utf8");
		await rename(temporaryPath, path);
		if (await readFile(path, "utf8") !== content) throw new Error("Handoff artifact verification failed");
		return { directory, path, content };
	} catch (error) {
		throw new Error(`Handoff artifact persistence failed; retained directory: ${directory}; ${errorMessage(error)}`);
	}
}

function activeConversation(ctx: ExtensionCommandContext): string {
	const messages = ctx.sessionManager.buildContextEntries().flatMap(sessionEntryToContextMessages);
	return serializeConversation(convertToLlm(messages));
}

function markerData(artifactPath: string, replacementSessionId: string) {
	return { artifactPath, replacementSessionId, handedOffAt: new Date().toISOString() };
}

async function generateHandoff(ctx: ExtensionCommandContext, focus: string): Promise<string> {
	if (!ctx.model) throw new Error("No active model");
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
	if (!auth.ok) throw new Error(auth.error);

	const prompt = buildGeneratorPrompt({
		conversation: activeConversation(ctx),
		resources: ctx.getSystemPromptOptions().contextFiles ?? [],
		focus: focus || undefined,
	});
	const message: Message = {
		role: "user",
		content: [{ type: "text", text: prompt.userPrompt }],
		timestamp: Date.now(),
	};
	const response = await complete(
		ctx.model,
		{ systemPrompt: prompt.systemPrompt, messages: [message] },
		{ apiKey: auth.apiKey, headers: auth.headers, env: auth.env, cacheRetention: "none", sessionId: uuidv7() },
	);
	if (response.stopReason === "aborted") throw new Error("Handoff generation was cancelled");
	if (response.stopReason === "error") throw new Error(response.errorMessage ?? "Handoff generation failed");
	const content = response.content
		.filter((block): block is { type: "text"; text: string } => block.type === "text")
		.map((block) => block.text)
		.join("\n");
	if (!content.trim()) throw new Error("Handoff generator returned an empty document");
	return content;
}

async function appendSourceMarker(sourceSessionPath: string, artifactPath: string, replacementSessionId: string): Promise<void> {
	// The original runtime is intentionally gone. Reopen its durable session instead of
	// reusing a stale source SessionManager or extension context.
	SessionManager.open(sourceSessionPath).appendCustomEntry(HANDOFF_MARKER_TYPE, markerData(artifactPath, replacementSessionId));
}

/** Create a pending handoff without sending a user message or triggering a turn. */
export async function createPendingHandoff(
	ctx: Pick<ExtensionCommandContext, "newSession">,
	sourceSessionPath: string,
	artifact: HandoffArtifact,
	persistMarker: (source: string, artifact: string, replacement: string) => Promise<void> = appendSourceMarker,
	onMarkerFailure?: (error: unknown, replacementCtx: { ui: { notify(message: string, type?: "info" | "warning" | "error"): void } }) => void,
): Promise<{ cancelled: boolean }> {
	return ctx.newSession({
		parentSession: sourceSessionPath,
		setup: async (sessionManager) => {
			sessionManager.appendCustomMessageEntry(HANDOFF_CONTEXT_TYPE, artifact.content, true, { artifactPath: artifact.path });
		},
		withSession: async (replacementCtx) => {
			try {
				await persistMarker(sourceSessionPath, artifact.path, replacementCtx.sessionManager.getSessionId());
			} catch (error) {
				onMarkerFailure?.(error, replacementCtx);
			}
			replacementCtx.ui.notify("Handoff ready. Enter your next instruction to continue.", "info");
		},
	});
}

export default function handoffExtension(pi: ExtensionAPI) {
	pi.registerMessageRenderer(HANDOFF_CONTEXT_TYPE, (message, { expanded, outputPad }, theme) => {
		const content = typeof message.content === "string" ? message.content : "";
		const details = message.details as { artifactPath?: string } | undefined;
		const compact = `Handoff context${details?.artifactPath ? ` • ${basename(details.artifactPath)}` : ""}`;
		return new Text(
			expanded ? `${theme.fg("accent", compact)}\n\n${content}` : theme.fg("accent", compact),
			outputPad,
			0,
		);
	});

	pi.registerEntryRenderer(HANDOFF_MARKER_TYPE, (entry, { expanded }, theme) => {
		const marker = entry.data as ReturnType<typeof markerData>;
		const compact = `Handoff → ${marker.replacementSessionId}\nArtifact: ${marker.artifactPath}`;
		const detail = `\nTime: ${marker.handedOffAt}`;
		return new Text(expanded ? `${theme.fg("accent", compact)}${theme.fg("dim", detail)}` : theme.fg("accent", compact), 0, 0);
	});

	pi.registerCommand("handoff", {
		description: "Transfer the current session into a pending handoff",
		handler: async (args, ctx) => {
			await ctx.waitForIdle();
			const focus = args.trim();
			const sourceSessionPath = ctx.sessionManager.getSessionFile();
			if (!sourceSessionPath) return void ctx.ui.notify("Handoff requires a persisted source session", "error");

			let artifact: HandoffArtifact;
			try {
				ctx.ui.notify("Generating handoff…", "info");
				artifact = await writeHandoffArtifact(await generateHandoff(ctx, focus));
			} catch (error) {
				return void ctx.ui.notify(`Handoff generation or artifact write failed: ${errorMessage(error)}`, "error");
			}

			try {
				const result = await createPendingHandoff(ctx, sourceSessionPath, artifact, appendSourceMarker, (error, replacementCtx) => {
					replacementCtx.ui.notify(`Handoff completed, but source marker was not saved: ${errorMessage(error)}`, "warning");
				});
				if (result.cancelled) ctx.ui.notify(`Handoff artifact kept at ${artifact.path}; session replacement cancelled.`, "info");
			} catch (error) {
				ctx.ui.notify(`Handoff replacement failed; artifact kept at ${artifact.path}: ${errorMessage(error)}`, "error");
			}
		},
	});
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
