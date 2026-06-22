import { describe, expect, it } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";

describe("Orchestrator.agents", () => {
  it("returns 5 agents with correct modes", () => {
    const agents = Orchestrator.agents(false);
    expect(Object.keys(agents)).toEqual([
      "strategist", "architect", "engineer", "auditor", "specialist",
    ]);
    expect(agents.strategist.mode).toBe("primary");
    expect(agents.architect.mode).toBe("subagent");
    expect(agents.engineer.mode).toBe("subagent");
    expect(agents.auditor.mode).toBe("subagent");
    expect(agents.specialist.mode).toBe("subagent");
  });

  it("strategist prompt mentions phase gates in manual mode", () => {
    const agents = Orchestrator.agents(false);
    expect(agents.strategist.prompt).toContain("phase gates");
  });

  it("strategist prompt mentions no gates in automation mode", () => {
    const agents = Orchestrator.agents(true);
    expect(agents.strategist.prompt).toContain("NO phase gates");
  });

  it("engineer has full access permissions", () => {
    const agents = Orchestrator.agents(false);
    expect(agents.engineer.permission.edit).toBe("allow");
    expect(agents.engineer.permission.bash).toBe("allow");
    expect(agents.engineer.permission.write).toBe("allow");
  });

  it("architect has plan-write permissions but no edit", () => {
    const agents = Orchestrator.agents(false);
    expect(agents.architect.permission.edit).toBe("deny");
    expect(agents.architect.permission.write).toMatchObject({
      ".opencode/plans/*": "allow",
      "*": "deny",
    });
  });

  it("auditor has read + bash but no edit", () => {
    const agents = Orchestrator.agents(false);
    expect(agents.auditor.permission.edit).toBeUndefined();
    expect(agents.auditor.permission.bash).toBe("allow");
    expect(agents.auditor.permission.read).toBe("allow");
  });
});