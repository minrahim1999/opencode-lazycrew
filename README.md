# opencode-lazycrew

**Minimal multi-agent pipeline for OpenCode.**

Strategist → Architect → Engineer(s) → Auditor. Ponytail lazy-dev ruleset baked in. No commands needed.

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

That's it. The plugin auto-registers all agents with their prompts, permissions, and roles. You only need to set the **model** for each agent — everything else is handled.

## How Agents Work

The plugin registers 5 agents automatically via the `config` hook. You don't need to manually define prompts, permissions, tools, or modes — just assign a model to each:

| Agent | Role | Mode | What it does |
|-------|------|------|--------------|
| **strategist** | Primary | primary | Detects tasks, asks "Proceed?" via question modal, drives pipeline |
| **architect** | Subagent | subagent | Writes plans + todo lists (read-only, no code) |
| **engineer** | Subagent | subagent | Implements code (full access: edit, write, bash) |
| **auditor** | Subagent | subagent | Verifies critical-path tasks (read + bash, no edit) |
| **specialist** | Subagent | subagent | Diagnoses stuck missions (read-only) |

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
Strategist: "This is a task. Here's my plan. Proceed?"
    ↓ (question modal)
User selects "Proceed"
    ↓
Strategist calls start_mission tool
    ↓
Architect: writes .opencode/plans/{slug}/plan.md + .opencode/todo/{slug}.md
    ↓
Engineer(s): execute tasks, update todos with evidence [x]
    ↓
    VERIFIED — todo has [x] TASK-XXX with evidence?
    ✅ yes → mark done
    ❌ no → mark FAILED, pause (ask: Retry? Skip? Abort?)
    ↓
Auditor: verifies critical-path tasks (PASS/FAIL)
    ↓
Strategist: reads log, summarizes results. If failures → asks user.
```

## Tools

- `start_mission` — Launch the pipeline (strategist calls this after user confirms)
- `abort_mission` — Abort all active missions
- `delegate_task` — Delegate a one-off subtask to a specific agent
- `lazycrew_config` — Switch automation and/or ponytail at runtime (no restart needed)

### Switching settings at runtime

The `lazycrew_config` tool lets the strategist (or user) change settings without restarting OpenCode:

```
lazycrew_config({ automation: true })          → turn on autonomous mode
lazycrew_config({ ponytail: "ultra" })         → max laziness
lazycrew_config({ automation: false, ponytail: "lite" })  → change both
lazycrew_config({})                            → just check current settings
```

## Persistence & Sessions

**No state management.** The plugin is stateless:

- **Plans** → saved as files: `.opencode/plans/{slug}/plan.md`
- **Todos** → saved as files: `.opencode/todo/{slug}.md`
- **Sessions** → managed by OpenCode natively (conversation history, compaction, session list)
- **Mission state** → ephemeral boolean (`active` or not). No database, no state.json, no MissionStore

Files on disk are the only persistence. If OpenCode restarts mid-mission, the plan and todos are still there — the user can tell the strategist to resume.

## Resilience: Context-Limit Handling

If a subagent hits its model's context limit and stops mid-generation (sudden stop), lazycrew automatically detects the truncation and requests a continuation — up to 2 retries. The full response is assembled and returned to the pipeline, so missions don't derail from partial output.

## Task Verification

After each engineer completes a task, lazycrew verifies the todo file was actually updated with `[x] TASK-XXX` evidence BEFORE marking it "done". If the engineer:
- Hit context limit and stopped before updating
- Forgot to update the todo
- Produced empty response

→ the task is marked **FAILED**, not done. In non-automation mode (`automation: false`), the pipeline PAUSES and asks you: "Retry? Skip? Abort?" — no silent failures.

In automation mode (`automation: true`), failures are logged as `⚠` and the pipeline continues to remaining tasks, with a final summary showing `X done, Y failed`.

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

31 tests covering ponytail ruleset (16), agent configuration, and pipeline execution (15).

## License

MIT © 2026 muhaimin