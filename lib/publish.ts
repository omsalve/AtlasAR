import { deflateSync, inflateSync, strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { Project } from "./project";
import { getAsset, getProject, saveAsset, saveProject } from "./storage";
import { parseProject } from "./validation";
import { validateImageFile, validateModelFile, validateTargetFile } from "./assets";
import { createId } from "./id";

const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_HASH_LENGTH = 24000;
const MAX_PACKAGE_BYTES = 100 * 1024 * 1024;

function assetUrls(project: Project): string[] {
  return [project.model.url, project.interiorModel?.url, project.ar.targetImageUrl, project.ar.targetMindUrl, ...project.pois.map((poi) => poi.mediaUrl)].filter((value): value is string => !!value);
}

function rewriteAssets(project: Project, mapping: Map<string, string>): Project {
  const replace = (url: string) => mapping.get(url) ?? url;
  return parseProject({
    ...project,
    model: { ...project.model, url: replace(project.model.url) },
    ...(project.interiorModel ? { interiorModel: { ...project.interiorModel, url: replace(project.interiorModel.url) } } : {}),
    ar: { ...project.ar, targetImageUrl: replace(project.ar.targetImageUrl), targetMindUrl: replace(project.ar.targetMindUrl) },
    pois: project.pois.map((poi) => ({ ...poi, ...(poi.mediaUrl ? { mediaUrl: replace(poi.mediaUrl) } : {}) })),
  });
}

export function hasLocalAssets(project: Project): boolean { return assetUrls(project).some((url) => url.startsWith("idb:")); }

function baseUrl(origin: string): URL {
  const base = new URL(origin);
  if (!["https:", "http:"].includes(base.protocol) || base.username || base.password) throw new Error("Enter an HTTP or HTTPS hosting origin, such as https://your-site.pages.dev.");
  return new URL("/experience/", base.origin);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("The shared project link is malformed.");
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/** Short static URL for a project whose exported projects/ directory has been deployed. */
export function staticProjectUrl(project: Project, origin: string): string {
  const parsed = parseProject(project);
  const url = baseUrl(origin);
  url.searchParams.set("project", parsed.id);
  return url.href;
}

/** Public assets travel in a compressed manifest. Local uploads require publishing the ZIP first. */
export function projectUrl(project: Project, origin: string): string {
  const parsed = parseProject({ ...project, status: "published" });
  if (hasLocalAssets(parsed)) return staticProjectUrl(parsed, origin);
  const json = strToU8(JSON.stringify(parsed));
  if (json.length > MAX_MANIFEST_BYTES) throw new Error("The project is too large for a share link. Export and host its static package instead.");
  const hash = toBase64Url(deflateSync(json, { level: 9 }));
  if (hash.length > MAX_HASH_LENGTH) throw new Error("The project is too large for a share link. Export and host its static package instead.");
  const url = baseUrl(origin);
  url.hash = `p=${hash}`;
  return url.href;
}

export function decodeProjectHash(hash: string): Project | null {
  const parameters = new URLSearchParams(hash.replace(/^#/, ""));
  const value = parameters.get("p");
  if (!value) return null;
  if (value.length > MAX_HASH_LENGTH) throw new Error("The shared project link exceeds the supported size.");
  try {
    const bytes = inflateSync(fromBase64Url(value), { out: new Uint8Array(MAX_MANIFEST_BYTES + 1) });
    if (bytes.length > MAX_MANIFEST_BYTES) throw new Error("Project manifest is too large.");
    const parsed = parseProject(JSON.parse(strFromU8(bytes)));
    if (hasLocalAssets(parsed)) throw new Error("A public project link cannot contain browser-local assets. Ask its author for a published package.");
    return parsed;
  } catch (error) { throw new Error(`This shared project could not be loaded. ${error instanceof Error ? error.message : "The link is invalid."}`); }
}

/** Includes uploaded assets; existing public/HTTPS asset references remain references. */
export async function exportProjectPackage(project: Project): Promise<Blob> {
  const parsed = parseProject({ ...project, status: "published" });
  const mapping = new Map<string, string>();
  const files: Record<string, Uint8Array> = {};
  let total = 0;
  for (const url of new Set(assetUrls(parsed))) {
    if (!url.startsWith("idb:")) continue;
    const stored = await getAsset(url);
    total += stored.blob.size;
    if (total > MAX_PACKAGE_BYTES) throw new Error("The combined uploaded assets exceed the 100 MiB export budget.");
    const extension = stored.name.split(".").pop()?.toLowerCase();
    if (!extension || !["glb", "gltf", "mind", "png", "jpg", "jpeg", "webp"].includes(extension)) throw new Error(`The uploaded asset ${stored.name} has an unsupported filename. Upload it again with its original extension.`);
    const path = `projects/${parsed.id}/assets/${url.slice(4)}.${extension}`;
    files[path] = new Uint8Array(await stored.blob.arrayBuffer());
    mapping.set(url, `/${path}`);
  }
  const portable = rewriteAssets(parsed, mapping);
  files[`projects/${parsed.id}/project.json`] = strToU8(JSON.stringify(portable, null, 2));
  files["PUBLISHING.txt"] = strToU8("AtlasAR static project package\n\nCopy the projects/ folder into your AtlasAR public/ directory before npm run build, or into the static out/ directory after building. Serve the complete app over HTTPS. Open /experience/?project=" + parsed.id + ".\n\nThis package includes uploaded local assets. Existing root-relative sample assets are already part of AtlasAR; external HTTPS assets must remain publicly accessible with CORS. This ZIP is also importable in AtlasAR Studio as a project backup. No hosting account or deployment was created.\n");
  const bytes = zipSync(files, { level: 1 });
  return new Blob([new Uint8Array(bytes)], { type: "application/zip" });
}

export const exportProjectBackup = exportProjectPackage;

export async function importProjectBackup(file: File): Promise<Project> {
  if (!file.name.toLowerCase().endsWith(".zip") || file.size === 0 || file.size > MAX_PACKAGE_BYTES) throw new Error("Choose an AtlasAR .zip backup no larger than 100 MiB.");
  let extracted: Record<string, Uint8Array>;
  let total = 0;
  let count = 0;
  try {
    extracted = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: (entry) => {
      if (entry.name.endsWith("/")) return false;
      if (++count > 100 || entry.originalSize > 25 * 1024 * 1024 || (total += entry.originalSize) > MAX_PACKAGE_BYTES) throw new Error("The backup exceeds the safe extraction budget.");
      if (entry.name.includes("\\") || entry.name.startsWith("/") || entry.name.split("/").some((part) => part === ".." || part === ".")) throw new Error("The backup contains an unsafe path.");
      return /^projects\/[a-z0-9-]+\/(?:project\.json|assets\/[a-zA-Z0-9.-]+)$/.test(entry.name);
    } });
  } catch (error) { throw new Error(`The ZIP could not be opened. ${error instanceof Error ? error.message : "Invalid archive."}`); }
  const manifests = Object.keys(extracted).filter((name) => name.endsWith("/project.json"));
  if (manifests.length !== 1) throw new Error("The backup must contain exactly one projects/<id>/project.json manifest.");
  if (extracted[manifests[0]].length > MAX_MANIFEST_BYTES) throw new Error("The project manifest is too large.");
  const project = parseProject(JSON.parse(strFromU8(extracted[manifests[0]])));
  if (manifests[0] !== `projects/${project.id}/project.json`) throw new Error("The backup folder does not match its project identifier.");
  if (hasLocalAssets(project)) throw new Error("This backup contains unresolved browser-local references. Export it again from the original browser.");
  const mapping = new Map<string, string>();
  for (const url of new Set(assetUrls(project))) {
    const path = url.replace(/^\//, "");
    const bytes = extracted[path];
    if (!bytes) {
      if (path.startsWith(`projects/${project.id}/assets/`)) throw new Error(`An uploaded asset is missing from the backup: ${path}`);
      continue;
    }
    const extension = path.split(".").pop()?.toLowerCase();
    const types: Record<string, string> = { glb: "model/gltf-binary", gltf: "model/gltf+json", mind: "application/octet-stream", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
    const assetFile = new File([new Uint8Array(bytes)], path.split("/").pop()!, { type: types[extension ?? ""] ?? "" });
    if (extension === "glb" || extension === "gltf") await validateModelFile(assetFile);
    else if (extension === "mind") await validateTargetFile(assetFile);
    else await validateImageFile(assetFile);
    mapping.set(url, await saveAsset(assetFile));
  }
  const restored = rewriteAssets(project, mapping);
  if (await getProject(restored.id)) restored.id = `${restored.id.slice(0, 60)}-copy-${createId().slice(0, 8)}`;
  restored.status = "draft";
  restored.updatedAt = new Date().toISOString();
  await saveProject(restored);
  return restored;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
