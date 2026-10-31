export const MAX_MODEL_BYTES = 25 * 1024 * 1024;
export const MAX_TARGET_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export type ModelMetadata = { format: "glb" | "gltf"; size: number; nodes: number; meshes: number; textures: number; nodeNames: string[] };

function checkSize(file: File, max: number, label: string) {
  if (file.size === 0) throw new Error(`${label} is empty.`);
  if (file.size > max) throw new Error(`${label} must be no larger than ${Math.round(max / 1024 / 1024)} MiB. Optimize the asset before uploading.`);
}

function inspectGltf(value: unknown): Omit<ModelMetadata, "format" | "size"> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The model JSON is not a glTF document.");
  const gltf = value as Record<string, unknown>;
  const asset = gltf.asset as { version?: unknown } | undefined;
  if (asset?.version !== "2.0") throw new Error("Only glTF 2.0 models are supported.");
  const counts: Record<string, number> = {};
  for (const [key, max] of [["nodes", 50000], ["meshes", 20000], ["textures", 256]] as const) {
    const values = gltf[key];
    if (values !== undefined && (!Array.isArray(values) || values.length > max)) throw new Error(`The model has an invalid or excessive ${key} list (maximum ${max}).`);
    counts[key] = Array.isArray(values) ? values.length : 0;
  }
  if (counts.meshes === 0) throw new Error("The model contains no meshes to display.");
  let visited = 0;
  const inspectUris = (item: unknown, depth: number) => {
    if (depth > 48 || ++visited > 500000) throw new Error("The model JSON is too complex. Optimize or simplify it before uploading.");
    if (Array.isArray(item)) { for (const child of item) inspectUris(child, depth + 1); return; }
    if (!item || typeof item !== "object") return;
    for (const [key, child] of Object.entries(item)) {
      if (key === "uri" && (typeof child !== "string" || !/^data:(?:application\/(?:octet-stream|gltf-buffer)|image\/(?:png|jpeg|webp));base64,[A-Za-z0-9+/]*={0,2}$/.test(child))) {
        throw new Error("External model resources are not supported. Export a self-contained GLB or embed every buffer and texture in the glTF.");
      }
      inspectUris(child, depth + 1);
    }
  };
  inspectUris(gltf, 0);
  const nodeNames = Array.isArray(gltf.nodes) ? gltf.nodes.flatMap((node) => typeof node?.name === "string" ? [node.name.slice(0, 180)] : []) : [];
  return { nodes: counts.nodes, meshes: counts.meshes, textures: counts.textures, nodeNames };
}

/** Check the file container, glTF version, resource policy and resource budgets before storing. */
export async function validateModelFile(file: File): Promise<ModelMetadata> {
  checkSize(file, MAX_MODEL_BYTES, "The model");
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension !== "glb" && extension !== "gltf") throw new Error("Choose a .glb or self-contained .gltf model.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let json: string;
  if (extension === "glb") {
    if (bytes.length < 20) throw new Error("The GLB is truncated.");
    const view = new DataView(bytes.buffer);
    if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) throw new Error("This file is not a valid GLB 2.0 model.");
    if (view.getUint32(8, true) !== bytes.length) throw new Error("The GLB length does not match its header. Re-export the model.");
    if (view.getUint32(16, true) !== 0x4e4f534a) throw new Error("The GLB must start with a JSON chunk.");
    const jsonLength = view.getUint32(12, true);
    if (jsonLength > 4 * 1024 * 1024 || jsonLength < 2 || jsonLength + 20 > bytes.length) throw new Error("The GLB JSON chunk is invalid or larger than 4 MiB.");
    let offset = 12;
    while (offset < bytes.length) {
      if (offset + 8 > bytes.length) throw new Error("The GLB has a truncated chunk header.");
      const length = view.getUint32(offset, true);
      if (length % 4 !== 0 || offset + 8 + length > bytes.length) throw new Error("The GLB has an invalid chunk length.");
      offset += 8 + length;
    }
    json = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(20, 20 + jsonLength)).trim();
  } else {
    json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }
  let gltf: unknown;
  try { gltf = JSON.parse(json); } catch { throw new Error("The model contains malformed JSON."); }
  return { format: extension, size: file.size, ...inspectGltf(gltf) };
}

/** MindAR compiler v2 writes MessagePack {v:2,dataList:[...]}; deeper decoding occurs in MindAR. */
export async function validateTargetFile(file: File): Promise<void> {
  checkSize(file, MAX_TARGET_BYTES, "The compiled target");
  if (!file.name.toLowerCase().endsWith(".mind")) throw new Error("Choose a compiled .mind target, or compile your image in Target Studio.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const expected = [0x82, 0xa1, 0x76, 0x02, 0xa8, 0x64, 0x61, 0x74, 0x61, 0x4c, 0x69, 0x73, 0x74];
  if (bytes.length < 24 || !expected.every((byte, index) => bytes[index] === byte) || bytes[13] !== 0x91) {
    throw new Error("This is not a supported single-image MindAR v2 target. Recompile one target image in Target Studio.");
  }
}

function imageType(bytes: Uint8Array): string | null {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (new TextDecoder().decode(bytes.subarray(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.subarray(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export async function validateImageFile(file: File): Promise<{ width: number; height: number; type: string }> {
  checkSize(file, MAX_IMAGE_BYTES, "The image");
  const type = imageType(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
  if (!type || !/\.(png|jpe?g|webp)$/i.test(file.name)) throw new Error("Choose a valid PNG, JPEG, or WebP image. SVG and executable content are not accepted.");
  if (file.type && file.type !== type) throw new Error("The image content does not match its file type.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (image.naturalWidth < 128 || image.naturalHeight < 128) throw new Error("The target image must be at least 128 × 128 pixels.");
    if (image.naturalWidth > 4096 || image.naturalHeight > 4096) throw new Error("Resize the target image to at most 4096 × 4096 pixels.");
    return { width: image.naturalWidth, height: image.naturalHeight, type };
  } catch (error) {
    if (error instanceof Error && /target image/.test(error.message)) throw error;
    throw new Error("The image could not be decoded. Re-export it as a PNG or JPEG.");
  } finally { URL.revokeObjectURL(url); }
}
