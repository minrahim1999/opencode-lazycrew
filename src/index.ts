/**
 * opencode-lazycrew — minimal multi-agent pipeline for OpenCode.
 *
 * Flow: user types task → strategist asks "proceed?" → architect plans
 * → engineers execute in parallel → auditor verifies → done.
 *
 * Config in opencode.json:
 *   { "plugin": [["opencode-lazycrew", { "automation": false, "ponytail": "full" }]] }
 *
 * - automation: false (default) = human gates via question tool
 * - automation: true = fully autonomous, no gates
 * - ponytail: "off" | "lite" | "full" (default) | "ultra"
 */

import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
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
  const automation = opts.automation === true;
  const ponytailLevel = PONYTAIL.normalize(opts.ponytail);

  // Register agents in opencode config
  const agents = Orchestrator.agents(automation);

  // Create orchestrator instance
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
          "Start the multi-agent pipeline: architect plans, engineers execute in parallel, auditor verifies. Call AFTER user confirms via question tool.",
        args: {
          description: tool.schema
            .string()
            .describe("Full task description"),
        },
        execute: async (args: { description: string }) => {
          orch.start(args.description).catch((err) =>
            console.error("[orchestrator] mission failed:", err),
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
    },
  };
};

export default plugin;