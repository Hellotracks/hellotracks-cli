import { Command } from "commander";
import { finishSignupAction, resolveActionEnvironment, startSignupAction, type SignupCompanyInput } from "@hellotracks/ht-core/actions/index.js";
import { reportStoredEmailCodeKey } from "@hellotracks/ht-core/commands/auth.js";
import { contextFor, outputData, promptIfMissing, runCommand } from "@hellotracks/ht-core/commands/support.js";
import { clearPendingSignup, readPendingSignup, savePendingSignup } from "@hellotracks/ht-core/config/pending-signup.js";
import { confirm, promptText, success } from "@hellotracks/ht-core/ui/tty.js";
import type { CommandContext } from "@hellotracks/ht-core/types.js";

const TERMS_URL = "https://hellotracks.com/terms-of-service";
const DASHBOARD_URL = "https://live.hellotracks.com";
const DASHBOARD_SIGN_IN = `The dashboard is at ${DASHBOARD_URL}: sign in with Google, or use "Forgot password?" there to set a password.`;

interface SignupOptions {
  email?: string;
  name?: string;
  company?: string;
  address?: string;
  lat?: string;
  lng?: string;
  timezone?: string;
  acceptTerms?: boolean;
  code?: string;
  keyFile?: string;
}

function interactive(context: CommandContext): boolean {
  return !context.noInput && Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);
}

function machineOutput(context: CommandContext): boolean {
  return context.output === "json" || context.output === "yaml" || context.output === "ndjson";
}

function coordinate(value: string | number | undefined, label: string): number | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`${label} must be a number.`);
  }
  return number;
}

function companyInput(name: string, address: string | undefined, lat: number | undefined, lng: number | undefined): SignupCompanyInput {
  if (!address && (lat === undefined || lng === undefined)) {
    throw new Error("--address (or --lat and --lng) is required: it centers your maps and starts your routes.");
  }
  return {
    name,
    ...(address ? { address } : {}),
    ...(lat !== undefined && lng !== undefined ? { location: { lat, lng } } : {})
  };
}

async function finish(command: Command, context: CommandContext, options: SignupOptions, code: string): Promise<void> {
  const environment = await resolveActionEnvironment(context, { requireAuth: false });
  const pending = await readPendingSignup(environment.profileName);
  const email = options.email ?? pending?.email;
  const company = options.company ?? pending?.company;
  if (!email || !company) {
    throw new Error("No sign-up is waiting for a code on this profile. Start one with: ht signup --email <email> ...");
  }
  const input = companyInput(
    company,
    options.address ?? pending?.address,
    coordinate(options.lat, "--lat") ?? pending?.lat,
    coordinate(options.lng, "--lng") ?? pending?.lng
  );
  const stored = await finishSignupAction(context, { email, code, company: input });
  await clearPendingSignup(environment.profileName);
  await reportStoredEmailCodeKey(command, stored, options.keyFile);
  if (!machineOutput(context)) {
    success("Next: ht members create --username <their email> --name <name> invites your first worker to the app.");
    success(DASHBOARD_SIGN_IN);
  }
}

export function registerSignup(program: Command): void {
  program.command("signup")
    .description("Create a Hellotracks company from the command line; a 6-digit code sent to your email proves it's yours")
    .option("--email <email>", "Your email: the code goes there and it becomes your login (no password needed)")
    .option("--name <name>", "Your own name")
    .option("--company <company>", "The company's name")
    .option("--address <address>", "The company's address; it centers your maps and starts your routes")
    .option("--lat <lat>", "The company's latitude, instead of or as well as --address")
    .option("--lng <lng>", "The company's longitude, with --lat")
    .option("--timezone <timezone>", "IANA time zone such as America/Los_Angeles (default: this computer's)")
    .option("--accept-terms", `You accept the terms of service at ${TERMS_URL}`)
    .option("--code <code>", "The 6-digit code from the email; finishes a sign-up started earlier on this profile")
    .option("--key-file <path>", "Also write the new API key to this file (mode 600), for CI secrets")
    .addHelpText("after", `

Examples:
  ht signup                                          # asks for everything, then for the code
  ht signup --email sam@acme.com --name "Sam Lee" --company "Acme Plumbing" \\
    --address "1 Ferry Building, San Francisco" --accept-terms
  ht signup --code 482913                            # finish with the code from the email

The person signing up reads and accepts ${TERMS_URL}; an agent passes --accept-terms only
when they said so. The code works for 30 minutes. The API key is stored like one from "ht auth login" and works
for 90 days; "ht auth login --email" makes a new one. Already have an account? Use: ht auth login --email
${DASHBOARD_SIGN_IN}
`)
    .action((options: SignupOptions, command: Command) => runCommand(async () => {
      const context = contextFor(command);
      if (options.code) {
        await finish(command, context, options, options.code);
        return;
      }

      const email = await promptIfMissing(context, "Your email", options.email);
      const name = await promptIfMissing(context, "Your name", options.name);
      const company = await promptIfMissing(context, "Company name", options.company);
      const lat = coordinate(options.lat, "--lat");
      const lng = coordinate(options.lng, "--lng");
      const address = options.address ?? (lat === undefined && interactive(context) ? await promptText("Company address") : undefined);
      companyInput(company, address, lat, lng);
      let acceptTerms = options.acceptTerms === true;
      if (!acceptTerms && interactive(context)) {
        acceptTerms = await confirm(`Do you accept the terms of service at ${TERMS_URL}?`);
      }
      if (!acceptTerms) {
        throw new Error(`Read ${TERMS_URL} and pass --accept-terms to sign up.`);
      }

      const timezone = options.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
      const sent = await startSignupAction(context, { email, name, timezone, acceptTerms });
      const environment = await resolveActionEnvironment(context, { requireAuth: false });
      await savePendingSignup(environment.profileName, { email, name, company, address, lat, lng, apiUrl: environment.apiUrl, createdAt: Date.now() });

      if (!interactive(context)) {
        if (machineOutput(context)) {
          outputData(command, { ...sent, next: "ht signup --code <code>" }, "pretty");
        } else {
          success(`A 6-digit code is on its way to ${sent.email} (valid ${Math.round(sent.codeExpiresInSeconds / 60)} minutes).`);
          success("Finish with: ht signup --code <code>");
        }
        return;
      }
      success(`A 6-digit code is on its way to ${sent.email}.`);
      await finish(command, context, options, await promptText("Code from the email"));
    }));
}
