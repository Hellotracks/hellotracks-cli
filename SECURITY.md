# Security

Report suspected vulnerabilities to support@hellotracks.com.

Do not open public GitHub issues for secrets, API keys, tokens, customer data, or vulnerability details. Include
the `ht --version` output, the command you ran (without its key), and the smallest steps that show the problem.

## How ht handles your API key

- `ht auth login` keeps the key in the macOS Keychain, or on Linux in `~/.config/hellotracks-cli/credentials/`
  with permissions only for you (folder `0700`, file `0600`).
- `HELLOTRACKS_API_KEY_FILE` and `--api-key-stdin` pass a key without storing it. `--api-key` works but warns,
  because command lines end up in shell history and process lists.
- The key is sent only to the API base URL of the active profile, in the `API-Key` header. `ht` never prints it.
- Releases are checked against the SHA-256 in `https://cli.hellotracks.org/manifest.json` before they are unpacked.
