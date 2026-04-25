/*
 * Tiny static server for the Sendero pitch deck.
 *   bun run pitch/serve.ts  (or: bun run dev:pitch)
 * Serves pitch/ on http://localhost:4000 (override with PORT).
 */
import { existsSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir);
const PORT = Number(process.env.PORT ?? 4000);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".svg": "image/svg+xml", ".webp": "image/webp", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

const server = Bun.serve({
  port: PORT,
  development: true,
  async fetch(req) {
    const url = new URL(req.url);
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith("/")) path += "index.html";
    if (path === "") path = "/index.html";
    const filePath = join(ROOT, path);
    if (!filePath.startsWith(ROOT)) return new Response("forbidden", { status: 403 });
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      const htmlPath = `${filePath}.html`;
      if (existsSync(htmlPath) && statSync(htmlPath).isFile()) {
        return new Response(Bun.file(htmlPath), {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
      }
      return new Response("not found", { status: 404 });
    }
    const ext = extname(filePath).toLowerCase();
    const type = MIME[ext] ?? "application/octet-stream";
    return new Response(Bun.file(filePath), {
      headers: { "content-type": type, "cache-control": "no-store" },
    });
  },
});

console.log(`\n  ✦ Sendero pitch · http://localhost:${server.port}\n  ✦ Notes window  · press N inside the deck\n  ✦ Password      · sendero-arc\n`);
