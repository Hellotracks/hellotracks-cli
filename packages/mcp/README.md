# Hellotracks MCP server

A remote [MCP](https://modelcontextprotocol.io) server that lets AI apps (Claude, ChatGPT, Cursor, Claude Code and
others) run a Hellotracks field team: the people and teams, jobs, places, routes on real roads, arrival and map links,
timesheets, forms, alerts and reports. Someone without an account can create a company while connecting, so an AI app
can take a new team from signup to its first planned day.

It is a thin layer over `@hellotracks/ht-core`, the same core the `ht` command line uses: every API call is one of
the core's actions, and rules both need (form template checks, report requests) live in the core. This package adds
only the sign-in, the tool descriptions and the shape of the answers.

Connect at **`https://mcp.hellotracks.com/mcp`**. The bare `https://mcp.hellotracks.com` works too, because people paste
it; it has its own resource metadata at `/.well-known/oauth-protected-resource`. A browser opening it gets a short page
for people. Docs: https://api-docs.hellotracks.com/mcp

## Tools

47 tools, one per kind of change, so each one's hints say truthfully whether it reads, adds, changes or removes.

| Area | Read | Add | Change | Remove |
|---|---|---|---|---|
| Company and people | `get_company`, `get_team_status`, `find_members` | `invite_members` | `update_company`, `update_members` | `remove_members` |
| Jobs | `find_jobs`, `get_job` | `create_jobs` | `update_jobs`, `archive_jobs`, `restore_jobs` | `delete_jobs` |
| Places and routes | `find_places`, `find_zones` | `create_places` | `update_places`, `optimize_route` | `delete_places` |
| Links | `find_arrival_links`, `find_map_links` | `create_arrival_link`, `share_map` | | `revoke_arrival_link`, `revoke_map_link` |
| Timesheets | `get_timesheets` | `add_timesheet_entries` | `update_timesheet_entries` | `delete_timesheet_entries` |
| Forms | `find_forms`, `find_form_answers` | `create_form` | `update_form`, `link_form` | `delete_form` |
| Reports | `list_reports`, `preview_report`, `run_report` | `send_saved_report` | `save_report` | `delete_saved_report` |
| Alerts | `find_alerts` | `create_alert_rules` | `update_alert_rules`, `mark_alerts_read` | `delete_alert_rules` |

Every tool has a `title` and `readOnlyHint`, `destructiveHint`, `idempotentHint` and `openWorldHint` annotations;
the ones that reach people outside Hellotracks (invites, public links, emailed reports, alert emails) are open world.
A "Read only" connection is offered only the 16 read tools; the others aren't listed, and a call to one is refused.

Left out on purpose: API keys and webhooks (they hand data to other systems, so a prompt hidden in a job note must not
be able to set them up), bulk file import and export, and the classic report types. They stay in the dashboard and
in `ht`.

## Sign-in

OAuth 2.1 with PKCE (S256). Clients register themselves (RFC 7591) or present a Client ID Metadata Document. The
person signs in on our page with their email and either their password or an emailed 6-digit code; the server then
holds a 90-day company API key for them, encrypted at rest (AES-256-GCM), and hands the client its own short-lived
access token (1 hour) and a rotating refresh token (30 days, never past the key). Disconnecting revokes the key.
"Read only" at sign-in limits the connection to the read tools.

New to Hellotracks: "Create your company" on the sign-in page asks for name, email, company name and address and the
terms, and sends the browser's time zone and language. It calls `/signup`, then `/signup/verify` with the emailed code,
which creates the company with its 30-day trial and issues the key; the connection is then like any other.

Who can connect: company admins without an authenticator app, the same people who can get a key with `ht auth login`.

## Run it

From the repository root (the server is one of its npm workspaces and builds the core first):

```bash
npm install
npm run build -w @hellotracks/mcp-server
MCP_SECRET=... node --disable-warning=ExperimentalWarning packages/mcp/dist/main.js
```

| Variable | Default | Meaning |
|---|---|---|
| `MCP_SECRET` | (required) | 32+ characters; encrypts the stored API keys |
| `MCP_PUBLIC_URL` | `http://localhost:8790` | Public origin; the MCP endpoint is `<origin>/mcp` |
| `HELLOTRACKS_API_URL` | `https://api.hellotracks.com/v1` | The Hellotracks public API |
| `MCP_SERVICE_TOKEN` | empty | Same value as the runtime's `MCP_SERVICE_TOKEN`; lets sign-in limits count per person |
| `MCP_DB_PATH` | `mcp.db` | SQLite file (Node's built-in `node:sqlite`, Node 22.13 or newer) |
| `PORT`, `MCP_HOST` | `8790`, `127.0.0.1` | Where it listens |
| `MCP_ALLOWED_ORIGINS` | | Extra browser origins allowed to call `/mcp` |

`npm test` runs the whole flow (discovery, registration, sign-in, tools, refresh rotation, revoke) against a fake
Hellotracks API on 127.0.0.1.

## What it sends and stores

- Sends: the person's email, password or code to the Hellotracks API to get a key; then each tool call to the
  Hellotracks API with that key, through the core's `ApiClient`. Nothing goes anywhere else. Nothing is read from or
  written to the machine's `ht` profiles or keychain.
- Stores (SQLite): registered clients, sign-ins in progress (up to an hour), single-use codes (5 minutes), hashed
  tokens, and per connection the account, company and the encrypted API key. Expired rows are swept every 15 minutes.
