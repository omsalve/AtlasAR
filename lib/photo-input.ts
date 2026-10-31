/** Local-only preparation of a gallery photo for the real image-target tracker. */
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
export const MAX_PHOTO_SIDE = 1280;
const MAX_DECODED_PIXELS = 64_000_000;

export type PreparedPhoto = { canvas: HTMLCanvasElement; width: number; height: number; name: string };
type PhotoType = "image/png" | "image/jpeg" | "image/webp" | "image/heic";

/** Inspect bytes rather than trusting a filename or the picker-supplied MIME type. */
function photoType(bytes: Uint8Array): PhotoType | null {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const text = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes.length >= 16 && text(0, 4) === "RIFF" && text(8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 16 && text(4, 8) === "ftyp") {
    const brands = [text(8, 12)];
    for (let offset = 16; offset + 4 <= bytes.length; offset += 4) brands.push(text(offset, offset + 4));
    // AVIF is another ISO-BMFF format; only explicit HEVC image brands qualify.
    if (!brands.some(brand => brand === "avif" || brand === "avis") && brands.some(brand => /^(heic|heix|hevc|hevx|heim|heis|hevm|hevs)$/.test(brand))) return "image/heic";
  }
  return null;
}

/**
 * Returns an EXIF-oriented, opaque canvas no larger than 1280 pixels on either
 * side. Nothing is uploaded or saved. The caller owns the returned canvas.
 * HEIC is accepted only when this browser can decode it natively.
 */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  if (!file || file.size === 0) throw new Error("Choose a photo that is not empty.");
  if (file.size > MAX_PHOTO_BYTES) throw new Error("Choose a photo no larger than 25 MiB. Export a smaller JPEG if necessary.");
  const type = photoType(new Uint8Array(await file.slice(0, 128).arrayBuffer()));
  if (!type) throw new Error("Choose an actual JPEG, PNG or WebP photo. HEIC works only in browsers with native support; SVG, PDFs and other files are not supported.");
  const blob = file.slice(0, file.size, type);
  let bitmap: ImageBitmap | undefined;
  let image: HTMLImageElement | undefined;
  let url: string | undefined;
  try {
    if (typeof createImageBitmap === "function") {
      try { bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" }); }
      catch {
        // ImageBitmap and <img> decoder support differs, notably for mobile HEIC.
      }
    }
    if (!bitmap) {
      url = URL.createObjectURL(blob);
      image = new Image();
      image.decoding = "async";
      image.src = url;
      try { await image.decode(); }
      catch { throw new Error(type === "image/heic" ? "This browser cannot decode this HEIC photo. Export or share it as a JPEG, then choose that copy." : "This photo could not be decoded. Choose a valid JPEG, PNG or WebP, or export a fresh copy."); }
    }
    const source = bitmap || image!;
    const width = bitmap?.width ?? image!.naturalWidth;
    const height = bitmap?.height ?? image!.naturalHeight;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 128 || height < 128) throw new Error("Choose a photo at least 128 pixels wide and high so the target has enough detail.");
    if (width * height > MAX_DECODED_PIXELS || width > 16_384 || height > 16_384) throw new Error("This photo has too many pixels for a mobile test. Export a smaller copy, preferably around 1280 pixels on its longest side.");
    const ratio = Math.min(1, MAX_PHOTO_SIDE / Math.max(width, height));
    let drawWidth = Math.max(1, Math.round(width * ratio));
    let drawHeight = Math.max(1, Math.round(height * ratio));
    // MindAR 1.2.5 mistakes a square input for a rotated input. Preserve every
    // photo pixel's aspect ratio and add one neutral column, rather than rotate
    // it or distort it. Keep that column inside the maximum-side budget.
    const square = drawWidth === drawHeight;
    if (square && drawWidth === MAX_PHOTO_SIDE) { drawWidth -= 1; drawHeight -= 1; }
    const canvas = document.createElement("canvas");
    canvas.width = drawWidth + (square ? 1 : 0);
    canvas.height = drawHeight;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("This browser could not prepare the photo. Close other demanding tabs and try again.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(source, 0, 0, drawWidth, drawHeight);
    return { canvas, width: canvas.width, height: canvas.height, name: file.name.slice(0, 200) || "Selected photo" };
  } finally {
    bitmap?.close();
    if (image) image.src = "";
    if (url) URL.revokeObjectURL(url);
  }
}
