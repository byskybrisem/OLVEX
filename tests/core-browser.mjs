import assert from "node:assert/strict";

export async function checkCoreLoading(page) {
  const stage = page.locator("#core-stage");
  const toggle = page.locator("#core-toggle");
  let resume;
  const held = new Promise(resolve => { resume = resolve; });
  await page.route("**/assets/core-scene.js", async route => {
    await held;
    await route.continue();
  }, {times: 1});

  try {
    const requested = page.waitForRequest("**/assets/core-scene.js");
    await toggle.click();
    await requested;
    assert.equal(await stage.getAttribute("aria-busy"), "true");
    assert.equal(await toggle.getAttribute("aria-pressed"), "false");
    assert.ok(await stage.locator("img").isVisible());
    await page.getByRole("button", {name: "Hazırlanıyor · Vazgeç"}).click();
    assert.equal(await stage.getAttribute("data-core-state"), "idle");
    assert.equal(await stage.getAttribute("aria-busy"), "false");
    assert.equal(await toggle.textContent(), "3B görünümü aç");
  } finally {
    resume();
  }
}

export async function checkCoreFrames(page) {
  const frames = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", {alpha: true, antialias: true, preserveDrawingBuffer: true});
    const {createCore} = await import("/assets/core-scene.js");
    const scene = createCore(canvas, gl, true);
    const width = 168, height = 144;
    try {
      scene.resize(width, height, 1);
      return [0, .2, .47, .74, .84, 1, .47].map(progress => {
        scene.draw(progress);
        const bytes = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
        let visible = 0, edge = 0, signature = 0;
        for (let i = 0; i < width * height; i++) {
          if (bytes[i * 4 + 3] < 128) continue;
          visible++;
          if (i < width || i >= width * (height - 1) || i % width === 0 || i % width === width - 1) edge++;
          signature = (Math.imul(signature, 31) + bytes[i * 4] + i) >>> 0;
        }
        return {visible, edge, signature};
      });
    } finally {
      scene.dispose();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  });

  for (const frame of frames.slice(0, 5)) {
    assert.ok(frame.visible > 500, "Çekirdek beklenen aşamada görünür olmalı");
    assert.equal(frame.edge, 0, "Çıkıştan önce çekirdek kırpılmamalı");
  }
  assert.notEqual(frames[0].signature, frames[2].signature);
  assert.deepEqual(frames[3], frames[4], "Bekleme aşamasında görüntü sabit kalmalı");
  assert.equal(frames[5].visible, 0, "Son pozda çekirdek kadrajdan çıkmış olmalı");
  assert.deepEqual(frames[2], frames[6], "Geri kaydırma aynı görüntüyü vermeli");
}
