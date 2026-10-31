import assert from "node:assert/strict";
import { test } from "node:test";
import { SurfaceTracker } from "../lib/surface-placement";

function pose(x = 0, y = 0, z = -1, tiltDegrees = 0): number[] {
  const angle = tiltDegrees * Math.PI / 180;
  return [1, 0, 0, 0, 0, Math.cos(angle), Math.sin(angle), 0, 0, -Math.sin(angle), Math.cos(angle), 0, x, y, z, 1];
}

const viewer = pose(0, 1.5, 0);
function acquire(tracker: SurfaceTracker, start = 0) {
  let state = tracker.update([pose()], viewer, start);
  for (let time = 75; time <= 600; time += 75) state = tracker.update([pose()], viewer, start + time);
  assert.equal(state.phase, "ready");
  return state;
}

test("a stable plane needs both sustained time and enough observations before placement", () => {
  const fast = new SurfaceTracker();
  for (let time = 0; time < 600; time += 50) {
    const state = fast.update([pose()], viewer, time);
    assert.equal(state.phase, "stabilizing", `must not place at ${time}ms`);
    assert.ok(state.progress >= 0 && state.progress < 1);
  }
  assert.equal(fast.update([pose()], viewer, 600).phase, "ready");

  const sparse = new SurfaceTracker();
  for (const time of [0, 200, 400, 600]) assert.equal(sparse.update([pose()], viewer, time).phase, "stabilizing");
  for (const time of [625, 650, 675]) assert.equal(sparse.update([pose()], viewer, time).phase, "stabilizing");
  assert.equal(sparse.update([pose()], viewer, 700).phase, "ready");
});

test("missing hits clear an acquired plane and require a fresh dwell", () => {
  const tracker = new SurfaceTracker();
  acquire(tracker);
  assert.deepEqual(tracker.update([], viewer, 675), { phase: "searching", reason: "missing", progress: 0, hitIndex: -1, position: null });
  assert.equal(tracker.update([pose()], viewer, 750).progress, 0);
  acquire(tracker, 750);
  tracker.reset();
  assert.equal(tracker.update([pose()], viewer, 1400).phase, "stabilizing");
});

test("slower phones can acquire and retain a stable surface at 10fps and 5fps", () => {
  for (const cadence of [100, 200]) {
    const tracker = new SurfaceTracker();
    for (let sample = 0; sample < 7; sample++) {
      assert.equal(tracker.update([pose()], viewer, sample * cadence).phase, "stabilizing", `cadence ${cadence}ms sample ${sample + 1}`);
    }
    assert.equal(tracker.update([pose()], viewer, 7 * cadence).phase, "ready", `cadence ${cadence}ms must acquire after eight valid samples`);
    // Sliding the dwell window must retain enough observations to stay ready.
    for (let sample = 8; sample < 16; sample++) assert.equal(tracker.update([pose()], viewer, sample * cadence).phase, "ready");
  }
});

test("walls, ceilings and visibly sloped surfaces cannot accept the building", () => {
  for (const tilt of [30, 90, 180]) {
    const tracker = new SurfaceTracker();
    const state = tracker.update([pose(0, 0, -1, tilt)], viewer, 0);
    assert.equal(state.phase, "searching", `tilt ${tilt}`);
    assert.equal(state.reason, "tilted");
    assert.equal(state.position, null);
  }
  assert.equal(new SurfaceTracker().update([pose(0, 0, -1, 15)], viewer, 0).phase, "stabilizing");
  const degenerateNormal = pose();
  degenerateNormal[4] = degenerateNormal[5] = degenerateNormal[6] = 0;
  assert.equal(new SurfaceTracker().update([degenerateNormal], viewer, 0).reason, "tilted");
});

test("surface normals are normalized before horizontal filtering", () => {
  const scaledWall = pose(0, 0, -1, 60);
  scaledWall[4] *= 10; scaledWall[5] *= 10; scaledWall[6] *= 10;
  assert.equal(new SurfaceTracker().update([scaledWall], viewer, 0).reason, "tilted");
  const scaledFloor = pose(); scaledFloor[5] = .5;
  assert.equal(new SurfaceTracker().update([scaledFloor], viewer, 0).phase, "stabilizing");
});

test("planes too close or too far away are rejected using the viewer position", () => {
  for (const surface of [pose(0, 1.5, -.1), pose(0, 0, -6)]) {
    const state = new SurfaceTracker().update([surface], viewer, 0);
    assert.equal(state.reason, "distance");
    assert.equal(state.phase, "searching");
  }
  assert.equal(new SurfaceTracker().update([pose()], viewer, 0).phase, "stabilizing");
  // Moving the reference-space origin must not change the actual camera-to-hit distance.
  assert.equal(new SurfaceTracker().update([pose(100, 0, 99)], pose(100, 1.5, 100), 0).phase, "stabilizing");
});

test("small noise is averaged while a surface jump starts acquisition again", () => {
  const tracker = new SurfaceTracker();
  let state = tracker.update([pose(-.005)], viewer, 0);
  for (let index = 1; index <= 8; index++) state = tracker.update([pose(index % 2 ? .005 : -.005)], viewer, index * 75);
  assert.equal(state.phase, "ready");
  assert.ok(state.position && Math.abs(state.position[0]) < .002, "display position should average small pose noise");
  const jumped = tracker.update([pose(.5)], viewer, 675);
  assert.equal(jumped.phase, "stabilizing");
  assert.equal(jumped.progress, 0);
  assert.deepEqual(jumped.position, [.5, 0, -1]);
});

test("gradual drift that looks stable frame-to-frame does not accumulate into readiness", () => {
  const tracker = new SurfaceTracker();
  let state = tracker.update([pose()], viewer, 0);
  for (let index = 1; index <= 3; index++) state = tracker.update([pose(index * .02)], viewer, index * 100);
  assert.equal(state.reason, "unstable");
  assert.equal(state.phase, "stabilizing");
  assert.equal(state.progress, 0);
});

test("dropped frames, repeated timestamps and time reversal discard stale confidence", () => {
  for (const nextTime of [600, 599, 1000]) {
    const tracker = new SurfaceTracker();
    acquire(tracker);
    const state = tracker.update([pose()], viewer, nextTime);
    assert.equal(state.phase, "stabilizing", `timestamp ${nextTime}`);
    assert.equal(state.progress, 0);
  }
});

test("overlapping plane result ordering cannot pull a stable reticle to another surface", () => {
  const tracker = new SurfaceTracker();
  tracker.update([pose()], viewer, 0);
  for (let index = 1; index <= 8; index++) {
    const state = tracker.update([pose(.8), pose(.003)], viewer, index * 75);
    assert.equal(state.hitIndex, 1, "retain the nearby surface even when it is not the first hit");
    assert.ok(state.position && state.position[0] < .01);
    assert.equal(state.phase, index === 8 ? "ready" : "stabilizing");
  }
});

test("invalid poses and nonfinite input never preserve acquired readiness", () => {
  const badMatrix = pose(); badMatrix[0] = NaN;
  const badNormal = pose(); badNormal[5] = Infinity;
  for (const matrices of [[null], [[1, 2, 3]], [badMatrix], [badNormal]]) {
    const tracker = new SurfaceTracker(); acquire(tracker);
    const state = tracker.update(matrices, viewer, 675);
    assert.equal(state.phase, "searching");
    assert.equal(state.position, null);
    assert.equal(state.progress, 0);
  }
  for (const time of [NaN, Infinity, -Infinity]) {
    const tracker = new SurfaceTracker(); acquire(tracker);
    assert.equal(tracker.update([pose()], viewer, time).phase, "searching");
  }
  const badViewer = pose(); badViewer[12] = NaN;
  assert.equal(new SurfaceTracker().update([pose()], badViewer, 0).phase, "searching");
  const mixed = new SurfaceTracker().update([null, badMatrix, pose(0, 0, -1, 90), pose()], viewer, 0);
  assert.equal(mixed.hitIndex, 3, "invalid earlier hits must not prevent a valid hit from being used");
});
