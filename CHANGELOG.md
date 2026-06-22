# Changelog

All notable changes follow [Semantic Versioning](https://semver.org/).

## [1.2.1] - 2026-06-22

### Fix: Loading animation disappears and mission appears stuck

**Root cause:** `start_mission` tool was fire-and-forget — it returned immediately with "Mission started" text while the pipeline ran silently in the background. The strategist had nothing to do, so the loading animation stopped. When the user typed something, the strategist woke up and "suddenly resumed."

### Fixed
- **`orchestrator.ts`**: `start()` now returns `Promise<string[]>` — a progress log array. NOT fire-and-forget. The tool call stays open until the pipeline finishes, so the loading animation stays visible.
- **`index.ts`**: `start_mission` tool now `await`s the mission and returns the progress log (status lines with emoji: ▶ 📋 🔍 ✅).
- **`orchestrator.ts`**: Added "How start_mission Works" section to strategist prompt — explains that the tool stays open and returns a log.
- **`orchestrator.ts`**: Added "Compaction Recovery" section to strategist prompt — if context was compacted, check `.opencode/todo/` for unfinished missions and offer to resume.
- **`orchestrator.ts`**: Architect prompt now includes the slug in the prompt so the plan/todo filenames match.
- **`test/orchestrator.test.ts`**: 2 new tests for `start()` return type (14 total).

## [1.2.0] - 2026-06-22

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