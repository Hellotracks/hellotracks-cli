# Working on ht

Rules for people and coding agents (Claude, Codex) who change this repository. The text that teaches agents how to
*use* `ht` is a different one: `packages/cli/src/skill.ts`, installed by `ht skills install`.

## Layout

- `packages/core`: API client, config and credentials, actions (one function per API call), bulk import and sync,
  output formatters, and the public API contract (`src/api/public-contract.ts`).
- `packages/cli`: the `ht` command. One file per resource in `src/commands/`.

`ht` is command-first: no TUI, no interactive shell.

## Build and test

```bash
npm run build
npm run typecheck
npm test
```

Tests run against fake API servers. Bind every new test server to `127.0.0.1`, not to all interfaces.

## Conventions

- Every command and option has a help description, and commands with several steps have examples
  (`addHelpText("after", ...)`). Agents read `--help` first.
- Default output is compact and human. `--json` and `--output json|yaml|csv|
  ndjson` print the API's objects unchanged; with them, errors are JSON on stderr too.
- Exit codes come from the HTTP status (`exitCodeForStatus` in core): 2 key, 3 invalid, 4 not found, 5 conflict,
  6 rate limited, 10 server; anything else is 1. Bulk commands print their report with `outputBulkReport`, which
  exits 7 when a record failed.
- Date options accept YYYY-MM-DD, today, yesterday, and tomorrow; resolve the words with `resolveDateWord`, because
  the API only reads YYYY-MM-DD.
- `--verbose` does two things: core logs each request on stderr, and presenters add read-only details.
- All requests go through `ApiClient` (`packages/core/src/client/api-client.ts`); only GETs are retried. Anything
  new that leaves the machine or writes to disk goes into the table in the README's "What it sends and stores".
- Destructive commands call `confirmDangerous`; bulk commands offer `--dry-run`.
- Never print API keys or passwords.
- `public-contract.ts` lists the API routes `ht` uses, for readers; nothing checks it against the code, so keep it in
  step by hand.

## Adding a command

For example `ht places archive <id>` for a new `POST /places/{id}/archive`:

1. Core: an action in `packages/core/src/actions/index.ts` (`archivePlaceAction`) that calls the client, and the
   route in `packages/core/src/api/public-contract.ts`.
2. CLI: the subcommand in `packages/cli/src/commands/places.ts`, with a description on the command and on every
   option, and `confirmDangerous` if it changes or removes data. Add `addHelpText("after", ...)` examples when it
   takes several steps.
3. Test: a fake-server test in `packages/cli/src/cli.test.ts` that checks the method, path, and body, the human
   output, and `--json`.
4. Docs: the command list in `docs/COMMANDS.md`, the skill (`packages/cli/src/skill.ts`) if agents should know it,
   and "Unreleased" in `CHANGELOG.md`.

`npm test` fails when a command or option has no description, or when the README, `docs/`, `AGENTS.md`, or the
skill mention a flag that doesn't exist. It doesn't notice a missing contract entry or a command missing from the
docs.

## Where the API differs from what you'd expect

- Unknown webhook events and working hours without all seven days are skipped by the API without an error, so the
  CLI checks them first.
- Older API versions saved only username, name, phone, password, and role when creating a member, so
  `createMemberAction` sends the rest as an update too. A password can't be set through the API.
- Member route start time is a number like 800 for 08:00; `routeStartTimeValue` converts it.
- `GET /members/{id}`, `/places/{id}` and `/jobs/{id}` answer an unknown id with an empty list; core turns that into
  a 404.
- `--updated-since` and `--created-since` are epoch milliseconds in the API; the CLI converts dates.
- `PATCH /reports/saved/{id}` replaces the whole saved report, so updates send every field.

## Releases

Add your change under "Unreleased" in `CHANGELOG.md`. Hellotracks maintainers release by bumping the version in
`packages/cli/package.json` (and `packages/core` when it changed), moving "Unreleased" under that version, and
pushing a tag `v<version>`. The Release workflow then tests, builds the tarballs with a bundled Node.js
(`scripts/build-release.mjs`), uploads them to https://cli.hellotracks.org with the manifest last
(`scripts/publish-cli.mjs`), creates the GitHub release, and publishes to npm. Tarballs are immutable: never reuse a
version.
