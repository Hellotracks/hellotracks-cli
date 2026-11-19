// An example for running the server with pm2, from packages/mcp after `npm run build`:
//   pm2 start ecosystem.config.cjs
// Secrets (MCP_SECRET, MCP_SERVICE_TOKEN) come from the .env file next to it, never from this file.
module.exports = {
  apps: [
    {
      name: "hellotracks-mcp",
      script: "dist/main.js",
      node_args: "--env-file=.env --disable-warning=ExperimentalWarning",
      env: {
        NODE_ENV: "production",
        PORT: "8790",
        MCP_HOST: "127.0.0.1",
        MCP_PUBLIC_URL: "https://mcp.example.com",
        HELLOTRACKS_API_URL: "https://api.hellotracks.com/v1",
        MCP_DB_PATH: "data/mcp.db"
      },
      max_memory_restart: "400M"
    }
  ]
};
