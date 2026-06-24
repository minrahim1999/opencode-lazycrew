import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockClient(text = "done") {
  return {
    v2: {
      session: {
        create: async () => ({ id: "test-session" }),
        prompt: async () => ({ data: { parts: [{ type: "text", text }] } }),
        close: async () => {},
      },
    },
  };
}

function createMockClientSequence(responses: string[]) {
  let callCount = 0;
  return {
    v2: {
      session: {
        create: async () => ({ id: `test-session-${callCount}` }),
        prompt: async () => {
          const text = responses[callCount] || "done";
          callCount++;
          return { data: { parts: [{ type: "text", text }] } };
        },
        close: async () => {},
      },
    },
  };
}

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
      ".gitignore": "allow",
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

  it("strategist prompt instructs to check lazycrew_state before missions", () => {
    const agents = Orchestrator.agents(false);
    expect(agents.strategist.prompt).toContain("lazycrew_state");
    expect(agents.strategist.prompt).toContain("Resume");
  });

  it("engineer prompt has strict retry instructions", () => {
    const agents = Orchestrator.agents(false);
    expect(agents.engineer.prompt).toContain("Retry Rule");
    expect(agents.engineer.prompt).toContain("Do NOT re-implement");
  });
});

describe("Orchestrator.start", () => {
  const mockClient = createMockClient();

  it("start returns progress log when already active", async () => {
    const orch = new Orchestrator({ client: mockClient, directory: "/tmp", automation: false });
    // @ts-ignore
    orch.active = true;
    const log = await orch.start("test");
    expect(log).toEqual(["Mission already active — abort first."]);
  });

  it("enforces workspace (.gitignore + .opencode) on start", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "lazycrew-test-"));
    const orch = new Orchestrator({ client: mockClient, directory: tmpDir, automation: false });
    
    await orch.start("test mission");
    
    // .opencode directories should exist
    expect(existsSync(join(tmpDir, ".opencode", "plans"))).toBe(true);
    expect(existsSync(join(tmpDir, ".opencode", "todo"))).toBe(true);
    
    // .gitignore should contain .opencode
    const gitignorePath = join(tmpDir, ".gitignore");
    expect(existsSync(gitignorePath)).toBe(true);
    const gitignoreContent = readFileSync(gitignorePath, "utf-8");
    expect(gitignoreContent).toContain(".opencode");
    
    // Cleanup
    rmSync(tmpDir, { recursive: true, force: true });
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

  it("retries architect when plan or todo files are missing", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "lazycrew-test-"));
    const client = createMockClientSequence(["architect-run-1", "architect-run-2"]);
    const orch = new Orchestrator({ client, directory: tmpDir, automation: true });
    
    const log = await orch.start("retry test");
    
    // Should show retry in log
    expect(log.some((l: string) => l.includes("Retrying architect") || l.includes("Workspace enforced"))).toBe(true);
    
    // Cleanup
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("forces engineer retry when todo not updated", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "lazycrew-test-"));
    const missionDesc = "force retry";
    const slug = "force-retry";
    mkdirSync(join(tmpDir, ".opencode", "plans", slug), { recursive: true });
    mkdirSync(join(tmpDir, ".opencode", "todo"), { recursive: true });
    
    // Write a plan
    writeFileSync(join(tmpDir, ".opencode", "plans", slug, "plan.md"), "# Plan");
    
    // Write a todo with TASK-001 unchecked
    writeFileSync(join(tmpDir, ".opencode", "todo", `${slug}.md`), `
- [ ] TASK-001: Test task (@engineer, critical-path: no)
  - Acceptance: Verify something
  - Depends: []
`);
    
    // Engineer returns text but doesn't update the todo file (we don't change it here)
    const client = createMockClientSequence([
      "engineer-run-1",
      "engineer-run-2",
    ]);
    
    const orch = new Orchestrator({ client, directory: tmpDir, automation: true });
    const log = await orch.start(missionDesc);
    
    // Should show forced retry in log
    expect(log.some((l: string) => l.includes("forcing retry"))).toBe(true);
    
    // Cleanup
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("Orchestrator.scanIncompleteMissions", () => {
  it("finds incomplete missions from todo files", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "lazycrew-test-"));
    mkdirSync(join(tmpDir, ".opencode", "todo"), { recursive: true });
    
    // Write a partially completed todo
    writeFileSync(join(tmpDir, ".opencode", "todo", "incomplete.md"), `
# Todo: Test

- [x] TASK-001: Done task
  - Acceptance: Verified
  - Depends: []

- [ ] TASK-002: Not done task
  - Acceptance: Not verified
  - Depends: []
`);
    
    const orch = new Orchestrator({ client: createMockClient(), directory: tmpDir, automation: false });
    const incomplete = orch.scanIncompleteMissions();
    
    expect(incomplete.length).toBe(1);
    expect(incomplete[0].slug).toBe("incomplete");
    expect(incomplete[0].done).toBe(1);
    expect(incomplete[0].failed).toBe(1);
    
    // Cleanup
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when no todo files exist", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "lazycrew-test-"));
    const orch = new Orchestrator({ client: createMockClient(), directory: tmpDir, automation: false });
    const incomplete = orch.scanIncompleteMissions();
    expect(incomplete.length).toBe(0);
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("Orchestrator.recoverMission", () => {
  it("returns null when no state file exists", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "lazycrew-test-"));
    const orch = new Orchestrator({ client: createMockClient(), directory: tmpDir, automation: false });
    const recovery = orch.recoverMission();
    expect(recovery).toBeNull();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns recovery message for interrupted mission", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "lazycrew-test-"));
    mkdirSync(join(tmpDir, ".opencode"), { recursive: true });
    
    // Write state file
    writeFileSync(join(tmpDir, ".opencode", "lazycrew-state.json"), JSON.stringify({
      slug: "test-mission",
      description: "Test description",
      status: "executing",
      tasksTotal: 5,
      tasksDone: 2,
      tasksFailed: 0,
    }));
    
    const orch = new Orchestrator({ client: createMockClient(), directory: tmpDir, automation: false });
    const recovery = orch.recoverMission();
    
    expect(recovery).toContain("test-mission");
    expect(recovery).toContain("interrupted");
    
    // Cleanup
    rmSync(tmpDir, { recursive: true, force: true });
  });
});