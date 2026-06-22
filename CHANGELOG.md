# Changelog

All notable changes follow [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-06-22

### Fresh start — minimal multi-agent orchestrator

Rebuilt from scratch with ponytail principles. Replaces the over-engineered `opencode-ollama-orchestrator` (32 files, 5,579 lines) with a minimal plugin (3 files, 455 lines).

### What it does
- Strategist (primary) → Architect (plan) → Engineer(s) (code) → Auditor (verify)
- Ponytail lazy-dev ruleset injected into every system prompt
- Automation toggle: `false` (human gates) or `true` (fully autonomous)
- 3 tools: `start_mission`, `abort_mission`, `delegate_task`
- 5 agents: strategist, architect, engineer, auditor, specialist

### What was removed (vs opencode-ollama-orchestrator)
- DOX system, backup system, hallucination guard, token budget manager
- Rate limiter, notifier, config-loader, atomic writes, paths utility
- Fast mode controller, mode resolution system, spark agent
- 6 unnecessary tools (skip_task, resume_from, revert_mission, check_watchdog, auto_run, toggle_automation, mission_status)
- Duplicate type files, god class MissionController (1,262 lines)
- Session manager (346 lines), mission store (202 lines)

### Test Results
- 12 tests passing (2 test files)
- Typecheck clean