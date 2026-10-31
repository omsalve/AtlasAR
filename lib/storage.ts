import { SAMPLE_PROJECTS, type Project } from "./project";
import { parseProject } from "./validation";
import { createId } from "./id";

type StoredAsset = { id: string; blob: Blob; name: string; type: string };
const DB_NAME = "atlasar-studio";
let databasePromise: Promise<IDBDatabase> | undefined;
let initializationPromise: Promise<void> | undefined;

function storageError(error: unknown): Error {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "QuotaExceededError") return new Error("Browser storage is full. Export a backup and remove unused projects or assets, then try again.");
  return new Error(`Could not access local project storage. Allow browser storage and avoid private browsing. ${error instanceof Error ? error.message : "Please try again."}`);
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("This browser does not provide IndexedDB. Open AtlasAR in a modern browser with local storage enabled."));
  if (!databasePromise) {
    databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        for (const store of ["projects", "published", "assets"]) {
          if (!database.objectStoreNames.contains(store)) database.createObjectStore(store, { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains("meta")) database.createObjectStore("meta");
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => { database.close(); databasePromise = undefined; initializationPromise = undefined; };
        resolve(database);
      };
      request.onerror = () => { databasePromise = undefined; reject(storageError(request.error)); };
      request.onblocked = () => { databasePromise = undefined; reject(new Error("Local storage needs an update. Close other AtlasAR tabs and reload.")); };
    });
  }
  return databasePromise;
}

async function transaction<T>(stores: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction, result: (value: T) => void) => void): Promise<T> {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    let value: T;
    const tx = database.transaction(stores, mode);
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(storageError(tx.error));
    tx.onabort = () => reject(storageError(tx.error));
    try { work(tx, (result) => { value = result; }); }
    catch (error) { tx.abort(); reject(storageError(error)); }
  });
}

async function initialize(): Promise<void> {
  if (!initializationPromise) {
    initializationPromise = transaction<void>(["meta", "projects", "published"], "readwrite", (tx, result) => {
      const marker = tx.objectStore("meta").get("initialized");
      marker.onsuccess = () => {
        if (marker.result) { result(undefined); return; }
        const count = tx.objectStore("projects").count();
        count.onsuccess = () => {
          if (count.result === 0) {
            for (const sample of SAMPLE_PROJECTS) {
              tx.objectStore("projects").put(parseProject(sample));
              if (sample.status === "published") tx.objectStore("published").put(parseProject(sample));
            }
          }
          tx.objectStore("meta").put(true, "initialized");
          result(undefined);
        };
      };
    }).catch((error) => { initializationPromise = undefined; throw error; });
  }
  return initializationPromise;
}

export async function listProjects(): Promise<Project[]> {
  await initialize();
  const projects = await transaction<unknown[]>(["projects"], "readonly", (tx, result) => {
    const request = tx.objectStore("projects").getAll();
    request.onsuccess = () => result(request.result);
  });
  return projects.map(parseProject).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function getProject(id: string): Promise<Project | null> {
  await initialize();
  const value = await transaction<unknown>(["projects"], "readonly", (tx, result) => {
    const request = tx.objectStore("projects").get(id);
    request.onsuccess = () => result(request.result);
  });
  return value ? parseProject(value) : null;
}

export async function saveProject(project: Project): Promise<void> {
  const parsed = parseProject(project);
  await initialize();
  await transaction<void>(["projects"], "readwrite", (tx, result) => { tx.objectStore("projects").put(parsed); result(undefined); });
}

export async function deleteProject(id: string): Promise<void> {
  await initialize();
  await transaction<void>(["projects", "published"], "readwrite", (tx, result) => {
    tx.objectStore("projects").delete(id);
    tx.objectStore("published").delete(id);
    result(undefined);
  });
}

/** A snapshot is independent of later draft changes. This publishes in the current browser only. */
export async function publishProject(project: Project): Promise<Project> {
  const snapshot = parseProject({ ...project, status: "published", updatedAt: new Date().toISOString() });
  await initialize();
  await transaction<void>(["projects", "published"], "readwrite", (tx, result) => {
    tx.objectStore("projects").put(snapshot);
    tx.objectStore("published").put(snapshot);
    result(undefined);
  });
  return snapshot;
}

export async function getPublishedProject(id: string): Promise<Project | null> {
  await initialize();
  const value = await transaction<unknown>(["published"], "readonly", (tx, result) => {
    const request = tx.objectStore("published").get(id);
    request.onsuccess = () => result(request.result);
  });
  return value ? parseProject(value) : null;
}

export async function saveAsset(file: Blob): Promise<string> {
  if (file.size === 0 || file.size > 25 * 1024 * 1024) throw new Error("An uploaded asset must be between 1 byte and 25 MiB.");
  const id = `idb:${createId()}`;
  const name = file instanceof File ? file.name : "asset";
  await transaction<void>(["assets"], "readwrite", (tx, result) => {
    tx.objectStore("assets").put({ id, blob: file, name, type: file.type } satisfies StoredAsset);
    result(undefined);
  });
  return id;
}

export async function getAsset(id: string): Promise<StoredAsset> {
  const asset = await transaction<StoredAsset | undefined>(["assets"], "readonly", (tx, result) => {
    const request = tx.objectStore("assets").get(id);
    request.onsuccess = () => result(request.result);
  });
  if (!asset || !(asset.blob instanceof Blob)) throw new Error("This uploaded asset is unavailable in this browser. Import the project backup or upload the file again.");
  return asset;
}

export async function getAssetBlob(id: string): Promise<Blob> { return (await getAsset(id)).blob; }

/** Callers own returned object URLs and must revoke them on scene/image cleanup. */
export async function resolveAssetUrl(url: string): Promise<string> {
  if (!url.startsWith("idb:")) return url;
  return URL.createObjectURL(await getAssetBlob(url));
}
