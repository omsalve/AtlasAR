import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
const root = resolve("out");
const port = Number(process.env.PORT || 3000);
const mime = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".css":"text/css; charset=utf-8", ".json":"application/json", ".png":"image/png", ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".webp":"image/webp", ".svg":"image/svg+xml", ".wasm":"application/wasm", ".glb":"model/gltf-binary", ".gltf":"model/gltf+json", ".mind":"application/octet-stream", ".ico":"image/x-icon", ".txt":"text/plain; charset=utf-8", ".woff2":"font/woff2" };
try { await stat(resolve(root, "index.html")); } catch { console.error("Build the static app first: npm run build"); process.exit(1); }
createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url || "/", "http://localhost").pathname);
    let file = resolve(root, `.${pathname}`);
    if (file !== root && !file.startsWith(root + sep)) { response.writeHead(403).end("Forbidden"); return; }
    if ((await stat(file)).isDirectory()) file = resolve(file, "index.html");
    const data = await readFile(file);
    response.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream", "X-Content-Type-Options":"nosniff" });
    response.end(data);
  } catch { response.writeHead(404, { "Content-Type":"text/plain" }); response.end("Not found"); }
}).listen(port, "0.0.0.0", () => console.log(`Atlas AR static preview: http://localhost:${port}`));
