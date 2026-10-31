import assert from "node:assert/strict";
import { test } from "node:test";
import { zipSync, strToU8 } from "fflate";
import { SAMPLE_PROJECT } from "../lib/project";
import { isSafeAssetUrl, parseProject } from "../lib/validation";
import { MAX_MODEL_BYTES, validateModelFile, validateTargetFile } from "../lib/assets";
import { decodeProjectHash, hasLocalAssets, importProjectBackup, projectUrl, staticProjectUrl } from "../lib/publish";

function glb(document: unknown): File {
  const json = new TextEncoder().encode(JSON.stringify(document));
  const padded = Math.ceil(json.length / 4) * 4;
  const bytes = new Uint8Array(20 + padded);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, padded, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20);
  bytes.set(json, 20);
  return new File([bytes], "building.glb", { type: "model/gltf-binary" });
}

const document = { asset: { version: "2.0" }, nodes: [{ name: "floor_0", mesh: 0 }], meshes: [{ primitives: [] }] };

test("project parser accepts sample and returns an independent whitelisted value", () => {
  const parsed = parseProject({ ...SAMPLE_PROJECT, unsafeExtraField: "ignored" });
  assert.deepEqual(parsed, SAMPLE_PROJECT);
  assert.notEqual(parsed, SAMPLE_PROJECT);
  assert.notEqual(parsed.pois, SAMPLE_PROJECT.pois);
  assert.equal("unsafeExtraField" in parsed, false);
});

test("project parser rejects unsupported versions and nonfinite or degenerate camera vectors", () => {
  assert.throws(() => parseProject({ ...SAMPLE_PROJECT, schemaVersion: 2 }), /version 1/);
  assert.throws(() => parseProject({ ...SAMPLE_PROJECT, overview: { position: [Infinity, 1, 2], target: [0, 0, 0] } }), /finite/);
  assert.throws(() => parseProject({ ...SAMPLE_PROJECT, overview: { position: [0, 0, 0], target: [0, 0, 0] } }), /differ/);
  assert.throws(() => parseProject({ ...SAMPLE_PROJECT, ar: { ...SAMPLE_PROJECT.ar, scale: 0 } }), /scale/);
});

test("project parser enforces unique POI IDs and explicit floor node mappings", () => {
  assert.throws(() => parseProject({ ...SAMPLE_PROJECT, pois: [SAMPLE_PROJECT.pois[0], SAMPLE_PROJECT.pois[0]] }), /unique/);
  assert.throws(() => parseProject({ ...SAMPLE_PROJECT, floors: [{ id: "floor-1", name: "Level one", nodeNames: [] }] }), /at least one/);
  assert.throws(() => parseProject({ ...SAMPLE_PROJECT, name: "x".repeat(121) }), /120/);
  assert.throws(() => parseProject({ ...SAMPLE_PROJECT, id: "../escape" }), /lowercase/);
});

test("asset references reject executable, protocol-relative, credentialed and traversing URLs", () => {
  for (const url of ["javascript:alert(1)", "data:image/svg+xml,<svg/>", "blob:https://example.com/id", "//evil.example/file.glb", "/../file.glb", "/%2e%2e/file.glb", "https://name:password@example.com/file.glb", "http://external.example/file.glb", "idb:made-up", "/a\\b.glb"]) {
    assert.equal(isSafeAssetUrl(url), false, url);
    assert.throws(() => parseProject({ ...SAMPLE_PROJECT, model: { ...SAMPLE_PROJECT.model, url } }), /model.url/);
  }
  for (const url of ["/assets/model.glb", "https://example.com/model.glb", "idb:1af090a0-b3ad-4a57-91c6-01d8a53106f6"]) assert.equal(isSafeAssetUrl(url), true, url);
});

test("GLB validation reads actual header and node metadata", async () => {
  const metadata = await validateModelFile(glb(document));
  assert.equal(metadata.format, "glb");
  assert.equal(metadata.meshes, 1);
  assert.deepEqual(metadata.nodeNames, ["floor_0"]);
  await assert.rejects(validateModelFile(new File(["not a model"], "renamed.glb")), /truncated|valid GLB/);
  const bytes = new Uint8Array(await glb(document).arrayBuffer());
  bytes[8] = 0;
  await assert.rejects(validateModelFile(new File([bytes], "bad-length.glb")), /length/);
  await assert.rejects(validateModelFile(glb({ asset: { version: "1.0" }, meshes: [{}] })), /glTF 2.0/);
});

test("model validation requires self-contained resources and enforces upload budget", async () => {
  const external = new File([JSON.stringify({ ...document, buffers: [{ uri: "https://example.com/model.bin" }] })], "external.gltf");
  await assert.rejects(validateModelFile(external), /External model resources/);
  const embedded = new File([JSON.stringify({ ...document, buffers: [{ uri: "data:application/octet-stream;base64,AAAA" }] })], "embedded.gltf");
  assert.equal((await validateModelFile(embedded)).format, "gltf");
  await assert.rejects(validateModelFile(new File([new Uint8Array(MAX_MODEL_BYTES + 1)], "large.glb")), /25 MiB/);
  await assert.rejects(validateModelFile(new File(["{}"], "model.exe")), /\.glb/);
});

test("target validation rejects arbitrary renamed data and unsupported compiler envelopes", async () => {
  await assert.rejects(validateTargetFile(new File(["not a target"], "target.mind")), /MindAR v2/);
  await assert.rejects(validateTargetFile(new File([new Uint8Array(30)], "target.png")), /compiled .mind/);
});

test("portable publication links preserve a validated UTF8 project snapshot", () => {
  const project = { ...structuredClone(SAMPLE_PROJECT), name: "Courtyard · बेंगलुरु", status: "draft" as const };
  const link = new URL(projectUrl(project, "https://atlas.example"));
  assert.equal(link.pathname, "/experience/");
  assert.equal(link.origin, "https://atlas.example");
  assert.ok(link.href.length < 2500, "Sample project should fit a practical QR payload");
  const decoded = decodeProjectHash(link.hash);
  assert.equal(decoded?.name, project.name);
  assert.equal(decoded?.status, "published");
  assert.deepEqual(decoded?.pois, project.pois);
  assert.equal(project.status, "draft", "Publishing a URL must not mutate the draft");
});

test("local assets require a static published package rather than an invalid portable link", () => {
  const project = { ...structuredClone(SAMPLE_PROJECT), model: { ...SAMPLE_PROJECT.model, url: "idb:1af090a0-b3ad-4a57-91c6-01d8a53106f6" } };
  assert.equal(hasLocalAssets(project), true);
  const link = new URL(projectUrl(project, "http://localhost:3000"));
  assert.equal(link.searchParams.get("project"), SAMPLE_PROJECT.id);
  assert.equal(link.hash, "");
  assert.equal(staticProjectUrl(SAMPLE_PROJECT, "https://atlas.example"), "https://atlas.example/experience/?project=the-courtyard");
  assert.equal(decodeProjectHash("#other=value"), null);
  assert.throws(() => decodeProjectHash("#p=not_valid_deflate"), /could not be loaded/);
  assert.throws(() => projectUrl(SAMPLE_PROJECT, "javascript:alert(1)"), /HTTP or HTTPS/);
});

test("ZIP import rejects traversal paths, inconsistent manifests, and missing assets before storage", async () => {
  const archive = (files: Record<string, Uint8Array>) => new File([new Uint8Array(zipSync(files))], "backup.zip", { type: "application/zip" });
  await assert.rejects(importProjectBackup(archive({ "../escape": strToU8("bad") })), /unsafe path/);
  await assert.rejects(importProjectBackup(archive({ "projects/wrong-id/project.json": strToU8(JSON.stringify(SAMPLE_PROJECT)) })), /does not match/);
  const project = { ...SAMPLE_PROJECT, model: { ...SAMPLE_PROJECT.model, url: `/projects/${SAMPLE_PROJECT.id}/assets/missing.glb` } };
  await assert.rejects(importProjectBackup(archive({ [`projects/${project.id}/project.json`]: strToU8(JSON.stringify(project)) })), /missing/);
});
