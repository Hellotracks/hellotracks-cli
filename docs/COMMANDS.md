# ht Command Reference

`ht` is the operational CLI for the Hellotracks public API. It is designed for dispatch operators, platform teams, CI jobs, and automation workflows.

## Global Flags

- `--profile <name>` selects a local profile.
- `--api-url <url>` overrides the public API base URL.
- `--api-key-stdin` reads the API key from stdin. `--api-key <key>` works too but shows the key in shell history and
  process lists; prefer stdin or `HELLOTRACKS_API_KEY_FILE`.
- `--json` is short for `--output json`.
- `--output pretty|table|json|yaml|csv|ndjson` selects output format.
- `--fields <a,b,c>` projects array output to specific fields.
- `--sort <field>` sorts array output; prefix with `-` for descending.
- `--request-id <id>` sends an `X-Request-ID` header.
- `--confirm-profile <name>` fails unless the selected profile matches.
- `--yes` skips destructive confirmations.
- `--no-input` disables prompts.
- `--quiet` hides notices on stderr. `--verbose` logs each HTTP request on stderr (never the key) and adds read-only
  details to human output.
- `--no-update-check` skips the daily check for a newer release.

Date options accept `YYYY-MM-DD`, `today`, `yesterday`, and `tomorrow`, as your computer's local day. Files for
`import` and `sync` need `YYYY-MM-DD`.

## Output, Errors, And Exit Codes

Without `--json` or `--output`, output is meant for people and may change between releases. `--json` and
`--output json|yaml|ndjson|csv` print the public API objects unchanged.

With `--json` (or `--output json|yaml|ndjson`) errors are one JSON line on stderr. Mistyped commands and options are
the exception: they print the usual plain-text usage error and exit 1.

```json
{"error":{"code":"not_found","message":"Job not found: job-123","status":404,"exitCode":4}}
```

| Exit code | Meaning |
|---|---|
| 0 | Done |
| 1 | Any other error: invalid flags, `network_error` (API unreachable), `request_timeout` |
| 2 | Missing or invalid API key (HTTP 401) |
| 3 | Invalid request (HTTP 400) |
| 4 | Not found (HTTP 404) |
| 5 | Conflict (HTTP 409) |
| 6 | Rate limited (HTTP 429); wait and retry |
| 7 | A bulk `import` or `sync` finished, but some records failed; the report lists them under `errors` |
| 10 | Server error (HTTP 5xx); safe to retry reads |

Reads (GET) are retried a few times on timeouts, 429 with `Retry-After`, and 5xx before `ht` gives up; writes are
never retried, so a failed write may or may not have happened. Check before repeating it.

## Sign Up And Sign In Without A Key

```bash
ht signup --email sam@acme.com --name "Sam Lee" --company "Acme Plumbing" --address "1 Ferry Building, San Francisco" --accept-terms
ht signup --code 482913
ht auth login --email sam@acme.com
ht auth login --email sam@acme.com --code 482913 --key-file ci/ht.key
```

These four calls are the only ones without an API key (`POST /signup`, `/signup/verify`, `/auth/email-code`,
`/auth/email-code/verify`). The code goes to the email, works for 30 minutes and 5 tries, and the API key it gives
works for 90 days. Only company admins get a key by email code; `auth login --email` answers the same for any
address, so it can't be used to find out who has an account. The API limits sign-ups and code requests per address
and per network, and refuses throwaway inboxes.

## Public API Resources

- `ht signup` (create a company; `--code` finishes it)
- `ht auth login|logout|whoami|validate` (`login --email` signs in with an emailed code)
- `ht company show|update`
- `ht members list|get|locate|create|update|delete|columns|template|import|export|sync` (`list --query` searches)
- `ht places list|get|create|update|delete|columns|template|import|export|sync`
- `ht jobs list|get|create|update|archive|restore|delete|columns|template|import|export|sync` (`list --all` reads every page)
- `ht routing optimize`
- `ht reports catalog|preview|run|status|saved` and the classic `types|describe|columns|generate|jobs|history|recurring`
- `ht timesheets list|summary|add|update|delete|export|columns|template`
- `ht forms templates|submissions|links|attachments|builder|report`
- `ht alerts actions|zones|configs|recent|instances|report`
- `ht maps layers|inspect|export|open|share|viewer|shares`
- `ht eta create|list|get|update|refresh|events|snippet|revoke`
- `ht webhooks list|set`
- `ht apikeys list|create|revoke|delete`
- `ht profiles list|create|use|doctor`
- `ht skills install`, `ht update`, `ht commands` (every command; `--json` adds arguments and options)

## Bulk Commands

Bulk commands accept JSON arrays, `{ "items": [...] }`, NDJSON, CSV, and YAML.

```bash
ht jobs columns
ht jobs template > jobs.csv
ht jobs import --file jobs.csv --dry-run
ht jobs sync --file jobs.csv --upsert-by externalId --continue-on-error
ht places columns
ht places template > places.csv
ht places sync --file places.ndjson --upsert-by name
ht members columns
ht members template > members.csv
ht members sync --file members.yaml --upsert-by username
```

`import` creates records. `sync` creates or updates records using a stable key. Defaults are `externalId` for jobs, `name` for places, and `username` for members. A sync compares against every job and place, not only the first page.

Jobs are written 50 per request (`--batch-size`); a batch the API refuses is written again one by one, so the report
names each bad row. Members and places are written one at a time.

A run stops at the first failed record unless `--continue-on-error` is given. Either way the report's `summary`
counts what was created, updated, skipped, and failed, and the run exits 7 when anything failed. A job someone deleted
in Hellotracks stays deleted when a sync sends its `externalId` again: it's listed under `skipped` with reason
`deleted`, not created anew.

CSV cells are text. Columns typed `number` or `integer` in `ht <resource> columns` are sent as numbers; everything
else, `date` included, is sent as written.

On a sync, `extendedData.*` columns change only those custom fields of a place; an empty column leaves the field as
it is.

CSV headers use public API field names. Nested fields use dot notation, for example `contact.name`, `location.lat`, `timeWindow.start`, and `extendedData.customerId`.

## Member Location

Use `locate` when you need the latest known GPS payload without the full member profile.

```bash
ht members locate <member-id>
ht members locate <member-id> <member-id> --full
ht --json members locate <member-id>
```

Default output is a compact table with id, name, latitude, longitude, updated time, speed, accuracy, and tracking state. `--full` adds GPS-style fields such as raw `ts`, altitude, heading, sensor, username, and member status. JSON/YAML output returns the full location, normalized GPS fields, states, and timestamps objects.

## Reports

The reports from the dashboard's Reports page run in the background. `ht reports run` starts a run, waits, and
downloads the files; their links are signed and work for 30 days without an API key.

```bash
ht reports catalog
ht reports preview team-week --period lastWeek
ht reports run timesheet --period lastWeek --format xlsx --format pdf --dir reports/
ht reports run jobs --from 2026-10-01 --until 2026-10-31 --member alice --format csv --stdout
ht reports run form-answers --form <template-id> --period lastMonth --format csv
ht reports run jobs --period yesterday --no-wait
ht reports status <run-id> --download
```

Periods are `today`, `yesterday`, `thisWeek`, `lastWeek`, `thisMonth`, `lastMonth`, `last7Days`, and `last30Days`, or
`--from` and `--until`. Without `--member` or `--team` a report covers everyone.

Saved reports keep a report by name, and can send it on a schedule:

```bash
ht reports saved list
ht reports saved create timesheet --name "Weekly hours" --every week --weekday monday --at 07:00 --to alice --format xlsx
ht reports saved update <id> --email office@example.com --delivery link
ht reports saved send <id>
ht reports saved pause <id>
ht reports saved delete <id>
```

### Classic Reports

The classic report types still work, and are the only way to the places, members, gpx, activities, and timeline
reports. Use their discovery before generating files:

```bash
ht reports types
ht reports describe jobs
ht reports columns jobs
```

Generate report files with explicit selectors:

```bash
ht reports generate jobs --from 2026-05-01 --until 2026-05-28 --format csv --all-members --file jobs.csv
ht reports generate timesheet --date today --member alice --format xlsx
ht reports generate checkins --date yesterday --all-members --option mode=manual
ht reports generate places --format csv --background --file places.csv
ht reports jobs list
ht reports jobs get <job-id> --download
```

`--background` makes the file on the server without the two-minute request limit and waits for it.

Manage recurring report schedules:

```bash
ht reports recurring list
ht reports recurring create --name "Weekly jobs" --type jobs --frame week --weekday monday --format xlsx --all-members
ht reports recurring pause <id>
ht reports recurring resume <id>
ht reports recurring delete <id>
```

## Timesheets

`ht timesheets` manages raw clock-in/clock-out entries. For official PDF/XLSX timesheet files, keep using `ht reports generate timesheet`.

```bash
ht timesheets list --date today
ht timesheets list --from 2026-05-01 --until 2026-05-28 --member alice
ht timesheets summary --date today
ht timesheets add --member alice --date today --in 08:30 --out 17:15
ht timesheets update <entry-id> --in 08:45 --out 17:00
ht timesheets delete <entry-id> --yes
ht timesheets export --from 2026-05-01 --until 2026-05-28 --output csv
```

Use `ht timesheets columns` to see export columns and `ht timesheets template` for a CSV starter. Member selectors accept member id, username, email, or exact name. `list` output includes the `entryId` used by `update` and `delete`; raw API objects remain available with `--json` or `--output yaml`.

## Forms

`ht forms` manages form templates, submission data, attachments, and job/place links. The canonical authoring format is JSON or YAML using Hellotracks `FormContent`.

Template workflow:

```bash
ht forms templates fields
ht forms templates template --format yaml > safety-check.yaml
ht forms templates validate --file safety-check.yaml
ht forms templates create --file safety-check.yaml
ht forms templates list
ht forms templates get "Safety check"
ht forms templates update <template-id> --file safety-check.yaml
```

Submission workflow:

```bash
ht forms submissions template <template-id> --format yaml > answers.yaml
ht forms submissions submit <template-id> --values answers.yaml --member alice --job job-123
ht forms submissions list --template <template-id> --from today --until today
ht forms submissions get <submission-id>
ht forms submissions export --template <template-id> --from 2026-05-01 --until 2026-05-28 --output csv
```

Attachments and links:

```bash
ht forms attachments upload --file signature.png --field customer_signature
ht forms links attach <template-id> --job job-123
ht forms links list --job job-123
ht forms links detach <template-id> --job job-123 --yes
```

Use `ht forms report <template-id> --from ... --until ... --format csv|xlsx --file ...` as a convenience wrapper around `ht reports generate formsubmissions`. The focused `ht forms builder` command is a line-oriented draft editor; use file-based commands for CI and agent automation.

## Alerts

`ht alerts` manages alert rule configs and triggered alert instances. Use `ht webhooks` for alert-triggered webhook delivery; alert commands do not configure webhooks.

Discover supported triggers and zone ids before creating configs:

```bash
ht alerts actions
ht alerts zones
ht alerts configs template no-check-out --format yaml > missing-checkout-alert.yaml
ht alerts configs validate --file missing-checkout-alert.yaml
```

Create and maintain alert configs:

```bash
ht alerts configs create --title "Missing check-out" --action no_check_out --member alice --email ops@example.com --time-start 08:00 --time-end 18:00
ht alerts configs list
ht alerts configs get <config-id>
ht alerts configs update <config-id> --weekday monday --weekday tuesday --time-start 08:00 --time-end 18:00
ht alerts configs pause <config-id>
ht alerts configs resume <config-id>
ht alerts configs delete <config-id> --yes
```

Inspect triggered alerts and export history:

```bash
ht alerts recent --limit 20
ht alerts instances get <instance-id>
ht alerts instances ack <instance-id> --yes
ht alerts instances archive <instance-id> --yes
ht alerts instances export --from 2026-05-01 --until 2026-05-28 --output csv
ht alerts report --from 2026-05-01 --until 2026-05-28 --format csv --file alerts.csv
```

Selectors accept repeated `--member`, `--place`, and `--zone` values. Members resolve by id, username, email, or exact name; places and zones resolve by id or exact title/name. Raw API objects remain available with `--json` or `--output yaml`.

## ETA Pages

`ht eta` creates public, no-login arrival pages at `https://eta.page/...` for Hellotracks jobs. The CLI does not send SMS or WhatsApp; use snippets, CRM fields, portals, email, or an existing messaging provider to distribute the link. ETA Email Notifications are configured in Hellotracks Job Settings; when those emails include `{etaPageUrl}`, Hellotracks can create the ETA Page automatically as the email is sent.

```bash
ht eta create --job job-123 --title "Service visit"
ht eta list --date today
ht eta get eta_123
ht eta snippet eta_123 --format email
ht eta update eta_123 --show-worker-name --show-map --expires 30d
ht eta events eta_123
ht eta revoke eta_123 --yes
```

Omit visibility flags on create to use company ETA Page defaults. Use `--show-worker-name`, `--hide-worker-name`, `--show-map`, and `--hide-map` to override visibility for a specific page. Default output is compact for operators; use `--json` or `--output yaml` for raw API objects.

## Maps

`ht maps` creates operational map snapshots. Share links are expiring backend-stored snapshots; exported GeoJSON files are durable local archives that can be opened later in the hosted viewer.

```bash
ht maps layers
ht maps share members places jobs --title "Snapshot June 6"
ht maps export members places jobs --file snapshot-june-6.geojson
ht maps viewer
ht maps open members places --title "Current operations"
ht maps export trips --member alice --date today --file alice-trips.geojson
ht maps share heatmap --from 2026-05-01 --until 2026-05-28 --title "May coverage"
ht maps shares list
ht maps shares revoke <share-id> --yes
```

`viewer` opens `https://live.hellotracks.com/share/maps/viewer`; the browser reads a dropped or selected `.geojson` file locally and does not upload it. Use `trips` as the public CLI name for trip history.
