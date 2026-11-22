# ChatGPT app package

What OpenAI's plugin portal (https://platform.openai.com/plugins) takes for the Hellotracks connector:
`plugin.json` (listing, starter prompts, review test cases), `mcp.json` (the server) and `assets/icon.png`.
Sign-in needs nothing here: the server announces OAuth with Dynamic Client Registration and Client ID Metadata
Documents by itself.

Build the upload from this folder:

```bash
zip -r ../hellotracks-openai-plugin.zip plugin.json mcp.json assets
```

Entered in the portal, never in this folder: the reviewer login, the domain check token (served by the server from
`OPENAI_APPS_CHALLENGE` at `/.well-known/openai-apps-challenge`) and the walkthrough video link.
