/**
 * Orchestrator — the pipeline engine (v1.6.0 extremist mode).
 *
 * strategist (primary) → architect (plan + todos) → engineer → auditor
 *
 * Extremist guarantees:
 * 1. .opencode/ always exists + .gitignore always contains .opencode
 * 2. Plan written to .opencode/plans/{slug}/plan.md before execution
 * 3. Todo written to .opencode/todo/{slug}.md before execution
 * 4. Plan = procedure document; Todo = execution checklist (different files)
 * 5. Engineer MUST update todo checkbox; if not → strict retry
 * 6. Startup resume check via strategist prompt + lazycrew_state
 * 7. Plugin enforces everything; agents only generate content
 *
 * Uses OpenCode SDK: session.create + session.prompt.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
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
    ".gitignore": "allow",
    "AGENTS.md": "allow", "*": "deny",
  },
};

const STRATEGIST_PROMPT = `You are the Strategist — the primary agent of LazyCrew.

## Your Job
1. Receive user message → is it a task or a question?
2. **Task detection (ANY of these = TASK, never a question):**
   - Message mentions file paths, at-sign references, or specific code locations
   - Message asks to change, modify, update, replace, refactor, or fix code
   - Message references specific components, classes, functions, or widgets
   - Message compares implementations ("use X instead of Y")
   - Message starts with "can we" but references concrete code → still TASK
3. **Question detection (ALL of these = QUESTION):**
   - Purely informational: "what is X?", "how does Y work?", "explain Z"
   - No file paths, no code references, no concrete changes requested
   - Conceptual or architectural discussion only
4. Question → answer directly. No mission.
5. Task with enough detail → call question tool with plan summary + "Proceed?" + options [Proceed, Cancel, Modify].
6. Task too vague → call question tool asking for clarification.
7. User selects "Proceed" → call start_mission tool with the full description.
8. BEFORE any mission, call lazycrew_state tool to check for incomplete todos. If incomplete mission found, ask user "Resume 'X'?" with options [Resume, Start New, Cancel].
9. Wait for mission completion → read the progress log carefully.
10. If ANY task shows ⚠ FAILED or "not completed" → call question tool: "X/Y tasks completed. Some failed. Retry failed tasks? Skip? Abort?"
11. If ALL tasks show ✅ → summarize results to user.

## File Path Detection
If the user mentions at-sign path references or any file path, this is ALWAYS a task reference, never a question. Treat it as TASK immediately.

## How start_mission Works
The start_mission tool RUNS the full pipeline (architect → engineer → auditor) and RETURNS when done. It returns a progress log with status lines. You will see output like:
  ▶ Architect planning: build-auth
  📋 Plan written: .opencode/plans/build-auth/plan.md
  📋 Todo written: .opencode/todo/build-auth.md (5 tasks)
  ▶ [1/5] TASK-001: Set up database schema
  ✅ TASK-001 completed
  🔍 Auditing TASK-001...
  📋 TASK-001 audit: PASS
  ✅ Mission 'build-auth' completed — 5 done, 0 failed

OR if tasks failed:
  ⚠ TASK-003 failed: no evidence of completion
  ⚠ Mission 'build-auth' completed with failures — 4 done, 1 failed

The tool call stays open while the pipeline runs. This is normal — the loading animation stays visible. When it returns, read the log and summarize results to the user.

## Rules
- ALWAYS call the 'question' tool for interactions. NEVER write plain text questions.
- NEVER do work yourself — delegate to architect (plan), engineer (code), auditor (verify).
- After compaction, call lazycrew_state to check for interrupted missions.
- If mission log shows failures, DO NOT pretend everything succeeded. Ask the user what to do.
- NEVER start a new mission without checking lazycrew_state first.

## Compaction Recovery
If you notice your context was compacted (missing earlier conversation):
1. Call lazycrew_state tool to check if a mission was interrupted.
2. If it reports an incomplete mission, ask the user: "Mission 'X' was interrupted (Y/Z tasks). Resume or start new?"
3. If user says resume → call start_mission with the original description.
4. If user says start new → proceed normally.
5. If user says no → summarize what was completed so far.`;

const ARCHITECT_PROMPT = `You are the Architect — you write plans and todo lists. You NEVER write code.

## Your Job (in this exact order)
1. Read the mission description
2. Decompose into tasks (≤30 min each)
3. Write a PROCEDURE document to .opencode/plans/{slug}/plan.md
4. Write a TODO checklist to .opencode/todo/{slug}.md

## Plan Format (.opencode/plans/{slug}/plan.md)
Use this exact structure:

# Plan: {Mission Title}

## Overview
1-2 sentence summary of what this mission accomplishes.

## Procedure
For each task, write a section like:

### Step 1: TASK-001 — {Title}
**What to change:** Specific files, functions, or components.
**How:** Detailed implementation approach.
**Why:** Rationale for this approach.
**Acceptance:** Verifiable condition that proves completion.
**Depends:** [] (or list of TASK-XXX that must complete first)

### Step 2: TASK-002 — {Title}
... repeat for each task ...

## Rollback Plan
If something breaks, how to revert.

## Notes
Any assumptions, dependencies, or warnings.

## Todo Format (.opencode/todo/{slug}.md)
Use EXACTLY this format:

# Todo: {Mission Title}

- [ ] TASK-001: Description here (@engineer, critical-path: yes/no)
  - Acceptance: Verifiable condition
  - Depends: []

- [ ] TASK-002: Description here (@engineer, critical-path: yes/no)
  - Acceptance: Verifiable condition
  - Depends: [TASK-001]

Mark critical-path: yes for tasks that need auditor verification (security, data loss, money).

## CRITICAL RULES
- After writing BOTH files, read them back to confirm they exist and are correct.
- The plan.md is the PROCEDURE — it explains WHAT to do and WHY.
- The todo.md is the CHECKLIST — it lists tasks with checkboxes for tracking.
- NEVER combine them into one file. They serve different purposes.
- If the write tool fails, retry up to 2 times.
- Single-phase missions run fully automatically.`;

const ENGINEER_PROMPT = `You are the Engineer — you implement code. You NEVER plan or audit.

## Your Job
1. Read assigned task and ALL referenced files
2. Follow .opencode/todo/{slug}.md exactly — do not invent extra work
3. Write minimal, correct code
4. Update todo checkbox when done: - [x] TASK-XXX: ... (Evidence: ...)
5. If blocked after 2 attempts → call 'question' tool. Never write plain text.
6. If task feels > 30 min → call 'question' tool suggesting split. Never write plain text.
7. After completing code, ALWAYS update the todo file with evidence before finishing.

## Evidence Format (MANDATORY)
When marking a task complete, update the todo line like this EXACTLY:
- [x] TASK-001: Description (Evidence: created auth.js with login/logout handlers)

The Evidence field MUST describe what file was changed and what was done.
If you forget to update the todo, the task will be marked FAILED and you will be forced to retry.

## Retry Rule
If you are called back to update a todo that you forgot to update:
1. Read the todo file
2. Find your task
3. Change [ ] to [x] and add Evidence
4. Do NOT re-implement the code — just update the checkbox

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
  private currentSlug: string | null = null;
  private stateFile: string;

  constructor(opts: { client: any; directory: string; automation: boolean }) {
    this.client = opts.client;
    this.directory = opts.directory;
    this.automation = opts.automation;
    this.stateFile = join(this.directory, ".opencode", "lazycrew-state.json");
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
        tools: { ...READ_ONLY, start_mission: true, abort_mission: true, delegate_task: true, lazycrew_config: true, lazycrew_state: true, question: true },
        permission: { ...READ_ONLY, start_mission: "allow", abort_mission: "allow", delegate_task: "allow", lazycrew_config: "allow", lazycrew_state: "allow" },
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
        permission: PLAN_WRITE,
      },
    };
  }

  /**
   * Ensure .opencode directory exists and .gitignore contains .opencode.
   * Called on plugin load (constructor) AND on mission start for redundancy.
   */
  ensureWorkspace(): void {
    // 1. Create .opencode directories
    mkdirSync(join(this.directory, ".opencode", "plans"), { recursive: true });
    mkdirSync(join(this.directory, ".opencode", "todo"), { recursive: true });

    // 2. Ensure .gitignore contains .opencode
    const gitignorePath = join(this.directory, ".gitignore");
    let gitignoreContent = "";
    try {
      gitignoreContent = readFileSync(gitignorePath, "utf-8");
    } catch {
      // .gitignore doesn't exist yet — create it
    }
    const lines = gitignoreContent.split("\n").map((l) => l.trim());
    if (!lines.includes(".opencode") && !lines.includes(".opencode/")) {
      const separator = gitignoreContent.endsWith("\n") ? "" : "\n";
      const entry = gitignoreContent ? `${separator}# LazyCrew workspace\n.opencode\n` : "# LazyCrew workspace\n.opencode\n";
      writeFileSync(gitignorePath, gitignoreContent + entry, "utf-8");
    }
  }

  /**
   * Start a mission — architect → engineer(s) → auditor.
   * Returns a progress log (array of status lines).
   * NOT fire-and-forget — the tool call stays open until done.
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
      // ─── Phase 0: Enforce workspace structure ──────────────────────────────
      this.ensureWorkspace();
      log.push("🔧 Workspace enforced: .opencode/ + .gitignore");

      // Write mission state file
      this.currentSlug = slug;
      this.saveState({
        slug,
        description,
        status: "planning",
        startedAt: new Date().toISOString(),
        tasksTotal: 0,
        tasksDone: 0,
        tasksFailed: 0,
      });

      // ─── Phase 1: Architect plans (plan + todo) ────────────────────────────
      log.push(`▶ Architect planning: ${slug}`);
      const planPath = join(this.directory, ".opencode", "plans", slug, "plan.md");
      const todoPath = join(this.directory, ".opencode", "todo", `${slug}.md`);

      // Retry architect up to 2 times if files are missing
      let architectAttempts = 0;
      const maxArchitectAttempts = 2;
      while (architectAttempts <= maxArchitectAttempts) {
        await this.runAgent("architect", `Mission: ${description}\n\nWrite the plan to .opencode/plans/${slug}/plan.md and the todo list to .opencode/todo/${slug}.md for this mission. Use slug: ${slug}`);

        // Verify BOTH files exist
        const planExists = existsSync(planPath);
        const todoExists = existsSync(todoPath);

        if (planExists && todoExists) {
          log.push(`📋 Plan written: .opencode/plans/${slug}/plan.md`);
          log.push(`📋 Todo written: .opencode/todo/${slug}.md`);
          break;
        }

        const missing: string[] = [];
        if (!planExists) missing.push("plan.md");
        if (!todoExists) missing.push("todo.md");
        log.push(`⚠ Architect missing: ${missing.join(", ")}`);

        if (architectAttempts >= maxArchitectAttempts) {
          log.push(`❌ Architect failed to produce required files after ${maxArchitectAttempts + 1} attempts`);
          this.saveState({ status: "error", error: `Missing files: ${missing.join(", ")}` });
          return log;
        }

        architectAttempts++;
        log.push(`🔄 Retrying architect (${architectAttempts}/${maxArchitectAttempts})...`);
      }

      // ─── Phase 2: Read and parse todos ─────────────────────────────────────
      const todos = await this.readTodos(slug);
      if (todos.length === 0) {
        log.push("⚠ No todos produced by architect — check .opencode/todo/");
        this.saveState({ status: "error", error: "No todos produced" });
        return log;
      }
      log.push(`📋 ${todos.length} tasks planned`);
      this.saveState({ tasksTotal: todos.length, status: "executing" });

      // ─── Phase 3: Execute tasks sequentially ─────────────────────────────────
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
          // Run engineer
          const result = await this.runAgent("engineer", this.buildTaskPrompt(slug, task));

          // ─── Phase 3b: Force todo update verification ──────────────────────
          let isCompleted = await this.isTaskCompleted(slug, task.id);

          if (!isCompleted) {
            // Engineer forgot to update todo — force retry with strict prompt
            log.push(`⚠ ${task.id}: missing todo update — forcing retry`);
            const retryPrompt = `STRICT RETRY — You forgot to update the todo checkbox for ${task.id}.

1. Read .opencode/todo/${slug}.md
2. Find the line for ${task.id}
3. Change [ ] to [x] and add Evidence: what file you changed and what you did
4. Do NOT re-implement any code — only update the checkbox

Your previous work was: ${result?.slice(0, 200) || "(no output recorded)"}`;

            await this.runAgent("engineer", retryPrompt);
            isCompleted = await this.isTaskCompleted(slug, task.id);
          }

          if (isCompleted) {
            log.push(`✅ ${task.id} completed`);
            done++;
          } else {
            log.push(`⚠ ${task.id} failed: todo still not updated after retry`);
            failed++;
            if (!this.automation) {
              log.push(`⏸ Mission paused — task ${task.id} incomplete. Retry? Skip? Abort?`);
              break;
            }
          }

          // ─── Phase 3c: Audit critical-path tasks ──────────────────────────
          if (isCompleted && task.critical) {
            log.push(`🔍 Auditing ${task.id}...`);
            const auditResult = await this.runAgent("auditor", `Audit task ${task.id} in mission ${slug}. Read the evidence in .opencode/todo/${slug}.md and verify acceptance criteria.`);
            log.push(`📋 ${task.id} audit: ${auditResult?.includes("FAIL") ? "FAIL" : "PASS"}`);
          }
        } catch (err) {
          failed++;
          log.push(`⚠ ${task.id} failed: ${String(err).slice(0, 100)}`);
          if (!this.automation) {
            log.push(`⏸ Mission paused — task ${task.id} errored. Retry? Skip? Abort?`);
            break;
          }
        }
      }

      // ─── Phase 4: Finalize ─────────────────────────────────────────────────
      if (this.aborted) {
        log.push(`⏹ Mission '${slug}' aborted — ${done} done, ${failed} failed`);
        this.saveState({ status: "aborted", tasksDone: done, tasksFailed: failed });
      } else if (failed > 0) {
        log.push(`⚠ Mission '${slug}' completed with failures — ${done} done, ${failed} failed`);
        this.saveState({ status: "paused", tasksDone: done, tasksFailed: failed });
      } else {
        log.push(`✅ Mission '${slug}' completed — ${done} done, ${failed} failed`);
        this.saveState({ status: "completed", tasksDone: done, tasksFailed: failed });
      }
      return log;
    } catch (err) {
      log.push(`❌ Mission failed: ${String(err).slice(0, 200)}`);
      this.saveState({ status: "error", error: String(err).slice(0, 200) });
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

  /** Get current mission state for strategist recovery */
  getMissionState(): { active: boolean; slug: string | null; state: any } {
    let state: any = null;
    try {
      const raw = readFileSync(this.stateFile, "utf-8");
      state = JSON.parse(raw);
    } catch {
      // No state file — no active mission
    }
    return {
      active: this.active,
      slug: this.currentSlug,
      state,
    };
  }

  /** Save mission state to file (for timeout/compaction recovery) */
  private saveState(updates: Partial<{
    slug: string;
    description: string;
    status: string;
    startedAt: string;
    tasksTotal: number;
    tasksDone: number;
    tasksFailed: number;
    error: string;
  }>): void {
    try {
      let state: any = {};
      try {
        const raw = readFileSync(this.stateFile, "utf-8");
        state = JSON.parse(raw);
      } catch {
        // State file doesn't exist yet
      }
      writeFileSync(this.stateFile, JSON.stringify({ ...state, ...updates }, null, 2) + "\n", "utf-8");
    } catch (err) {
      console.warn("[lazycrew] could not save state:", err);
    }
  }

  /**
   * Scan all todo files and return incomplete missions.
   * Used by strategist on first interaction to offer resume.
   */
  scanIncompleteMissions(): { slug: string; total: number; done: number; failed: number }[] {
    const incomplete: { slug: string; total: number; done: number; failed: number }[] = [];
    const todoDir = join(this.directory, ".opencode", "todo");
    try {
      const { readdirSync, statSync } = require("node:fs");
      const entries = readdirSync(todoDir);
      for (const entry of entries) {
        if (!entry.endsWith(".md")) continue;
        const slug = entry.replace(/\.md$/, "");
        const content = readFileSync(join(todoDir, entry), "utf-8");
        const total = (content.match(/^\s*- \[ \]/gm) || []).length + (content.match(/^\s*- \[x\]/gm) || []).length;
        const done = (content.match(/^\s*- \[x\]/gm) || []).length;
        const failed = (content.match(/^\s*- \[ \]/gm) || []).length;
        if (failed > 0 && done > 0) {
          incomplete.push({ slug, total, done, failed });
        }
      }
    } catch {
      // todo dir doesn't exist yet
    }
    return incomplete;
  }

  /** Recover from timeout/compaction — returns summary of previous mission */
  recoverMission(): string | null {
    try {
      const raw = readFileSync(this.stateFile, "utf-8");
      const state = JSON.parse(raw);
      if (!state.slug || !state.description) return null;

      const total = state.tasksTotal || 0;
      const done = state.tasksDone || 0;
      const failed = state.tasksFailed || 0;

      switch (state.status) {
        case "completed":
          return `Mission '${state.slug}' was completed (${done} done, ${failed} failed). No recovery needed.`;
        case "aborted":
          return `Mission '${state.slug}' was aborted (${done} done, ${failed} failed). Call start_mission to restart.`;
        case "paused":
          return `Mission '${state.slug}' is paused with failures (${done} done, ${failed} failed). Call delegate_task to retry failed tasks or start_mission to restart.`;
        case "executing":
        case "planning":
          return `Mission '${state.slug}' was interrupted (status: ${state.status}, ${done}/${total} tasks). Call start_mission to restart from the beginning.`;
        case "error":
          return `Mission '${state.slug}' failed: ${state.error || "unknown error"}. Fix the issue, then call start_mission.`;
        default:
          return `Mission '${state.slug}' (status: ${state.status} — ${done}/${total} tasks). Call start_mission to restart.`;
      }
    } catch {
      return null;
    }
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
        } else {
          console.warn(`[lazycrew] Invalid model format "${model}" for agent "${agent}". Expected "provider/model". Falling back to default.`);
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

  /** Check if a specific task was marked complete in the todo file */
  private async isTaskCompleted(slug: string, taskId: string): Promise<boolean> {
    try {
      const content = readFileSync(
        join(this.directory, ".opencode", "todo", `${slug}.md`),
        "utf-8",
      );
      // Look for the task with [x] checkbox
      const lines = content.split("\n");
      for (const line of lines) {
        const taskMatch = line.match(/^\s*- \[x\]\s*(TASK-\d+|[\d]+):?\s*(.+?)$/i);
        if (taskMatch) {
          const id = taskMatch[1].startsWith("TASK-")
            ? taskMatch[1]
            : `TASK-${taskMatch[1].padStart(3, "0")}`;
          if (id === taskId) return true;
        }
      }
      return false;
    } catch {
      return false;
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