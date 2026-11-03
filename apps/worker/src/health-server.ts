import { createServer, type Server } from "node:http";

/** Minimal HTTP endpoint for container health checks (`GET /health`). */
export function startHealthServer(port: number, isHealthy: () => boolean): Server {
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      const ok = isHealthy();
      res.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: ok ? "ok" : "degraded" }));
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(port);
  return server;
}
