/** Reproducible, browser-only MindAR 1.2.5 vendoring. No native canvas install. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = path.join(root, "public/vendor/mindar");
const archive = path.join(root, "mind-ar-1.2.5.tgz");
const metadata = { dist: { tarball: "https://registry.npmjs.org/mind-ar/-/mind-ar-1.2.5.tgz", integrity: "sha512-YsbiNYaNbI/AMSXYfL+c/vJaFD/RB8uKtAOhmMyOkGZ0vBnEM8+KPh3ee8BH35ldtVudziJpv62qqV6dns/Evw==" } };
let bytes;
try { bytes = await readFile(archive); }
catch { bytes = Buffer.from(await fetch(metadata.dist.tarball).then(r => { if (!r.ok) throw new Error(`npm tarball: ${r.status}`); return r.arrayBuffer(); })); }
const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
if (integrity !== metadata.dist.integrity) throw new Error("MindAR archive integrity check failed.");
await writeFile(archive, bytes);
await mkdir(directory, { recursive: true });
const files = ["mindar-image.prod.js", "controller-mGt1s8dJ.js", "ui-fBadYuor.js"];
for (const file of files) {
  let data = execFileSync("tar", ["-xOf", archive, `package/dist/${file}`], { maxBuffer: 8 * 1024 * 1024 });
  if (file === "controller-mGt1s8dJ.js") {
    const source = data.toString("utf8");
    const original = "    (async () => {\n      for (; this.processingVideo; )";
    if (!source.includes(original)) throw new Error("MindAR processVideo patch location changed.");
    let patched = source.replace(original, "    return (async () => {\n      for (; this.processingVideo; )");
    const disposeOriginal = '    this.stopProcessVideo(), this.worker.postMessage({\n      type: "dispose"\n    });';
    if (!patched.includes(disposeOriginal)) throw new Error("MindAR disposal patch location changed.");
    patched = patched.replace(disposeOriginal, `${disposeOriginal}
    const visited = new Set();
    const release = value => {
      if (!value || typeof value !== 'object' || visited.has(value) || ArrayBuffer.isView(value)) return;
      visited.add(value);
      if (typeof value.dispose === 'function') { value.dispose(); return; }
      for (const child of Object.values(value)) release(child);
    };
    release(this.cropDetector?.detector?.tensorCaches);
    release(this.tracker?.featurePointsListT);
    release(this.tracker?.imagePixelsListT);
    release(this.tracker?.imagePropertiesListT);
    if (this.inputLoader?.tempPixelHandle?.dataId) ps().disposeData(this.inputLoader.tempPixelHandle.dataId);
    if (this.inputLoader?.context?.canvas) { this.inputLoader.context.canvas.width = 0; this.inputLoader.context.canvas.height = 0; }
    this.worker.terminate();`);
    data = Buffer.from(patched);
  }
  await writeFile(path.join(directory, file), data);
}
await writeFile(path.join(directory, "LICENSE"), execFileSync("tar", ["-xOf", archive, "package/LICENSE"]));
await writeFile(path.join(directory, "PROVENANCE.json"), JSON.stringify({ package: "mind-ar", version: "1.2.5", source: "https://github.com/hiukim/mind-ar-js/tree/v1.2.5", tarball: metadata.dist.tarball, integrity, modifications: "Controller.processVideo returns its existing async loop promise so errors/cleanup can be observed. Controller.dispose releases detector/tracker cached tensors, disposes InputLoader's TensorInfo dataId using its WebGL backend (TensorInfo is not a Tensor), clears the input canvas, and terminates its worker. No tracking algorithm changes. Target compilation is isolated in a disposable iframe." }, null, 2));
// The isolated document lets cancellation/unmount release TensorFlow, workers and canvases.
await writeFile(path.join(directory, "compiler.html"), `<!doctype html><html><head><meta charset="utf-8"><title>Local image target compiler</title><style>html,body{margin:0;background:transparent}body{padding:6px 0}progress{width:100%;height:8px;accent-color:#64734e;display:block}</style></head><body><progress id="progress" max="100" value="0" aria-label="Compiling image target"></progress><script type="module">
import { Compiler } from './mindar-image.prod.js';
let token = null;
const send = (data, transfer = []) => parent.postMessage({ source: 'atlasar-target-compiler', token, ...data }, location.origin, transfer);
addEventListener('error', event => send({ type: 'error', message: event.message || 'Image compilation failed.' }));
addEventListener('unhandledrejection', event => send({ type: 'error', message: event.reason?.message || 'Image compilation failed. Try a smaller image.' }));
addEventListener('message', async event => {
  if (event.source !== parent || event.origin !== location.origin || event.data?.type !== 'compile' || token !== null) return;
  token = event.data.token;
  let url;
  try {
    const file = new Blob([event.data.bytes], { type: event.data.mime });
    url = URL.createObjectURL(file);
    const image = new Image(); image.src = url; await image.decode();
    if (Math.min(image.width, image.height) < 256 || Math.max(image.width, image.height) > 2048) throw new Error('Choose an image with each side from 256 to 2048 pixels.');
    const compiler = new Compiler();
    await compiler.compileImageTargets([image], progress => { document.getElementById('progress').value = progress; send({ type: 'progress', progress }); });
    const features = compiler.data?.[0]?.matchingData?.reduce((count, keyframe) => count + keyframe.maximaPoints.length + keyframe.minimaPoints.length, 0) || 0;
    if (features < 40) throw new Error('This image has too few distinctive features. Choose a detailed photograph or textured, asymmetric artwork.');
    const data = compiler.exportData();
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    send({ type: 'complete', bytes: buffer, features }, [buffer]);
  } catch(error) { send({ type: 'error', message: error?.message || 'The image could not be compiled.' }); }
  finally { if(url) URL.revokeObjectURL(url); }
});
send({ type: 'ready' });
</script></body></html>`);
// Remove only these known, unused distributions extracted during development.
for (const file of ["controller-d1-OMKPY.js", "mindar-face-aframe.prod.js", "mindar-face-three.prod.js", "mindar-face.prod.js", "mindar-image-aframe.prod.js", "mindar-image-three.prod.js"]) await rm(path.join(directory, file), { force: true });
await rm(archive, { force: true });
console.log(`Vendored MindAR 1.2.5 (${files.length} modules, integrity verified, documented lifecycle patches).`);

if (process.argv.includes("--compile-sample")) {
  const sharp = (await import("sharp")).default;
  const { chromium } = await import("@playwright/test");
  const { createServer } = await import("node:http");
  const assets = path.join(root, "public/assets");
  await mkdir(assets, { recursive: true });
  const building = await readFile(path.join(assets, "courtyard-preview.png"));
  let seed = 9142;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  let textures = "";
  for (let i = 0; i < 250; i++) {
    const x = 490 + random() * 450, y = 126 + random() * 440;
    textures += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(1 + random() * 2).toFixed(1)}" fill="#b7bfaa" opacity=".5"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1000" height="720" viewBox="0 0 1000 720">
  <rect width="1000" height="720" fill="#f4f1e7"/><rect x="24" y="24" width="952" height="672" fill="none" stroke="#243b30" stroke-width="2"/>
  <rect x="24" y="24" width="422" height="672" fill="#223d33"/><path d="M50 74h34l25-28 27 28h31v34h-31l-27 26-25-26H50z" fill="none" stroke="#d6ddb5" stroke-width="2"/>
  <text x="195" y="94" font-family="Arial" font-size="21" letter-spacing="5" fill="#eeeede">ATLAS AR</text><path d="M55 168h355" stroke="#81917b"/>
  <text x="56" y="216" font-family="Arial" font-size="12" letter-spacing="3" fill="#cbd4b3">A NEW PERSPECTIVE ON LIVING</text>
  <text x="52" y="289" font-family="Georgia" font-size="57" fill="#faf7e7">The</text><text x="52" y="352" font-family="Georgia" font-size="57" fill="#faf7e7">Courtyard.</text>
  <text x="56" y="393" font-family="Arial" font-size="12" letter-spacing="2" fill="#cbd4b3">BENGALURU, INDIA  /  12.9716° N</text>
  <g transform="translate(58 443)" fill="none" stroke="#a6b68f" stroke-width="2"><path d="M0 0h105v44h-32v51H0zM122 0h62v31h52v78H122zM0 115h89v45H0zM105 125h55v35h-55zM178 126h87v34h-87z"/><path d="M14 12h78v21H14zM14 59h44v22H14zM136 14h32v30h53v52h-85z" stroke-width="1"/><path d="M270-8v178M265 0h10M265 160h10M-8 184h277" stroke="#788c6a" stroke-width="1"/><circle cx="304" cy="30" r="21"/><path d="M292 30h24M304 18v24"/><path d="M301 90l-12 29h24z" fill="#bdc99f"/></g>
  ${textures}<circle cx="728" cy="323" r="190" fill="#e3e5d4"/><path d="M467 561l143-64 84 102 132-61 108 46" fill="none" stroke="#bdc7af" stroke-width="2"/>
  <image x="452" y="114" width="520" height="460" xlink:href="data:image/png;base64,${building.toString("base64")}"/>
  <text x="481" y="82" font-family="Arial" font-size="11" letter-spacing="3" fill="#526546">SCAN THIS IMAGE. EXPLORE THE SPACES.</text>
  <g transform="translate(486 614)" fill="#2d4937"><path d="M0 0h24v24H0zM0 31h10v10H0zM15 31h9v10h-9zM31 0h10v10H31zM31 16h10v25H31z"/><circle cx="80" cy="20" r="18" fill="none" stroke="#2d4937" stroke-width="2"/><path d="M76 10l11 10-11 10" fill="none" stroke="#2d4937" stroke-width="2"/></g>
  <text x="602" y="632" font-family="Arial" font-size="14" letter-spacing="1" fill="#263d2c">YOUR ANCHOR TO A NEW PERSPECTIVE</text><text x="602" y="655" font-family="Arial" font-size="11" fill="#627157">Print flat · Good lighting · Keep the full image in view</text>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(path.join(assets, "target.png"));
  const server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url || "/", "http://localhost").pathname);
    if (pathname === "/") { response.setHeader("Content-Type", "text/html"); response.end("<!doctype html><title>Local sample target compilation</title>"); return; }
    const target = path.resolve(root, "public", "." + pathname);
    if (!target.startsWith(path.resolve(root, "public") + path.sep)) { response.writeHead(403).end(); return; }
    try { const data = await readFile(target); response.setHeader("Content-Type", target.endsWith(".js") ? "text/javascript" : target.endsWith(".png") ? "image/png" : "text/html"); response.end(data); }
    catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  try {
    const page = await browser.newPage();
    page.on("pageerror", error => console.error("Compiler:", error.message));
    page.on("console", message => { if (message.text().startsWith("Target compilation")) console.log(message.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const result = await page.evaluate(async () => {
      const { Compiler } = await import("/vendor/mindar/mindar-image.prod.js");
      const image = new Image(); image.src = "/assets/target.png"; await image.decode();
      const compiler = new Compiler();
      await compiler.compileImageTargets([image], percent => console.log(`Target compilation ${percent.toFixed(0)}%`));
      const features = compiler.data[0].matchingData.reduce((count, frame) => count + frame.maximaPoints.length + frame.minimaPoints.length, 0);
      return { bytes: Array.from(compiler.exportData()), features };
    });
    await writeFile(path.join(assets, "target.mind"), Buffer.from(result.bytes));
    console.log(`Compiled sample target: ${result.features} matching features, ${result.bytes.length} bytes.`);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
