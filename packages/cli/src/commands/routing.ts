import { Command } from "commander";
import { optimizeRoutingAction } from "@hellotracks/ht-core/actions/index.js";
import { outputData, promptIfMissing, runCommand, contextFor } from "@hellotracks/ht-core/commands/support.js";
import { resolveDateWord } from "@hellotracks/ht-core/utils.js";

export function registerRouting(program: Command): void {
  const routing = program.command("routing").description("Run routing operations");

  routing.command("optimize")
    .description("Put one member's jobs for a day in the best order and save that order")
    .option("--date <date>", "Day to optimize: YYYY-MM-DD, today, yesterday, or tomorrow")
    .option("--account <account>", "Member username or id whose route is optimized")
    .option("--account-id <accountId>", "Member id; same as --account")
    .option("--solve", "Use the route solver: honors working hours, time windows, skills, and capacity, and lists jobs it cannot fit as unassigned")
    .option("--index <index>", "Without --solve: first stop to reorder, 0-based; use with --count")
    .option("--count <count>", "Without --solve: number of stops to reorder from --index")
    .option("--constraints-json <constraintsJson>", "With --solve: JSON such as {\"working_hours\":true,\"time_window\":true,\"skills\":true,\"capacity\":true,\"max_jobs\":20}")
    .addHelpText("after", `

Examples:
  ht routing optimize --account alice --date today
  ht routing optimize --account alice --date today --solve
  ht routing optimize --account alice --date today --solve --constraints-json '{"time_window":false}'

The new order is saved and shown to the member and the office.
`)
    .action((options) => runCommand(async () => {
      const command = routing.commands.find((entry) => entry.name() === "optimize")!;
      const context = contextFor(command);
      const account = options.accountId ? undefined : await promptIfMissing(context, "Account UID", options.account);
      const date = resolveDateWord(await promptIfMissing(context, "Date (YYYY-MM-DD, today, yesterday, or tomorrow)", options.date));
      const body = {
        accountId: options.accountId,
        account,
        date,
        solve: Boolean(options.solve),
        index: options.index ? Number.parseInt(options.index, 10) : undefined,
        count: options.count ? Number.parseInt(options.count, 10) : undefined,
        constraints: options.constraintsJson ? JSON.parse(options.constraintsJson) : undefined
      };
      const data = await optimizeRoutingAction(context, body);
      outputData(command, data, "pretty");
    }));
}
