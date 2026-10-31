import type { AssetRef, CameraView, Floor, Poi, Project, Vec3 } from "./project";

const ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const UUID = /^idb:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ASSET_BYTES = 25 * 1024 * 1024;

function fail(path: string, message: string): never {
  throw new Error(`${path}: ${message}`);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "expected an object");
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string, max: number, min = 0): string {
  if (typeof value !== "string" || value.length < min || value.length > max) {
    fail(path, `expected text between ${min} and ${max} characters`);
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail(path, "contains control characters");
  return value;
}

function id(value: unknown, path: string): string {
  const result = string(value, path, 80, 1);
  if (!ID.test(result)) fail(path, "use lowercase letters, numbers, and hyphens");
  return result;
}

function number(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    fail(path, `expected a finite number from ${min} to ${max}`);
  }
  return value;
}

function vector(value: unknown, path: string): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) fail(path, "expected three coordinates");
  return value.map((coordinate, index) => number(coordinate, `${path}[${index}]`, -10000, 10000)) as Vec3;
}

function camera(value: unknown, path: string): CameraView {
  const record = object(value, path);
  const position = vector(record.position, `${path}.position`);
  const target = vector(record.target, `${path}.target`);
  if (position.every((coordinate, index) => Math.abs(coordinate - target[index]) < 0.0001)) {
    fail(path, "camera position must differ from its target");
  }
  return { position, target };
}

/** Manifests cannot supply executable/data/blob URLs. Blob URLs are created only by storage. */
export function isSafeAssetUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 2048 || /[\u0000-\u0020\\]/.test(value)) return false;
  if (UUID.test(value)) return true;
  if (value.startsWith("/") && !value.startsWith("//")) {
    try {
      const path = decodeURIComponent(value.split(/[?#]/)[0]);
      return !/[\\\u0000-\u001f]/.test(path) && !path.split("/").some((part) => part === ".." || part === ".");
    } catch { return false; }
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !!url.hostname;
  } catch { return false; }
}

function assetUrl(value: unknown, path: string): string {
  if (!isSafeAssetUrl(value)) fail(path, "use a root-relative path, HTTPS URL, or an uploaded asset");
  return value;
}

function asset(value: unknown, path: string): AssetRef {
  const record = object(value, path);
  const result: AssetRef = { url: assetUrl(record.url, `${path}.url`), name: string(record.name, `${path}.name`, 180, 1) };
  if (record.size !== undefined) result.size = number(record.size, `${path}.size`, 1, MAX_ASSET_BYTES);
  return result;
}

function array(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(path, `expected a list with at most ${max} entries`);
  return value;
}

function unique<T extends { id: string }>(values: T[], path: string): T[] {
  if (new Set(values.map((value) => value.id)).size !== values.length) fail(path, "identifiers must be unique");
  return values;
}

function timestamp(value: unknown, path: string): string {
  const result = string(value, path, 40, 10);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(result) || !Number.isFinite(Date.parse(result))) fail(path, "expected an ISO timestamp");
  return result;
}

/** Parse to a fresh, whitelisted object; TypeScript assertions alone never admit imported data. */
export function parseProject(value: unknown): Project {
  const record = object(value, "Project");
  if (record.schemaVersion !== 1) fail("schemaVersion", "only project format version 1 is supported");
  if (record.status !== "draft" && record.status !== "published") fail("status", "expected draft or published");
  if (record.cover !== "sage" && record.cover !== "sand" && record.cover !== "slate") fail("cover", "unsupported cover style");
  const ar = object(record.ar, "ar");
  const pois: Poi[] = unique(array(record.pois, "pois", 64).map((item, index) => {
    const path = `pois[${index}]`;
    const poi = object(item, path);
    if (!["amenity", "apartment", "entrance", "outdoor"].includes(poi.category as string)) fail(`${path}.category`, "unsupported category");
    const parsed: Poi = {
      id: id(poi.id, `${path}.id`), name: string(poi.name, `${path}.name`, 100, 1),
      category: poi.category as Poi["category"], position: vector(poi.position, `${path}.position`),
      camera: camera(poi.camera, `${path}.camera`), description: string(poi.description, `${path}.description`, 3000),
    };
    if (poi.mediaUrl !== undefined) parsed.mediaUrl = assetUrl(poi.mediaUrl, `${path}.mediaUrl`);
    if (poi.interior !== undefined) {
      if (typeof poi.interior !== "boolean") fail(`${path}.interior`, "expected a boolean");
      parsed.interior = poi.interior;
    }
    return parsed;
  }), "pois");
  const floors: Floor[] = unique(array(record.floors, "floors", 100).map((item, index) => {
    const path = `floors[${index}]`;
    const floor = object(item, path);
    const nodeNames = array(floor.nodeNames, `${path}.nodeNames`, 200).map((node, nodeIndex) => string(node, `${path}.nodeNames[${nodeIndex}]`, 180, 1));
    if (nodeNames.length === 0) fail(`${path}.nodeNames`, "map at least one scene node");
    return { id: id(floor.id, `${path}.id`), name: string(floor.name, `${path}.name`, 100, 1), nodeNames: [...new Set(nodeNames)] };
  }), "floors");
  const parsed: Project = {
    schemaVersion: 1, id: id(record.id, "id"), name: string(record.name, "name", 120, 1),
    description: string(record.description, "description", 5000), location: string(record.location, "location", 160),
    status: record.status, cover: record.cover, createdAt: timestamp(record.createdAt, "createdAt"), updatedAt: timestamp(record.updatedAt, "updatedAt"),
    model: asset(record.model, "model"), overview: camera(record.overview, "overview"),
    ar: { targetImageUrl: assetUrl(ar.targetImageUrl, "ar.targetImageUrl"), targetMindUrl: assetUrl(ar.targetMindUrl, "ar.targetMindUrl"), scale: number(ar.scale, "ar.scale", 0.0001, 100) },
    pois, floors,
  };
  if (record.interiorModel !== undefined) parsed.interiorModel = asset(record.interiorModel, "interiorModel");
  return parsed;
}
