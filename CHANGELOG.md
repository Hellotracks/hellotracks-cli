# Changelog

## Unreleased

### New

- `ht signup`: create a Hellotracks company from the terminal with a code sent to your email; no password or
  dashboard needed. `ht auth login --email` signs company admins in the same way. Keys made this way work 90 days.
- `ht reports catalog`, `preview`, `run`, `status`, and `saved`: the reports from the dashboard's Reports page.
  `run` makes the files in the background, waits, and downloads them; `saved` keeps a report by name and can send
  it on a schedule.
- `ht maps`: map snapshots as GeoJSON files, browser previews, and expiring share links.
- `ht eta`: ETA pages, live arrival pages at `https://eta.page/...` for the people a job is for.
- `ht members locate`: the last known position of members.
- `ht jobs list --assigned` and `--unassigned`.
- `ht commands`: every command in one list; with `--json`, every argument and option too.
- `ht places delete`, `ht members list --query`, and `ht jobs list|export --all`.
- `ht reports generate --background` and `ht reports jobs` for big classic reports.
- Job imports and syncs write 50 jobs per request.
- `ht company update --address|--phone|--email` and the trip, working-hours, web-forms, tracking-off, and
  automatic check-in settings.
- With `--json`, errors are JSON on stderr, with the same exit codes.
- Bulk `import` and `sync` exit 7 when any record failed, instead of 0.
- Date options take `tomorrow` too.
- CSV columns typed number or integer (coordinates, radius, capacity, priority, durations) are sent as numbers.
- Every command and option has a help description.

### Fixed

- `today` and `yesterday` work for `jobs`, `routing optimize`, and `alerts report`, and mean the local day
  everywhere, not the UTC day.
- `webhooks set` keeps an event's saved headers when only its URL changes, and refuses unknown events instead of
  saving nothing (`job.updated` is read as `job_updated`).
- `forms submissions submit --content` sends the submission in the shape the API reads.
- `forms report` covers everyone unless `--member` is given; it failed without members before.
- `members create` saves every field, not only username, name, phone, password, and role.
- `members update --username` renames a member's login (company admins only); `--password` is refused, as the API
  can't set passwords.
- `--route-start-time 08:00` is saved as 08:00, not midnight.
- `--working-hours-json` without all seven days is refused instead of being dropped by the API.
- `members get`, `places get`, and `jobs get` with an unknown id end with "not found" and exit code 4.
- `jobs list --updated-since` and `--created-since` take dates and times, not only epoch milliseconds.
- `ht skills install` installs a skill about using `ht`, and never a `SKILL.md` from the current folder.
- Messages are colored only in a terminal, and never with `NO_COLOR`.
- `places sync` and `jobs sync` match against every place and job; they only saw the first 1000 before.
- Report file links are printed in full.
- `ht ... | head` no longer ends with a broken-pipe error.
- Form templates accept `form_title` and `form_description` items.
- `ht eta get` shows the job's address and time window and the reschedule note; `eta list --job` says whether the
  ETA email went out.
- Classic `reports recurring` no longer offers `--form-template`, which it couldn't keep.

### Removed

- The old terminal UI, which nothing opened any more.
- `--fail-fast` on bulk commands, which did nothing: stopping at the first failure is the default.
- The hidden `ht agent` command. Use `ht commands --json` to list commands and options, and `--json` on any command
  for machine-readable output and errors.

## 0.1.7 (2026-05-28)

- Alerts, forms, reports, and timesheets commands.
