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

  describe("PONYTAIL.isDeactivationCommand", () => {
    it("recognizes 'stop ponytail'", () => {
      expect(PONYTAIL.isDeactivationCommand("stop ponytail")).toBe(true);
      expect(PONYTAIL.isDeactivationCommand("Stop Ponytail")).toBe(true);
      expect(PONYTAIL.isDeactivationCommand("stop ponytail.")).toBe(true);
      expect(PONYTAIL.isDeactivationCommand("stop ponytail!")).toBe(true);
    });

    it("recognizes 'normal mode'", () => {
      expect(PONYTAIL.isDeactivationCommand("normal mode")).toBe(true);
      expect(PONYTAIL.isDeactivationCommand("Normal Mode")).toBe(true);
      expect(PONYTAIL.isDeactivationCommand("normal mode?")).toBe(true);
    });

    it("does not trigger on partial matches", () => {
      expect(PONYTAIL.isDeactivationCommand("add a normal mode toggle")).toBe(false);
      expect(PONYTAIL.isDeactivationCommand("stop ponytailing around")).toBe(false);
      expect(PONYTAIL.isDeactivationCommand("")).toBe(false);
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

    it("includes persistence enforcement", () => {
      const txt = ponytailInstructions("full");
      expect(txt).toContain("ACTIVE EVERY RESPONSE");
      expect(txt).toContain("No drift back to over-building");
      expect(txt).toContain("stop ponytail");
    });

    it("includes reflex-not-research principle", () => {
      const txt = ponytailInstructions("full");
      expect(txt).toContain("reflex, not a research project");
      expect(txt).toContain("take the higher one and move on");
    });

    it("includes no-re-arguing rule", () => {
      const txt = ponytailInstructions("full");
      expect(txt).toContain("no re-arguing");
    });

    it("includes hardware/physical world clause", () => {
      const txt = ponytailInstructions("full");
      expect(txt).toContain("Hardware");
      expect(txt).toContain("calibration");
    });

    it("includes testing (lazy but checked) section", () => {
      const txt = ponytailInstructions("full");
      expect(txt).toContain("Lazy but Checked");
      expect(txt).toContain("ONE runnable check");
    });

    it("includes ponytail comment convention", () => {
      const txt = ponytailInstructions("full");
      expect(txt).toContain("ponytail:");
      expect(txt).toContain("known ceiling");
      expect(txt).toContain("upgrade path");
    });

    it("includes output format pattern", () => {
      const txt = ponytailInstructions("full");
      expect(txt).toContain("skipped");
      expect(txt).toContain("add when");
    });
  });
});