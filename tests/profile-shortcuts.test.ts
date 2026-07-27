import { describe, expect, test } from "bun:test";
import { matchesKey } from "@earendil-works/pi-tui";
import { PROFILE_CYCLE_SHORTCUT, PROFILE_PICKER_SHORTCUT } from "../extensions/profile.ts";

describe("profile shortcuts", () => {
	test("use the reserved-free control bindings", () => {
		expect(PROFILE_PICKER_SHORTCUT).toBe("ctrl+space");
		expect(PROFILE_CYCLE_SHORTCUT).toBe("ctrl+q");
	});

	test("match unshifted control input and not the old alt bindings", () => {
		expect(matchesKey("\x00", PROFILE_PICKER_SHORTCUT)).toBe(true);
		expect(matchesKey("\x11", PROFILE_CYCLE_SHORTCUT)).toBe(true);
		expect(matchesKey("\x1bp", PROFILE_PICKER_SHORTCUT)).toBe(false);
		expect(matchesKey("\x1bn", PROFILE_CYCLE_SHORTCUT)).toBe(false);
	});
});
