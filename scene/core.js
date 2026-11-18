import {
  ACESFilmicToneMapping, BoxGeometry, Color, CylinderGeometry, DataTexture, DirectionalLight,
  EquirectangularReflectionMapping, ExtrudeGeometry, FloatType, Group, LinearSRGBColorSpace,
  Mesh, MeshStandardMaterial, Path, PerspectiveCamera, PMREMGenerator, RGBAFormat, Scene,
  Shape, Vector2, WebGLRenderer
} from "three";

// The asymmetric six-sided aperture follows the outline of the workspace mark.
const outline = [[-.66, 1.45], [.74, 1.45], [1.48, .46], [.66, -1.45], [-.74, -1.45], [-1.48, -.46]];

function contour(scale, inset = false) {
  const points = outline.map(([x, y]) => new Vector2(x * scale, y * scale));
  if (inset) points.reverse();
  const path = inset ? new Path() : new Shape();
  points.forEach((p, i) => {
    const arrival = p.clone().lerp(points[(i + 5) % 6], .095);
    const departure = p.clone().lerp(points[(i + 1) % 6], .095);
    if (i === 0) path.moveTo(arrival.x, arrival.y);
    else path.lineTo(arrival.x, arrival.y);
    path.quadraticCurveTo(p.x, p.y, departure.x, departure.y);
  });
  path.closePath();
  return path;
}

function ring(outer, inner, thickness, bevel, simple) {
  const shape = contour(outer);
  shape.holes.push(contour(inner, true));
  return new ExtrudeGeometry(shape, {
    depth: thickness, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel,
    bevelSegments: simple ? 2 : 4, curveSegments: simple ? 3 : 6, steps: 1
  });
}

// A procedural studio panorama: a neutral ceiling, two tall strip reflections and a violet rim.
function studio(renderer) {
  const w = 144, h = 72;
  const pixels = new Float32Array(w * h * 4);
  const softbox = (u, v, x, y, width, height) =>
    Math.exp(-Math.pow((u - x) / width, 8) - Math.pow((v - y) / height, 8));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w, v = y / h;
    const key = 5.6 * softbox(u, v, .70, .68, .14, .07);
    const strip = 3.9 * softbox(u, v, .31, .52, .022, .29);
    const rim = 3 * softbox(u, v, .92, .55, .065, .20);
    const floor = .12 + .27 * v + .18 * softbox(u, v, .55, .24, .24, .085);
    pixels.set([floor + key + strip + rim * .54, floor + key + strip * .97 + rim * .32,
      floor + key + strip * 1.12 + rim, 1], (y * w + x) * 4);
  }
  const texture = new DataTexture(pixels, w, h, RGBAFormat, FloatType);
  texture.mapping = EquirectangularReflectionMapping;
  texture.colorSpace = LinearSRGBColorSpace;
  texture.needsUpdate = true;
  const filter = new PMREMGenerator(renderer);
  try { return filter.fromEquirectangular(texture); }
  finally { filter.dispose(); texture.dispose(); }
}

const poses = [
  // Scroll position, pitch, yaw, roll, camera distance, layer separation.
  [0, -.42, -.58, -.24, 6.65, .09],
  [.18, -.37, -.76, -.19, 6.3, .14],
  [.38, -.28, -.87, -.13, 6.15, .28],
  [.62, -.19, -1.02, -.09, 7.25, .67],
  [.83, -.38, -.67, -.22, 6.75, .22],
  [1, -.42, -.58, -.24, 6.65, .09]
];

export function createCore(canvas, context, simple) {
  const renderer = new WebGLRenderer({ canvas, context, alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.setClearColor(0x000000, 0);
  const scene = new Scene(), camera = new PerspectiveCamera(36, 1, .1, 40);
  const assembly = new Group();
  scene.add(assembly);
  let reflection;
  const geometry = new Set(), materials = new Set();
  function finish(color, metalness, roughness, glow = 0) {
    const material = new MeshStandardMaterial({ color, metalness, roughness,
      emissive: new Color(glow), emissiveIntensity: .72 });
    materials.add(material);
    return material;
  }
  function add(parent, form, surface, x = 0, y = 0, z = 0) {
    geometry.add(form);
    const part = new Mesh(form, surface);
    part.position.set(x, y, z);
    parent.add(part);
    return part;
  }
  function dispose() {
    geometry.forEach(item => item.dispose());
    materials.forEach(item => item.dispose());
    reflection?.dispose();
    renderer.dispose();
  }
  try {
    reflection = studio(renderer);
    scene.environment = reflection.texture;
    const nickel = finish(0xc9cbd9, .94, .245);
    const titanium = finish(0x656575, .92, .26);
    const graphite = finish(0x262636, .82, .33);
    const iris = finish(0x7453c4, .77, .25);
    const violet = finish(0xb296ff, .38, .24, 0x7a4ade);
    const enamel = finish(0x252633, .5, .31);
    const layers = [];
    function plate(outer, inner, depth, bevel, material, z) {
      const group = new Group();
      assembly.add(group);
      add(group, ring(outer, inner, depth, bevel, simple), material);
      group.userData.rest = z;
      layers.push(group);
      return group;
    }
    plate(.98, .52, .12, .035, titanium, -.35);
    const heatSink = plate(.93, .53, .20, .025, graphite, -.22);
    const fin = ring(.975, .91, .025, .009, simple);
    for (const z of [.025, .10, .17]) add(heatSink, fin, titanium, 0, 0, z);
    plate(.961, .52, .038, .012, violet, .015);
    plate(.982, .495, .085, .022, iris, .075);
    const caseFront = plate(1, .49, .135, .052, nickel, .21);
    // Anodized insert seated into the machined face, with a fine exposed silver lip.
    add(caseFront, ring(.919, .628, .021, .012, simple), titanium, 0, 0, .183);
    add(caseFront, ring(.617, .539, .034, .013, simple), graphite, 0, 0, .183);
    add(caseFront, ring(.548, .523, .016, .005, simple), iris, 0, 0, .181);

    const stud = new CylinderGeometry(.046, .046, .018, simple ? 12 : 20);
    const slot = new BoxGeometry(.049, .008, .008);
    const positions = [[-.55, 1.14], [.58, 1.14], [1.20, .39], [.55, -1.14], [-.58, -1.14], [-1.2, -.39]];
    for (const [x, y] of positions) {
      add(caseFront, stud, graphite, x, y, .218).rotation.x = Math.PI / 2;
      add(caseFront, slot, nickel, x, y, .23).rotation.z = .78;
    }
    // Inlaid signal bars occupy the upper bridge. Dark ticks mark the lower bridge.
    const bar = new BoxGeometry(.078, .022, .009);
    for (let i = 0; i < 6; i++) add(caseFront, bar, i < 3 ? violet : enamel, (i - 2.5) * .105, 1.18, .219);
    const tick = new BoxGeometry(.013, .095, .006);
    for (let i = -4; i <= 4; i++) add(caseFront, tick, graphite, i * .055, -1.15, .218).rotation.z = -.4;
    const key = new DirectionalLight(0xfaf7ff, 1.95);
    key.position.set(-3, 5, 4);
    const rim = new DirectionalLight(0xa79dff, 2.2);
    rim.position.set(3, -1, -.4);
    scene.add(key, rim);

    function resize(width, height, ratio) {
      renderer.setPixelRatio(ratio);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
    function draw(progress, pointerX = 0, pointerY = 0) {
      const next = poses.findIndex(pose => pose[0] >= progress);
      const b = poses[next < 0 ? poses.length - 1 : next];
      const a = poses[Math.max(0, (next < 0 ? poses.length - 1 : next) - 1)];
      const t = a === b ? 0 : Math.min(1, Math.max(0, (progress - a[0]) / (b[0] - a[0])));
      const smooth = t * t * (3 - 2 * t);
      const at = i => a[i] + (b[i] - a[i]) * smooth;
      assembly.rotation.set(at(1) + pointerY * .06, at(2) + pointerX * .075, at(3));
      for (const [i, layer] of layers.entries()) layer.position.z = layer.userData.rest + (i - 2) * at(5);
      camera.position.z = at(4) * Math.max(1, .99 / camera.aspect);
      renderer.render(scene, camera);
    }
    return { draw, resize, dispose };
  } catch (error) { dispose(); throw error; }
}
