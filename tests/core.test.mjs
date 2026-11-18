import assert from "node:assert/strict";
import test from "node:test";
import { corePose } from "../scene/core.js";

test("çekirdek kesintisiz bir tam tur döner ve kaydırma geri alındığında aynı pozu verir", () => {
  const poses = Array.from({length: 101}, (_, i) => corePose(i / 100));
  const rotation = poses.at(-1).yaw - poses[0].yaw;
  assert.ok(Math.abs(rotation - 2 * Math.PI) < 1e-10);
  for (let i = poses.length - 1; i > 0; i--) {
    assert.deepEqual(corePose(i / 100), poses[i]);
    const step = poses[i].yaw - poses[i - 1].yaw;
    assert.ok(step >= 0 && step < .15);
  }
  assert.deepEqual(corePose(-1), poses[0]);
  assert.deepEqual(corePose(2), poses.at(-1));
});

test("katmanlar ayrılıp birleşir, çekirdek dinlenir ve son aşamada kadrajdan çıkar", () => {
  const initial = corePose(0);
  const split = corePose(.47);
  const restored = corePose(.74);
  assert.ok(split.gap > 5 * initial.gap);
  assert.ok(split.depth > initial.depth);
  for (const key of ["pitch", "roll", "gap", "depth", "rise"]) {
    assert.equal(initial[key], restored[key]);
  }
  assert.equal(restored.parallax, 0);
  assert.deepEqual(restored, corePose(.84));
  assert.ok(corePose(.93).rise > restored.rise);
  assert.ok(corePose(1).rise > corePose(.93).rise);
});
