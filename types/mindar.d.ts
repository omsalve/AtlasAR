/** The browser-only, self-hosted MindAR 1.2.5 distribution. */
type MindARUpdate = { type: "updateMatrix"; targetIndex: number; worldMatrix: number[] | null } | { type: "processDone" };
type MindARInput = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;
interface MindARController {
  inputWidth: number;
  inputHeight: number;
  processingVideo: boolean;
  worker: Worker;
  workerMatchDone?: ((data: unknown) => void) | null;
  workerTrackDone?: ((data: unknown) => void) | null;
  onUpdate: ((update: MindARUpdate) => void) | null;
  addImageTargetsFromBuffer(buffer: ArrayBuffer): { dimensions: [number, number][] };
  getProjectionMatrix(): number[];
  dummyRun(input: MindARInput): void;
  processVideo(input: MindARInput): Promise<void>;
  stopProcessVideo(): void;
  dispose(): void;
}
interface MindARCompiler {
  data?: { matchingData: { maximaPoints: unknown[]; minimaPoints: unknown[] }[]; trackingData: unknown[] }[];
  compileImageTargets(images: HTMLImageElement[], onProgress: (percent: number) => void): Promise<unknown>;
  exportData(): Uint8Array;
  importData(buffer: ArrayBuffer): unknown[];
}
interface MindARImageApi {
  Controller: new (options: { inputWidth: number; inputHeight: number; onUpdate?: (update: MindARUpdate) => void; maxTrack?: number; warmupTolerance?: number; missTolerance?: number; filterMinCF?: number; filterBeta?: number }) => MindARController;
  Compiler: new () => MindARCompiler;
}
interface Window { MINDAR?: { IMAGE?: MindARImageApi } }
