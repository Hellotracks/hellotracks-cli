import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { Store } from "./store.js";

const config = loadConfig();
const store = new Store(config.dbPath);
store.sweep();
setInterval(() => store.sweep(), 15 * 60_000).unref();

const app = createApp(config, store);
app.listen(config.port, process.env.MCP_HOST ?? "127.0.0.1", () => {
  console.log(`hellotracks-mcp on ${process.env.MCP_HOST ?? "127.0.0.1"}:${config.port}, public ${config.mcpUrl.href}, api ${config.apiUrl}`);
});
