import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildGeneratorPrompt, createPendingHandoff, writeHandoffArtifact } from "../extensions/handoff.ts";

describe("native handoff", () => {
	test("builds a self-contained generator prompt with optional focus and loaded resources", () => {
		const prompt = buildGeneratorPrompt({
			conversation: "[User]: Implement native handoff\n[Tool result]: extension API supports newSession",
			resources: [{ path: "/project/AGENTS.md", content: "Use Bun tests." }],
			focus: "add failure coverage",
		});

		expect(prompt.systemPrompt).toContain("Include a \"suggested skills\" section");
		expect(prompt.systemPrompt).toContain("Redact any sensitive information");
		expect(prompt.userPrompt).toContain("Implement native handoff");
		expect(prompt.userPrompt).toContain("/project/AGENTS.md");
		expect(prompt.userPrompt).toContain("Use Bun tests.");
		expect(prompt.userPrompt).toContain("add failure coverage");
	});

	test("omits a next-task instruction when no focus was supplied", () => {
		const prompt = buildGeneratorPrompt({ conversation: "[User]: Current state", resources: [] });
		expect(prompt.userPrompt).not.toContain("Next-session focus");
	});

	test("atomically persists and verifies a non-empty artifact in the OS temp directory", async () => {
		const artifact = await writeHandoffArtifact("# Handoff\n\nContinue here.");
		try {
			expect(artifact.path.startsWith(tmpdir())).toBe(true);
			expect(await readFile(artifact.path, "utf8")).toBe("# Handoff\n\nContinue here.");
		} finally {
			await rm(artifact.directory, { recursive: true, force: true });
		}
	});

	test("creates an idle replacement with handoff context and records its destination", async () => {
		const customMessages: Array<{ type: string; content: string }> = [];
		const markers: Array<{ source: string; artifact: string; replacement: string }> = [];
		let sentProviderMessage = false;
		const context = {
			newSession: async (options: any) => {
				await options.setup({
					appendCustomMessageEntry: (type: string, content: string) => customMessages.push({ type, content }),
				});
				await options.withSession({
					sessionManager: { getSessionId: () => "replacement-123" },
					sendUserMessage: () => { sentProviderMessage = true; },
					ui: { notify: () => {} },
				});
				return { cancelled: false };
			},
		};

		await createPendingHandoff(context as any, "/sessions/source.jsonl", {
			directory: "/tmp/pi-handoff-x",
			path: "/tmp/pi-handoff-x/handoff.md",
			content: "# Handoff",
		}, async (source, artifact, replacement) => { markers.push({ source, artifact, replacement }); });

		expect(customMessages).toEqual([{ type: "native-handoff-context", content: "# Handoff" }]);
		expect(sentProviderMessage).toBe(false);
		expect(markers).toEqual([{
			source: "/sessions/source.jsonl",
			artifact: "/tmp/pi-handoff-x/handoff.md",
			replacement: "replacement-123",
		}]);
	});

	test("keeps a successful replacement usable when marker persistence fails", async () => {
		const notifications: string[] = [];
		const context = {
			newSession: async (options: any) => {
				await options.setup({ appendCustomMessageEntry: () => {} });
				await options.withSession({
					sessionManager: { getSessionId: () => "replacement-123" },
					ui: { notify: (message: string) => notifications.push(message) },
				});
				return { cancelled: false };
			},
		};

		const result = await createPendingHandoff(context as any, "/sessions/source.jsonl", {
			directory: "/tmp/pi-handoff-x",
			path: "/tmp/pi-handoff-x/handoff.md",
			content: "# Handoff",
		}, async () => { throw new Error("disk full"); }, (error, replacementCtx) => {
			replacementCtx.ui.notify(`Marker failed: ${(error as Error).message}`, "warning");
		});

		expect(result).toEqual({ cancelled: false });
		expect(notifications).toEqual(["Marker failed: disk full", "Handoff ready. Enter your next instruction to continue."]);
	});

	test("rejects an empty artifact before creating a handoff directory", async () => {
		await expect(writeHandoffArtifact("   ")).rejects.toThrow("empty");
	});
});
