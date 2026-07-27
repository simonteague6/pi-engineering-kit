import { describe, expect, test } from "bun:test";
import { matchesKey } from "@earendil-works/pi-tui";
import { PROFILE_CYCLE_SHORTCUT, PROFILE_PICKER_SHORTCUT } from "../extensions/profile.ts";

describe("profile shortcuts", () => {
	test("match terminal input without requiring the Kitty keyboard protocol", () => {
		expect(matchesKey("\x1bp", PROFILE_PICKER_SHORTCUT)).toBe(true);
		expect(matchesKey("\x1bn", PROFILE_CYCLE_SHORTCUT)).toBe(true);
	});

	test("do not collapse onto ordinary control-key input", () => {
		expect(matchesKey("\x0c", PROFILE_PICKER_SHORTCUT)).toBe(false);
		expect(matchesKey("\x15", PROFILE_CYCLE_SHORTCUT)).toBe(false);
	});
});
