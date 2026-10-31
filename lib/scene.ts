import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import type { Floor } from "./project";
import { resolveAssetUrl } from "./storage";
import { MAX_MODEL_BYTES, validateModelFile } from "./assets";

async function fetchModel(url: string): Promise<ArrayBuffer> {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 45_000);
  try {
    const response = await fetch(url, { signal: abort.signal });
    if (!response.ok) throw new Error(`The model request failed (HTTP ${response.status}).`);
    if (Number(response.headers.get("content-length")) > MAX_MODEL_BYTES) { abort.abort(); throw new Error("This model exceeds the 25 MiB loading limit. Optimize it before publishing."); }
    if (!response.body) throw new Error("The model response was empty.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_MODEL_BYTES) { await reader.cancel(); throw new Error("This model exceeds the 25 MiB loading limit. Optimize it before publishing."); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const isGlb = bytes.length >= 4 && new DataView(bytes.buffer).getUint32(0, true) === 0x46546c67;
    await validateModelFile(new File([bytes], isGlb ? "model.glb" : "model.gltf"));
    return bytes.buffer;
  } finally { clearTimeout(timeout); }
}

/** Shared model loading for the ordinary viewer and tracked AR runtime. */
export async function loadModel(url: string, renderer?: THREE.WebGLRenderer): Promise<THREE.Group> {
  const resolved = await resolveAssetUrl(url);
  const loader = new GLTFLoader();
  const draco = new DRACOLoader().setDecoderPath("/vendor/draco/");
  loader.setDRACOLoader(draco);
  loader.setMeshoptDecoder(MeshoptDecoder);
  const ktx = renderer ? new KTX2Loader().setTranscoderPath("/vendor/basis/").detectSupport(renderer) : null;
  if (ktx) loader.setKTX2Loader(ktx);
  try {
    const bytes = await fetchModel(resolved);
    const gltf = await loader.parseAsync(bytes, "");
    prepareModel(gltf.scene);
    gltf.scene.userData.animationCount = gltf.animations.length;
    return gltf.scene;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "The file could not be decoded.";
    throw new Error(`Unable to load this 3D model. Check the GLB/glTF file and its assets. ${detail}`);
  } finally {
    draco.dispose();
    ktx?.dispose();
    if (url.startsWith("idb:") && resolved.startsWith("blob:")) URL.revokeObjectURL(resolved);
  }
}

/** Make every project use the same authoring space: Y-up, base zero, footprint 12. */
export function prepareModel(group: THREE.Group): void {
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(group);
  const size = bounds.getSize(new THREE.Vector3());
  if (bounds.isEmpty() || !Number.isFinite(size.length()) || Math.max(size.x, size.z) < 0.00001) {
    disposeObject(group);
    throw new Error("The model is empty or has invalid dimensions.");
  }
  const scale = 12 / Math.max(size.x, size.z);
  group.scale.multiplyScalar(scale);
  group.updateMatrixWorld(true);
  const normalized = new THREE.Box3().setFromObject(group);
  const center = normalized.getCenter(new THREE.Vector3());
  group.position.add(new THREE.Vector3(-center.x, -normalized.min.y, -center.z));
  group.updateMatrixWorld(true);
  let triangles = 0;
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
      const geometry = object.geometry;
      triangles += (geometry.index?.count ?? geometry.attributes.position?.count ?? 0) / 3;
    }
  });
  group.userData.triangles = Math.round(triangles);
  group.userData.normalized = true;
}

/** Named floor roots are the explicit asset contract; unrelated landscape stays visible. */
export function applyFloorVisibility(group: THREE.Group, floors: Floor[], selectedId?: string | null): void {
  const allNodes = new Set(floors.flatMap((floor) => floor.nodeNames));
  const chosen = floors.find((floor) => floor.id === selectedId);
  group.traverse((object) => {
    if (allNodes.has(object.name)) object.visible = !chosen || chosen.nodeNames.includes(object.name);
  });
}

/** Models may share materials/textures, so dispose each GPU resource once. */
export function disposeObject(object: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    geometries.add(child.geometry);
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  textures.forEach((texture) => {
    if (typeof ImageBitmap !== "undefined" && texture.image instanceof ImageBitmap) texture.image.close();
    texture.dispose();
  });
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
}
