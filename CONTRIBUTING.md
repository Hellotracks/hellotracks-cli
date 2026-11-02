# Contributing

Thanks for helping. Issues and pull requests are welcome; for anything larger than a fix, open an issue first so
we can agree on the shape.

## Set up

```bash
npm install
npm run build
node packages/cli/dist/index.js --help
npm test
```

`ht` needs Node.js 18 or newer; CI tests 22 and 24. The tests start fake API servers on 127.0.0.1 and never call
Hellotracks. One test runs against a real company only when you set `HT_TEST_API_URL` and `HT_TEST_API_KEY`; use a
test company for it.

## What a good change looks like

- It matches what the public API really does. When a field is accepted but not applied, say so in the help or
  refuse it, rather than reporting a success that changed nothing.
- Every command and option has a help description; commands with several steps have examples.
- `--json` output stays the API's own objects. Human output can change; JSON output can't break.
- New commands and flags appear in `docs/COMMANDS.md`. A test checks that the docs only use real commands and flags.
- One change per pull request, with a test.

[AGENTS.md](AGENTS.md) has the details, for people and coding agents alike.
