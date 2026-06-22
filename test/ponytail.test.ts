import { describe, expect, it } from "vitest";
import { PONYTAIL, ponytailInstructions } from "../src/ponytail.js";

describe("ponytail", () => {
  describe("PONYTAIL.normalize", () => {
    it("defaults to 'full'", () => {
      expect(PONYTAIL.normalize(undefined)).toBe("full");
      expect(PONYTAIL.normalize("")).toBe("full");
    });

    it("normalizes case-insensitively", () => {
      expect(PONYTAIL.normalize("OFF")).toBe("off");
      expect(PONYTAIL.normalize("Lite")).toBe("lite");
      expect(PONYTAIL.normalize("ULTRA")).toBe("ultra");
    });

    it("falls back to 'full' for invalid", () => {
      expect(PONYTAIL.normalize("nope")).toBe("full");
    });
  });

  describe("ponytailInstructions", () => {
    it("returns empty string for 'off'", () => {
      expect(ponytailInstructions("off")).toBe("");
    });

    it("includes the ladder in all non-off levels", () => {
      for (const level of ["lite", "full", "ultra"] as const) {
        const txt = ponytailInstructions(level);
        expect(txt).toContain("The Ladder");
        expect(txt).toContain("YAGNI");
        expect(txt).toContain("stdlib");
        expect(txt).toContain("Never lazy about");
      }
    });

    it("includes intensity-specific sections", () => {
      expect(ponytailInstructions("lite")).toContain("Intensity: lite");
      expect(ponytailInstructions("full")).toContain("Intensity: full");
      expect(ponytailInstructions("ultra")).toContain("Intensity: ultra");
    });
  });
});