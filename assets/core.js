const stage = document.getElementById("core-stage");
const story = document.getElementById("core-story");
const toggle = document.getElementById("core-toggle");
const status = document.getElementById("core-status");
let canvas = document.getElementById("core-canvas");
const motion = matchMedia("(prefers-reduced-motion: reduce)");
const stackedStory = matchMedia("(max-width: 750px)");
const compact = matchMedia("(max-width: 768px), (pointer: coarse)");
let scene, context, pending = 0, generation = 0, onScreen = true;
let width = 0, height = 0, ratio = 1, slowFrames = 0, lastFrame = 0;
let pointerX = 0, pointerY = 0;

function setState(state) {
  stage.dataset.coreState = state;
  const live = state === "live";
  toggle.hidden = false;
  toggle.disabled = state === "reduced" || state === "unavailable";
  toggle.setAttribute("aria-controls", stage.id);
  stage.setAttribute("aria-busy", String(state === "loading"));
  toggle.setAttribute("aria-pressed", String(live));
  toggle.textContent = ({
    idle: "3B görünümü aç", loading: "Hazırlanıyor · Vazgeç", live: "2B görünüme dön",
    reduced: "2B · Hareket azaltıldı", unavailable: "2B · 3B kullanılamıyor"
  })[state];
  status.textContent = ({
    idle: "Sabit görsel gösteriliyor.", loading: "Üç boyutlu model hazırlanırken sabit görsel gösteriliyor.",
    live: "3B görünüm açık. Kaydırarak çekirdeği tam tur döndürebilir ve katmanları inceleyebilirsiniz.",
    reduced: "Hareket tercihiniz nedeniyle sabit görsel gösteriliyor.",
    unavailable: "Bu cihazda 3B görünüm kullanılamıyor. Sabit görsel gösteriliyor."
  })[state];
  canvas.hidden = !live;
}

function release(state) {
  generation++;
  cancelAnimationFrame(pending);
  pending = 0;
  scene?.dispose();
  scene = null;
  if (context) {
    canvas.removeEventListener("webglcontextlost", lost);
    context.getExtension("WEBGL_lose_context")?.loseContext();
    context = null;
    // A deliberately lost context cannot be reused immediately on mobile Safari.
    const fresh = canvas.cloneNode(false);
    canvas.replaceWith(fresh);
    canvas = fresh;
  }
  width = height = slowFrames = lastFrame = pointerX = pointerY = 0;
  setState(state);
}

function lost(event) {
  event.preventDefault();
  release("unavailable");
}

function paint(time) {
  pending = 0;
  if (!scene || !onScreen || document.hidden) return;
  const box = stage.getBoundingClientRect();
  if (!box.width || !box.height) return;
  // Only count consecutive animation frames. A pause between gestures is not a slow frame.
  const frameTime = time - lastFrame;
  if (lastFrame && frameTime > 25 && frameTime < 120) slowFrames++;
  else slowFrames = Math.max(0, slowFrames - 1);
  if (slowFrames >= 4 && ratio > .8) {
    ratio = Math.max(.8, ratio - .25);
    width = 0;
    slowFrames = 0;
  }
  lastFrame = time;
  const w = Math.round(box.width), h = Math.round(box.height);
  if (w !== width || h !== height) {
    width = w; height = h;
    scene.resize(w, h, ratio);
  }
  const track = story.getBoundingClientRect();
  // On phones the stage scrolls with the text. Complete the turn and the exit
  // while the stage is still above the fold and below the sticky navigation.
  const position = stackedStory.matches
    ? (innerHeight * .60 - box.top) / Math.max(1, innerHeight * .60 - 64)
    : -track.top / Math.max(1, track.height - Math.min(innerHeight, box.height));
  const progress = Math.min(1, Math.max(0, position));
  try {
    scene.draw(progress, pointerX, pointerY);
    if (stage.dataset.coreState !== "live") setState("live");
  } catch { release("unavailable"); }
}

function queue() {
  if (scene && onScreen && !document.hidden && !pending) pending = requestAnimationFrame(paint);
}

toggle.addEventListener("click", async () => {
  if (stage.dataset.coreState === "loading" || scene) return release("idle");
  const ticket = ++generation;
  setState("loading");
  try {
    context = canvas.getContext("webgl2", { alpha: true, antialias: true, powerPreference: "low-power" });
    if (!context) throw new Error("WebGL2");
    canvas.addEventListener("webglcontextlost", lost);
    const { createCore } = await import("./core-scene.js");
    if (ticket !== generation) return;
    scene = createCore(canvas, context, compact.matches);
    ratio = Math.min(devicePixelRatio || 1, compact.matches ? 1.35 : 1.75);
    queue();
  } catch {
    if (ticket === generation) release("unavailable");
  }
});

const observer = new IntersectionObserver(([entry]) => {
  onScreen = entry.isIntersecting;
  if (onScreen) queue();
  else lastFrame = 0;
});
observer.observe(stage);
new ResizeObserver(queue).observe(stage);
addEventListener("scroll", queue, { passive: true });
document.addEventListener("visibilitychange", queue);
stage.addEventListener("pointermove", event => {
  if (!scene || event.pointerType === "touch") return;
  const box = stage.getBoundingClientRect();
  pointerX = (event.clientX - box.left) / box.width - .5;
  pointerY = (event.clientY - box.top) / box.height - .5;
  queue();
});
stage.addEventListener("pointerleave", () => { pointerX = pointerY = 0; queue(); });
function reset() { release(motion.matches ? "reduced" : "idle"); }
motion.addEventListener("change", reset);
addEventListener("pagehide", reset);
reset();
