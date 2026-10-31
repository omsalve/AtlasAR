export type SurfaceState = {
  phase: "searching" | "stabilizing" | "ready";
  reason: "missing" | "tilted" | "distance" | "unstable" | "steady";
  progress: number;
  hitIndex: number;
  position: [number, number, number] | null;
};

const HOLD_MS = 600;
const MIN_SAMPLES = 8;
const MAX_TILT = Math.cos(20 * Math.PI / 180);
const MAX_JITTER_METERS = .025;

/** Placement policy, not a surface detector. Only native plane hits are accepted.
 * Thresholds are application tuning in meters; WebXR supplies no confidence score.
 */
export class SurfaceTracker {
  private samples: { time: number; position: [number, number, number] }[] = [];

  reset() { this.samples = []; }

  update(matrices: readonly (ArrayLike<number> | null)[], viewer: ArrayLike<number>, time: number): SurfaceState {
    const empty = (reason: SurfaceState["reason"]): SurfaceState => {
      this.reset();
      return { phase: "searching", reason, progress: 0, hitIndex: -1, position: null };
    };
    if (!Number.isFinite(time) || ![viewer[12], viewer[13], viewer[14]].every(Number.isFinite)) return empty("missing");
    let reason: SurfaceState["reason"] = "missing";
    const candidates: { index: number; position: [number, number, number] }[] = [];
    matrices.forEach((matrix, index) => {
      if (!matrix || matrix.length !== 16 || !Array.from(matrix).every(Number.isFinite)) return;
      const length = Math.hypot(matrix[4], matrix[5], matrix[6]);
      if (length < .001 || matrix[5] / length < MAX_TILT) { reason = "tilted"; return; }
      const position: [number, number, number] = [matrix[12], matrix[13], matrix[14]];
      const distance = Math.hypot(...position.map((value, axis) => value - viewer[12 + axis]));
      if (distance < .25 || distance > 5) { reason = "distance"; return; }
      candidates.push({ index, position });
    });
    if (!candidates.length) return empty(reason);
    const last = this.samples.at(-1);
    // Keep the same nearby surface when multiple planes overlap in the view ray.
    if (last) candidates.sort((a, b) => this.distance(a.position, last.position) - this.distance(b.position, last.position));
    const chosen = candidates[0];
    if (last && (time <= last.time || time - last.time > 200 || this.distance(last.position, chosen.position) > MAX_JITTER_METERS * 2)) this.reset();
    this.samples.push({ time, position: chosen.position });
    // Retain the sample immediately before the window boundary to measure a full dwell.
    while (this.samples.length > MIN_SAMPLES && this.samples[1].time <= time - HOLD_MS) this.samples.shift();
    const mean = (): [number, number, number] => [0, 1, 2].map(axis => this.samples.reduce((sum, sample) => sum + sample.position[axis], 0) / this.samples.length) as [number, number, number];
    let position = mean();
    const unstable = this.samples.some(sample => this.distance(sample.position, position) > MAX_JITTER_METERS);
    if (unstable) { this.samples = [{ time, position: chosen.position }]; position = [...chosen.position]; }
    const elapsed = time - this.samples[0].time;
    const progress = Math.min(1, elapsed / HOLD_MS, this.samples.length / MIN_SAMPLES);
    return { phase: progress >= 1 ? "ready" : "stabilizing", reason: unstable ? "unstable" : "steady", progress, hitIndex: chosen.index, position };
  }

  private distance(a: readonly number[], b: readonly number[]) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
}
