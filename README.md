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
  "plugin": [
    ["opencode-lazycrew", {
      "automation": false,
      "ponytail": "full"
    }]
  ]
}
```

## Config

- **`automation`**: `false` (default) = human gates via question tool. `true` = fully autonomous.
- **`ponytail`**: `"off"` | `"lite"` | `"full"` (default) | `"ultra"` — lazy-dev ruleset injected into every system prompt.

## How It Works

1. User types a task → **Strategist** asks "Proceed?" via question modal
2. User confirms → **Architect** writes plan + todos
3. **Engineer(s)** execute tasks
4. **Auditor** verifies critical-path tasks
5. Strategist reports results

## Agents

| Agent | Role | Model (your choice) |
|-------|------|---------------------|
| strategist | Primary — detects tasks, drives pipeline | any |
| architect | Subagent — writes plans and todos | any |
| engineer | Subagent — implements code | any |
| auditor | Subagent — verifies critical tasks | any |
| specialist | Subagent — diagnoses stuck missions | any |

## Tools

- `start_mission` — Launch the pipeline (call after user confirms)
- `abort_mission` — Abort all active missions
- `delegate_task` — Delegate a subtask to a specific agent

## Ponytail

The "lazy senior dev" ruleset is embedded — no external dependency. It makes agents:
- Check YAGNI first (does this need to exist?)
- Reach for stdlib before dependencies
- Write one-liners instead of abstractions
- Never cut validation, security, or accessibility

## Testing

```bash
npm test
```

12 tests covering ponytail ruleset and agent configuration.

## License

MIT © 2026 muhaimin