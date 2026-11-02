# ht, the Hellotracks command line

Run Hellotracks from a shell, a CI runner, or a coding agent: jobs, routes, people, places, timesheets, forms,
alerts, reports, ETA pages, maps, webhooks, and API keys, through the public Hellotracks API.

```bash
ht auth login
ht jobs list --date today
ht jobs sync --file work-orders.csv --upsert-by externalId --dry-run
ht routing optimize --account alice@example.com --date today --solve
ht reports run timesheet --period lastWeek --format xlsx
ht skills install
```

Every command has `--help` with examples. `--json` prints the API's own objects, errors included, with exit codes
by kind: 1 other, 2 key, 3 invalid request, 4 not found, 5 conflict, 6 rate limited, 7 some bulk records failed,
10 server error.

Install with `curl -fsSL https://cli.hellotracks.org/install.sh | bash`. Interactive runs check for a newer release at
most once a day; `--no-update-check` or `HT_CLI_AUTO_UPDATE_CHECK=0` turns that off.
