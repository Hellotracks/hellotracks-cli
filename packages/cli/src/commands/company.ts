import { Command } from "commander";
import { showCompanyAction, updateCompanyAction } from "@hellotracks/ht-core/actions/index.js";
import { boolFlag, outputData, runCommand, contextFor } from "@hellotracks/ht-core/commands/support.js";
import { renderCompanyOverview } from "./company-presenter.js";

function outputCompany(command: Command, data: Record<string, unknown>): void {
  const context = contextFor(command);
  if (context.output === "json" || context.output === "yaml") {
    outputData(command, data, "pretty");
    return;
  }
  outputData(command, renderCompanyOverview(data, { verbose: context.verbose }), "pretty");
}

export function registerCompany(program: Command): void {
  const company = program.command("company").description("Inspect and update company settings");

  company.command("show")
    .description("Show writable company settings by default; use --verbose for read-only details or --json for raw output")
    .addHelpText("after", `

Default output is a compact human overview focused on fields you can change.
Use --verbose to include read-only identity fields and compact teamsConfig details.
Use --json or --output yaml to print the raw public API response.
`)
    .action(() => runCommand(async () => {
      const command = company.commands.find((entry) => entry.name() === "show")!;
      const data = await showCompanyAction(contextFor(command));
      outputCompany(command, data);
    }));

  company.command("update")
    .description("Update writable company settings")
    .option("--name <name>", "Company name")
    .option("--address <address>", "Company address")
    .option("--phone <phone>", "Company phone")
    .option("--email <email>", "Company email")
    .option("--api-enabled <boolean>", "Allow the public API and this CLI: true or false")
    .option("--workers-create-jobs <boolean>", "Workers may create jobs in the app")
    .option("--workers-edit-job <boolean>", "Workers may edit jobs in the app")
    .option("--workers-create-places <boolean>", "Workers may create places in the app")
    .option("--workers-view-places <boolean>", "Workers may see the company's places")
    .option("--workers-optimize-route <boolean>", "Workers may reorder their own route")
    .option("--workers-view-job-calendar <boolean>", "Workers may see jobs on other days")
    .option("--assistant-enabled <boolean>", "AI features for operators, such as assignee suggestions")
    .option("--trips-enabled <boolean>", "Show trips in the apps")
    .option("--job-groups-enabled <boolean>", "Allow job groups")
    .option("--snooze-notifications <boolean>", "Hide live pop-up notifications on the web for everyone")
    .option("--route-calc-include-company <boolean>", "Start and end routes at the location of the member's team")
    .option("--eta-page-default-show-worker-name <boolean>", "ETA pages show the worker's name unless a page says otherwise")
    .option("--eta-page-default-show-map <boolean>", "ETA pages show the live map unless a page says otherwise")
    .option("--workers-edit-trips <boolean>", "Workers may edit their own trips")
    .option("--trips-require-approval <boolean>", "Trips need the office's approval")
    .option("--workers-edit-working-hours <boolean>", "Workers may change their own working hours")
    .option("--workers-web-forms <boolean>", "Workers may fill in forms on the web")
    .option("--workers-allowed-tracking-off <boolean>", "Workers may turn tracking off")
    .option("--auto-checkins <boolean>", "Check people in and out of places automatically")
    .addHelpText("after", `

Only provided fields are changed. Boolean values accept true, false, 1, 0, yes, no, on, and off.

Examples:
  ht company update --name "Acme Field Ops"
  ht company update --api-enabled true
  ht company update --workers-create-jobs false --workers-edit-job false
  ht company update --eta-page-default-show-worker-name true --eta-page-default-show-map false

teamsConfig is currently read-only through the public API. Use ht company show --verbose to inspect it.
`)
    .action((options) => runCommand(async () => {
      const command = company.commands.find((entry) => entry.name() === "update")!;
      const body = {
        name: options.name,
        address: options.address,
        phone: options.phone,
        email: options.email,
        apiEnabled: boolFlag(options.apiEnabled),
        workersCreateJobs: boolFlag(options.workersCreateJobs),
        workersEditJob: boolFlag(options.workersEditJob),
        workersCreatePlaces: boolFlag(options.workersCreatePlaces),
        workersViewPlaces: boolFlag(options.workersViewPlaces),
        workersOptimizeRoute: boolFlag(options.workersOptimizeRoute),
        workersViewJobCalendar: boolFlag(options.workersViewJobCalendar),
        assistantEnabled: boolFlag(options.assistantEnabled),
        tripsEnabled: boolFlag(options.tripsEnabled),
        jobGroupsEnabled: boolFlag(options.jobGroupsEnabled),
        snoozeNotifications: boolFlag(options.snoozeNotifications),
        routeCalcIncludeCompany: boolFlag(options.routeCalcIncludeCompany),
        etaPageDefaultShowWorkerName: boolFlag(options.etaPageDefaultShowWorkerName),
        etaPageDefaultShowMap: boolFlag(options.etaPageDefaultShowMap),
        workersEditTrips: boolFlag(options.workersEditTrips),
        tripsRequireApproval: boolFlag(options.tripsRequireApproval),
        workersEditWorkingHours: boolFlag(options.workersEditWorkingHours),
        workersWebForms: boolFlag(options.workersWebForms),
        workersAllowedTrackingOff: boolFlag(options.workersAllowedTrackingOff),
        autoCheckins: boolFlag(options.autoCheckins)
      };
      const data = await updateCompanyAction(contextFor(command), body);
      outputCompany(command, data);
    }));
}
