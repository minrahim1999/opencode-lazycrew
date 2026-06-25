/**
 * opencode-lazycrew — minimal multi-agent pipeline for OpenCode (v1.6.0 extremist).
 *
 * Flow: user types task → strategist checks lazycrew_state → asks resume?
 * → asks "proceed?" → architect plans → engineers execute → auditor verifies → done.
 *
 * Config in opencode.json:
 *   { "plugin": [["opencode-lazycrew", { "automation": false, "ponytail": "full" }]] }
 *
 * - automation: false (default) = human gates via question tool
 * - automation: true = fully autonomous, no gates
 * - ponytail: "off" | "lite" | "full" (default) | "ultra"
 *
 * Both settings can be switched at runtime via the `lazycrew_config` tool.
 * Plans and todos are saved as files (.opencode/plans/, .opencode/todo/).
 * Sessions are managed by OpenCode natively. No state management needed.
 */

import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PONYTAIL, ponytailInstructions } from "./ponytail.js";
import { Orchestrator } from "./orchestrator.js";

const plugin: Plugin = async (input) => {
  const { client, directory } = input;

  // Read config from opencode.json plugin block
  const rawPlugin = (input as any).config?.plugin ?? [];
  const entry = Array.isArray(rawPlugin)
    ? rawPlugin.find(
        (p: any) =>
          p === "opencode-lazycrew" ||
          (Array.isArray(p) && p[0] === "opencode-lazycrew"),
      )
    : null;
  const opts = (Array.isArray(entry) ? entry[1] : null) ?? {};

  // Mutable runtime config — switchable via lazycrew_config tool
  let automation = opts.automation === true;
  let ponytailLevel = PONYTAIL.normalize(opts.ponytail);

  // Path to opencode.json for persisting config changes
  const configPath = join(
    process.env.XDG_CONFIG_HOME || join(process.env.HOME || "", ".config"),
    "opencode",
    "opencode.json",
  );

  /** Write a setting back to opencode.json plugin block */
  function persistConfig(key: string, value: any): void {
    try {
      const raw = readFileSync(configPath, "utf-8");
      const config = JSON.parse(raw);
      if (!Array.isArray(config.plugin)) return;
      const idx = config.plugin.findIndex(
        (p: any) =>
          p === "opencode-lazycrew" ||
          (Array.isArray(p) && p[0] === "opencode-lazycrew"),
      );
      if (idx === -1) return;
      // Ensure plugin block is [name, opts] format
      if (!Array.isArray(config.plugin[idx])) {
        config.plugin[idx] = [config.plugin[idx], {}];
      }
      if (!config.plugin[idx][1]) config.plugin[idx][1] = {};
      config.plugin[idx][1][key] = value;
      writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    } catch (err) {
      console.warn(`[lazycrew] could not persist ${key} to opencode.json:`, err);
    }
  }

  // Register agents (based on initial automation setting)
  const agents = Orchestrator.agents(automation);
  const orch = new Orchestrator({ client, directory, automation });
  // Enforce workspace on plugin load — every project gets .opencode/ immediately
  orch.ensureWorkspace();

  return {
    config: async (config: any) => {
      if (!config.agent) config.agent = {};

      // Register lazycrew commands
      config.command = config.command || {};
      config.command["lazycrew"] = {
        template: "<action> [description...]",
        description: "LazyCrew mission control — /lazycrew mission <desc>, /lazycrew plan <desc>, /lazycrew status, /lazycrew abort",
      };

      // Capture model assignments from user config
      const models: Record<string, string | undefined> = {};

      /** Whitelist merge: only model, temperature, skills can be overridden.
       *  Everything else (tools, permission, mode, prompt, description)
       *  is locked to plugin defaults. If user tries to override them,
       *  we discard their values and keep ours. */
      const ALLOWED_OVERRIDES = ["model", "temperature", "skills"];

      for (const [name, cfg] of Object.entries(agents)) {
        const userCfg = config.agent[name] ?? {};
        const merged: any = { ...cfg };
        for (const key of ALLOWED_OVERRIDES) {
          if (userCfg[key] !== undefined) merged[key] = userCfg[key];
        }
        config.agent[name] = merged;
        // Capture model if user set one
        if (userCfg.model) {
          models[name] = userCfg.model;
        }
      }

      // Pass models to orchestrator so it can pass them to session.prompt
      orch.setModels(models);
    },

    "command.execute.before": async (input: any, output: any) => {
      const commandStr = (input.command || "").trim();
      const args = (input.arguments || "").trim();

      // Only handle /lazycrew commands
      if (commandStr !== "lazycrew") return;

      const [action, ...descParts] = args.split(/\s+/);
      const description = descParts.join(" ").trim();

      switch (action) {
        case "mission": {
          if (!description) {
            output.parts = [{ text: "❌ Usage: /lazycrew mission <task description>" }];
            return;
          }
          // Resume check
          const recovery = orch.recoverMission();
          if (recovery) {
            output.parts = [{ text: `${recovery}\n\nPlease resolve the interrupted mission first (resume via /lazycrew resume), then start a new one.` }];
            return;
          }
          const log = await orch.start(description);
          output.parts = [{ text: log.join("\n") }];
          return;
        }

        case "plan": {
          if (!description) {
            output.parts = [{ text: "❌ Usage: /lazycrew plan <task description>" }];
            return;
          }
          // Force architect to write plan + todo
          const result = await orch.forcePlan(description);
          output.parts = [{ text: result }];
          return;
        }

        case "status": {
          const state = orch.getState();
          if (!state.active) {
            output.parts = [{ text: "No active mission.\n\nUse /lazycrew mission <description> to start one." }];
            return;
          }
          const { done, total, failed } = orch.getProgress();
          output.parts = [{ text: `Mission: ${state.slug}\nProgress: ${done}/${total} done, ${failed} failed\nDescription: ${state.description.slice(0, 200)}${state.description.length > 200 ? "..." : ""}` }];
          return;
        }

        case "abort": {
          orch.abort();
          output.parts = [{ text: "✅ Mission aborted." }];
          return;
        }

        case "resume": {
          const recovery = orch.recoverMission();
          if (!recovery) {
            output.parts = [{ text: "No interrupted mission found. Use /lazycrew mission <description> to start new." }];
            return;
          }
          // Start with the recovered description
          const state = orch.getState();
          const log = await orch.start(state.description);
          output.parts = [{ text: log.join("\n") }];
          return;
        }

        default: {
          output.parts = [{ text: `LazyCrew commands:
/lazycrew mission <description> — Force start pipeline
/lazycrew plan <description> — Force architect to write plan + todo
/lazycrew status — Show mission progress
/lazycrew abort — Abort active mission
/lazycrew resume — Resume interrupted mission

Or just type your question — the strategist auto-detects tasks.` }];
          return;
        }
      }
    },

    "experimental.chat.system.transform": async (_input: any, output: any) => {
      if (ponytailLevel === "off") return;
      output.system.push(ponytailInstructions(ponytailLevel));
    },

    tool: {
      start_mission: tool({
        description:
          "Start the multi-agent pipeline: architect plans, engineers execute, auditor verifies. Call AFTER user confirms via question tool.",
        args: {
          description: tool.schema
            .string()
            .describe("Full task description"),
        },
        execute: async (args: { description: string }) => {
          const log = await orch.start(args.description);
          return log.join("\n");
        },
      }),

      abort_mission: tool({
        description: "Abort all active missions.",
        args: {},
        execute: async () => {
          orch.abort();
          return "All missions aborted.";
        },
      }),

      delegate_task: tool({
        description:
          "Delegate a subtask to a specific agent (architect, engineer, auditor, specialist).",
        args: {
          agent: tool.schema
            .string()
            .describe("Agent name: architect, engineer, auditor, or specialist"),
          prompt: tool.schema.string().describe("Task prompt for the agent"),
        },
        execute: async (args: { agent: string; prompt: string }) => {
          const validAgents = ["architect", "engineer", "auditor", "specialist"];
          if (!validAgents.includes(args.agent)) {
            return `Error: "${args.agent}" is not a valid lazycrew agent. Valid agents: ${validAgents.join(", ")}`;
          }
          return await orch.delegate(args.agent, args.prompt);
        },
      }),

      lazycrew_state: tool({
        description:
          "Check the current mission state and scan for incomplete todos. Call this on first interaction to offer resume, or after timeout/compaction.",
        args: {},
        execute: async () => {
          const recovery = orch.recoverMission();
          const incomplete = orch.scanIncompleteMissions();
          
          if (incomplete.length > 0) {
            const lines = incomplete.map((m) => 
              `- ${m.slug}: ${m.done}/${m.total} done, ${m.failed} remaining`
            );
            if (recovery) {
              return `${recovery}\n\nAlso found incomplete todos from other missions:\n${lines.join("\n")}\n\nUse start_mission to restart, or delegate_task to retry individual tasks.`;
            }
            return `Incomplete missions found:\n${lines.join("\n")}\n\nUse start_mission with the mission description to resume, or delegate_task for specific tasks.`;
          }
          
          if (recovery) {
            return `${recovery}\n\nUse start_mission to restart, or delegate_task to retry individual failed tasks.`;
          }
          return "No incomplete missions found. Ready to start new mission.";
        },
      }),

      lazycrew_config: tool({
        description:
          "Switch automation and/or ponytail settings at runtime. No restart needed. Pass only the fields you want to change.",
        args: {
          automation: tool.schema
            .boolean()
            .optional()
            .describe("true = fully autonomous (no human gates), false = human interaction"),
          ponytail: tool.schema
            .string()
            .optional()
            .describe("Ponytail level: off, lite, full, or ultra"),
        },
        execute: async (args: { automation?: boolean; ponytail?: string }) => {
          const changes: string[] = [];
          if (args.automation !== undefined) {
            automation = args.automation;
            orch.setAutomation(automation);
            persistConfig("automation", automation);
            changes.push(`automation = ${automation ? "ON (autonomous)" : "OFF (human gates)"}`);
          }
          if (args.ponytail !== undefined) {
            ponytailLevel = PONYTAIL.normalize(args.ponytail);
            persistConfig("ponytail", ponytailLevel);
            changes.push(`ponytail = ${ponytailLevel}`);
          }
          if (changes.length === 0) {
            return `Current settings — automation: ${automation ? "ON" : "OFF"}, ponytail: ${ponytailLevel}`;
          }
          return `Updated and saved to opencode.json: ${changes.join(", ")}`;
        },
      }),
    },
  };
};

export default plugin;