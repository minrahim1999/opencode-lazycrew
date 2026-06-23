# Changelog

All notable changes follow [Semantic Versioning](https://semver.org/).

## [1.5.2] - 2026-06-23

### Fixed: Pipeline silently reported tasks as "done" when they actually failed

**Problem:** `runAgent()` returned text but `start()` ignored it. The `done++` counter always incremented after every engineer call, even if:
- The response was truncated (context limit hit)
- The response was empty
- The engineer never updated the todo file with `[x] TASK-XXX`

Result: Mission reported "✅ 5 done" when maybe only 3 actually completed. User had no way to know.

**Fixed:**
- **`orchestrator.ts`**: Added `isTaskCompleted()` method — reads the todo file and verifies the task has `[x]` checkbox with evidence
- **Completion gate**: After engineer returns, pipeline checks `isTaskCompleted(slug, taskId)` BEFORE incrementing `done`. If no evidence → task marked FAILED, not done
- **Pause on failure (non-automation mode)**: When `automation: false` (default), if a task fails or errors, the pipeline PAUSES and asks the user: "Retry? Skip? Abort?" — no silent continuation
- **Automation mode**: When `automation: true`, failures still log `⚠` but continue to next task (as before)
- **Audit logging**: Auditor result now captured and logged as `📋 TASK-XXX audit: PASS/FAIL`
- **Strategist prompt**: Updated to instruct reading the log for `⚠` failures and asking user before pretending success
- **Engineer prompt**: Added explicit instruction "After completing code, ALWAYS update the todo file with evidence" and warning "If you forget to update the todo, the task will be marked FAILED"

### Test Results
- 31 tests passing (2 test files) — unchanged count, existing suite still green
- Typecheck clean

## [1.5.1] - 2026-06-22

### Added: Context-limit truncation detection + continuation retry

**Problem:** Subagents sometimes hit their model's context limit and stop mid-generation (sudden stop). Lazycrew returned the partial response as-is, causing garbled output or silent mission failure.

**Fixed:**
- **`orchestrator.ts`**: `runAgent()` now detects truncation in two ways:
  1. `finishReason === "length"` from the API response
  2. Heuristic `looksTruncated()` function: checks for sentences ending without punctuation, open code blocks (unmatched ` ``` `), trailing `...`, and unclosed brackets in the final 200 characters
- **Continuation loop**: If truncation is detected, fires a follow-up `session.prompt` with `"Continue exactly from where you stopped. Do not repeat what you already wrote."` — up to 2 continuation attempts before giving up.
- **Result assembly**: All continuation chunks are concatenated into one coherent response, returned to the pipeline.

### Changed: Default model recommendations for cost optimization

**Problem:** All non-coding agents previously defaulted to `nemotron-3-super` or `deepseek-v4-flash`, which are more expensive than needed for lightweight tasks.

**Updated README + defaults:**
- **architect** → `gemini-3-flash-preview` (was `deepseek-v4-flash`) — planning is lightweight
- **auditor** → `gemini-3-flash-preview` (was `nemotron-3-super`) — read-only verification
- **specialist** → `deepseek-v4-flash` (was `nemotron-3-super`) — rare, needs reasoning
- **global `small_model`** → `gemini-3-flash-preview` (was `nemotron-3-super`)
- **engineer** stays `kimi-k2.7-code` — coding is where power matters most

### Test Results
- 31 tests passing (2 test files) — unchanged count, existing test suite still green
- Typecheck clean

## [1.5.0] - 2026-06-22

### Fixed: Ponytail ruleset synced with upstream

Audited embedded Ponytail against DietrichGebert/ponytail@main (v4.7.0). Found 7
missing pieces from the upstream ruleset. All now included:

1. **Persistence reinforcement** — "ACTIVE EVERY RESPONSE. No drift back to
   over-building. Still active if unsure." Previously a weak one-liner. Now a
   full section matching upstream.

2. **Deactivation commands** — "stop ponytail" / "normal mode" now recognized
   as standalone deactivation commands. Added `PONYTAIL.isDeactivationCommand()`
   utility (case-insensitive, ignores trailing punctuation, rejects partial
   matches like "add a normal mode toggle").

3. **Reflex-not-research principle** — "The ladder is a reflex, not a research
   project. Two rungs work → take the higher one and move on."

4. **No-re-arguing rule** — "User insists on full version → build it, no
   re-arguing." Prevents agents from repeatedly pushing lazy alternatives after
   the user explicitly asks for the full version.

5. **Hardware/physical world clause** — "Hardware is never the ideal on paper:
   a real clock drifts, a real sensor reads off. Leave the calibration knob."
   Important for IoT/embedded tasks.

6. **Testing (lazy but checked) section** — "Lazy code without its check is
   unfinished. Non-trivial logic leaves ONE runnable check: assert-based
   self-check or one small test file. No frameworks, no fixtures."

7. **Expanded `ponytail:` comment convention** — now shows both the simple
   intent marker (`// ponytail: this exists`) and the ceiling+upgrade-path
   pattern (`# ponytail: global lock, per-account locks if throughput matters`).

### Also fixed
- Removed stale "Phase Gates" section from README (phase gates were removed in
  v1.4.0 but the docs still referenced them).
- Updated Ponytail section in README with deactivation instructions and
  hardware clause mention.

### Test Results
- 31 tests passing (2 test files) — up from 21
  - ponytail.test.ts: 16 tests (was 9) — added persistence, reflex,
    no-re-arguing, hardware, testing, deactivation, comment convention tests
  - orchestrator.test.ts: 15 tests (unchanged)
- Typecheck clean

## [1.4.0] - 2026-06-22

### Fixed: 4 issues found in code review

1. **Dead phase gate code** — Strategist and architect prompts mentioned phase gates but `start()` never implemented them. Removed all phase gate references from prompts. Missions now run all tasks sequentially without pause points.

2. **No timeout on `runAgent()`** — If a subagent session hung (rate limit, model not responding), `session.prompt()` blocked forever. Fixed: `Promise.race()` with 5-minute timeout. Throws `Agent X timed out after 300s` instead of hanging indefinitely.

3. **`parseTodos()` too strict** — Only matched `- [ ] TASK-001:` format. If architect wrote `Task-001:` or plain `- [ ] Description`, parser returned empty array → mission completed with 0 tasks. Fixed: lenient parser now matches `TASK-001` (case-insensitive), bare numbers, and plain checkbox items with auto-assigned IDs.

4. **Automation toggle was cosmetic** — `setAutomation()` updated a boolean but `start()` never read it. The only difference was in the strategist prompt, set once at init. Now: prompts have no automation-specific text (phase gates removed), so automation toggle affects only future config-dependent behavior without dead code paths.

### Test Results
- 21 tests passing (2 test files)
- Typecheck clean

## [1.3.0] - 2026-06-22

### Fixed: 5 bugs found in code review

1. **Subagents used wrong model (or no model)** — `runAgent()` didn't pass `model` to `session.prompt()`. Subagents inherited the global default model instead of their assigned model. Fixed: config hook now captures model assignments from `opencode.json` and passes them to `session.prompt({ model: { providerID, modelID } })`.

2. **Sessions leaked** — `runAgent()` created sessions but never closed them. Long missions accumulated zombie sessions, consuming tokens and context. Fixed: `finally` block closes every session after prompt completes.

3. **Abort didn't stop the pipeline** — `abort()` set `active = false` but the task loop checked `active` at the top. By then the next `runAgent()` would re-set `active = true`. Fixed: separate `aborted` flag checked at the start of each task iteration.

4. **Task failures crashed the entire mission** — one engineer failure stopped all remaining tasks. Fixed: each task wrapped in try/catch, failures logged as `⚠`, mission continues to next task. Final summary reports `X done, Y failed`.

5. **`lazycrew_config` tool not registered in strategist permissions** — strategist couldn't call the config tool because it wasn't in its `tools` or `permission` blocks. Fixed: added `lazycrew_config: true` / `lazycrew_config: "allow"` to strategist config.

### Test Results
- 20 tests passing (2 test files)
- Typecheck clean

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