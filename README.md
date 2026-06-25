# opencode-lazycrew

**Minimal multi-agent pipeline for OpenCode — now with extremist enforcement.**

Strategist → Architect → Engineer(s) → Auditor. Ponytail lazy-dev ruleset baked in. No commands needed. **Every project auto-enforces `.opencode/` + `.gitignore`. Plans and todos are mandatory, verified, and retry-forced.**

## Quick Start

```bash
npm install -g opencode-lazycrew
```

Add to `~/.config/opencode/opencode.json`:

```json
{
  "provider": {
    "ollama": {
      "baseURL": "https://ollama.com/v1",
      "apiKey": "{env:OLLAMA_API_KEY}"
    }
  },
  "agent": {
    "strategist": { "model": "ollama/deepseek-v4-flash" },
    "architect":  { "model": "ollama/gemini-3-flash-preview" },
    "engineer":   { "model": "ollama/kimi-k2.7-code" },
    "auditor":    { "model": "ollama/gemini-3-flash-preview" },
    "specialist": { "model": "ollama/deepseek-v4-flash" }
  },
  "plugin": [
    ["opencode-lazycrew", {
      "automation": false,
      "ponytail": "full"
    }]
  ]
}
```

That's it. The plugin auto-registers all agents with their prompts, permissions, and roles. You only need to set the **model** for each agent — everything else is handled. `.opencode/` and `.gitignore` are created automatically on plugin load — no mission required.

## How Agents Work

The plugin registers 5 agents automatically via the `config` hook. You don't need to manually define prompts, permissions, tools, or modes — just assign a model to each:

| Agent | Role | Mode | What it does |
|-------|------|------|--------------|
| **strategist** | Primary | primary | Detects tasks, asks "Proceed?" via question modal, drives pipeline |
| **architect** | Subagent | subagent | Writes plans + todo lists (read-only, no code) |
| **engineer** | Subagent | subagent | Implements code (full access: edit, write, bash) |
| **auditor** | Subagent | subagent | Verifies critical-path tasks (read + bash, no edit) |
| **specialist** | Subagent | subagent | Diagnoses stuck missions (plans+todos only) |

### Model Assignment

Pick models that fit each role. **Only these three fields are user-configurable** for lazycrew agents:

- `model` — which model runs the agent (e.g. `ollama/deepseek-v4-flash`)
- `temperature` — creativity / determinism (default: 0.3 for strategist, 0.2 for engineer, etc.)
- `skills` — additional skills to load (e.g. `["dox-system"]`)

Example minimal config:

```json
{
  "agent": {
    "strategist": { "model": "ollama/deepseek-v4-flash" },
    "architect":  { "model": "ollama/glm-5.1" },
    "engineer":   { "model": "ollama/kimi-k2.7-code" },
    "auditor":    { "model": "ollama/qwen3.5:9b" },
    "specialist": { "model": "ollama/deepseek-v4-flash" }
  }
}
```

**Do NOT set** `permission`, `tools`, `mode`, `prompt`, `description`, `maxTokens`, or `steps` on lazycrew agents. These are locked by the plugin.

### Agent Permissions (auto-set by plugin)

| Agent | edit | write | bash | read | question |
|-------|------|-------|------|------|----------|
| strategist | ❌ | ❌ | ❌ | ✅ | ✅ |
| architect | ❌ | plans+todos only | ❌ | ✅ | ✅ |
| engineer | ✅ | ✅ | ✅ | ✅ | ✅ |
| auditor | ❌ | ❌ | ✅ | ✅ | ✅ |
| specialist | ❌ | ❌ | ❌ | ✅ | ✅ |

You don't need to set these — the plugin handles it. Since v1.5.4, lazycrew agent configs are **guard-railed**: only `model`, `temperature`, and `skills` are user-overridable. Since v1.5.5, the strategist can properly invoke the `question` tool for "Proceed?" gates.

## Config Options

```json
["opencode-lazycrew", {
  "automation": false,
  "ponytail": "full"
}]
```

- **`automation`**: `false` (default) = human gates via question tool modal. `true` = fully autonomous, no gates.
- **`ponytail`**: `"off"` | `"lite"` | `"full"` (default) | `"ultra"` — lazy-dev ruleset injected into every system prompt.

## How It Works

```
User types task
    ↓
Strategist: calls lazycrew_state to check for incomplete missions
    ↓
If incomplete found → "Resume 'X' (Y/Z done)?" [Resume, Start New, Cancel]
If none → "Here's my plan. Proceed?" [Proceed, Cancel, Modify]
    ↓ (question modal)
User selects "Proceed"
    ↓
Strategist calls start_mission tool
    ↓
Phase 0: Plugin enforces workspace (.opencode/ + .gitignore)
    ↓
Phase 1: Architect writes plan + todo
    → .opencode/plans/{slug}/plan.md (procedure document)
    → .opencode/todo/{slug}.md (execution checklist)
    → Plugin verifies BOTH files exist, retries architect if missing
    ↓
Phase 2: Engineer(s) execute tasks, update todos with evidence [x]
    → Plugin verifies todo checkbox updated after each task
    → If engineer forgot → FORCE RETRY with strict "update checkbox only" prompt
    → If still not updated after retry → mark FAILED
    ↓
Phase 3: Auditor verifies critical-path tasks (PASS/FAIL)
    ↓
Strategist: reads log, summarizes results. If failures → asks user.
```

### Plan vs Todo: Two Files, Two Purposes

| File | Purpose | Content |
|------|---------|---------|
| `.opencode/plans/{slug}/plan.md` | **Procedure** | What to do, how, why. Step-by-step implementation guide with acceptance criteria, dependencies, rollback plan. |
| `.opencode/todo/{slug}.md` | **Checklist** | Execution tracker. Each task has a checkbox `[ ]` → `[x]` with Evidence field. The source of truth for what's done. |

The **plan** is read once at the start by the engineer for context. The **todo** is read and updated by every engineer task as the ground truth of completion.

## Tools

- `start_mission` — Launch the pipeline (strategist calls this after user confirms)
- `abort_mission` — Abort all active missions
- `delegate_task` — Delegate a one-off subtask to a specific agent
- `lazycrew_state` — **Check for incomplete missions on startup** + timeout/compaction recovery. Returns all unfinished todos with progress counts.
- `lazycrew_config` — Switch automation and/or ponytail at runtime (no restart needed)

### Switching settings at runtime

The `lazycrew_config` tool lets the strategist (or user) change settings without restarting OpenCode:

```
lazycrew_config({ automation: true })          → turn on autonomous mode
lazycrew_config({ ponytail: "ultra" })         → max laziness
lazycrew_config({ automation: false, ponytail: "lite" })  → change both
lazycrew_config({})                            → just check current settings
```

## Persistence & Recovery

The plugin is mostly stateless:

- **Plans** → saved as files: `.opencode/plans/{slug}/plan.md`
- **Todos** → saved as files: `.opencode/todo/{slug}.md`
- **Sessions** → managed by OpenCode natively (conversation history, compaction, session list)
- **Mission state** → saved as `.opencode/lazycrew-state.json` (status, progress, timestamps)

If OpenCode restarts mid-mission or the strategist times out, call `lazycrew_state` to see if a mission was interrupted and how far it got.

## Resilience: Context-Limit Handling

If a subagent hits its model's context limit and stops mid-generation (sudden stop), lazycrew automatically detects the truncation and requests a continuation — up to 2 retries. The full response is assembled and returned to the pipeline, so missions don't derail from partial output.

## Task Verification (Extremist Mode)

After each engineer completes a task, lazycrew **verifies the todo file was actually updated** with `[x] TASK-XXX` evidence BEFORE marking it "done". This is enforced — not optional.

### Verification Flow
1. Engineer runs task
2. Plugin reads todo file, searches for `[x] TASK-XXX`
3. **Found?** → ✅ mark done, continue to audit if critical-path
4. **Not found?** → ⚠️ **FORCE RETRY**
   - Engineer re-called with strict prompt: "You forgot to update the todo. Read the file, find your task, change `[ ]` to `[x]`, add Evidence. Do NOT re-implement any code."
   - Plugin re-checks todo file after retry
5. **Still not found after retry?** → ❌ mark FAILED
   - `automation: false`: Pipeline PAUSES, asks user: "Retry? Skip? Abort?"
   - `automation: true`: Logs `⚠ TASK-XXX failed`, continues to next task

### Why Force Retry?
Engineers frequently forget to update todos after coding. In v1.5.x, this silently marked tasks as failed. In v1.6.0, the plugin **forces** the engineer back with a specific "update checkbox only" instruction. No code rewrite, no guessing — just the checkbox update.

### What Triggers Failure
- Context limit hit before todo update (truncated response)
- Engineer forgot to update the todo after implementing
- Empty response from engineer
- Todo file missing or corrupted

In all cases: no evidence = not done. No exceptions.

## Ponytail

The "lazy senior dev" ruleset is embedded — no external dependency. Before any code, agents check:

1. Does this need to exist? (YAGNI)
2. Stdlib does it? → use it
3. Native platform feature? → use it
4. Already-installed dependency? → use it
5. One line? → one line
6. Only then: minimum code that works

Never lazy about: validation, security, accessibility, data-loss handling, anything explicitly requested, hardware calibration, user-insisted full versions.

Deactivation: say "stop ponytail" or "normal mode" to turn off. Use `lazycrew_config({ ponytail: "off" })` for programmatic control.

Intensity levels:
- **lite** — Build what's asked, name the lazier alternative
- **full** (default) — The ladder enforced. Stdlib first. Shortest diff
- **ultra** — YAGNI extremist. Challenge the request

## Testing

```bash
npm test
```

40 tests covering:
- Ponytail ruleset (16 tests)
- Agent configuration + permissions (10 tests)
- Workspace enforcement + .gitignore (1 test)
- Architect retry when files missing (1 test)
- Engineer force-retry when todo not updated (1 test)
- Incomplete mission scanning (2 tests)
- Mission state recovery (3 tests)
- Pipeline execution + timeout handling (6 tests)

## License

MIT © 2026 muhaimin