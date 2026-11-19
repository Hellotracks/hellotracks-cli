import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { personContext } from "../api.js";
import type { Config } from "../config.js";
import type { Connection } from "../provider.js";
import { registerAlertTools } from "./alerts.js";
import { registerFormTools } from "./forms.js";
import { registerJobTools } from "./jobs.js";
import { Tools } from "./kit.js";
import { registerLinkTools } from "./links.js";
import { registerPlaceTools } from "./places.js";
import { registerReportTools } from "./reports.js";
import { registerTeamTools } from "./team.js";
import { registerTimesheetTools } from "./timesheets.js";

export const SERVER_INSTRUCTIONS = `Hellotracks runs a company's field team: people with the phone app, their jobs (visits, deliveries, appointments), places (customer sites), each person's route for the day, their timesheets, the forms they fill in, alerts and reports.
- Dates are YYYY-MM-DD or today/tomorrow/yesterday, in the company's time zone. Times are local HH:mm.
- Start with get_company (time zone, teams, settings) and get_team_status (who works today, where they are, how loaded they are). Use find_jobs for open or unassigned work.
- Before you add, change or delete anything, tell the person what will change and get a yes. Changes reach the workers' phones right away. Prefer archive over delete.
- optimize_route plans one person's day with the route solver (real roads, working hours, time windows, skills, capacity). Run it after you add or move jobs.
- Ids come from the find and get tools; keep them to change things later. Assign by member id from get_team_status.
- Arrival links and map links are public to anyone with the link until they expire; Hellotracks doesn't send them, you or the person do.
- Reports: preview_report for numbers to answer a question, run_report for a file.
- A new company has only the person who signed up and no jobs. Set it up with them, one step at a time: ask who is on the team and invite them with invite_members (each gets an email, and a text when you give a phone number, with the app link; they sign in with it). Then add the first places and jobs, assign them and run optimize_route. A member with lastSeen "never" has not opened the app yet. The person who signed up can install the Hellotracks app too and do a job themselves to see how it works.
- API keys, webhooks and billing are not here, on purpose: they are set up in the dashboard or with the ht command line.`;

/** One MCP server per request, for the connection the access token belongs to. */
export function createServer(connection: Connection, config: Config): McpServer {
  const server = new McpServer(
    { name: "hellotracks", title: "Hellotracks", version: "0.2.0", websiteUrl: "https://hellotracks.com" },
    { instructions: SERVER_INSTRUCTIONS }
  );
  const tools = new Tools(server, connection, personContext(config, connection.apiKey));
  registerTeamTools(tools);
  registerJobTools(tools);
  registerPlaceTools(tools);
  registerLinkTools(tools);
  registerTimesheetTools(tools);
  registerFormTools(tools);
  registerReportTools(tools);
  registerAlertTools(tools);
  return server;
}
