import { Command } from "commander";
import { contextFor, outputData, runCommand } from "@hellotracks/ht-core/commands/support.js";

interface CommandEntry {
  command: string;
  description: string;
  arguments: Array<{ name: string; required: boolean; variadic: boolean; description: string }>;
  options: Array<{ flags: string; description: string; default?: unknown }>;
}

// Every visible command with its arguments and options, read from the command tree itself.
export function listCommands(program: Command): CommandEntry[] {
  const entries: CommandEntry[] = [];
  const visit = (command: Command, prefix: string) => {
    for (const child of command.commands) {
      if ((child as unknown as { _hidden?: boolean })._hidden || child.name() === "help") {
        continue;
      }
      const name = `${prefix} ${child.name()}`;
      if (child.commands.length === 0) {
        entries.push({
          command: name,
          description: child.description(),
          arguments: child.registeredArguments.map((argument) => ({
            name: argument.name(),
            required: argument.required,
            variadic: argument.variadic,
            description: argument.description
          })),
          options: child.options.filter((option) => !option.hidden).map((option) => ({
            flags: option.flags,
            description: option.description,
            ...(option.defaultValue !== undefined && !(Array.isArray(option.defaultValue) && option.defaultValue.length === 0) ? { default: option.defaultValue } : {})
          }))
        });
      }
      visit(child, name);
    }
  };
  visit(program, program.name());
  return entries;
}

export function registerCommands(program: Command): void {
  const commands = program.command("commands")
    .description("List every command; with --json, also each argument and option, for agents and scripts");
  commands.action(() => runCommand(async () => {
    const context = contextFor(commands);
    const entries = listCommands(program);
    if (context.output === "json" || context.output === "yaml") {
      outputData(commands, { globalOptions: program.options.filter((option) => !option.hidden).map((option) => ({ flags: option.flags, description: option.description })), commands: entries }, "pretty");
      return;
    }
    const width = Math.max(...entries.map((entry) => entry.command.length));
    outputData(commands, entries.map((entry) => `${entry.command.padEnd(width)}  ${entry.description}`).join("\n"), "pretty");
  }));
}
