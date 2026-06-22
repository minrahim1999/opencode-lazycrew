/**
 * Orchestrator — the pipeline engine.
 *
 * strategist (primary) → architect (plan + todos) → engineer(s) (parallel) → auditor (verify)
 *
 * Uses OpenCode SDK: session.create + session.prompt.
 * session.create only accepts { title?, parentID? }.
 * session.prompt accepts { agent, model, parts }.
 */

import type { PluginInput } from "@opencode-ai/plugin";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ─── Agent configs ───────────────────────────────────────────────────────────

export interface AgentCfg {
  model?: string;
  mode: "primary" | "subagent";
  description?: string;
  prompt: string;
  temperature?: number;
  tools?: Record<string, any>;
  permission?: Record<string, any>;
}

const READ_ONLY = {
  read: "allow", glob: "allow", grep: "allow", list: "allow",
  webfetch: "allow", websearch: "allow", task: "allow",
  question: "allow", skill: { "*": "allow" },
};

const FULL_ACCESS = {
  ...READ_ONLY, edit: "allow", write: "allow", bash: "allow",
  external_directory: "allow", doom_loop: "allow",
};

const PLAN_WRITE = {
  ...READ_ONLY,
  edit: "deny", bash: "deny",
  write: {
    ".opencode/plans/*": "allow", ".opencode/plans/**": "allow",
    ".opencode/todo/*": "allow", ".opencode/todo/**": "allow",
    "AGENTS.md": "allow", "*": "deny",
  },
};

const STRATEGIST_PROMPT = `You are the Strategist — the primary agent of the Orchestrator.

## Your Job
1. Receive user message → is it a task or a question?
2. Question → answer directly. No mission.
3. Task with enough detail → call question tool with plan summary + "Proceed?" + options [Proceed, Cancel, Modify].
4. Task too vague → call question tool asking for clarification.
5. User selects "Proceed" → call start_mission tool with the full description.
6. Wait for mission completion → summarize results.

## Rules
- ALWAYS call the 'question' tool for interactions. NEVER write plain text questions.
- NEVER do work yourself — delegate to architect (plan), engineer (code), auditor (verify).
- After compaction, re-read .opencode/todo/{slug}.md to reconstruct state.
${""}
## Phase Gates (automation: false only)
- When architect marks phase-gate: yes on a task → PAUSE, call question tool with "Continue/Hold/Modify".
- On "Continue" → resume execution. On "Hold" → wait.`;

const ARCHITECT_PROMPT = `You are the Architect — you write plans and todo lists. You NEVER write code.

1. Read the mission description
2. Decompose into phases and tasks (≤30 min each)
3. Write plan to .opencode/plans/{slug}/plan.md
4. Write todos to .opencode/todo/{slug}.md

Todo format:
- [ ] TASK-001: Description (@engineer, critical-path: yes/no, phase-gate: yes/no)
  - Acceptance: Verifiable condition
  - Depends: []

Phase gate: put phase-gate: yes on the LAST task of each phase (if multi-phase).
Single-phase missions run fully automatically — no gates needed.`;

const ENGINEER_PROMPT = `You are the Engineer — you implement code. You NEVER plan or audit.

1. Read assigned task and ALL referenced files
2. Follow .opencode/todo/{slug}.md exactly — do not invent extra work
3. Write minimal, correct code
4. Update todo checkbox when done: - [x] TASK-XXX: ... (Evidence: ...)
5. If blocked after 2 attempts → call 'question' tool. Never write plain text.
6. If task feels > 30 min → call 'question' tool suggesting split. Never write plain text.

## Safety
- NEVER write outside the project directory
- NEVER modify node_modules/, .git/, or system paths
- Double-check file paths before destructive operations`;

const AUDITOR_PROMPT = `You are the Auditor — you verify critical-path tasks. You NEVER write code.

1. Read the completed task and its evidence
2. Verify the acceptance criteria are met
3. Run any existing tests if available
4. Write verdict to .opencode/todo/{slug}.md: AUDIT: TASK-XXX → PASS/FAIL (reason)
5. If FAIL → describe what's wrong, do NOT fix it yourself`;

const SPECIALIST_PROMPT = `You are the Specialist — you diagnose stuck missions and replan. You NEVER write code.

1. Read the mission state, plan, and todos
2. Identify what's stuck and why
3. Propose a revised approach or task split
4. Write diagnosis to .opencode/todo/{slug}.md: DIAGNOSIS: ...`;

// ─── Orchestrator class ──────────────────────────────────────────────────────

export class Orchestrator {
  private client: any;
  private directory: string;
  private automation: boolean;
  private active = false;
  private sessions = new Map<string, string>();

  constructor(opts: { client: any; directory: string; automation: boolean }) {
    this.client = opts.client;
    this.directory = opts.directory;
    this.automation = opts.automation;
  }

  /** Agent configs for the config hook */
  static agents(automation: boolean): Record<string, AgentCfg> {
    const gateInstruction = automation
      ? "Automation mode — NO phase gates. All tasks run automatically."
      : "Manual mode — pause at phase gates and call question tool.";

    return {
      strategist: {
        mode: "primary",
        description: "Primary agent — detects tasks, drives pipeline",
        prompt: `${STRATEGIST_PROMPT}\n\n${gateInstruction}`,
        temperature: 0.3,
        tools: { ...READ_ONLY, start_mission: true, abort_mission: true, delegate_task: true },
        permission: { ...READ_ONLY, start_mission: "allow", abort_mission: "allow", delegate_task: "allow" },
      },
      architect: {
        mode: "subagent",
        description: "Planner — writes plans and todo lists",
        prompt: ARCHITECT_PROMPT,
        temperature: 0.8,
        tools: { ...READ_ONLY, write: true },
        permission: PLAN_WRITE,
      },
      engineer: {
        mode: "subagent",
        description: "Coder — implements tasks in parallel",
        prompt: ENGINEER_PROMPT,
        temperature: 0.2,
        permission: FULL_ACCESS,
      },
      auditor: {
        mode: "subagent",
        description: "Verifier — audits critical-path tasks",
        prompt: AUDITOR_PROMPT,
        temperature: 0.3,
        tools: { ...READ_ONLY, bash: true },
        permission: { ...READ_ONLY, bash: "allow" },
      },
      specialist: {
        mode: "subagent",
        description: "Diagnostician — unsticks stalled missions",
        prompt: SPECIALIST_PROMPT,
        temperature: 0.4,
        tools: READ_ONLY,
        permission: READ_ONLY,
      },
    };
  }

  /** Start a mission — architect → engineers → auditor */
  async start(description: string): Promise<void> {
    if (this.active) {
      console.warn("[lazycrew] mission already active");
      return;
    }
    this.active = true;
    const slug = slugify(description);

    try {
      // 1. Architect plans
      await this.runAgent("architect", `Mission: ${description}\n\nWrite the plan and todos for this mission.`);

      // 2. Read todos
      const todos = await this.readTodos(slug);
      if (todos.length === 0) {
        console.warn("[lazycrew] no todos produced by architect");
        return;
      }

      // 3. Execute tasks (simple sequential for now — parallel is a future concern)
      for (const task of todos) {
        await this.runAgent("engineer", this.buildTaskPrompt(slug, task));
        if (task.critical) {
          await this.runAgent("auditor", `Audit task ${task.id} in mission ${slug}. Read the evidence and verify acceptance criteria.`);
        }
      }

      console.log(`[lazycrew] mission '${slug}' completed`);
    } catch (err) {
      console.error(`[lazycrew] mission '${slug}' failed:`, err);
    } finally {
      this.active = false;
    }
  }

  /** Abort the current mission */
  abort(): void {
    this.active = false;
    for (const [, sid] of this.sessions) {
      this.client.v2?.session?.close?.({ id: sid }).catch(() => {});
    }
    this.sessions.clear();
    console.log("[lazycrew] aborted");
  }

  /** Switch automation mode at runtime */
  setAutomation(value: boolean): void {
    this.automation = value;
  }

  /** Delegate a one-off task to an agent */
  async delegate(agent: string, prompt: string): Promise<string> {
    try {
      const result = await this.runAgent(agent, prompt);
      return result ?? "Agent completed (no output)";
    } catch (err) {
      return `Delegate failed: ${String(err)}`;
    }
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  private async runAgent(agent: string, prompt: string): Promise<string | undefined> {
    const session = await this.client.v2.session.create({
      directory: this.directory,
      title: `orchestrator-${agent}`,
    });
    const sid = session.id ?? session.data?.id;
    if (!sid) throw new Error(`Failed to create session for ${agent}`);

    this.sessions.set(agent, sid);

    const result = await this.client.v2.session.prompt({
      sessionID: sid,
      directory: this.directory,
      agent,
      parts: [{ type: "text", text: prompt }],
    });

    // Extract text from result
    const parts = result?.data?.parts ?? result?.parts ?? [];
    const text = parts
      .filter((p: any) => p.type === "text" && p.text)
      .map((p: any) => p.text)
      .join("\n");

    return text;
  }

  private slugify(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/^-|-$/g, "");
  }

  private buildTaskPrompt(slug: string, task: Task): string {
    return `Mission: ${slug}\nTask: ${task.id} — ${task.description}\n\nRead .opencode/todo/${slug}.md for full context. Implement this task, then update the todo checkbox with evidence.`;
  }

  private async readTodos(slug: string): Promise<Task[]> {
    try {
      const content = readFileSync(
        join(this.directory, ".opencode", "todo", `${slug}.md`),
        "utf-8",
      );
      return parseTodos(content);
    } catch {
      return [];
    }
  }
}

// ─── Types & helpers ─────────────────────────────────────────────────────────

interface Task {
  id: string;
  description: string;
  critical: boolean;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/^-|-$/g, "");
}

function parseTodos(content: string): Task[] {
  const tasks: Task[] = [];
  const lines = content.split("\n");
  for (const line of lines) {
    const m = line.match(/^\s*- \[ \] (TASK-\d+):\s*(.+?)$/);
    if (m) {
      const critical = /critical-path:\s*yes/i.test(line);
      tasks.push({ id: m[1], description: m[2].trim(), critical });
    }
  }
  return tasks;
}