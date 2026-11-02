# ht, the Hellotracks command line

`ht` runs [Hellotracks](https://hellotracks.com) from a shell, a CI runner, or a coding agent: jobs, routes, people,
places, timesheets, forms, alerts, reports, ETA pages, maps, webhooks, and API keys. It talks to the public
Hellotracks API (`https://api.hellotracks.com/v1`) and nothing else.

```bash
ht jobs sync --file work-orders.csv --upsert-by externalId --dry-run
ht routing optimize --account alice@example.com --date today --solve
ht reports run timesheet --period lastWeek --format xlsx
```

## Install

macOS and Linux, arm64 and x64:

```bash
curl -fsSL https://cli.hellotracks.org/install.sh | bash
```

The installer puts `ht` in `~/.local/bin` with its own Node.js runtime, after checking the download against the
SHA-256 in `https://cli.hellotracks.org/manifest.json`. `ht update` installs a newer release; `ht update --check`
only looks.

## Sign up or sign in

New to Hellotracks? Create a company from the terminal. A 6-digit code sent to your email proves the address; no
password is needed, and the API key is stored for you:

```bash
ht signup --email sam@acme.com --name "Sam Lee" --company "Acme Plumbing" \
  --address "1 Ferry Building, San Francisco" --accept-terms
ht signup --code 482913
```

`--accept-terms` means the person signing up accepts the [terms of service](https://hellotracks.com/terms-of-service).
In a terminal, `ht signup` asks for whatever is missing, then for the code. The account has no password: for the
dashboard at https://live.hellotracks.com, sign in with Google, or use "Forgot password?" there to set one.

Company admins with an account sign in the same way, or paste an API key from the dashboard (Settings, API and
Integrations):

```bash
ht auth login --email sam@acme.com      # emails a code, then asks for it
ht auth login                           # paste an API key instead
ht auth whoami
```

On macOS the key is kept in the Keychain; on Linux in `~/.config/hellotracks-cli/credentials/`, readable only by you.
`ht` runs on macOS and Linux. Scripts can pass a key without storing it:

```bash
HELLOTRACKS_API_KEY_FILE=/run/secrets/hellotracks ht jobs list --date today
printf '%s\n' "$HELLOTRACKS_API_KEY" | ht --api-key-stdin jobs list --date today
```

When several are given, the first wins: `--api-key`, `HELLOTRACKS_API_KEY`, `--api-key-stdin`,
`HELLOTRACKS_API_KEY_FILE`, then the key stored for the profile.

Keys from an email code work for 90 days; `ht auth login --email` makes a new one. `--key-file <path>` also writes
the new key to a file only you can read, for a CI secret.

Keep environments apart with profiles, and make production scripts refuse to run anywhere else:

```bash
ht profiles create staging --api-url https://staging.example.com/v1
ht --profile staging auth login
ht --profile production --confirm-profile production jobs sync --file work-orders.csv
```

## What it does

| Command | For |
|---|---|
| `ht jobs` | List, create, update, archive, import, export, and sync jobs (sync matches on `externalId`) |
| `ht routing optimize` | Put a member's day in the best order, optionally with the route solver |
| `ht members`, `ht places` | People and places: list, get, create, update, import, export, sync; `members locate` for last positions |
| `ht timesheets` | The clock-in and clock-out entries: list, summary, add, update, delete, export |
| `ht reports` | Run, preview, save, and schedule reports; download the files |
| `ht forms` | Form templates as YAML or JSON files, submissions, attachments, links to jobs and places |
| `ht alerts` | Alert rules and the alerts they raised |
| `ht eta` | ETA pages: live arrival pages at `https://eta.page/...` for the people a job is for |
| `ht maps` | Map snapshots as GeoJSON, or as expiring share links |
| `ht webhooks`, `ht apikeys`, `ht company` | Integration settings |
| `ht skills install` | Teach Codex and Claude Code how to use `ht` |

Every command explains itself, with examples: `ht <command> --help`. The full list is in
[docs/COMMANDS.md](docs/COMMANDS.md), and [docs/AUTOMATION-RECIPES.md](docs/AUTOMATION-RECIPES.md) has worked
examples for nightly syncs, exports, and webhooks.

## For scripts and agents

- `ht commands --json` lists every command with its arguments and options, in one call.
- `--json` prints the API's own objects; `--output yaml|csv|ndjson|table` and `--fields a,b` shape them.
  Without these flags the output is for people and may change between releases.
- With `--json`, errors are JSON on stderr too: `{"error":{"code":"not_found","message":"…","status":404,"exitCode":4}}`.
- Exit codes: `0` ok, `1` other error (including no network), `2` missing or invalid API key, `3` invalid request,
  `4` not found, `5` conflict, `6` rate limited, `7` a bulk run where some records failed, `10` server error.
  Mistyped commands and options print plain-text usage errors even with `--json`.
- Date options take `YYYY-MM-DD`, `today`, `yesterday`, or `tomorrow`. Files for `import` and `sync` need
  `YYYY-MM-DD`.
- `--no-input` never prompts. Deletes and other destructive commands ask first; `--yes` answers for you.
- Bulk `import` and `sync` take CSV, JSON, NDJSON, or YAML. Run them with `--dry-run` first and read the plan.
  They stop at the first failed record unless `--continue-on-error` is given, and exit `7` if any record failed.
  `ht <resource> columns` and `ht <resource> template` show the accepted columns.
- `ht skills install` writes a skill for Codex (`~/.codex/skills/hellotracks/`) and Claude Code
  (`~/.claude/skills/hellotracks/`), so an agent knows these rules without reading this page.

## Settings

| Variable | Meaning |
|---|---|
| `HELLOTRACKS_API_KEY_FILE` | Read the API key from this file |
| `HELLOTRACKS_API_KEY` | The API key itself; wins over the file |
| `HELLOTRACKS_API_URL` | Another API base, for a test system |
| `HT_CLI_CREDENTIAL_STORE=private-file` | Keep the key in a private file instead of the macOS Keychain |
| `HT_CLI_AUTO_UPDATE_CHECK=0` | Don't look for a newer release (also `--no-update-check`) |
| `NO_COLOR` | No colors in messages |
| `CODEX_HOME`, `CLAUDE_HOME` | Where `ht skills install` writes |

Profiles live in `~/.config/hellotracks-cli/config.json`.

## What it sends and stores

| Where | What | When | Code |
|---|---|---|---|
| The Hellotracks API (`https://api.hellotracks.com/v1` or your `--api-url`) | Your requests, with the key in the `API-Key` header, `User-Agent: hellotracks-ht-cli/<version>` and `HT-Integration-Source: ht_cli` | Every command that reads or changes data | `packages/core/src/client/api-client.ts` (the one place requests are made) |
| The download links the API returns for report and form files | A plain download, no key | `ht reports run`, `ht reports generate`, and `ht reports saved send --download` | `packages/cli/src/commands/reporting.ts`, `reports.ts` |
| The Hellotracks API, without a key | Your email, name, time zone, and company name and address | `ht signup`, `ht auth login --email`; the API emails you a 6-digit code | `packages/core/src/actions/index.ts` (`startSignupAction` and the next three) |
| `https://cli.hellotracks.org/manifest.json` | A plain request | At most once a day in a terminal (`--no-update-check` turns it off) | `packages/cli/src/update.ts` |
| `https://cli.hellotracks.org/install.sh` | Downloads and runs the installer, which needs `curl` and `python3` and checks the SHA-256 of what it downloads | `ht update` | `packages/cli/src/update.ts`, `scripts/install.sh` |
| Your browser | Opens the map viewer at `https://live.hellotracks.com` | `ht maps open`, `ht maps viewer` | `packages/cli/src/commands/maps.ts` |

On disk, `ht` writes:
- `~/.config/hellotracks-cli/config.json` (profiles) and `update-check.json`;
- `~/.config/hellotracks-cli/signup-<profile>.json` while a sign-up waits for its code (email, name, company; no
  secrets), removed once it's finished;
- the API key, in the macOS Keychain or in `~/.config/hellotracks-cli/credentials/`. On macOS, the key is handed to
  the `security` tool as an argument while it is saved;
- the skill files from `ht skills install`;
- the files you ask for with `--file`, `--dir`, or `--out`.

Nothing else leaves your machine.

## Developing

`ht` is TypeScript on Node.js 18 or newer:

```bash
npm install
npm run build -w @hellotracks/ht-cli
node packages/cli/dist/index.js --help
npm run test -w @hellotracks/ht-core && npm run test -w @hellotracks/ht-cli
```

[AGENTS.md](AGENTS.md) has the conventions for changing it.

Licensed under the [MIT license](LICENSE).
