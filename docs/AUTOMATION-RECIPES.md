# ht Automation Recipes

## Work Orders Into Hellotracks Jobs

```bash
ht jobs columns
ht jobs template > work-orders.csv
ht jobs sync \
  --file work-orders.csv \
  --upsert-by externalId \
  --dry-run

ht jobs sync \
  --file work-orders.csv \
  --upsert-by externalId \
  --continue-on-error \
  --output json
```

Use `externalId` as the CRM/work-order id. The dry run returns the planned create/update count before touching Hellotracks.

## Import, Assign, And Plan Tomorrow

Put the assignee and the day in the file: `assigneeUsername` and `date` (always YYYY-MM-DD in files; the date words
only work on the command line).

```bash
ht jobs template > tomorrow.csv
ht jobs import --file tomorrow.csv --dry-run
ht jobs import --file tomorrow.csv --continue-on-error --output json > import-report.json
```

The import exits 7 when some rows failed; `import-report.json` lists them under `errors`. Then put each assigned
person's day in order:

```bash
ht --output csv --fields assigneeUsername jobs list --date tomorrow --all | tail -n +2 | sort -u > assignees.txt
while read -r member; do
  ht routing optimize --account "$member" --date tomorrow --solve
done < assignees.txt
```

`--solve` honors working hours, time windows, skills, and capacity, and reports jobs it couldn't fit.

## Customer Sites Into Places

```bash
ht places template > customers.csv
ht places sync --file customers.ndjson --upsert-by name --dry-run
ht places sync --file customers.ndjson --upsert-by name --continue-on-error
```

Place records can include address, contact fields, radius, teams, location, and `extendedData`.

## Workforce Synchronization

```bash
ht members template > workforce.csv
ht members sync --file workforce.yaml --upsert-by username --dry-run
ht members sync --file workforce.yaml --upsert-by username
```

Member records can include role, contact data, teams, vehicle capacity, travel mode, route start/end, and working-hours JSON.

## Daily Route Optimization

```bash
ht jobs export --date today --output table --fields id,title,assigneeUsername,progress
ht routing optimize --account worker-uid --date today --solve --output json
```

## Webhook-Driven Reporting

```bash
ht webhooks list
ht webhooks set --event job_updated --url https://example.com/hellotracks/job-updated --header "Authorization=Bearer $WEBHOOK_TOKEN"
ht jobs export --updated-since 2026-05-20T00:00:00Z --output ndjson
```

## Form Template And Submission Automation

```bash
ht forms templates template --format yaml > safety-check.yaml
ht forms templates validate --file safety-check.yaml
ht forms templates create --file safety-check.yaml

ht forms links attach "Safety check" --job job-123
ht forms submissions template "Safety check" --format yaml > answers.yaml
ht forms submissions submit "Safety check" --values answers.yaml --member alice --job job-123
ht forms submissions export --template "Safety check" --from today --until today --output csv
```

Use `ht forms attachments upload --file proof.png --field proof_photo` for file/image/signature values. Use `ht forms report <template-id> --from ... --until ... --format xlsx --file submissions.xlsx` when the output should be an official report file.

## Alert Rule Automation

```bash
ht alerts actions
ht alerts zones
ht alerts configs template no-check-out --format yaml > missing-checkout-alert.yaml
ht alerts configs validate --file missing-checkout-alert.yaml
ht alerts configs create --file missing-checkout-alert.yaml

ht alerts recent --limit 20
ht alerts instances export --from 2026-05-01 --until 2026-05-28 --output csv
ht alerts report --from 2026-05-01 --until 2026-05-28 --format xlsx --file alerts.xlsx
```

Edit generated config templates before creating them so placeholder member, place, or zone ids resolve in your company. Use templates for repeatable rules like missing check-outs, idle members, battery-low warnings, and zone entry alerts. Keep alert-triggered webhook delivery in `ht webhooks`; alerts commands only manage rules and triggered events.

## API Key Rotation

```bash
ht apikeys create --label ci-rotation --source github-actions
ht apikeys list
ht apikeys revoke old-key-id --yes
```

Prefer `HELLOTRACKS_API_KEY_FILE` or `--api-key-stdin` in CI so secrets do not appear in shell history.
