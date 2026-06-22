/**
 * opencode-lazycrew — minimal multi-agent pipeline for OpenCode.
 *
 * Flow: user types task → strategist asks "proceed?" → architect plans
 * → engineers execute → auditor verifies → done.
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

  return {
    config: async (config: any) => {
      if (!config.agent) config.agent = {};
      for (const [name, cfg] of Object.entries(agents)) {
        config.agent[name] = { ...cfg, ...(config.agent[name] ?? {}) };
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
          orch.start(args.description).catch((err) =>
            console.error("[lazycrew] mission failed:", err),
          );
          return `Mission started: ${args.description.slice(0, 80)}`;
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
          return await orch.delegate(args.agent, args.prompt);
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