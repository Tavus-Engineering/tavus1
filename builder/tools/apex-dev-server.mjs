/* Runs the Apex demo API (api/apex.js) on localhost without `vercel dev`, so the
   console and /meet pages can be tested against a local backend:

     node tools/apex-dev-server.mjs            # port 3000, reads builder/.env.local
     API_PROXY=http://localhost:3000 npm run dev:ui

   Tavus has to reach the webhook for post-call capture, so set APEX_PUBLIC_URL to
   a tunnel (e.g. `cloudflared tunnel --url http://localhost:3000`). In-call tools
   still POST to the URL registered on the PAL's tools, not to this server. */

import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const envFile = fileURLToPath(new URL("../.env.local", import.meta.url));
try {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
} catch { /* no env file */ }

const { default: handler } = await import("../api/apex.js");
const port = Number(process.env.PORT || 3000);

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== "/api/apex") { res.writeHead(404).end("Only /api/apex runs here."); return; }

  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  req.query = Object.fromEntries(url.searchParams);
  try { req.body = raw && /json/.test(req.headers["content-type"] || "") ? JSON.parse(raw) : raw; } catch { req.body = raw; }

  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (j) => { if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(j)); return res; };
  res.send = (s) => { res.end(typeof s === "string" ? s : JSON.stringify(s)); return res; };
  res.redirect = (code, loc) => { res.writeHead(code, { Location: loc }).end(); return res; };

  const started = Date.now();
  await handler(req, res);
  console.log(`${new Date().toISOString().slice(11, 19)} ${req.method} ${req.query.op || ""} → ${res.statusCode} (${Date.now() - started}ms)`);
}).listen(port, () => {
  console.log(`Apex API on http://localhost:${port}/api/apex`);
  console.log(`Tavus key: ${process.env.TAVUS_API_KEY ? "set" : "MISSING"} | HubSpot: ${process.env.HUBSPOT_ACCESS_TOKEN ? "set" : "off"} | Anthropic: ${process.env.ANTHROPIC_API_KEY ? "set" : "off"} | Redis: ${process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL ? "on" : "in-memory"} | public URL: ${process.env.APEX_PUBLIC_URL || "not set (no post-call webhook)"}`);
});
