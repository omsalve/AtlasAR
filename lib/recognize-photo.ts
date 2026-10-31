import { loadTrackingLibrary } from "./mindar";
import { preparePhoto } from "./photo-input";
import { resolveAssetUrl } from "./storage";
import { MAX_TARGET_BYTES } from "./assets";

/** A gallery photo is only an activation check. Its pose never places the model. */
export async function recognizePhoto(file: File, targetAssetUrl: string, signal: AbortSignal, onMatching: () => void): Promise<boolean> {
  let canvas: HTMLCanvasElement | undefined;
  let controller: MindARController | undefined;
  let processing: Promise<void> | undefined;
  let resolved = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let removeAbort = () => {};
  try {
    const prepared = await preparePhoto(file);
    canvas = prepared.canvas;
    signal.throwIfAborted();
    const api = await loadTrackingLibrary();
    signal.throwIfAborted();
    resolved = await resolveAssetUrl(targetAssetUrl);
    const response = await fetch(resolved, { signal });
    if (!response.ok) throw new Error("The configured image target is missing. Compile and publish the project target before scanning.");
    if (Number(response.headers.get("content-length")) > MAX_TARGET_BYTES) throw new Error("The compiled target exceeds the 10 MiB limit.");
    const data = await response.arrayBuffer();
    if (data.byteLength === 0 || data.byteLength > MAX_TARGET_BYTES) throw new Error("The compiled target is empty or exceeds 10 MiB.");
    signal.throwIfAborted();
    controller = new api.Controller({ inputWidth: prepared.width, inputHeight: prepared.height, maxTrack: 1, warmupTolerance: 5, missTolerance: 5 });
    const target = controller.addImageTargetsFromBuffer(data);
    if (target.dimensions.length !== 1 || !target.dimensions[0].every(n => Number.isFinite(n) && n > 0)) throw new Error("This project needs exactly one valid compiled image target.");
    controller.dummyRun(canvas);
    signal.throwIfAborted();
    onMatching();
    const decision = new Promise<boolean>((resolve, reject) => {
      const finish = (found: boolean) => { controller?.stopProcessVideo(); resolve(found); };
      controller!.onUpdate = update => {
        if (update.type === "updateMatrix" && update.targetIndex === 0 && update.worldMatrix !== null) finish(true);
      };
      controller!.worker.onerror = () => { controller?.stopProcessVideo(); reject(new Error("The image recognizer stopped unexpectedly. Choose the photo again.")); };
      const abort = () => { controller?.stopProcessVideo(); reject(new DOMException("Photo scan cancelled.", "AbortError")); };
      signal.addEventListener("abort", abort, { once: true });
      removeAbort = () => signal.removeEventListener("abort", abort);
      timer = setTimeout(() => finish(false), 15_000);
    });
    processing = controller.processVideo(canvas);
    void processing.catch(() => {});
    return await Promise.race([decision, processing.then(() => false)]);
  } finally {
    clearTimeout(timer); removeAbort();
    if (controller) {
      controller.onUpdate = null;
      controller.stopProcessVideo();
      controller.workerMatchDone?.({ targetIndex: -1, modelViewTransform: null });
      controller.workerTrackDone?.({ modelViewTransform: null });
      await processing?.catch(() => {});
      controller.dispose(); controller.worker.terminate();
    }
    if (canvas) { canvas.width = 1; canvas.height = 1; }
    if (resolved.startsWith("blob:")) URL.revokeObjectURL(resolved);
  }
}
