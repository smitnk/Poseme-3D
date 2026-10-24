import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const $ = (s) => document.querySelector(s);
const D2R = Math.PI / 180;

// ---------- scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8a8a8a);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.05, 200);
const orbit = new OrbitControls(camera, renderer.domElement);
function resetView() { camera.position.set(0, 1.3, 4.8); orbit.target.set(0, 1, 0); orbit.update(); }
resetView();

scene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 0.5, far: 40 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);
const light = { az: 30, el: 55, power: 2.2 };
const arrows = new THREE.Group();
for (let i = -1; i <= 1; i++) {
  const a = new THREE.ArrowHelper(new THREE.Vector3(0, -1, 0), new THREE.Vector3(i * 0.25, 0, 0), 0.8, 0xffee00, 0.15, 0.08);
  arrows.add(a);
}
scene.add(arrows);
function updateLight() {
  const d = new THREE.Vector3().setFromSphericalCoords(1, (90 - light.el) * D2R, light.az * D2R);
  sun.position.copy(d).multiplyScalar(12);
  sun.intensity = light.power;
  arrows.position.copy(d).multiplyScalar(3).add(new THREE.Vector3(0, 1, 0));
  arrows.children.forEach((a) => a.setDirection(d.clone().negate()));
}
updateLight();

const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 1 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
const grid = new THREE.GridHelper(60, 120, 0x555555, 0x7a7a7a);
grid.position.y = 0.001;
scene.add(floor, grid);

const tc = new TransformControls(camera, renderer.domElement);
tc.setSize(1.2);
tc.setSpace('local');
scene.add(tc.getHelper());
tc.addEventListener('dragging-changed', (e) => { orbit.enabled = !e.value; if (e.value) pushUndo(); });

// ---------- Poseme character (from the model sheet) ----------
// [name, parent, offset, side(+1 L, -1 R, 0 center)]
const RIG = [
  ['hips', null, [0, 0.95, 0], 0], ['spine', 'hips', [0, 0.14, 0], 0], ['chest', 'spine', [0, 0.18, 0], 0],
  ['neck', 'chest', [0, 0.2, 0], 0], ['head', 'neck', [0, 0.07, 0], 0],
  ['shoulderL', 'chest', [0.12, 0.15, 0], 1], ['elbowL', 'shoulderL', [0.27, 0, 0], 1], ['wristL', 'elbowL', [0.25, 0, 0], 1],
  ['shoulderR', 'chest', [-0.12, 0.15, 0], -1], ['elbowR', 'shoulderR', [-0.27, 0, 0], -1], ['wristR', 'elbowR', [-0.25, 0, 0], -1],
  ['hipL', 'hips', [0.09, -0.04, 0], 1], ['kneeL', 'hipL', [0, -0.42, 0], 1], ['ankleL', 'kneeL', [0, -0.41, 0], 1],
  ['hipR', 'hips', [-0.09, -0.04, 0], -1], ['kneeR', 'hipR', [0, -0.42, 0], -1], ['ankleR', 'kneeR', [0, -0.41, 0], -1],
];
const LIMBS = [['shoulderL', 'elbowL', 'wristL', 0.05], ['shoulderR', 'elbowR', 'wristR', 0.05],
  ['hipL', 'kneeL', 'ankleL', 0.068], ['hipR', 'kneeR', 'ankleR', 0.068]];
const DOT_COLOR = { 1: 0xe04444, '-1': 0x4466dd, 0: 0x33cc55 };
const dotGeo = new THREE.SphereGeometry(1, 12, 8);

function makeDot(side, size) {
  const d = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: DOT_COLOR[side], depthTest: false, transparent: true, opacity: 0.9 }));
  d.scale.setScalar(size);
  d.renderOrder = 999;
  d.userData.isDot = true;
  return d;
}

const EXPRESSIONS = ['smile', 'neutral', 'surprised', 'sad', 'angry', 'wink', 'laugh'];
function drawFace(c) {
  const ctx = c.faceCanvas.getContext('2d'), W = 512, H = 256, cx = 128, ey = 112, my = 150;
  ctx.fillStyle = c.color; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = ctx.fillStyle = '#2b2b2b'; ctx.lineWidth = 4; ctx.lineCap = 'round';
  const eye = (x, open = true) => { ctx.beginPath(); if (open) { ctx.ellipse(x, ey, 5, 10, 0, 0, 7); ctx.stroke(); } else { ctx.moveTo(x - 9, ey); ctx.lineTo(x + 9, ey); ctx.stroke(); } };
  const line = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
  const e = c.expr;
  if (e === 'neutral') { line(cx - 30, ey - 2, cx - 12, ey - 2); line(cx + 12, ey - 2, cx + 30, ey - 2); line(cx - 30, ey + 4, cx - 12, ey + 4); line(cx + 12, ey + 4, cx + 30, ey + 4); line(cx - 18, my, cx + 18, my); }
  else {
    eye(cx - 20, true); eye(cx + 20, e !== 'wink');
    if (e === 'surprised') { ctx.beginPath(); ctx.arc(cx - 20, ey - 14, 8, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke(); ctx.beginPath(); ctx.arc(cx + 20, ey - 14, 8, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke(); ctx.beginPath(); ctx.ellipse(cx, my + 4, 7, 11, 0, 0, 7); ctx.stroke(); }
    if (e === 'sad') { line(cx - 30, ey - 12, cx - 14, ey - 17); line(cx + 14, ey - 17, cx + 30, ey - 12); ctx.beginPath(); ctx.arc(cx, my + 14, 16, Math.PI * 1.2, Math.PI * 1.8); ctx.stroke(); }
    if (e === 'angry') { line(cx - 30, ey - 18, cx - 12, ey - 10); line(cx + 12, ey - 10, cx + 30, ey - 18); line(cx - 14, my + 2, cx + 14, my + 2); }
    if (e === 'smile' || e === 'wink' || e === 'laugh') {
      const r = e === 'laugh' ? 20 : 15;
      ctx.beginPath(); ctx.moveTo(cx - r, my - 4); ctx.arc(cx, my - 4, r, 0, Math.PI); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e89a9a'; ctx.beginPath(); ctx.ellipse(cx, my + r - 8, r * 0.5, 4, 0, 0, 7); ctx.fill();
    }
  }
  c.faceTex.needsUpdate = true;
}

function buildPoseme() {
  const c = { type: 'poseme', group: new THREE.Group(), joints: {}, dots: [], color: '#efe9df', expr: 'smile', hand: 'relaxed',
    squash: 1, hose: false, bend: 1, tubes: [], fingers: { 1: [], '-1': [] } };
  c.mat = new THREE.MeshStandardMaterial({ color: c.color, roughness: 0.55 });
  c.faceCanvas = Object.assign(document.createElement('canvas'), { width: 512, height: 256 });
  c.faceTex = new THREE.CanvasTexture(c.faceCanvas);
  c.faceTex.colorSpace = THREE.SRGBColorSpace;
  c.headMat = new THREE.MeshStandardMaterial({ map: c.faceTex, roughness: 0.55 });
  const mesh = (geo, parent, pos, scale, mat = c.mat, stretchy = false) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos); if (scale) m.scale.set(...scale);
    m.castShadow = m.receiveShadow = true; m.userData.char = c;
    if (stretchy) { m.userData.basePos = m.position.clone(); m.userData.baseScale = m.scale.clone(); parent.userData.stretchy.push(m); }
    parent.add(m); return m;
  };
  for (const [name, parent, off, side] of RIG) {
    const j = new THREE.Object3D();
    j.name = name; j.position.set(...off);
    j.userData = { base: j.position.clone(), stretch: 1, side, stretchy: [] };
    (parent ? c.joints[parent] : c.group).add(j);
    c.joints[name] = j;
    const dot = makeDot(side, name === 'hips' ? 0.045 : 0.032);
    dot.userData.joint = j; dot.userData.char = c;
    j.add(dot); c.dots.push(dot);
  }
  const J = c.joints;
  mesh(new THREE.CapsuleGeometry(0.13, 0.06, 6, 16), J.hips, [0, 0.0, 0], [1, 1, 0.8], c.mat, true);
  mesh(new THREE.CapsuleGeometry(0.105, 0.1, 6, 16), J.spine, [0, 0.07, 0], [1, 1, 0.8], c.mat, true);
  mesh(new THREE.CapsuleGeometry(0.14, 0.1, 6, 16), J.chest, [0, 0.09, 0], [1, 1, 0.72], c.mat, true);
  mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 12), J.neck, [0, 0.03, 0], null, c.mat, true);
  mesh(new THREE.SphereGeometry(0.24, 40, 24), J.head, [0, 0.22, 0], null, c.headMat, true);
  for (const s of [1, -1]) {
    const S = s === 1 ? 'L' : 'R';
    mesh(new THREE.SphereGeometry(0.055, 16, 12), J['shoulder' + S], [0, 0, 0]);
    c.elbowBalls = (c.elbowBalls || []).concat(
      mesh(new THREE.SphereGeometry(0.05, 14, 10), J['elbow' + S], [0, 0, 0]),
      mesh(new THREE.SphereGeometry(0.068, 14, 10), J['knee' + S], [0, 0, 0]));
    // cartoon glove hand: palm + 3 fingers + thumb (fingers curl for hand poses)
    const hand = J['wrist' + S];
    mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.05, 14), hand, [s * 0.02, 0, 0], null).rotation.z = Math.PI / 2;
    mesh(new THREE.SphereGeometry(0.07, 16, 12), hand, [s * 0.09, 0, 0], [1.15, 0.7, 1.05]);
    [-0.035, 0, 0.035].forEach((z) => {
      const f = new THREE.Group(); f.position.set(s * 0.145, 0, z); hand.add(f);
      mesh(new THREE.CapsuleGeometry(0.026, 0.05, 4, 8), f, [s * 0.035, 0, 0], null).rotation.z = Math.PI / 2;
      c.fingers[s].push(f);
    });
    const th = new THREE.Group(); th.position.set(s * 0.08, 0, 0.055); th.userData.thumb = true; hand.add(th);
    mesh(new THREE.CapsuleGeometry(0.026, 0.035, 4, 8), th, [s * 0.015, 0, 0.025], null).rotation.x = Math.PI / 2;
    c.fingers[s].push(th);
    // boot
    const foot = J['ankle' + S];
    mesh(new THREE.CylinderGeometry(0.075, 0.07, 0.09, 16), foot, [0, 0.03, 0], null);
    mesh(new THREE.SphereGeometry(0.085, 18, 12), foot, [0, -0.025, 0.06], [1, 0.62, 1.55]);
  }
  for (const l of LIMBS) {
    const t = new THREE.Mesh(new THREE.BufferGeometry(), c.mat);
    t.castShadow = t.receiveShadow = true; t.userData.char = c; t.userData.limb = l;
    c.group.add(t); c.tubes.push(t);
  }
  drawFace(c);
  return c;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
function updateTubes(c) {
  for (const t of c.tubes) {
    const [ja, jb, jc, r] = t.userData.limb;
    c.group.worldToLocal(c.joints[ja].getWorldPosition(_a));
    c.group.worldToLocal(c.joints[jb].getWorldPosition(_b));
    c.group.worldToLocal(c.joints[jc].getWorldPosition(_c));
    let curve;
    if (c.hose) {
      // rubber hose: one smooth arc; bend=1 passes through the elbow/knee, >1 exaggerates, <1 straightens
      const mid = _a.clone().add(_c).multiplyScalar(0.5);
      const ctrl = mid.clone().add(_b.clone().sub(mid).multiplyScalar(2 * c.bend));
      curve = new THREE.QuadraticBezierCurve3(_a.clone(), ctrl, _c.clone());
    } else {
      curve = new THREE.CurvePath();
      curve.add(new THREE.LineCurve3(_a.clone(), _b.clone()));
      curve.add(new THREE.LineCurve3(_b.clone(), _c.clone()));
    }
    const thin = 1 / Math.sqrt(c.joints[ja].userData.stretch); // volume preservation
    t.geometry.dispose();
    t.geometry = new THREE.TubeGeometry(curve, 48, r * thin, 12, false);
  }
  for (const b of c.elbowBalls) b.visible = !c.hose;
}

function applyStretch(c) {
  if (c.type === 'poseme') {
    for (const j of Object.values(c.joints)) {
      const s = j.parent.userData?.stretch || 1;
      if (j.userData.base) j.position.copy(j.userData.base).multiplyScalar(s);
      const k = j.userData.stretch, w = 1 / Math.sqrt(k);
      for (const m of j.userData.stretchy) {
        m.position.copy(m.userData.basePos).multiplyScalar(k);
        m.scale.copy(m.userData.baseScale).multiply(new THREE.Vector3(w, k, w));
      }
    }
  } else {
    for (const j of Object.values(c.joints)) { const k = j.userData.stretch, w = 1 / Math.sqrt(k); j.scale.set(w, k, w); }
  }
  const q = c.squash, w = 1 / Math.sqrt(q);
  c.group.scale.set(w, q, w);
}

function setHand(c, pose) {
  c.hand = pose;
  const curls = { open: [0, 0, 0, 0], relaxed: [0.4, 0.5, 0.6, 0.3], fist: [1.7, 1.7, 1.7, 0.9], point: [0, 1.7, 1.7, 0.9], peace: [0, 0, 1.7, 0.9], thumbsup: [1.7, 1.7, 1.7, -0.6] }[pose];
  for (const s of [1, -1]) c.fingers[s].forEach((f, i) => {
    if (f.userData.thumb) f.rotation.y = s * curls[i];
    else f.rotation.z = -s * curls[i];
  });
}

// ---------- GLTF characters from the three.js repo ----------
const MODELS = { xbot: 'models/Xbot.glb', soldier: 'models/Soldier.glb', michelle: 'models/Michelle.glb' };
const gltfCache = {};
const loader = new GLTFLoader();
const MAJOR_BONE = /(Hips|Spine\d?|Neck|Head|Shoulder|Arm|ForeArm|Hand|UpLeg|Leg|Foot)$/;

async function buildGltf(type) {
  gltfCache[type] ??= loader.loadAsync(MODELS[type]);
  const gltf = await gltfCache[type];
  const root = SkeletonUtils.clone(gltf.scene);
  const c = { type, group: new THREE.Group(), joints: {}, dots: [], color: '#ffffff', squash: 1, hose: false, bend: 1, tubes: [], hand: 'relaxed', expr: 'smile' };
  c.group.add(root);
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = o.receiveShadow = true; o.userData.char = c; o.frustumCulled = false;
      o.material = o.material.clone(); o.userData.baseColor = o.material.color.clone();
    }
  });
  const box = new THREE.Box3().setFromObject(root);
  root.scale.multiplyScalar(1.8 / (box.max.y - box.min.y));
  root.updateMatrixWorld(true);
  const ws = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isBone || !MAJOR_BONE.test(o.name)) return;
    o.userData = { stretch: 1, base: null, rest: o.quaternion.clone() };
    c.joints[o.name] = o;
    const side = /Left/.test(o.name) ? 1 : /Right/.test(o.name) ? -1 : 0;
    const dot = makeDot(side, 0.03);
    o.getWorldScale(ws); dot.scale.divide(ws);
    dot.userData.joint = o; dot.userData.char = c;
    o.add(dot); c.dots.push(dot);
  });
  return c;
}

function tint(c) {
  if (c.type === 'poseme') { c.mat.color.set(c.color); drawFace(c); return; }
  const col = new THREE.Color(c.color);
  c.group.traverse((o) => { if (o.isMesh && o.userData.baseColor) o.material.color.copy(o.userData.baseColor).multiply(col); });
}

// ---------- world state ----------
const chars = [], props = [];
let sel = null; // {char, joint} | {char} | {prop}
let showDots = true;

async function addCharacter(type, state) {
  const c = type === 'poseme' ? buildPoseme() : await buildGltf(type);
  scene.add(c.group);
  chars.push(c);
  if (state) applyCharState(c, state);
  else c.group.position.x = (chars.length - 1) * 0.9 * (chars.length % 2 ? 1 : -1) / 1;
  c.dots.forEach((d) => (d.visible = showDots && !c.locked));
  return c;
}

const PROP_GEOS = {
  box: () => new THREE.BoxGeometry(0.5, 0.5, 0.5), sphere: () => new THREE.SphereGeometry(0.3, 32, 16),
  cylinder: () => new THREE.CylinderGeometry(0.25, 0.25, 0.6, 32), cone: () => new THREE.ConeGeometry(0.3, 0.6, 32),
  torus: () => new THREE.TorusGeometry(0.25, 0.08, 16, 48), stair: () => new THREE.BoxGeometry(1, 0.2, 0.4),
};
function addProp(kind, state) {
  const m = new THREE.Mesh(PROP_GEOS[kind](), new THREE.MeshStandardMaterial({ color: 0xc8c8c8, roughness: 0.6 }));
  m.castShadow = m.receiveShadow = true;
  m.userData = { prop: true, kind };
  if (state) { m.position.fromArray(state.pos); m.quaternion.fromArray(state.rot); m.scale.fromArray(state.scale); m.material.color.set(state.color); }
  else m.position.set(1, 0.3, 0.5);
  scene.add(m); props.push(m);
  return m;
}

function charState(c) {
  const joints = {};
  for (const [k, j] of Object.entries(c.joints)) joints[k] = [...j.quaternion.toArray(), j.userData.stretch];
  return { type: c.type, pos: c.group.position.toArray(), rot: c.group.quaternion.toArray(), squash: c.squash,
    hose: c.hose, bend: c.bend, color: c.color, expr: c.expr, hand: c.hand, locked: !!c.locked,
    hipsPos: c.type === 'poseme' ? c.joints.hips.position.toArray() : null, joints };
}
function applyCharState(c, s) {
  c.group.position.fromArray(s.pos); c.group.quaternion.fromArray(s.rot);
  Object.assign(c, { squash: s.squash, hose: s.hose, bend: s.bend ?? 1, color: s.color, expr: s.expr, locked: s.locked });
  for (const [k, v] of Object.entries(s.joints)) { const j = c.joints[k]; if (j) { j.quaternion.fromArray(v); j.userData.stretch = v[4] ?? 1; } }
  if (s.hipsPos && c.type === 'poseme') c.joints.hips.userData.base.fromArray(s.hipsPos);
  if (c.type === 'poseme') setHand(c, s.hand || 'relaxed');
  applyStretch(c); tint(c);
}
const sceneState = () => ({ chars: chars.map(charState), props: props.map((p) => ({ kind: p.userData.kind, pos: p.position.toArray(), rot: p.quaternion.toArray(), scale: p.scale.toArray(), color: '#' + p.material.color.getHexString() })) });

async function loadScene(st) {
  select(null);
  for (const c of chars) scene.remove(c.group);
  for (const p of props) scene.remove(p);
  chars.length = props.length = 0;
  for (const s of st.chars) await addCharacter(s.type, s);
  for (const p of st.props || []) addProp(p.kind, p);
}

// ---------- undo / redo ----------
const undoStack = [], redoStack = [];
function pushUndo() { undoStack.push(JSON.stringify(sceneState())); if (undoStack.length > 60) undoStack.shift(); redoStack.length = 0; }
async function undo() { if (!undoStack.length) return toast('Nothing to undo'); redoStack.push(JSON.stringify(sceneState())); await loadScene(JSON.parse(undoStack.pop())); }
async function redo() { if (!redoStack.length) return toast('Nothing to redo'); undoStack.push(JSON.stringify(sceneState())); await loadScene(JSON.parse(redoStack.pop())); }

// ---------- poses ----------
const PRESETS = {
  'T-pose': {},
  'A-pose': { shoulderL: [0, 0, -50], shoulderR: [0, 0, 50] },
  Idle: { shoulderL: [0, 0, -75], shoulderR: [0, 0, 75], elbowL: [0, -15, 0], elbowR: [0, 15, 0], head: [5, 0, 0] },
  Wave: { shoulderL: [0, 0, -75], shoulderR: [0, 0, -25], elbowR: [0, 0, -85], head: [0, -10, 5], hipL: [0, 0, 4] },
  Run: { spine: [12, 0, 0], chest: [0, 10, 0], shoulderL: [-45, 0, -75], shoulderR: [45, 0, 75], elbowL: [0, -90, 0], elbowR: [0, 90, 0], hipL: [-55, 0, 0], kneeL: [60, 0, 0], hipR: [35, 0, 0], kneeR: [80, 0, 0], ankleR: [-20, 0, 0] },
  Jump: { shoulderL: [0, 0, 60], shoulderR: [0, 0, -60], hipL: [-35, 0, 0], kneeL: [70, 0, 0], hipR: [-10, 0, 0], kneeR: [30, 0, 0], head: [-10, 0, 0], _y: 0.25 },
  Sit: { hipL: [-90, 0, 5], hipR: [-90, 0, -5], kneeL: [90, 0, 0], kneeR: [90, 0, 0], shoulderL: [-20, 0, -70], shoulderR: [-20, 0, 70], elbowL: [0, -40, 0], elbowR: [0, 40, 0], _y: -0.42 },
  Think: { shoulderL: [0, 0, -75], shoulderR: [-60, 0, 70], elbowR: [0, 135, 0], head: [8, -10, 8], spine: [5, 0, 0] },
  Kick: { hipL: [-85, 0, 0], ankleL: [-30, 0, 0], shoulderL: [30, 0, -20], shoulderR: [-30, 0, 20], spine: [-10, 0, 0] },
  Cheer: { shoulderL: [0, 0, 75], shoulderR: [0, 0, -75], elbowL: [0, 0, 20], elbowR: [0, 0, -20], head: [-15, 0, 0] },
  Sad: { spine: [15, 0, 0], neck: [20, 0, 0], head: [15, 0, 0], shoulderL: [10, 0, -80], shoulderR: [10, 0, 80] },
};
function applyPreset(c, name) {
  if (c.type !== 'poseme') return toast('Presets are for the Poseme character');
  pushUndo();
  const p = PRESETS[name];
  for (const [k, j] of Object.entries(c.joints)) {
    const e = p[k] || [0, 0, 0];
    j.quaternion.setFromEuler(new THREE.Euler(e[0] * D2R, e[1] * D2R, e[2] * D2R));
  }
  c.joints.hips.userData.base.set(0, 0.95 + (p._y || 0), 0);
  applyStretch(c);
  if (name === 'Sad') { c.expr = 'sad'; drawFace(c); }
}
function resetPose(c) {
  pushUndo();
  for (const j of Object.values(c.joints)) { j.quaternion.copy(j.userData.rest || new THREE.Quaternion()); j.userData.stretch = 1; }
  if (c.type === 'poseme') c.joints.hips.userData.base.set(0, 0.95, 0);
  c.squash = 1; applyStretch(c);
}
const swapSide = (n) => n.replace(/L$|R$|Left|Right/, (m) => ({ L: 'R', R: 'L', Left: 'Right', Right: 'Left' }[m]));
function mirror(c) {
  if (c.type !== 'poseme') return toast('Mirror works on the Poseme character');
  pushUndo();
  const snap = Object.fromEntries(Object.entries(c.joints).map(([k, j]) => [k, [j.quaternion.clone(), j.userData.stretch]]));
  for (const [k, [q, s]] of Object.entries(snap)) {
    const t = c.joints[swapSide(k)];
    t.quaternion.set(q.x, -q.y, -q.z, q.w); // reflect across the body's YZ plane
    t.userData.stretch = s;
  }
  const b = c.joints.hips.userData.base; b.x = -b.x;
  applyStretch(c);
}

// ---------- selection & picking ----------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let down = null;
renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, axis: tc.axis }; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down || down.axis || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) return (down = null);
  down = null;
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const live = chars.filter((c) => !c.locked);
  const dots = live.flatMap((c) => c.dots.filter((d) => d.visible));
  let hit = raycaster.intersectObjects(dots, false)[0];
  if (hit) return select({ char: hit.object.userData.char, joint: hit.object.userData.joint });
  const bodies = [];
  live.forEach((c) => c.group.traverse((o) => o.isMesh && !o.userData.isDot && bodies.push(o)));
  hit = raycaster.intersectObjects([...bodies, ...props], false)[0];
  if (!hit) return select(null);
  if (hit.object.userData.prop) return select({ prop: hit.object });
  select({ char: hit.object.userData.char });
});

let mode = 'rotate';
function select(s) {
  sel = s;
  tc.detach();
  if (s?.joint) { mode = 'rotate'; tc.setMode('rotate'); tc.attach(s.joint); }
  else if (s?.char) { mode = 'translate'; tc.setMode('translate'); tc.attach(s.char.group); }
  else if (s?.prop) { mode = 'translate'; tc.setMode('translate'); tc.attach(s.prop); }
  $('#sel').style.display = s ? 'flex' : 'none';
  const c = s?.char;
  $('[data-act=lock]').textContent = c?.locked ? '🔒' : '🔓';
  for (const b of document.querySelectorAll('#sel button')) {
    const charOnly = ['mirror', 'reset', 'squash', 'face', 'hands', 'lock'].includes(b.dataset.act || b.dataset.panel);
    b.style.display = s?.prop && charOnly ? 'none' : '';
  }
  if (openPanel === 'squash' || openPanel === 'face' || openPanel === 'hands' || openPanel === 'color') renderPanel(openPanel);
}
function cycleMode() {
  const modes = sel?.prop ? ['translate', 'rotate', 'scale'] : sel?.joint ? (sel.joint.name === 'hips' || /Hips$/.test(sel.joint.name) ? ['rotate', 'translate'] : ['rotate']) : ['translate', 'rotate'];
  mode = modes[(modes.indexOf(mode) + 1) % modes.length];
  tc.setMode(mode); toast('Mode: ' + mode);
}

// ---------- panels ----------
let openPanel = null;
const P = $('#panel');
const btn = (label, fn, on) => { const b = document.createElement('button'); b.textContent = label; b.onclick = fn; if (on) b.classList.add('on'); return b; };
const row = (...kids) => { const r = document.createElement('div'); r.className = 'row'; r.append(...kids); return r; };
const slider = (label, min, max, step, val, fn) => {
  const l = document.createElement('label'); const i = document.createElement('input'); const v = document.createElement('span');
  Object.assign(i, { type: 'range', min, max, step, value: val }); v.textContent = (+val).toFixed(2);
  i.oninput = () => { v.textContent = (+i.value).toFixed(2); fn(+i.value); };
  i.onpointerdown = () => pushUndo();
  l.append(label, i, v); return l;
};
const swatches = (cur, fn) => {
  const r = row();
  for (const col of ['#efe9df', '#ffffff', '#f2c9a0', '#c68642', '#8d5524', '#ffd166', '#ef476f', '#06d6a0', '#118ab2', '#555555', '#222222']) {
    const b = btn('', () => fn(col)); b.className = 'sw'; b.style.background = col; r.append(b);
  }
  const i = document.createElement('input'); i.type = 'color'; i.value = cur; i.oninput = () => fn(i.value); r.append(i);
  return r;
};
const charOf = () => sel?.char || chars[0];

const PANELS = {
  add: () => [
    row(...[['Poseme (sheet)', 'poseme'], ['X Bot', 'xbot'], ['Soldier', 'soldier'], ['Michelle', 'michelle']].map(([l, t]) =>
      btn(l, async () => { pushUndo(); toast('Loading ' + l + '…'); select({ char: await addCharacter(t) }); }))),
    'Props', row(...Object.keys(PROP_GEOS).map((k) => btn(k, () => { pushUndo(); select({ prop: addProp(k) }); }))),
  ],
  poses: () => {
    const saved = JSON.parse(safeGet('poseme.saves') || '[]');
    return [
      'Preset poses (Poseme)', row(...Object.keys(PRESETS).map((n) => btn(n, () => { const c = charOf(); if (c) applyPreset(c, n); }))),
      'Saved scenes', row(btn('＋ Save current', () => { saved.unshift({ name: 'Scene ' + new Date().toLocaleString(), st: sceneState() }); safeSet('poseme.saves', JSON.stringify(saved.slice(0, 30))); renderPanel('poses'); toast('Saved'); })),
      row(...saved.map((s, i) => btn(s.name, async () => { pushUndo(); await loadScene(s.st); }))),
      row(btn('Delete all saves', () => { safeSet('poseme.saves', '[]'); renderPanel('poses'); }),
        btn('Export JSON', () => saveFile(btoa(unescape(encodeURIComponent(JSON.stringify(sceneState())))), 'application/json', 'poseme-scene.json')),
        btn('Import JSON', () => pickFile('json'))),
    ];
  },
  bg: () => [
    swatches('#' + (scene.background.isColor ? scene.background.getHexString() : '8a8a8a'), (c) => { scene.background = new THREE.Color(c); }),
    row(btn('Image…', () => pickFile('image')), btn('Grid', () => { grid.visible = !grid.visible; renderPanel('bg'); }, grid.visible),
      btn('Floor', () => { floor.visible = !floor.visible; renderPanel('bg'); }, floor.visible)),
  ],
  light: () => [
    slider('Direction', 0, 360, 1, light.az, (v) => { light.az = v; updateLight(); }),
    slider('Height', 5, 90, 1, light.el, (v) => { light.el = v; updateLight(); }),
    slider('Intensity', 0, 5, 0.05, light.power, (v) => { light.power = v; updateLight(); }),
    row(btn('Shadows', () => { sun.castShadow = !sun.castShadow; renderPanel('light'); }, sun.castShadow),
      btn('Arrows', () => { arrows.visible = !arrows.visible; renderPanel('light'); }, arrows.visible)),
  ],
  camera: () => [
    slider('Field of view', 15, 100, 1, camera.fov, (v) => { camera.fov = v; camera.updateProjectionMatrix(); }),
    row(btn('Front', () => setView(0, 1.1, 4.8)), btn('Back', () => setView(0, 1.1, -4.8)), btn('Left', () => setView(4.8, 1.1, 0)),
      btn('Right', () => setView(-4.8, 1.1, 0)), btn('Top', () => setView(0, 6, 0.01)), btn('Reset', resetView)),
  ],
  squash: () => {
    const c = charOf(); if (!c) return ['Add a character first'];
    const j = sel?.joint;
    const out = [
      j ? slider('Stretch "' + j.name.replace('mixamorig', '') + '"', 0.3, 2.5, 0.01, j.userData.stretch, (v) => { j.userData.stretch = v; applyStretch(c); })
        : 'Tap a joint dot to stretch / squash that part',
      slider('Whole body squash ↕', 0.4, 1.8, 0.01, c.squash, (v) => { c.squash = v; applyStretch(c); }),
    ];
    if (c.type === 'poseme') out.push(
      row(btn('Rubber hose limbs', () => { pushUndo(); c.hose = !c.hose; renderPanel('squash'); }, c.hose)),
      slider('Hose bend', 0, 2, 0.01, c.bend, (v) => { c.bend = v; }));
    out.push(row(btn('Reset squash & stretch', () => { pushUndo(); Object.values(c.joints).forEach((x) => (x.userData.stretch = 1)); c.squash = 1; applyStretch(c); renderPanel('squash'); })));
    return out;
  },
  face: () => { const c = charOf(); return c?.type !== 'poseme' ? ['Expressions are for the Poseme character'] : [row(...EXPRESSIONS.map((e) => btn(e, () => { pushUndo(); c.expr = e; drawFace(c); renderPanel('face'); }, c.expr === e)))]; },
  hands: () => { const c = charOf(); return c?.type !== 'poseme' ? ['Hand poses are for the Poseme character'] : [row(...['open', 'relaxed', 'fist', 'point', 'peace', 'thumbsup'].map((h) => btn(h, () => { pushUndo(); setHand(c, h); renderPanel('hands'); }, c.hand === h)))]; },
  color: () => {
    if (sel?.prop) return [swatches('#' + sel.prop.material.color.getHexString(), (col) => sel.prop.material.color.set(col))];
    const c = charOf(); return c ? [swatches(c.color, (col) => { c.color = col; tint(c); })] : [];
  },
};
const TITLES = { add: 'Add', poses: 'Poses', bg: 'Background', light: 'Light', camera: 'Camera', squash: 'Squash, stretch & rubber hose', face: 'Expression', hands: 'Hands', color: 'Color' };
function renderPanel(name) {
  openPanel = name;
  P.innerHTML = '';
  const h = document.createElement('h3'); h.append(TITLES[name], btn('✕', () => { P.style.display = 'none'; openPanel = null; }));
  P.append(h, ...PANELS[name]().map((x) => (typeof x === 'string' ? Object.assign(document.createElement('div'), { textContent: x, style: 'margin:4px 0;opacity:.8' }) : x)));
  P.style.display = 'block';
}
function setView(x, y, z) { orbit.target.set(0, 1, 0); camera.position.set(x, y, z); orbit.update(); }

// ---------- files / platform bridge ----------
function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch { toast('Storage unavailable'); } }
function saveFile(b64, mime, name) {
  if (window.Android?.saveFile) { toast(window.Android.saveFile(b64, mime, name)); return; }
  const a = document.createElement('a'); a.href = `data:${mime};base64,${b64}`; a.download = name; a.click();
}
let pickKind = null;
function pickFile(kind) { pickKind = kind; const f = $('#file'); f.value = ''; f.accept = kind === 'json' ? '.json,application/json' : 'image/*'; f.click(); }
$('#file').onchange = async (e) => {
  const file = e.target.files[0]; if (!file) return;
  if (pickKind === 'json') {
    try { const st = JSON.parse(await file.text()); pushUndo(); await loadScene(st); toast('Scene imported'); } catch { toast('Not a Poseme scene file'); }
  } else {
    const url = URL.createObjectURL(file);
    new THREE.TextureLoader().load(url, (t) => { t.colorSpace = THREE.SRGBColorSpace; scene.background = t; });
  }
};
function screenshot() {
  const hidden = [tc.getHelper(), arrows, grid, ...chars.flatMap((c) => c.dots)].filter((o) => o.visible);
  hidden.forEach((o) => (o.visible = false));
  renderer.render(scene, camera);
  const b64 = renderer.domElement.toDataURL('image/png').split(',')[1];
  hidden.forEach((o) => (o.visible = true));
  saveFile(b64, 'image/png', `poseme-${Date.now()}.png`);
}

let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toastT); toastT = setTimeout(() => (t.style.display = 'none'), 1800); }

// ---------- toolbar wiring ----------
const ACTS = {
  shot: screenshot, undo, redo, mode: cycleMode,
  save: () => { const saved = JSON.parse(safeGet('poseme.saves') || '[]'); saved.unshift({ name: 'Quick ' + new Date().toLocaleString(), st: sceneState() }); safeSet('poseme.saves', JSON.stringify(saved.slice(0, 30))); toast('Scene saved'); },
  mirror: () => sel?.char && mirror(sel.char),
  reset: () => sel?.char && resetPose(sel.char),
  dup: async () => {
    if (!sel) return; pushUndo();
    if (sel.prop) { const p = sceneState().props[props.indexOf(sel.prop)]; p.pos[0] += 0.6; return select({ prop: addProp(p.kind, p) }); }
    const s = charState(sel.char); s.pos[0] += 0.9; select({ char: await addCharacter(s.type, s) });
  },
  dots: () => { showDots = !showDots; chars.forEach((c) => c.dots.forEach((d) => (d.visible = showDots && !c.locked))); if (!showDots && sel?.joint) select({ char: sel.char }); },
  lock: () => { const c = sel?.char; if (!c) return; c.locked = !c.locked; c.dots.forEach((d) => (d.visible = showDots && !c.locked)); toast(c.locked ? 'Locked' : 'Unlocked'); select(null); },
  del: () => {
    if (!sel) return; pushUndo();
    if (sel.prop) { scene.remove(sel.prop); props.splice(props.indexOf(sel.prop), 1); }
    else { scene.remove(sel.char.group); chars.splice(chars.indexOf(sel.char), 1); }
    select(null);
  },
};
document.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => ACTS[b.dataset.act]()));
document.querySelectorAll('[data-panel]').forEach((b) => (b.onclick = () => (openPanel === b.dataset.panel ? (P.style.display = 'none', openPanel = null) : renderPanel(b.dataset.panel))));

addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

renderer.setAnimationLoop(() => {
  for (const c of chars) if (c.type === 'poseme') updateTubes(c);
  renderer.render(scene, camera);
});

// test hook for automated checks
window.poseme = { chars, props, addCharacter, applyPreset, mirror, select, sceneState, loadScene, undo, applyStretch, setHand, drawFace, renderPanel };

await addCharacter('poseme');
$('#loading').remove();
