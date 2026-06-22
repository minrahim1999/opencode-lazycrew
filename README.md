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
    "architect":  { "model": "ollama/deepseek-v4-flash" },
    "engineer":   { "model": "ollama/kimi-k2.7-code" },
    "auditor":    { "model": "ollama/nemotron-3-super" },
    "specialist": { "model": "ollama/nemotron-3-super" }
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

Pick models that fit each role:

- **strategist** → reasoning model (e.g. `deepseek-v4-flash`) — classifies tasks, drives flow
- **architect** → planning model (e.g. `deepseek-v4-flash`) — decomposes into tasks
- **engineer** → coding model (e.g. `kimi-k2.7-code`, `qwen3-coder-next`) — writes code
- **auditor** → fast model (e.g. `nemotron-3-super`) — verifies outputs
- **specialist** → reasoning model (e.g. `nemotron-3-super`) — diagnoses stuck missions

Use any provider: `ollama/`, `openai/`, `anthropic/`, `google/`, or omit for local models.

### Agent Permissions (auto-set by plugin)

| Agent | edit | write | bash | read | question |
|-------|------|-------|------|------|----------|
| strategist | ❌ | ❌ | ❌ | ✅ | ✅ |
| architect | ❌ | plans+todos only | ❌ | ✅ | ✅ |
| engineer | ✅ | ✅ | ✅ | ✅ | ✅ |
| auditor | ❌ | ❌ | ✅ | ✅ | ✅ |
| specialist | ❌ | ❌ | ❌ | ✅ | ✅ |

You don't need to set these — the plugin handles it.

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
Engineer(s): execute tasks, update todos with evidence
    ↓
Auditor: verifies critical-path tasks (PASS/FAIL)
    ↓
Strategist: summarizes results to user
```

### Phase Gates (automation: false only)

When the architect marks `phase-gate: yes` on the last task of a phase, the strategist pauses and shows a question modal: **Continue / Hold / Modify**. The user controls progression. Single-phase missions run automatically.

## Tools

- `start_mission` — Launch the pipeline (strategist calls this after user confirms)
- `abort_mission` — Abort all active missions
- `delegate_task` — Delegate a one-off subtask to a specific agent

## Ponytail

The "lazy senior dev" ruleset is embedded — no external dependency. Before any code, agents check:

1. Does this need to exist? (YAGNI)
2. Stdlib does it? → use it
3. Native platform feature? → use it
4. Already-installed dependency? → use it
5. One line? → one line
6. Only then: minimum code that works

Never lazy about: validation, security, accessibility, data-loss handling, anything explicitly requested.

Intensity levels:
- **lite** — Build what's asked, name the lazier alternative
- **full** (default) — The ladder enforced. Stdlib first. Shortest diff
- **ultra** — YAGNI extremist. Challenge the request

## Testing

```bash
npm test
```

12 tests covering ponytail ruleset and agent configuration.

## License

MIT © 2026 muhaimin