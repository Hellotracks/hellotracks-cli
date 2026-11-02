import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { outputData, runCommand } from "@hellotracks/ht-core/commands/support.js";
import { HELLOTRACKS_SKILL } from "../skill.js";

const SKILL_NAME = "hellotracks";

type AgentTarget = "codex" | "claude";

interface InstallTarget {
  agent: AgentTarget;
  directory: string;
  file: string;
}

interface InstallResult {
  skill: string;
  source: string;
  dryRun: boolean;
  installed: Array<{ agent: AgentTarget; path: string; status: "installed" | "would-install" }>;
}

function homeDir(): string {
  const home = os.homedir();
  if (!home) {
    throw new Error("Could not determine the current home directory.");
  }
  return home;
}

function targetRoot(agent: AgentTarget): string {
  const home = homeDir();
  return agent === "codex"
    ? path.join(process.env.CODEX_HOME || path.join(home, ".codex"), "skills")
    : path.join(process.env.CLAUDE_HOME || path.join(home, ".claude"), "skills");
}

function targetsFor(agent: string | undefined): InstallTarget[] {
  const normalized = (agent || "all").trim().toLowerCase();
  const agents: AgentTarget[] = normalized === "all"
    ? ["codex", "claude"]
    : normalized === "codex" || normalized === "claude"
      ? [normalized]
      : [];
  if (agents.length === 0) {
    throw new Error("Invalid agent target. Use codex, claude, or all.");
  }
  return agents.map((entry) => {
    const directory = path.join(targetRoot(entry), SKILL_NAME);
    return {
      agent: entry,
      directory,
      file: path.join(directory, "SKILL.md")
    };
  });
}

export async function installSkill(options: { agent?: string; dryRun?: boolean } = {}): Promise<InstallResult> {
  const targets = targetsFor(options.agent);
  const installed: InstallResult["installed"] = [];
  for (const target of targets) {
    if (!options.dryRun) {
      await fs.mkdir(target.directory, { recursive: true });
      await fs.writeFile(target.file, HELLOTRACKS_SKILL, "utf8");
    }
    installed.push({
      agent: target.agent,
      path: target.file,
      status: options.dryRun ? "would-install" : "installed"
    });
  }
  return {
    skill: SKILL_NAME,
    source: "built-in",
    dryRun: Boolean(options.dryRun),
    installed
  };
}

export function registerSkills(program: Command): void {
  const skills = program.command("skills").alias("skill").description("Install the Hellotracks skill, which teaches Codex and Claude Code how to use ht");

  skills.command("install")
    .description("Install the Hellotracks SKILL.md for Codex and Claude Code")
    .option("--agent <agent>", "codex | claude | all", "all")
    .option("--dry-run", "Show target paths without writing files")
    .addHelpText("after", `

Examples:
  ht skills install
  ht skill install
  ht skills install --agent codex
  ht skills install --agent claude --dry-run

Installs:
  Codex:      ~/.codex/skills/hellotracks/SKILL.md
  Claude Code: ~/.claude/skills/hellotracks/SKILL.md

Environment:
  CODEX_HOME   Override the Codex config directory
  CLAUDE_HOME  Override the Claude Code config directory`)
    .action((options) => runCommand(async () => {
      const command = skills.commands.find((entry) => entry.name() === "install")!;
      const result = await installSkill({ agent: options.agent, dryRun: options.dryRun });
      outputData(command, result, "pretty");
    }));
}
