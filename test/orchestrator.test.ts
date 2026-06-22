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

  it("strategist prompt has no phase gate references (removed)", () => {
    const agents = Orchestrator.agents(false);
    expect(agents.strategist.prompt).not.toContain("phase gate");
  });

  it("architect prompt has no phase gate references (removed)", () => {
    const agents = Orchestrator.agents(false);
    expect(agents.architect.prompt).not.toContain("phase-gate");
    expect(agents.architect.prompt).not.toContain("phase gate");
  });

  it("engineer has full access permissions", () => {
    const agents = Orchestrator.agents(false);
    expect(agents.engineer.permission!.edit).toBe("allow");
    expect(agents.engineer.permission!.bash).toBe("allow");
    expect(agents.engineer.permission!.write).toBe("allow");
  });

  it("architect has plan-write permissions but no edit", () => {
    const agents = Orchestrator.agents(false);
    expect(agents.architect.permission!.edit).toBe("deny");
    expect(agents.architect.permission!.write).toMatchObject({
      ".opencode/plans/*": "allow",
      "*": "deny",
    });
  });

  it("auditor has read + bash but no edit", () => {
    const agents = Orchestrator.agents(false);
    expect(agents.auditor.permission!.bash).toBe("allow");
    expect(agents.auditor.permission!.read).toBe("allow");
  });

  it("strategist has lazycrew_config in tools", () => {
    const agents = Orchestrator.agents(false);
    expect(agents.strategist.tools!.lazycrew_config).toBe(true);
    expect(agents.strategist.permission!.lazycrew_config).toBe("allow");
  });
});

describe("Orchestrator.start", () => {
  const mockClient = {
    v2: {
      session: {
        create: async () => ({ id: "test-session" }),
        prompt: async () => ({ data: { parts: [{ type: "text", text: "done" }] } }),
        close: async () => {},
      },
    },
  };

  it("start returns progress log when already active", async () => {
    const orch = new Orchestrator({ client: mockClient, directory: "/tmp", automation: false });
    // @ts-ignore
    orch.active = true;
    const log = await orch.start("test");
    expect(log).toEqual(["Mission already active — abort first."]);
  });

  it("start returns progress log with completed or no-todos status", async () => {
    const orch = new Orchestrator({ client: mockClient, directory: "/tmp", automation: false });
    const log = await orch.start("test mission");
    expect(Array.isArray(log)).toBe(true);
    expect(log.some((l: string) => l.includes("completed") || l.includes("No todos") || l.includes("failed"))).toBe(true);
  });

  it("abort sets aborted flag", () => {
    const orch = new Orchestrator({ client: mockClient, directory: "/tmp", automation: false });
    orch.abort();
    // @ts-ignore
    expect(orch.aborted).toBe(true);
    // @ts-ignore
    expect(orch.active).toBe(false);
  });

  it("setAutomation changes the mode", () => {
    const orch = new Orchestrator({ client: mockClient, directory: "/tmp", automation: false });
    orch.setAutomation(true);
    // @ts-ignore
    expect(orch.automation).toBe(true);
  });

  it("setModels stores model assignments", () => {
    const orch = new Orchestrator({ client: mockClient, directory: "/tmp", automation: false });
    orch.setModels({ engineer: "ollama/kimi-k2.7-code", architect: "ollama/deepseek-v4-flash" });
    // @ts-ignore
    expect(orch.models.engineer).toBe("ollama/kimi-k2.7-code");
    // @ts-ignore
    expect(orch.models.architect).toBe("ollama/deepseek-v4-flash");
  });

  it("delegate returns agent output on success", async () => {
    const orch = new Orchestrator({ client: mockClient, directory: "/tmp", automation: false });
    const result = await orch.delegate("engineer", "Write a hello function");
    expect(result).toBe("done");
  });

  it("delegate returns error message on failure", async () => {
    const failingClient = {
      v2: { session: { create: async () => { throw new Error("session down"); }, prompt: async () => {}, close: async () => {} } },
    };
    const orch = new Orchestrator({ client: failingClient, directory: "/tmp", automation: false });
    const result = await orch.delegate("engineer", "test");
    expect(result).toContain("Delegate failed");
  });

  it("runAgent times out on hanging session", async () => {
    process.env.LAZYCREW_TEST_TIMEOUT = "100"; // 100ms for test
    const hangingClient = {
      v2: {
        session: {
          create: async () => ({ id: "hang-session" }),
          prompt: async () => new Promise(() => {}),
          close: async () => {},
        },
      },
    };
    const orch = new Orchestrator({ client: hangingClient, directory: "/tmp", automation: false });
    // @ts-ignore
    await expect(orch.runAgent("engineer", "test")).rejects.toThrow("timed out");
    delete process.env.LAZYCREW_TEST_TIMEOUT;
  });
});