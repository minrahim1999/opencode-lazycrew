# Changelog

All notable changes follow [Semantic Versioning](https://semver.org/).

## [1.6.0] - 2026-06-25

### Added: Extremist Enforcement Mode

**Problem:** In v1.5.x, agents were told to write plans and todos, but there was no enforcement. Architects could skip files. Engineers could forget todo updates. The plugin trusted agents and hoped for the best. This caused silent failures, incomplete missions, and lost work.

**Fixed — "Extremist" guarantees:**

1. **Workspace Auto-Enforcement** — `start_mission` now calls `ensureWorkspace()` which:
   - Creates `.opencode/plans/` and `.opencode/todo/` directories via `mkdirSync(..., { recursive: true })`
   - Reads `.gitignore` and appends `.opencode` if not already present
   - This is done by the **plugin directly**, not delegated to agents

2. **Mandatory Plan + Todo** — After architect runs, the plugin **verifies both files exist**:
   - `.opencode/plans/{slug}/plan.md` (procedure document)
   - `.opencode/todo/{slug}.md` (execution checklist)
   - If either is missing → retries architect up to 2 times
   - If still missing after retries → aborts mission with clear error

3. **Plan vs Todo Separation** — Architect prompt now explicitly distinguishes:
   - **Plan** = procedure document (what, how, why, acceptance criteria, rollback)
   - **Todo** = execution checklist (checkboxes with TASK-XXX IDs, Evidence field)
   - Two separate files, two separate purposes. No combining allowed.

4. **Force Todo Update** — After engineer completes a task:
   - Plugin reads todo file, searches for `[x] TASK-XXX`
   - **Not found?** → Engineer is **force-retried** with strict prompt: "You forgot to update the todo. Read the file, find your task, change `[ ]` to `[x]`, add Evidence. Do NOT re-implement any code."
   - Still not found after retry? → Marked FAILED, not done
   - No silent failures. No "assume done."

5. **Startup Resume Check** — `lazycrew_state` tool now:
   - Scans `.opencode/todo/*.md` for any file with unchecked tasks (`[ ]`)
   - Returns all incomplete missions with progress counts (e.g. "`build-auth`: 3/5 done, 2 remaining")
   - Strategist prompt updated: **"NEVER start a new mission without checking `lazycrew_state` first"**
   - If incomplete missions found → strategist asks user: "Resume 'X'?" with [Resume, Start New, Cancel]

### Changed
- **Architect prompt** — Now includes explicit plan format with Overview, Procedure (per-task sections), Rollback Plan, and Notes. Todo format now requires Evidence field.
- **Engineer prompt** — Added "Retry Rule" section: "If called back to update a todo you forgot, do NOT re-implement — just update the checkbox."
- **Strategist prompt** — Added startup resume check. Step 6 now requires calling `lazycrew_state` before any mission. Compaction recovery also updated.
- **Architect permissions** — `.gitignore` added to `PLAN_WRITE` allowlist so architect can write it if needed (though plugin handles it directly).

### Tests
- 40 tests passing (up from 31)
- New tests: workspace enforcement, architect retry, engineer force-retry, incomplete mission scanning, mission recovery
- Build clean

## [1.5.6] - 2026-06-24

### Fixed: Plugin never created `.opencode/plans/` or `.opencode/todo/` directories

**Problem:** The architect prompt instructed: *"Write plan to .opencode/plans/{slug}/plan.md"* and *"Write todos to .opencode/todo/{slug}.md"* — but the plugin never created these directories. When the architect tried to write via the `write` tool, the directories didn't exist and writes silently failed. No plan, no todos, no pipeline.

**Fixed:** `start_mission` now calls `mkdirSync(..., { recursive: true })` for both directories before delegating to architect. Also fixed `tools` constants mixing `"allow"` strings with booleans — now all tools entries use booleans.

### Added: Mission state tracking for timeout/compaction recovery

**Problem:** After strategist timeout or context compaction, the plugin had no way to know if a mission was running. The strategist had to manually check `.opencode/todo/` files and guess at state.

**Added:**
- `lazycrew-state.json` file written to `.opencode/lazycrew-state.json` — tracks mission status, progress, timestamps
- `lazycrew_state` tool — strategist can call this to check if a mission was interrupted and get a human-readable summary
- `recoverMission()` method — returns contextual recovery message based on status (`completed`, `aborted`, `paused`, `executing`, `error`)
- Updated strategist prompt: compaction recovery now says "Call `lazycrew_state` tool" instead of "check todo files"
- Strategist now has `lazycrew_state` in both `tools` and `permission`

### Tests
- 31 tests passing, build clean
- New `saveState`/`getMissionState`/`recoverMission` methods are internal and exercised via existing orchestrator tests

## [1.5.5] - 2026-06-24

### Fixed: Strategist couldn't show question modal (missing `question` tool)

**Problem:** The strategist prompt instructs: *"ALWAYS call the 'question' tool for interactions. NEVER write plain text questions."* But the strategist's `tools` object in `orchestrator.ts` only included `start_mission`, `abort_mission`, `delegate_task`, and `lazycrew_config`. `question` was missing. The strategist had `question: "allow"` in `permission`, but without the tool registration, it couldn't actually invoke the question modal.

**Result:** Instead of showing the "Proceed?" question modal, the strategist either wrote plain text questions (which users can't interact with) or silently proceeded without asking. The pipeline gate was broken.

**Fixed:** Added `question: true` to strategist's `tools` object. Now strategist can properly invoke the question tool for "Proceed?" gates and failure recovery prompts.

**Tests:** 31 tests passing, build clean.

## [1.5.4] - 2026-06-24

### Changed: Agent config is now guard-railed — only model, temperature, skills are user-overridable

**Problem:** Even after v1.5.3's deep-merge fix, users could still accidentally or intentionally override `permission`, `tools`, `mode`, `prompt`, or `description` in their `opencode.json`. This was a foot-gun — one bad agent config could silently break the pipeline again.

**Changed:**
- **`index.ts` config hook**: Whitelist merge. Only three keys can be overridden from `opencode.json`:
  - `model` — which model runs the agent
  - `temperature` — creativity / determinism
  - `skills` — additional skills to load
- Everything else (`permission`, `tools`, `mode`, `prompt`, `description`, `maxTokens`, `steps`, etc.) is **locked** to plugin defaults. If the user sets them, they are **discarded**.
- This makes lazycrew agents a sealed unit: you pick the model and temperature, we handle permissions, tools, prompts, and behavior.

### Fixed: Specialist could not write diagnosis (permission mismatch)

**Problem:** Specialist prompt instructed: *"Write diagnosis to .opencode/todo/{slug}.md: DIAGNOSIS: ..."* but the agent config had `permission: READ_ONLY` (no write access). When strategist delegated to specialist on a stuck mission, specialist got permission-denied and failed silently.

**Fixed:** `orchestrator.ts`: Specialist permission changed from `READ_ONLY` to `PLAN_WRITE` (same as architect — can write to `.opencode/plans/`, `.opencode/todo/`, and `AGENTS.md` only).

### Fixed: Compaction recovery prompt lied about "resume"

**Problem:** Strategist prompt said: *"If user says yes → call start_mission with the remaining tasks"* — but `start_mission` tool has no "remaining tasks" parameter. It always restarts the full pipeline. User expected resume, got restart.

**Fixed:** Updated strategist prompt to say "Restart?" and explicitly note: *"this RESTARTS the full pipeline from the beginning, not a resume."*

### Fixed: `delegate_task` accepted any agent name without validation

**Problem:** If strategist hallucinated and delegated to `"build"` or `"explore"`, the tool silently ran it. Might work, might fail weirdly, no feedback.

**Fixed:** `index.ts`: Added validation in `delegate_task` tool — rejects invalid agent names with explicit error listing valid options.

### Added: Warning for invalid model format

**Problem:** Model strings without `provider/` prefix (e.g. `"kimi-k2.7-code"` instead of `"ollama/kimi-k2.7-code"`) silently fell back to the global default. User thought they assigned a model but didn't.

**Fixed:** `orchestrator.ts`: Added `console.warn` when model format is invalid, so the user knows immediately.

### Test Results
- 31 tests passing (2 test files) — unchanged count, existing suite still green
- Build clean

## [1.5.3] - 2026-06-24

### Fixed: Permission clobbering in config merge

**Problem:** Plugin used shallow object merge (`{ ...cfg, ...userCfg }`) in the config hook. When `opencode.json` defined agent-level `permission` or `tools` objects (even partial ones), they **replaced** the plugin's defaults entirely.

Result: strategist lost `start_mission`, `delegate_task`, and `lazycrew_config` tools silently. Could not drive the pipeline. Fell back to `task` tool → spawned built-in subagents (`explore`, `general`, `scout`) instead of custom agents.

**Fixed:**
- **`index.ts`**: Replaced shallow merge with `deepMerge()` that recursively merges nested objects (`permission`, `tools`, etc.) while replacing arrays
- User overrides still work at the leaf level (e.g. change `edit` from `"allow"` to `"deny"`)
- Plugin's required permissions (`start_mission: "allow"`, etc.) are preserved even if user's config doesn't mention them

### Test Results
- Build clean (`npm run build`)

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