// The skill `ht skills install` writes for Codex and Claude Code: how to run Hellotracks through ht.
// It is for people who use ht, so it says nothing about how ht itself is built or released.
export const HELLOTRACKS_SKILL = `---
name: hellotracks
description: Use when operating Hellotracks (field service tracking, dispatch, jobs, routes, timesheets, forms, reports) through the \`ht\` command-line interface.
---

# Hellotracks with ht

\`ht\` is the official Hellotracks command-line interface. It wraps the public API at
\`https://api.hellotracks.com/v1\` and is made for scripts, CI runners and coding agents.

## Before anything else

\`\`\`bash
ht auth whoami          # who am I, which company, which key
ht commands             # every command in one list; --json adds every option
ht <command> --help     # one command, with examples
\`\`\`

- Authenticate with \`ht auth login\`, \`HELLOTRACKS_API_KEY_FILE=/path/to/key\`, or
  \`printf '%s\\n' "$KEY" | ht --api-key-stdin <command>\`. Never put a key on the command line or in output.
- API keys come from the dashboard (Settings, API and Integrations) or \`ht apikeys create\`.
- No account yet? \`ht signup --email <their email> --name <name> --company <company> --address <address>
  --accept-terms\` creates one; the person gets a 6-digit code by email and gives it to you for
  \`ht signup --code <code>\`. Pass \`--accept-terms\` only after they agreed to
  https://hellotracks.com/terms-of-service. Admins without a key: \`ht auth login --email <email>\`, then
  \`--code\`. Never sign someone up or ask for a code they didn't expect. The new account has no password; for the
  dashboard at https://live.hellotracks.com they sign in with Google or set a password with "Forgot password?".
- Keep environments apart with profiles: \`ht profiles create staging --api-url <url>\`, then
  \`ht --profile staging ...\`. For production scripts add \`--confirm-profile <name>\`.

## Output and exit codes

- Default output is a readable table or summary. \`--json\` (or \`--output json|yaml|csv|ndjson\`) prints the raw
  API objects; use it whenever the result is parsed. \`--fields a,b\` and \`--sort field\` shape lists.
- Exit codes: 0 ok, 1 other error (also no network), 2 bad or missing API key, 3 invalid request, 4 not found,
  5 conflict, 6 rate limited, 7 a bulk run where some records failed, 10 server error. Writes are never retried.
- \`--no-input\` never prompts; \`--yes\` skips the confirmation of deletes and other destructive commands.

## Discover before guessing

\`\`\`bash
ht jobs columns          # CSV/JSON columns for import and sync; also members, places
ht jobs template         # copy-ready CSV
ht reports catalog       # the reports, their views, formats and periods
ht alerts actions        # alert rule kinds
ht maps layers           # map layer kinds
ht forms templates template --format yaml
\`\`\`

## Common work

\`\`\`bash
# Jobs: dates are YYYY-MM-DD, today, yesterday, or tomorrow
ht jobs list --date today
ht jobs list --date today --unassigned
ht jobs create --title "Boiler service" --address "Main St 1, Springfield" --external-id WO-1001 --date today --assignee-username alice@example.com
ht jobs sync --file work-orders.csv --upsert-by externalId --dry-run    # then again without --dry-run
ht jobs export --all-dates --updated-since yesterday --all --output ndjson

# Routes: put one member's day in the best order and save it
ht routing optimize --account alice@example.com --date today --solve

# People and places
ht members list
ht members locate <member-id>
ht members sync --file team.csv --dry-run
ht places list --query "Main St"
ht places sync --file sites.csv --upsert-by name --dry-run

# Webhooks: events are job_created, job_updated, job_completed, job_archived, job_deleted,
# job_checked, place_checked, clock_in_out, alert_triggered
ht webhooks set --event job_completed --url https://example.com/hooks/done --header "Authorization=Bearer $TOKEN"

# Reports: run in the background, the command waits and downloads
ht reports run timesheet --period lastWeek --format xlsx
ht reports run jobs --from 2026-10-01 --until 2026-10-31 --format csv --stdout
ht reports preview team-week --period lastWeek --json      # numbers without a file
ht reports saved create timesheet --every week --weekday monday --to alice@example.com

# Timesheets: the raw clock entries behind the timesheet report
ht timesheets list --date yesterday
ht timesheets add --member alice@example.com --date today --in 08:00 --out 16:30

# Forms: file first
ht forms templates template --format yaml > check.yaml
ht forms templates validate --file check.yaml && ht forms templates create --file check.yaml
ht forms submissions list --template <template-id>

# Alerts, ETA pages, maps
ht alerts recent --limit 20
ht eta create --job <job-id>               # a live arrival page at https://eta.page/...; you send the link
ht maps share members places jobs --title "Today" --expires 1d
\`\`\`

## Good to know

- \`jobs create\` with an \`--external-id\` that already exists updates that job, so syncs can be re-run.
- Bulk \`import\` and \`sync\` take CSV, JSON, NDJSON or YAML; always run \`--dry-run\` first and read the plan.
  They stop at the first failed record unless \`--continue-on-error\`; exit 7 means some failed, listed in \`errors\`.
  Dates in files must be YYYY-MM-DD; the date words only work in options. Jobs deleted in Hellotracks are not brought
  back by a sync: they show up under \`skipped\` (reason \`deleted\`).
- \`routing optimize\` saves the new order; members and the office see it right away.
- Report files from \`ht reports run\` come as signed links; anyone with a link can download the file until it expires.
- Classic report types (\`ht reports types\`, \`generate\`, \`recurring\`) still work; prefer \`ht reports catalog\` and \`run\`.
  For a big classic report add \`--background\`.
- Place custom fields (\`--extended-data-json\`, \`extendedData.*\` columns) change only the names given; null removes one.
- \`ht timesheets\` changes the underlying clock entries; reports only read them.
- ETA pages and map shares are public to anyone with the link until they expire or are revoked.
- \`members update --username\` renames a login (company admins only). Passwords can't be set
  through the API.
`;
