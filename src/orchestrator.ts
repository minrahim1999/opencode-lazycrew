/**
 * Orchestrator — the pipeline engine.
 *
 * strategist (primary) → architect (plan + todos) → engineer → auditor
 *
 * Uses OpenCode SDK: session.create + session.prompt.
 * session.create only accepts { title?, parentID? }.
 * session.prompt accepts { agent, model, parts }.
 */

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

const STRATEGIST_PROMPT = `You are the Strategist — the primary agent of LazyCrew.

## Your Job
1. Receive user message → is it a task or a question?
2. Question → answer directly. No mission.
3. Task with enough detail → call question tool with plan summary + "Proceed?" + options [Proceed, Cancel, Modify].
4. Task too vague → call question tool asking for clarification.
5. User selects "Proceed" → call start_mission tool with the full description.
6. Wait for mission completion → summarize results.

## How start_mission Works
The start_mission tool RUNS the full pipeline (architect → engineer → auditor) and RETURNS when done. It returns a progress log with status lines. You will see output like:
  ▶ Architect planning: build-auth
  📋 5 tasks planned
  ▶ [1/5] TASK-001: Set up database schema
  🔍 Auditing TASK-001...
  ✅ Mission 'build-auth' completed — 5 tasks done

The tool call stays open while the pipeline runs. This is normal — the loading animation stays visible. When it returns, read the log and summarize results to the user.

## Rules
- ALWAYS call the 'question' tool for interactions. NEVER write plain text questions.
- NEVER do work yourself — delegate to architect (plan), engineer (code), auditor (verify).
- After compaction, re-read .opencode/todo/{slug}.md to reconstruct state.

## Compaction Recovery
If you notice your context was compacted (missing earlier conversation):
1. Check if .opencode/todo/ has any .md files — if yes, a mission was in progress
2. Read the todo file to see what's done ([x]) vs pending ([ ])
3. Tell the user: "Found mission in progress. Completed: X/Y. Resume?"
4. If user says yes → call start_mission with the remaining tasks`;

const ARCHITECT_PROMPT = `You are the Architect — you write plans and todo lists. You NEVER write code.

1. Read the mission description
2. Decompose into tasks (≤30 min each)
3. Write plan to .opencode/plans/{slug}/plan.md
4. Write todos to .opencode/todo/{slug}.md

Todo format (use EXACTLY this format):
- [ ] TASK-001: Description (@engineer, critical-path: yes/no)
  - Acceptance: Verifiable condition
  - Depends: []

Mark critical-path: yes for tasks that need auditor verification (security, data loss, money).
Single-phase missions run fully automatically.`;

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

/** Per-agent call timeout — lazy getter so tests can override via env */
function getAgentTimeoutMs(): number {
  return Number(process.env.LAZYCREW_TEST_TIMEOUT) || 5 * 60 * 1000;
}

export class Orchestrator {
  private client: any;
  private directory: string;
  private automation: boolean;
  private active = false;
  private aborted = false;
  private models: Record<string, string | undefined> = {};

  constructor(opts: { client: any; directory: string; automation: boolean }) {
    this.client = opts.client;
    this.directory = opts.directory;
    this.automation = opts.automation;
  }

  /** Capture model assignments from opencode.json (called from config hook) */
  setModels(models: Record<string, string | undefined>): void {
    this.models = models;
  }

  /** Agent configs for the config hook */
  static agents(automation: boolean): Record<string, AgentCfg> {
    return {
      strategist: {
        mode: "primary",
        description: "Primary agent — detects tasks, drives pipeline",
        prompt: STRATEGIST_PROMPT,
        temperature: 0.3,
        tools: { ...READ_ONLY, start_mission: true, abort_mission: true, delegate_task: true, lazycrew_config: true },
        permission: { ...READ_ONLY, start_mission: "allow", abort_mission: "allow", delegate_task: "allow", lazycrew_config: "allow" },
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
        description: "Coder — implements tasks",
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

  /**
   * Start a mission — architect → engineer(s) → auditor.
   * Returns a progress log (array of status lines).
   * NOT fire-and-forget — the tool call stays open until done,
   * so the loading animation stays visible.
   */
  async start(description: string): Promise<string[]> {
    if (this.active) {
      return ["Mission already active — abort first."];
    }
    this.active = true;
    this.aborted = false;
    const slug = slugify(description);
    const log: string[] = [];

    try {
      // 1. Architect plans
      log.push(`▶ Architect planning: ${slug}`);
      await this.runAgent("architect", `Mission: ${description}\n\nWrite the plan and todos for this mission. Use slug: ${slug}`);
      log.push(`📋 Architect done`);

      // 2. Read todos
      const todos = await this.readTodos(slug);
      if (todos.length === 0) {
        log.push("⚠ No todos produced by architect — check .opencode/todo/");
        return log;
      }
      log.push(`📋 ${todos.length} tasks planned`);

      // 3. Execute tasks sequentially
      let done = 0;
      let failed = 0;
      for (let i = 0; i < todos.length; i++) {
        if (this.aborted) {
          log.push(`⏹ Mission aborted at task ${i + 1}/${todos.length}`);
          break;
        }

        const task = todos[i];
        log.push(`▶ [${i + 1}/${todos.length}] ${task.id}: ${task.description.slice(0, 60)}`);

        try {
          await this.runAgent("engineer", this.buildTaskPrompt(slug, task));
          done++;

          if (task.critical) {
            log.push(`🔍 Auditing ${task.id}...`);
            await this.runAgent("auditor", `Audit task ${task.id} in mission ${slug}. Read the evidence in .opencode/todo/${slug}.md and verify acceptance criteria.`);
          }
        } catch (err) {
          failed++;
          log.push(`⚠ ${task.id} failed: ${String(err).slice(0, 100)}`);
          // Continue to next task — don't abort the whole mission
        }
      }

      if (this.aborted) {
        log.push(`⏹ Mission '${slug}' aborted — ${done} done, ${failed} failed`);
      } else {
        log.push(`✅ Mission '${slug}' completed — ${done} done, ${failed} failed`);
      }
      return log;
    } catch (err) {
      log.push(`❌ Mission failed: ${String(err).slice(0, 200)}`);
      return log;
    } finally {
      this.active = false;
      this.aborted = false;
    }
  }

  /** Abort the current mission */
  abort(): void {
    this.aborted = true;
    this.active = false;
    console.log("[lazycrew] abort requested");
  }

  /** Switch automation mode at runtime (affects next start_mission) */
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
      title: `lazycrew-${agent}`,
    });
    const sid = session.id ?? session.data?.id;
    if (!sid) throw new Error(`Failed to create session for ${agent}`);

    try {
      const promptOpts: any = {
        sessionID: sid,
        directory: this.directory,
        agent,
        parts: [{ type: "text", text: prompt }],
      };

      // Pass model to session.prompt if we have one
      const model = this.models[agent];
      if (model) {
        const slashIdx = model.indexOf("/");
        if (slashIdx > 0) {
          promptOpts.model = {
            providerID: model.slice(0, slashIdx),
            modelID: model.slice(slashIdx + 1),
          };
        }
      }

      let fullText = "";
      let attempts = 0;
      const maxContinuationAttempts = 2;

      while (attempts <= maxContinuationAttempts) {
        // Race against timeout — don't let a hung subagent block forever
        const result = await Promise.race([
          this.client.v2.session.prompt(promptOpts),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Agent ${agent} timed out after ${getAgentTimeoutMs() / 1000}s`)), getAgentTimeoutMs()),
          ),
        ]);

        const parts = (result as any)?.data?.parts ?? (result as any)?.parts ?? [];
        const text = parts
          .filter((p: any) => p.type === "text" && p.text)
          .map((p: any) => p.text)
          .join("\n");

        fullText += (fullText ? "\n" : "") + text;

        // Detect truncation: finishReason === "length" OR text ends abruptly
        const finishReason = (result as any)?.data?.finishReason ?? (result as any)?.finishReason;
        const isTruncated = finishReason === "length" || looksTruncated(text);

        if (!isTruncated || attempts >= maxContinuationAttempts) {
          break;
        }

        // Retry with continuation prompt
        attempts++;
        console.log(`[lazycrew] ${agent} response truncated (attempt ${attempts}/${maxContinuationAttempts}), requesting continuation...`);
        promptOpts.parts = [{ type: "text", text: "Continue exactly from where you stopped. Do not repeat what you already wrote." }];
      }

      return fullText || undefined;
    } finally {
      try { await this.client.v2?.session?.close?.({ id: sid }); } catch {}
    }
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

/**
 * Detect if a response was cut off before completion.
 * Checks for sentences that don't end, open code blocks, or trailing "...".
 */
function looksTruncated(text: string): boolean {
  if (!text || text.length < 20) return false;
  const trimmed = text.trimEnd();
  // Ends with "..." or starts a partial sentence
  if (/\.{2,}$/.test(trimmed)) return true;
  // Ends mid-word
  if (/\w$/.test(trimmed) && !/[.!?;:]\s*$/.test(trimmed)) return true;
  // Open code block or markdown structure
  if ((trimmed.match(/```/g) || []).length % 2 !== 0) return true;
  // Unclosed brackets or parentheses at the very end
  const tail = trimmed.slice(-200);
  const openParens = (tail.match(/\(/g) || []).length;
  const closeParens = (tail.match(/\)/g) || []).length;
  const openBrackets = (tail.match(/\[/g) || []).length;
  const closeBrackets = (tail.match(/\]/g) || []).length;
  const openCurlies = (tail.match(/\{/g) || []).length;
  const closeCurlies = (tail.match(/\}/g) || []).length;
  return openParens > closeParens || openBrackets > closeBrackets || openCurlies > closeCurlies;
}

/**
 * Parse todos — lenient format matching.
 * Accepts: TASK-001, Task-001, task-001, TASK-1, etc.
 * Also accepts plain numbered tasks: 1., 1), etc.
 */
function parseTodos(content: string): Task[] {
  const tasks: Task[] = [];
  const lines = content.split("\n");
  let counter = 0;

  for (const line of lines) {
    // Match: - [ ] TASK-001: Description...  (case-insensitive)
    const m1 = line.match(/^\s*- \[ \] (?:TASK-)?(\d+):\s*(.+?)$/i);
    if (m1) {
      const num = m1[1];
      const id = `TASK-${num.padStart(3, "0")}`;
      const critical = /critical-path:\s*yes/i.test(line);
      tasks.push({ id, description: m1[2].trim(), critical });
      continue;
    }

    // Match: - [ ] Description... (no task ID — auto-assign)
    const m2 = line.match(/^\s*- \[ \] (.+?)$/);
    if (m2 && !line.includes("[x]")) {
      counter++;
      const id = `TASK-${String(counter).padStart(3, "0")}`;
      const desc = m2[1].trim();
      // Skip if it looks like metadata (starts with - or @)
      if (desc.startsWith("@") || desc.startsWith("Depends:") || desc.startsWith("Acceptance:")) continue;
      const critical = /critical-path:\s*yes/i.test(line);
      tasks.push({ id, description: desc, critical });
    }
  }
  return tasks;
}