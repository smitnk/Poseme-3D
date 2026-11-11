import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { polygonizeSdf } from './lib/sdf.js';
import { SDF } from './characters.js';

const $ = (s) => document.querySelector(s);
const D2R = Math.PI / 180;

// ---------- scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const effect = new OutlineEffect(renderer, { defaultThickness: 0.011, defaultColor: [0, 0, 0], defaultAlpha: 1 });
let outlines = true;
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
floor.material.userData.outlineParameters = { visible: false };
arrows.traverse((o) => o.material && (o.material.userData.outlineParameters = { visible: false }));
const grid = new THREE.GridHelper(60, 120, 0x555555, 0x7a7a7a);
grid.position.y = 0.001;
scene.add(floor, grid);

const tc = new TransformControls(camera, renderer.domElement);
tc.setSize(1.2);
tc.setSpace('local');
scene.add(tc.getHelper());
tc.addEventListener('dragging-changed', (e) => { orbit.enabled = !e.value; if (e.value) pushUndo(); });

// ---------- Rig characters (Poseme from the model sheet + variants on the same rig) ----------
// [name, parent, offset, side(+1 L, -1 R, 0 center), group for proportion scaling]
const RIG = [
  ['hips', null, [0, 0, 0], 0, 't'], ['spine', 'hips', [0, 0.14, 0], 0, 't'], ['chest', 'spine', [0, 0.18, 0], 0, 't'],
  ['neck', 'chest', [0, 0.2, 0], 0, 't'], ['head', 'neck', [0, 0.07, 0], 0, 't'],
  ['shoulderL', 'chest', [0.12, 0.15, 0], 1, 's'], ['elbowL', 'shoulderL', [0.27, 0, 0], 1, 'a'], ['wristL', 'elbowL', [0.25, 0, 0], 1, 'a'],
  ['shoulderR', 'chest', [-0.12, 0.15, 0], -1, 's'], ['elbowR', 'shoulderR', [-0.27, 0, 0], -1, 'a'], ['wristR', 'elbowR', [-0.25, 0, 0], -1, 'a'],
  ['hipL', 'hips', [0.09, -0.04, 0], 1, 'h'], ['kneeL', 'hipL', [0, -0.42, 0], 1, 'l'], ['ankleL', 'kneeL', [0, -0.41, 0], 1, 'l'],
  ['hipR', 'hips', [-0.09, -0.04, 0], -1, 'h'], ['kneeR', 'hipR', [0, -0.42, 0], -1, 'l'], ['ankleR', 'kneeR', [0, -0.41, 0], -1, 'l'],
];
const LIMBS = [['shoulderL', 'elbowL', 'wristL', 'arm'], ['shoulderR', 'elbowR', 'wristR', 'arm'],
  ['hipL', 'kneeL', 'ankleL', 'leg'], ['hipR', 'kneeR', 'ankleR', 'leg']];
const STYLES = {
  poseme: { label: 'Poseme (sheet)', color: '#efe9df', head: 0.24, headShape: 'sphere', face: true, torso: 'sdf', sdf: 'poseme', w: 1, hipW: 1.17, arm: 0.062, leg: 0.075, hand: 'sdf', foot: 'ellipsoid', footR: [0.078, 0.06, 0.12], footOff: [0, -0.02, 0.045], armK: 1, legK: 1, torsoK: 1 },
  chibigirl: { label: 'Chibi Girl', color: '#d9d6d1', head: 0.3, headShape: 'sdf', face: false, torso: 'sdf', sdf: 'chibi', noNeck: true, noShoulderBall: true, w: 1, hipW: 1.31, arm: 0.04, leg: 0.085, legTaper: 1.65, hand: 'sdfw', foot: 'sdfw', armK: 0.66, legK: 1, torsoK: 0.63 },
  blob: { label: 'Blob Buddy', color: '#fbfbfd', head: 0.3, headShape: 'ellipsoid', headR: [0.37, 0.27, 0.3], headY: 0.257, face: true, faceKind: 'blob', torso: 'sdf', sdf: 'blob', noNeck: true, noShoulderBall: true, w: 1, hipW: 1.45, arm: 0.062, leg: 0.074, hand: 'none', foot: 'ellipsoid', footR: [0.092, 0.052, 0.115], footOff: [0, -0.025, 0.03], armK: 0.63, legK: 0.39, torsoK: 0.6 },
  female: { label: 'Poseme Girl', color: '#f2e4d6', head: 0.235, headShape: 'sphere', face: true, lashes: true, hair: true, torso: 'smooth', w: 0.88, hipW: 1.15, arm: 0.042, leg: 0.058, hand: 'glove', foot: 'boot', armK: 0.95, legK: 1.03, torsoK: 0.95 },
  chibi: { label: 'Chibi', color: '#efe9df', head: 0.33, headShape: 'sphere', face: true, torso: 'smooth', w: 0.9, arm: 0.045, leg: 0.06, hand: 'glove', foot: 'boot', armK: 0.62, legK: 0.55, torsoK: 0.7 },
  mannequin: { label: 'Mannequin', color: '#d8b48a', joint: '#a07a50', head: 0.15, headShape: 'egg', face: false, torso: 'smooth', w: 1, arm: 0.04, leg: 0.055, hand: 'mitten', foot: 'shoe', armK: 1.1, legK: 1.12, torsoK: 1.05, balls: true },
  stickbot: { label: 'Stick Bot', color: '#e6e6e6', joint: '#8f8f8f', head: 0.13, headShape: 'sphere', face: false, torso: 'stick', w: 1, arm: 0.022, leg: 0.026, hand: 'ball', foot: 'shoe', armK: 1.05, legK: 1.1, torsoK: 1, balls: true },
  squarebot: { label: 'Square Stick Bot', color: '#e0e0e0', joint: '#8a8a8a', head: 0.13, headShape: 'box', face: false, torso: 'box', w: 1, arm: 0.03, leg: 0.036, hand: 'box', foot: 'box', armK: 1, legK: 1.05, torsoK: 1, balls: true, square: true },
};
const DOT_COLOR = { 1: 0xe04444, '-1': 0x4466dd, 0: 0x33cc55 };
const dotGeo = new THREE.SphereGeometry(1, 12, 8);

function makeDot(side, size) {
  const d = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: DOT_COLOR[side], depthTest: false, transparent: true, opacity: 0.9 }));
  d.scale.setScalar(size);
  d.renderOrder = 999;
  d.userData.isDot = true;
  return d;
}

// Blob Buddy face from its sheet: dot eyes, wavy smile with cheek curls, open-mouth phonemes
function drawBlobFace(c, ctx, line) {
  const cx = 128, ey = 124, my = 138, e = c.expr;
  const dot = (x) => { ctx.beginPath(); ctx.ellipse(x, ey, 5, 6, 0, 0, 7); ctx.fill(); };
  dot(cx - 32); if (e !== 'wink') dot(cx + 32); else line(cx + 26, ey, cx + 38, ey);
  const open = (w, h, tongue = true) => {
    ctx.beginPath(); ctx.ellipse(cx, my + 2, w, h, 0, 0, Math.PI); ctx.closePath(); ctx.fill();
    if (tongue) { ctx.fillStyle = '#e0564b'; ctx.beginPath(); ctx.ellipse(cx, my + h * 0.55, w * 0.6, h * 0.35, 0, 0, 7); ctx.fill(); ctx.fillStyle = '#1c1c1c'; }
  };
  if (e === 'smile' || e === 'wink') {
    ctx.beginPath(); ctx.moveTo(cx - 20, my); ctx.quadraticCurveTo(cx - 10, my + 10, cx, my + 4); ctx.quadraticCurveTo(cx + 10, my + 10, cx + 20, my); ctx.stroke();
    line(cx - 20, my, cx - 25, my - 6); line(cx + 20, my, cx + 25, my - 6);
  } else if (e === 'neutral') line(cx - 14, my + 2, cx + 14, my + 2);
  else if (e === 'laugh') open(22, 18);
  else if (e === 'surprised') { ctx.beginPath(); ctx.ellipse(cx, my + 6, 8, 10, 0, 0, 7); ctx.fill(); }
  else if (e === 'sad') { ctx.beginPath(); ctx.arc(cx, my + 14, 13, Math.PI * 1.2, Math.PI * 1.8); ctx.stroke(); }
  else if (e === 'angry') { line(cx - 42, ey - 14, cx - 24, ey - 8); line(cx + 24, ey - 8, cx + 42, ey - 14); line(cx - 12, my + 4, cx + 12, my + 4); }
  else open(16, 13);
}

const EXPRESSIONS = ['smile', 'neutral', 'surprised', 'sad', 'angry', 'wink', 'laugh', 'grin'];
function drawFace(c) {
  if (!c.faceCanvas) return;
  const ctx = c.faceCanvas.getContext('2d'), W = 512, H = 256, cx = 128, ey = 112, my = 150;
  ctx.fillStyle = c.color; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = ctx.fillStyle = '#2b2b2b'; ctx.lineWidth = 4; ctx.lineCap = 'round';
  const line = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
  const eye = (x, open = true) => {
    ctx.beginPath();
    if (open) { ctx.ellipse(x, ey, 5, 10, 0, 0, 7); ctx.stroke(); } else { ctx.moveTo(x - 9, ey); ctx.lineTo(x + 9, ey); ctx.stroke(); }
    if (c.style.lashes) { const d = Math.sign(x - cx); line(x + d * 3, ey - 9, x + d * 9, ey - 15); line(x + d * 6, ey - 5, x + d * 12, ey - 9); }
  };
  const e = c.expr;
  if (c.style.faceKind === 'blob') return drawBlobFace(c, ctx, line), (c.faceTex.needsUpdate = true);
  if (e === 'neutral') { line(cx - 30, ey - 2, cx - 12, ey - 2); line(cx + 12, ey - 2, cx + 30, ey - 2); line(cx - 30, ey + 4, cx - 12, ey + 4); line(cx + 12, ey + 4, cx + 30, ey + 4); line(cx - 18, my, cx + 18, my); }
  else {
    eye(cx - 20, true); eye(cx + 20, e !== 'wink');
    if (e === 'surprised') { ctx.beginPath(); ctx.arc(cx - 20, ey - 14, 8, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke(); ctx.beginPath(); ctx.arc(cx + 20, ey - 14, 8, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke(); ctx.beginPath(); ctx.ellipse(cx, my + 4, 7, 11, 0, 0, 7); ctx.stroke(); }
    if (e === 'sad') { line(cx - 30, ey - 12, cx - 14, ey - 17); line(cx + 14, ey - 17, cx + 30, ey - 12); ctx.beginPath(); ctx.arc(cx, my + 14, 16, Math.PI * 1.2, Math.PI * 1.8); ctx.stroke(); }
    if (e === 'angry') { line(cx - 30, ey - 18, cx - 12, ey - 10); line(cx + 12, ey - 10, cx + 30, ey - 18); line(cx - 14, my + 2, cx + 14, my + 2); }
    if (e === 'smile' || e === 'wink' || e === 'laugh' || e === 'grin') {
      const r = e === 'laugh' ? 20 : 15;
      ctx.beginPath(); ctx.moveTo(cx - r, my - 4); ctx.arc(cx, my - 4, r, 0, Math.PI); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e89a9a'; ctx.beginPath(); ctx.ellipse(cx, my + r - 8, r * 0.5, 4, 0, 0, 7); ctx.fill();
    }
  }
  c.faceTex.needsUpdate = true;
}

const sdfCache = {};
const sdfGeo = (key, desc) => (sdfCache[key] ??= polygonizeSdf(desc));

const lathe = (pts, sx = 1, sy = 1) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r * sx, y * sy)), 28);

function buildRig(type) {
  const st = STYLES[type];
  const c = { type, rig: true, style: st, group: new THREE.Group(), joints: {}, dots: [], color: st.color, expr: 'smile', hand: 'relaxed',
    squash: 1, hose: false, bend: 1, tubes: [], balls: [], fingers: { 1: [], '-1': [] } };
  c.mat = new THREE.MeshStandardMaterial({ color: c.color, roughness: 0.55 });
  c.jointMat = st.joint ? new THREE.MeshStandardMaterial({ color: st.joint, roughness: 0.5 }) : c.mat;
  if (st.face) {
    c.faceCanvas = Object.assign(document.createElement('canvas'), { width: 512, height: 256 });
    c.faceTex = new THREE.CanvasTexture(c.faceCanvas);
    c.faceTex.colorSpace = THREE.SRGBColorSpace;
    c.headMat = new THREE.MeshStandardMaterial({ map: c.faceTex, roughness: 0.55 });
  }
  const K = { t: [1, st.torsoK, 1], s: [st.w, st.torsoK, 1], a: [st.armK, 1, 1], h: [st.w * (st.hipW || 1), st.legK, 1], l: [1, st.legK, 1] };
  c.hipsY = 0.08 + 0.87 * st.legK;
  const mesh = (geo, parent, pos, scale, mat = c.mat, stretchy = false) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos); if (scale) m.scale.set(...scale);
    m.castShadow = m.receiveShadow = true; m.userData.char = c;
    if (stretchy) { m.userData.basePos = m.position.clone(); m.userData.baseScale = m.scale.clone(); parent.userData.stretchy.push(m); }
    parent.add(m); return m;
  };
  for (const [name, parent, off, side, g] of RIG) {
    const j = new THREE.Object3D();
    j.name = name; j.position.set(...off).multiply(new THREE.Vector3(...K[g]));
    if (name === 'hips') j.position.y = c.hipsY;
    j.userData = { base: j.position.clone(), stretch: 1, side, stretchy: [] };
    (parent ? c.joints[parent] : c.group).add(j);
    c.joints[name] = j;
    const dot = makeDot(side, name === 'hips' ? 0.045 : 0.032);
    dot.userData.joint = j; dot.userData.char = c;
    j.add(dot); c.dots.push(dot);
  }
  const J = c.joints, tk = st.torsoK, w = st.w, hw = w * (st.hipW || 1);
  // torso
  if (st.torso === 'sdf') {
    // torso shapes come from the img2threejs sculpt spec, split in two so the spine can bend
    const g = SDF[st.sdf], spineY = c.hipsY + 0.14 * tk;
    mesh(sdfGeo(st.sdf + '-lower', g.lower), J.hips, [0, -c.hipsY, 0], null, c.mat, true);
    mesh(sdfGeo(st.sdf + '-upper', g.upper), J.spine, [0, -spineY, 0], null, c.mat, true);
  } else if (st.torso === 'smooth') {
    mesh(lathe([[0, -0.11], [0.08, -0.105], [0.125, -0.06], [0.13, 0.0], [0.115, 0.07], [0.1, 0.1], [0, 0.1]], hw, tk), J.hips, [0, 0, 0], [1, 1, 0.78], c.mat, true);
    mesh(lathe([[0, -0.06], [0.112, -0.06], [0.095, 0.07], [0.105, 0.16], [0.11, 0.21], [0, 0.21]], w * (st.hipW ? 0.9 : 1), tk), J.spine, [0, 0, 0], [1, 1, 0.78], c.mat, true);
    mesh(lathe([[0, -0.07], [0.1, -0.07], [0.135, 0.06], [0.14, 0.14], [0.115, 0.21], [0.06, 0.245], [0, 0.25]], w, tk), J.chest, [0, 0, 0], [1, 1, 0.74], c.mat, true);
  } else if (st.torso === 'stick') {
    const bar = (parent, len, r, horiz) => { const m = mesh(new THREE.CylinderGeometry(r, r, len, 10), parent, horiz ? [0, horiz, 0] : [0, len / 2, 0], null, c.mat, !horiz); if (horiz) m.rotation.z = Math.PI / 2; };
    bar(J.hips, 0.14 * tk, 0.025); bar(J.spine, 0.18 * tk, 0.025); bar(J.chest, 0.2 * tk, 0.025);
    bar(J.chest, 0.24 * w, 0.02, 0.15 * tk); bar(J.hips, 0.18 * hw, 0.02, -0.04 * st.legK);
    mesh(new THREE.SphereGeometry(0.045, 14, 10), J.hips, [0, 0, 0], null, c.jointMat);
  } else {
    mesh(new THREE.BoxGeometry(0.24 * hw, 0.13 * tk, 0.14), J.hips, [0, 0, 0], null, c.mat, true);
    mesh(new THREE.BoxGeometry(0.18 * w, 0.16 * tk, 0.12), J.spine, [0, 0.09 * tk, 0], null, c.mat, true);
    mesh(new THREE.BoxGeometry(0.3 * w, 0.22 * tk, 0.16), J.chest, [0, 0.11 * tk, 0], null, c.mat, true);
  }
  const nr = st.torso === 'stick' ? 0.02 : 0.045 * w;
  if (!st.noNeck && st.torso !== 'sdf') mesh(new THREE.CylinderGeometry(nr, nr * 1.1, 0.12, 12), J.neck, [0, 0.03, 0], null, c.mat, true);
  // head
  const hr = st.head;
  const headGeo = st.headShape === 'box' ? new THREE.BoxGeometry(hr * 1.7, hr * 1.7, hr * 1.7) : st.headShape === 'ellipsoid' ? new THREE.SphereGeometry(1, 56, 32) : new THREE.SphereGeometry(hr, 48, 32);
  c.group.updateMatrixWorld(true);
  const wp = (j) => J[j].getWorldPosition(new THREE.Vector3()).negate().toArray();
  const head = st.headShape === 'sdf' ? mesh(sdfGeo(st.sdf + '-head', SDF[st.sdf].head), J.head, wp('head'), null, c.mat, true) : mesh(headGeo, J.head, [0, st.headY ?? hr * 0.9, 0], st.headShape === 'egg' ? [0.82, 1.12, 0.9] : st.headR || null, c.headMat || c.mat, true);
  if (st.hair) {
    const hairMat = new THREE.MeshStandardMaterial({ color: '#4a3326', roughness: 0.7 });
    mesh(new THREE.SphereGeometry(0.095, 20, 14), J.head, [0, hr * 1.55, -hr * 0.55], null, hairMat, true);
    mesh(new THREE.SphereGeometry(hr * 1.02, 40, 20, 0, Math.PI * 2, 0, Math.PI * 0.38), J.head, [0, hr * 0.9, -0.01], null, hairMat, true);
  }
  void head;
  for (const s of [1, -1]) {
    const S = s === 1 ? 'L' : 'R';
    const ball = (j, r) => { const b = mesh(new THREE.SphereGeometry(r, 16, 12), J[j + S], [0, 0, 0], null, c.jointMat); c.balls.push(b); return b; };
    if (!st.noShoulderBall) ball('shoulder', Math.max(st.arm * 1.15, 0.03));
    c.elbowBalls = (c.elbowBalls || []).concat(ball('elbow', st.arm * (st.balls ? 1.35 : 1)), ball('knee', st.leg * (st.balls ? 1.35 : 1)));
    if (st.balls) { ball('wrist', st.arm * 1.2); ball('ankle', st.leg * 1.2); ball('hip', st.leg * 1.3); }
    const hand = J['wrist' + S];
    if (st.hand === 'sdfw') mesh(sdfGeo(st.sdf + '-hand' + S, SDF[st.sdf]['hand' + S]), hand, wp('wrist' + S), null);
    else if (st.hand === 'sdf') {
      const hm = mesh(sdfGeo(st.sdf + '-hand' + S, SDF[st.sdf][s === 1 ? 'hand' : 'handR']), hand, [0, 0, 0], null);
      hm.rotation.z = s * Math.PI / 2; hm.scale.setScalar(SDF[st.sdf].handScale); // spec hand hangs along -Y; rig arm runs along ±X
    } else if (st.hand === 'none') mesh(new THREE.SphereGeometry(st.arm, 18, 12), hand, [0, 0, 0], null);
    else if (st.hand === 'glove' || st.hand === 'mitten') {
      // cartoon glove: cuff + palm + 3 fingers + thumb (fingers curl for hand poses)
      const fr = st.hand === 'glove' ? 0.03 : 0.019, pk = st.hand === 'glove' ? 1.25 : 0.8;
      if (st.hand === 'glove') mesh(new THREE.CylinderGeometry(0.068, 0.056, 0.07, 16), hand, [s * 0.03, 0, 0], null).rotation.z = Math.PI / 2;
      mesh(new THREE.SphereGeometry(0.07 * pk, 18, 12), hand, [s * 0.09 * pk, 0, 0], [1.15, 0.7, 1.05]);
      [-0.035, 0, 0.035].forEach((z) => {
        const f = new THREE.Group(); f.position.set(s * 0.145 * pk, 0, z * pk); hand.add(f);
        mesh(new THREE.CapsuleGeometry(fr, 0.05 * pk, 4, 10), f, [s * 0.035 * pk, 0, 0], null).rotation.z = Math.PI / 2;
        c.fingers[s].push(f);
      });
      const th = new THREE.Group(); th.position.set(s * 0.08 * pk, 0, 0.055 * pk); th.userData.thumb = true; hand.add(th);
      mesh(new THREE.CapsuleGeometry(fr, 0.035 * pk, 4, 10), th, [s * 0.015, 0, 0.025], null).rotation.x = Math.PI / 2;
      c.fingers[s].push(th);
    } else if (st.hand === 'ball') mesh(new THREE.SphereGeometry(0.04, 14, 10), hand, [s * 0.04, 0, 0], null);
    else mesh(new THREE.BoxGeometry(0.08, 0.03, 0.065), hand, [s * 0.05, 0, 0], null);
    const foot = J['ankle' + S];
    if (st.foot === 'sdfw') mesh(sdfGeo(st.sdf + '-boot' + S, SDF[st.sdf]['boot' + S]), foot, wp('ankle' + S), null);
    else if (st.foot === 'ellipsoid') mesh(new THREE.SphereGeometry(1, 24, 16), foot, st.footOff, st.footR);
    else if (st.foot === 'boot') {
      mesh(new THREE.CylinderGeometry(0.082, 0.075, 0.1, 18), foot, [0, 0.035, 0], null);
      mesh(new THREE.SphereGeometry(0.088, 20, 14), foot, [0, -0.025, 0.06], [1, 0.62, 1.6]);
    } else if (st.foot === 'shoe') mesh(new THREE.SphereGeometry(0.06, 16, 12), foot, [0, -0.03, 0.04], [1, 0.6, 1.8]);
    else mesh(new THREE.BoxGeometry(0.08, 0.05, 0.17), foot, [0, -0.045, 0.04], null);
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
// widen a tube ring by ring from 1 at the hip to `end` at the ankle (flared trousers / bell-bottoms)
function taper(geo, curve, segs, radial, end) {
  const pos = geo.attributes.position, p = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    curve.getPointAt(i / segs, p);
    const k = 1 + (end - 1) * (i / segs) ** 2;
    for (let j = 0; j <= radial; j++) { const n = i * (radial + 1) + j; v.fromBufferAttribute(pos, n).sub(p).multiplyScalar(k).add(p); pos.setXYZ(n, v.x, v.y, v.z); }
  }
  pos.needsUpdate = true; geo.computeVertexNormals();
}

function updateTubes(c) {
  for (const t of c.tubes) {
    const [ja, jb, jc, part] = t.userData.limb, r = c.style[part];
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
    t.geometry = new THREE.TubeGeometry(curve, 48, r * thin, c.style.square ? 4 : 12, false);
    if (part === 'leg' && c.style.legTaper) taper(t.geometry, curve, 48, 12, c.style.legTaper);
  }
  for (const b of c.elbowBalls) b.visible = !c.hose;
}

function applyStretch(c) {
  if (c.rig) {
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
const MODELS = {
  xbot: ['X Bot', 'models/Xbot.glb'], soldier: ['Soldier', 'models/Soldier.glb'], michelle: ['Michelle', 'models/Michelle.glb'],
  robot: ['Robot', 'models/RobotExpressive.glb'], cesium: ['Cesium Man', 'models/CesiumMan.glb'], figure: ['Rigged Figure', 'models/RiggedFigure.glb'],
  // from smitnk/Android-3D-Model-Forge; their rigid per-part skin is replaced by the smooth auto-rig
  claychibi: ['Clay Chibi', 'models/clay-chibi.glb', true], forgekid: ['Forge Kid', 'models/forge-kid.glb', true], gorilla: ['Gorilla', 'models/gorilla.glb', true],
  roundbuddy: ['Round Buddy', 'models/round-buddy.glb', true], snowbuddy: ['Snow Buddy', 'models/snow-buddy.glb', true],
};
const SKIP_BONE = /end|top|finger|thumb|index|middle|ring|pinky|toe|eye|jaw|palm\d|_nub|tongue/i;
const boneSide = (n) => (/left/i.test(n) || /(^|[_.\s])L([_.\s\d]|$)/.test(n) || /[a-z]L$/.test(n) ? 1
  : /right/i.test(n) || /(^|[_.\s])R([_.\s\d]|$)/.test(n) || /[a-z]R$/.test(n) ? -1 : 0);
const gltfCache = {};
const loader = new GLTFLoader();
const MAJOR_BONE = /(Hips|Spine\d?|Neck|Head|Shoulder|Arm|ForeArm|Hand|UpLeg|Leg|Foot)$/;

async function buildGltf(type) {
  const src = IMPORTS[type]?.root ?? (await (gltfCache[type] ??= loader.loadAsync(MODELS[type][1]).then((g) => (MODELS[type][2] ? { scene: autoRig(g.scene) } : g)))).scene;
  const root = SkeletonUtils.clone(src);
  const c = { type, group: new THREE.Group(), joints: {}, dots: [], color: '#ffffff', squash: 1, hose: false, bend: 1, tubes: [], hand: 'relaxed', expr: 'smile' };
  c.group.add(root);
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = o.receiveShadow = true; o.userData.char = c; o.frustumCulled = false;
      if (Array.isArray(o.material)) o.material = o.material[0];
      o.material = o.material.clone(); o.userData.baseColor = (o.material.color ?? new THREE.Color(1, 1, 1)).clone();
    }
  });
  // skinned bounds are only right once bone matrices are current; without this some models load huge
  root.updateMatrixWorld(true);
  root.traverse((o) => o.isSkinnedMesh && o.skeleton.update());
  const box = new THREE.Box3().setFromObject(root, true);
  const k = 1.75 / (box.max.y - box.min.y);
  root.scale.multiplyScalar(k);
  root.position.set(-(box.min.x + box.max.x) / 2 * k, -box.min.y * k, -(box.min.z + box.max.z) / 2 * k);
  root.updateMatrixWorld(true);
  const ws = new THREE.Vector3();
  const bones = []; root.traverse((o) => o.isBone && bones.push(o));
  const major = bones.filter((o) => MAJOR_BONE.test(o.name));
  c.autoRig = !!src.userData.autoRig;
  const pick = c.autoRig ? bones : major.length >= 8 ? major : bones.filter((o) => !SKIP_BONE.test(o.name) && o.children.some((ch) => ch.isBone));
  for (const o of pick) {
    o.userData = { stretch: 1, base: c.autoRig && o.name === 'hips' ? o.position.clone() : null, rest: o.quaternion.clone() };
    if (c.autoRig && o.name === 'hips') { c.hipsY = o.position.y; c.style = { legK: o.position.y / 0.95 }; }
    c.joints[o.name] = o;
    const dot = makeDot(boneSide(o.name), 0.03);
    o.getWorldScale(ws); dot.scale.divide(ws);
    dot.userData.joint = o; dot.userData.char = c;
    o.add(dot); c.dots.push(dot);
  }
  return c;
}

function tint(c) {
  if (cel) setCel(c, false);
  if (c.rig) { c.mat.color.set(c.color); drawFace(c); }
  else {
    const col = new THREE.Color(c.color);
    c.group.traverse((o) => { if (o.isMesh && o.userData.baseColor) o.material.color.copy(o.userData.baseColor).multiply(col); });
  }
  if (cel) setCel(c, true);
}

// ---------- imported models (FBX / GLB / GLTF / OBJ) ----------
const IMPORTS = {};
let importN = 0;
// saved imports live in IndexedDB so they survive app restarts
const idb = new Promise((res, rej) => { try { const r = indexedDB.open('poseme', 1); r.onupgradeneeded = () => r.result.createObjectStore('imports'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); } catch (e) { rej(e); } });
const idbDo = (mode, fn) => idb.then((db) => new Promise((res, rej) => { const tx = db.transaction('imports', mode); const out = fn(tx.objectStore('imports')); tx.oncomplete = () => res(out.result); tx.onerror = () => rej(tx.error); }));
async function restoreImports() {
  try {
    const keys = await idbDo('readonly', (st) => st.getAllKeys());
    for (const k of keys) {
      const rec = await idbDo('readonly', (st) => st.get(k));
      try { await importModel(new File([rec.data], rec.name), k, rec.thumb, rec.rig); } catch { /* skip a file that no longer parses */ }
    }
  } catch { /* no IndexedDB (private mode): imports stay session-only */ }
}
async function removeImport(t) { delete IMPORTS[t]; try { await idbDo('readwrite', (st) => st.delete(t)); } catch {} }

async function importModel(file, id, thumb, rig) {
  const name = file.name.toLowerCase(), buf = await file.arrayBuffer();
  let root;
  if (name.endsWith('.fbx')) root = new FBXLoader().parse(buf, '');
  else if (name.endsWith('.obj')) root = new OBJLoader().parse(new TextDecoder().decode(buf));
  else root = (await loader.parseAsync(buf, '')).scene;
  let skinned = false;
  root.traverse((o) => { if (o.isSkinnedMesh) skinned = true; });
  if (rig) root = autoRig(root, rig);
  else if (!skinned) root = autoRig(root);
  const t = id ?? 'import:' + Date.now().toString(36) + ++importN;
  IMPORTS[t] = { root, label: file.name.replace(/\.[^.]+$/, ''), thumb, rig };
  if (!id) {
    IMPORTS[t].thumb = await makeThumb(t);
    try { await idbDo('readwrite', (st) => st.put({ name: file.name, data: buf, thumb: IMPORTS[t].thumb }, t)); } catch { toast('Could not save to your library; it stays until you close the app'); }
  }
  return t;
}

// Fit the Poseme joint layout to an unrigged mesh's bounds and skin every vertex to its two nearest bones.
// shortcut: assumes an upright figure facing +Z, T-pose (or arms down if the model is narrow); a manual rig editor is the upgrade.
// Blender/Rigify-style bone names (used by Android-3D-Model-Forge and many hand-made rigs) -> Poseme joints
const BLENDER_BONES = { hips: 'pelvis', spine: 'spine', neck: 'neck', head: 'head', shoulderL: 'upper_arm.L', elbowL: 'forearm.L', wristL: 'hand.L',
  shoulderR: 'upper_arm.R', elbowR: 'forearm.R', wristR: 'hand.R', hipL: 'thigh.L', kneeL: 'shin.L', ankleL: 'foot.L', hipR: 'thigh.R', kneeR: 'shin.R', ankleR: 'foot.R' };
// Joint from the mesh: along a->b, the slice with the thinnest cross-section (mean distance of `pts` from the axis)
// within 30%-75% of the way is the knee/elbow. Falls back to `fallback` when no slice is clearly thinner than its neighbours.
// shortcut: a limb pressed against the torso/other limb in `pts` inflates the radius; callers pre-filter by side.
function thinnestSlice(pts, a, b, fallback) {
  const N = 24, ax = b.clone().sub(a), L = ax.length(), u = ax.divideScalar(L || 1), sum = new Float64Array(N), cnt = new Uint32Array(N), r = new THREE.Vector3();
  for (const p of pts) {
    r.copy(p).sub(a); const t = r.dot(u) / L;
    if (t < 0 || t >= 1) continue;
    const i = Math.floor(t * N); sum[i] += r.addScaledVector(u, -t * L).length(); cnt[i]++;
  }
  const rad = (i) => (i >= 0 && i < N && cnt[i] ? sum[i] / cnt[i] : null);
  let best = -1;
  for (let i = Math.ceil(0.3 * N - 0.5); i <= Math.floor(0.75 * N - 0.5); i++) if (rad(i) !== null && (best < 0 || rad(i) < rad(best))) best = i;
  if (best < 0) return fallback;
  const lo = rad(best - 1), hi = rad(best + 1), m = rad(best);
  return (lo === null || lo > m * 1.05) && (hi === null || hi > m * 1.05) && (lo !== null || hi !== null) ? a.clone().lerp(b, (best + 0.5) / N) : fallback;
}

// Fit the 17 Poseme joints to the mesh. mode: 'auto' (read arms from the mesh), 'T' (arms out), 'A' (arms ~45° down).
function fitJoints(pts, box, mode = 'auto') {
  const V = THREE.Vector3, h = box.max.y - box.min.y, Y = (f) => box.min.y + f * h;
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2, W = {};
  // body width per height slice (ignores far-out arms) -> neck = narrowest slice under the head
  const N = 80, hw = new Float32Array(N);
  for (const p of pts) { const i = Math.floor(((p.y - box.min.y) / h) * N), d = Math.abs(p.x - cx); if (i >= 0 && i < N && d < 0.3 * h && d > hw[i]) hw[i] = d; }
  const slice = (y) => hw[Math.min(N - 1, Math.max(0, Math.floor(((y - box.min.y) / h) * N)))];
  let ni = Math.round(0.8 * N);
  for (let i = Math.round(0.5 * N); i < Math.round(0.93 * N); i++) if (hw[i] > 0 && hw[i] < hw[ni]) ni = i;
  const neckY = Y((ni + 0.5) / N);
  // feet -> ankles
  for (const sd of [1, -1]) {
    const f = pts.filter((p) => p.y < Y(0.07) && sd * (p.x - cx) > 0);
    const c = f.length ? f.reduce((a, p) => a.add(p), new V()).divideScalar(f.length) : new V(cx + sd * 0.07 * h, 0, cz);
    W['ankle' + (sd > 0 ? 'L' : 'R')] = new V(c.x, Y(0.05), c.z - 0.02 * h);
  }
  // crotch = lowest body point on the centre line above the knees
  let crotch = Infinity;
  for (const p of pts) if (Math.abs(p.x - cx) < 0.02 * h && p.y > Y(0.3) && p.y < Y(0.7)) crotch = Math.min(crotch, p.y);
  if (crotch === Infinity) crotch = Y(0.47);
  const hipY = Math.min(crotch + 0.04 * h, neckY - 0.15 * h);
  W.hips = new V(cx, hipY, cz);
  W.neck = new V(cx, neckY - 0.02 * h, cz);
  W.head = new V(cx, neckY + 0.025 * h, cz);
  W.spine = W.hips.clone().lerp(W.neck, 0.3);
  W.chest = W.hips.clone().lerp(W.neck, 0.65);
  const shX = Math.min(0.2 * h, Math.max(0.05 * h, slice(neckY - 0.1 * h) * 0.95)), shY = neckY - 0.035 * h;
  for (const sd of [1, -1]) {
    const S = sd > 0 ? 'L' : 'R';
    W['hip' + S] = new V(cx + sd * Math.max(0.04 * h, Math.abs(W['ankle' + S].x - cx) * 0.6), hipY - 0.02 * h, cz);
    const legMid = W['hip' + S].clone().lerp(W['ankle' + S], 0.5);
    W['knee' + S] = thinnestSlice(pts.filter((p) => sd * (p.x - cx) > 0 && p.y < W['hip' + S].y), W['hip' + S], W['ankle' + S], legMid).add(new V(0, 0, 0.01 * h));
    const sh = (W['shoulder' + S] = new V(cx + sd * shX, shY, cz));
    // hand tip = the point farthest from the shoulder on this side, below shoulder height
    // hand tip = average of the farthest 5% of arm-side points (one stray corner skews the arm angle)
    const cand = pts.filter((p) => sd * (p.x - cx) >= shX * 0.9 && p.y <= shY + 0.08 * h && p.y >= Y(0.2)).map((p) => [p, p.distanceTo(sh)]).sort((x, y) => y[1] - x[1]);
    const far = cand.slice(0, Math.max(1, Math.ceil(cand.length * 0.05)));
    const tip = cand.length ? far.reduce((acc, [p]) => acc.add(p), new V()).divideScalar(far.length) : null;
    const len = tip ? cand[0][1] * 0.86 : 0.3 * h;
    const dir = mode === 'T' ? new V(sd, 0, 0) : mode === 'A' ? new V(sd * Math.SQRT1_2, -Math.SQRT1_2, 0) : tip ? tip.clone().sub(sh).normalize() : new V(sd, 0, 0);
    W['wrist' + S] = sh.clone().addScaledVector(dir, len);
    const armMid = sh.clone().lerp(W['wrist' + S], 0.5);
    W['elbow' + S] = thinnestSlice(pts.filter((p) => sd * (p.x - cx) >= shX * 0.9), sh, W['wrist' + S], armMid).add(new V(0, 0, -0.01 * h));
  }
  return W;
}

// Jacobi Laplacian smoothing of per-vertex weights w (n*NB) over the surface: w_i = 0.5*w_i + 0.5*mean(w_nbrs).
// Coincident vertices (UV/normal seams, non-indexed meshes) are welded by position so neighbours connect.
// D (same layout as w) marks bones forbidden for a vertex with Infinity; they stay 0. Returns the smoothed array (rows sum to 1).
function smoothSkinWeights(w, pos, index, NB, D, iters) {
  const n = pos.count, canon = new Uint32Array(n), seen = new Map(), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) { const c = [pos.getX(i), pos.getY(i), pos.getZ(i)]; for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], c[k]); hi[k] = Math.max(hi[k], c[k]); } }
  const cell = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) * 1e-5 || 1; // weld tolerance 1e-5 of the bbox size
  for (let i = 0; i < n; i++) {
    const key = (Math.round((pos.getX(i) - lo[0]) / cell) * 100003 + Math.round((pos.getY(i) - lo[1]) / cell)) * 100003 + Math.round((pos.getZ(i) - lo[2]) / cell);
    let c = seen.get(key); if (c === undefined) seen.set(key, (c = i)); canon[i] = c;
  }
  const nt = index ? index.length : n, ix = (j) => (index ? index[j] : j), off = new Uint32Array(n + 1);
  const edges = (f) => { for (let j = 0; j + 2 < nt; j += 3) { const a = canon[ix(j)], b = canon[ix(j + 1)], c = canon[ix(j + 2)]; if (a !== b) f(a, b); if (b !== c) f(b, c); if (c !== a) f(c, a); } };
  edges((a, b) => { off[a + 1]++; off[b + 1]++; });
  for (let i = 0; i < n; i++) off[i + 1] += off[i];
  const nb = new Uint32Array(off[n]), cur = off.slice(0, n);
  edges((a, b) => { nb[cur[a]++] = b; nb[cur[b]++] = a; });
  let a = w, b = new Float32Array(w.length);
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < n; i++) {
      if (canon[i] !== i) continue;
      const o = i * NB, d = off[i + 1] - off[i]; let sum = 0;
      for (let k = 0; k < NB; k++) b[o + k] = 0;
      for (let e = off[i]; e < off[i + 1]; e++) { const m = nb[e] * NB; for (let k = 0; k < NB; k++) b[o + k] += a[m + k]; }
      for (let k = 0; k < NB; k++) {
        const x = D && D[o + k] === Infinity ? 0 : d ? 0.5 * a[o + k] + (0.5 * b[o + k]) / d : a[o + k];
        b[o + k] = x; sum += x;
      }
      if (sum > 0) for (let k = 0; k < NB; k++) b[o + k] /= sum; else b[o] = 1; // nothing allowed -> hips
    }
    [a, b] = [b, a];
  }
  for (let i = 0; i < n; i++) if (canon[i] !== i) for (let k = 0; k < NB; k++) a[i * NB + k] = a[canon[i] * NB + k];
  return a;
}

// Build a 17-bone skeleton on the joints and skin the mesh to it.
// Bones are oriented so arms point along ±X and legs along -Y in the zero pose ("virtual T-pose"):
// an A-pose model's rest is then a rotation of that, and presets / mirror behave like on T-pose models.
function autoRig(src, override, onlyJoints, mode) {
  src.traverse((o) => o.isSkinnedMesh && o.skeleton.pose());
  src.updateMatrixWorld(true);
  const key = (n) => n.replace(/[.:\s]/g, ''); // the glTF loader strips dots from node names
  const old = {}; src.traverse((o) => { if (o.isBone) old[key(o.name)] = o; });
  const useOld = !mode && Object.values(BLENDER_BONES).every((n) => old[key(n)]);
  const parts = [];
  src.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone(); g.deleteAttribute('skinIndex'); g.deleteAttribute('skinWeight');
    parts.push([g.applyMatrix4(o.matrixWorld), Array.isArray(o.material) ? o.material[0] : o.material]);
  });
  if (!parts.length) throw new Error('no meshes in the file');
  const box = new THREE.Box3();
  for (const [g] of parts) { g.computeBoundingBox(); box.union(g.boundingBox); }
  const total = parts.reduce((n, [g]) => n + g.attributes.position.count, 0), step = Math.max(1, Math.floor(total / 30000)), pts = [];
  for (const [g] of parts) { const pos = g.attributes.position; for (let i = 0; i < pos.count; i += step) pts.push(new THREE.Vector3().fromBufferAttribute(pos, i)); }
  let W = fitJoints(pts, box, mode);
  if (useOld) { // keep the model's own joint placement, only the skin weights are rebuilt
    for (const [n, b] of Object.entries(BLENDER_BONES)) W[n] = old[key(b)].getWorldPosition(new THREE.Vector3());
    W.chest = W.spine.clone().lerp(W.neck, 0.5);
  }
  let skel = RIG.map(([n, par]) => [n, par]);
  if (override?.bones) { // a metarig built in the skeleton editor: any bone list
    skel = override.bones.map(([n, par]) => [n, par]);
    W = Object.fromEntries(override.bones.map(([n, , v]) => [n, new THREE.Vector3(...v)]));
  } else if (override) for (const [n, v] of Object.entries(override)) W[n] = new THREE.Vector3(...v); // joints placed by hand (older saves)
  if (onlyJoints) return W;
  const h = box.max.y - box.min.y, cx = W.hips?.x ?? (box.min.x + box.max.x) / 2, shX = W.shoulderL ? Math.abs(W.shoulderL.x - cx) : 0.1 * h;
  // bone world orientations
  const V = THREE.Vector3, child = { shoulderL: 'elbowL', elbowL: 'wristL', shoulderR: 'elbowR', elbowR: 'wristR', hipL: 'kneeL', kneeL: 'ankleL', hipR: 'kneeR', kneeR: 'ankleR' };
  const axis = (n) => (/L$/.test(n) && /shoulder|elbow/.test(n) ? new V(1, 0, 0) : /R$/.test(n) && /shoulder|elbow/.test(n) ? new V(-1, 0, 0) : /^(hip|knee)[LR]$/.test(n) ? new V(0, -1, 0) : null);
  const Qw = {};
  for (const [n, par] of skel) {
    const ax = axis(n);
    Qw[n] = ax && W[child[n]] ? new THREE.Quaternion().setFromUnitVectors(ax, W[child[n]].clone().sub(W[n]).normalize())
      : /^(wrist|ankle)[LR]$/.test(n) && par ? Qw[par].clone() : new THREE.Quaternion();
  }
  const bones = {}, list = [];
  for (const [n, par] of skel) {
    const b = new THREE.Bone(); b.name = n;
    const inv = par ? Qw[par].clone().invert() : new THREE.Quaternion();
    b.position.copy(W[n]).sub(par ? W[par] : new V()).applyQuaternion(inv);
    b.quaternion.copy(inv).multiply(Qw[n]);
    if (par) bones[par].add(b);
    bones[n] = b; list.push(b);
  }
  // segments: each belongs to the bone it starts at; leaf bones get a short segment past their end
  const bi = (n) => list.findIndex((b) => b.name === n), segs = [];
  for (const [n, par] of skel) if (par) segs.push([bi(par), W[par], W[n]]);
  // end bones (no children) get a short segment past their tip; the head reaches the top of the model
  const hasKids = new Set(skel.map(([, par]) => par));
  for (const [n, par] of skel) {
    if (hasKids.has(n) || !par) continue;
    const tip = n === 'head' ? new V(W.head.x, box.max.y, W.head.z)
      : /^ankle[LR]$/.test(n) ? W[n].clone().add(new V(0, -0.04 * h, 0.08 * h))
      : W[n].clone().add(W[n].clone().sub(W[par]).normalize().multiplyScalar((/^wrist[LR]$/.test(n) ? 0.08 : 0.05) * h));
    segs.push([bi(n), W[n], tip]);
  }
  // a vertex may only use limbs on its own side, and arms only away from the centre line
  const sideOf = list.map((b) => (/L$/.test(b.name) ? 1 : /R$/.test(b.name) ? -1 : 0)), armOf = list.map((b) => /^(shoulder|elbow|wrist)/.test(b.name));
  const allowed = (k, x) => !sideOf[k] || (sideOf[k] * (x - cx) > (armOf[k] ? shX * 0.45 : -0.01 * h));
  const seg = new THREE.Line3(), v = new V(), q = new V(), NB = list.length;
  const out = new THREE.Group(); out.add(bones[skel.find(([, par]) => !par)[0]]); out.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(list);
  // pass 1: raw nearest-segment distances, and each bone's typical thickness (envelope radius)
  const D = parts.map(([g]) => new Float32Array(g.attributes.position.count * NB).fill(Infinity));
  const near = list.map(() => []);
  parts.forEach(([g], pi) => {
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i); let bk = -1, bd = Infinity;
      for (const [k, a, b] of segs) {
        if (!allowed(k, v.x)) continue;
        seg.set(a, b); seg.closestPointToPoint(v, true, q); const d = q.distanceTo(v);
        if (d < D[pi][i * NB + k]) D[pi][i * NB + k] = d;
        if (d < bd) { bd = d; bk = k; }
      }
      if (bk >= 0 && i % 4 === 0) near[bk].push(bd);
    }
  });
  const rad = near.map((a) => { if (!a.length) return 0.05 * h; a.sort((x, y) => x - y); return Math.max(0.015 * h, a[a.length >> 1]); });
  // pass 2: distance in units of bone thickness, soft blend of the 4 best bones, then smoothed over the surface
  parts.forEach(([g, mat], pi) => {
    const n = g.attributes.position.count, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), w0 = new Float32Array(n * NB);
    for (let i = 0; i < n; i++) {
      const top = [];
      for (let k = 0; k < NB; k++) { const d = D[pi][i * NB + k]; if (d < Infinity) top.push([k, d / rad[k]]); }
      top.sort((x, y) => x[1] - y[1]); top.length = Math.min(4, top.length);
      if (!top.length) { w0[i * NB] = 1; continue; }
      const w = top.map(([, dn]) => 1 / (dn ** 2 + 1e-6)), sum = w.reduce((a, x) => a + x, 0);
      top.forEach(([k], j) => { w0[i * NB + k] = w[j] / sum; });
    }
    const ws = smoothSkinWeights(w0, g.attributes.position, g.index?.array, NB, D[pi], 10);
    for (let i = 0; i < n; i++) { // keep the 4 largest, renormalised
      let sum = 0;
      for (let j = 0; j < 4; j++) {
        let bk = 0; for (let k = 1; k < NB; k++) if (ws[i * NB + k] > ws[i * NB + bk]) bk = k;
        si[i * 4 + j] = bk; sw[i * 4 + j] = ws[i * NB + bk]; sum += ws[i * NB + bk]; ws[i * NB + bk] = 0;
      }
      for (let j = 0; j < 4; j++) sw[i * 4 + j] /= sum;
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    if (!g.attributes.normal) g.computeVertexNormals();
    const m = new THREE.SkinnedMesh(g, mat ?? new THREE.MeshStandardMaterial({ color: 0xdddddd }));
    out.add(m); m.bind(skeleton);
  });
  out.userData.autoRig = true;
  return out;
}

// ---------- skeleton editor (Rigify-style metarig, for imported models) ----------
// Workflow like Blender Rigify: pick a metarig template, fit it to the mesh, adjust joints, extrude or delete bones,
// then "Generate rig" skins the mesh to that skeleton. The skeleton is saved with the model.
let rigEdit = null;
const sideOfName = (n) => (/L$/.test(n) ? 'L' : /R$/.test(n) ? 'R' : '');
const baseOf = (n) => n.replace(/[LR]$/, '');
// metarig templates built on the fitted 17 joints. h = model height, W = fitted joint positions
function metarig(kind, W, h) {
  const V = THREE.Vector3, bones = RIG.map(([n, par]) => [n, par, W[n].clone()]);
  if (kind.startsWith('human')) {
    for (const S of ['L', 'R']) {
      const w = W['wrist' + S], e = W['elbow' + S], d = w.clone().sub(e).normalize(), L = 0.4 * w.distanceTo(e);
      const spread = new V().crossVectors(d, new V(0, 1, 0)).normalize(); if (S === 'R') spread.negate(); // +Z = front of the body
      ['index', 'middle', 'ring', 'pinky'].forEach((f, i) => {
        let at = w.clone().addScaledVector(d, L * 0.5).addScaledVector(spread, (0.27 - i * 0.18) * L);
        for (let k = 1; k <= 3; k++) { bones.push([f + k + S, k === 1 ? 'wrist' + S : f + (k - 1) + S, at.clone()]); at.addScaledVector(d, L * 0.22); }
      });
      const td = d.clone().addScaledVector(spread, 0.8).normalize();
      let at = w.clone().addScaledVector(d, L * 0.15).addScaledVector(spread, 0.3 * L);
      for (let k = 1; k <= 3; k++) { bones.push(['thumb' + k + S, k === 1 ? 'wrist' + S : 'thumb' + (k - 1) + S, at.clone()]); at.addScaledVector(td, L * 0.22); }
      bones.push(['toe' + S, 'ankle' + S, W['ankle' + S].clone().add(new V(0, -0.035 * h, 0.09 * h))]);
    }
  }
  if (kind === 'tail' || kind === 'human+tail') for (let k = 1; k <= 4; k++) bones.push(['tail' + k, k === 1 ? 'hips' : 'tail' + (k - 1), W.hips.clone().add(new V(0, -0.02 * h * k, -0.07 * h * k))]);
  return bones;
}
function rigLines() { // bone sticks between joints, like Blender's edit-mode skeleton
  const pos = [];
  for (const [n, par] of rigEdit.skel) if (par) pos.push(...rigEdit.handles[par].position.toArray(), ...rigEdit.handles[n].position.toArray());
  rigEdit.lines.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
}
function setSkeleton(bones) {
  for (const h of Object.values(rigEdit.handles)) scene.remove(h);
  rigEdit.handles = {}; rigEdit.skel = bones.map(([n, par]) => [n, par]); rigEdit.selected = null;
  for (const [n, , pos] of bones) {
    const side = sideOfName(n), small = /^(index|middle|ring|pinky|thumb|toe)/.test(n);
    const hd = makeDot(side === 'L' ? 1 : side === 'R' ? -1 : 0, n === 'hips' ? 0.05 : small ? 0.022 : 0.04);
    hd.userData = { isDot: true, rigJoint: n, size: hd.scale.x };
    hd.position.copy(pos); scene.add(hd); rigEdit.handles[n] = hd;
  }
  rigLines();
}
function selectRigBone(n) {
  rigEdit.selected = n;
  for (const [k, hd] of Object.entries(rigEdit.handles)) hd.scale.setScalar(hd.userData.size * (k === n ? 1.7 : 1));
  if (openPanel === 'rig') renderPanel('rig');
}
const currentBones = () => rigEdit.skel.map(([n, par]) => [n, par, rigEdit.handles[n].position.clone()]);
async function startRigEdit(c) {
  if (!IMPORTS[c.type]) return toast('Rig editing is for your imported models (My models)');
  if (rigEdit) endRigEdit(true);
  resetPose(c); applyStretch(c);
  select(null);
  c.group.updateMatrixWorld(true);
  const root = c.group.children[0], src = IMPORTS[c.type].root;
  const box = new THREE.Box3().setFromObject(root, true), h = box.max.y - box.min.y;
  const toWorld = (W) => Object.fromEntries(Object.entries(W).map(([n, v]) => [n, root.localToWorld(v.clone())]));
  const fit = (mode) => toWorld(autoRig(src, null, true, mode));
  const lines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffd23f, depthTest: false, transparent: true }));
  lines.renderOrder = 998; scene.add(lines);
  rigEdit = { c, root, h, fit, lines, handles: {}, skel: [], mirror: true, template: 'basic' };
  const saved = IMPORTS[c.type].rig?.bones;
  if (saved) setSkeleton(saved.map(([n, par, v]) => [n, par, root.localToWorld(new THREE.Vector3(...v))]));
  else if (c.autoRig) setSkeleton(RIG.map(([n, par]) => [n, par, c.joints[n].getWorldPosition(new THREE.Vector3())]));
  else setSkeleton(metarig('basic', fit('auto'), h));
  c.dots.forEach((d) => (d.visible = false));
  renderPanel('rig');
  toast('Adjust the skeleton, then Generate rig');
}
function fitTemplate(kind, mode) { rigEdit.template = kind; setSkeleton(metarig(kind, rigEdit.fit(mode), rigEdit.h)); renderPanel('rig'); }
// Extrude: add a child bone after the selected one (mirrored onto the other side when mirroring is on)
function extrudeBone() {
  const n = rigEdit.selected; if (!n) return toast('Tap a joint first');
  const bones = currentBones(), add = (from) => {
    const par = bones.find(([k]) => k === from); if (!par) return null;
    const side = sideOfName(from), gp = bones.find(([k]) => k === par[1]);
    const dir = gp ? par[2].clone().sub(gp[2]).normalize() : new THREE.Vector3(0, 1, 0);
    let i = 1, name; do name = baseOf(from) + '_x' + i++ + side; while (bones.some(([k]) => k === name));
    bones.push([name, from, par[2].clone().addScaledVector(dir, 0.07 * rigEdit.h)]);
    return name;
  };
  const made = add(n);
  if (rigEdit.mirror && sideOfName(n)) add(swapSide(n));
  setSkeleton(bones); selectRigBone(made);
}
// Delete the selected bone and everything below it (and its mirror twin)
function deleteBone() {
  const n = rigEdit.selected; if (!n) return toast('Tap a joint first');
  if (RIG.some(([k]) => k === n)) return toast('Core joints can be moved but not deleted; presets and mirror need them');
  const drop = new Set([n, ...(rigEdit.mirror && sideOfName(n) ? [swapSide(n)] : [])]);
  let grew = true;
  while (grew) { grew = false; for (const [k, par] of rigEdit.skel) if (drop.has(par) && !drop.has(k)) { drop.add(k); grew = true; } }
  setSkeleton(currentBones().filter(([k]) => !drop.has(k)));
  renderPanel('rig');
}
// Drag joints straight with a finger on a plane facing the camera (no gizmo: the move gizmo jumped on touch).
// Capture phase on the document runs before the camera controls, so a joint drag never also turns the camera.
const dragPlane = new THREE.Plane(), dragHit = new THREE.Vector3();
const rayAt = (e) => { ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); raycaster.setFromCamera(ndc, camera); };
document.addEventListener('pointerdown', (e) => {
  if (!rigEdit || e.target !== renderer.domElement) return;
  rayAt(e);
  const hit = raycaster.intersectObjects(Object.values(rigEdit.handles), false)[0];
  if (!hit) return; // empty space: let the camera turn
  e.stopPropagation(); e.preventDefault();
  const h = hit.object;
  dragPlane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), h.position);
  rigEdit.drag = { h, id: e.pointerId };
  selectRigBone(h.userData.rigJoint);
}, true);
document.addEventListener('pointermove', (e) => {
  const d = rigEdit?.drag; if (!d || e.pointerId !== d.id) return;
  e.stopPropagation(); rayAt(e);
  if (!raycaster.ray.intersectPlane(dragPlane, dragHit)) return;
  const n = d.h.userData.rigJoint, cx = (rigEdit.handles.hips ?? d.h).position.x;
  d.h.position.copy(dragHit);
  if (rigEdit.mirror) {
    const twin = rigEdit.handles[swapSide(n)];
    if (twin && twin !== d.h) twin.position.set(2 * cx - dragHit.x, dragHit.y, dragHit.z);
    else if (!sideOfName(n) && n !== 'hips') d.h.position.x = cx; // centre joints stay on the centre line
  }
  rigLines();
}, true);
document.addEventListener('pointerup', (e) => { if (rigEdit?.drag && e.pointerId === rigEdit.drag.id) { e.stopPropagation(); rigEdit.drag = null; } }, true);
function endRigEdit(cancel) {
  if (!rigEdit) return;
  tc.detach(); tc.setSpace('local');
  Object.values(rigEdit.handles).forEach((h) => scene.remove(h));
  scene.remove(rigEdit.lines);
  rigEdit.c.dots.forEach((d) => (d.visible = showDots && !rigEdit.c.locked));
  rigEdit = null;
  P.style.display = 'none'; openPanel = null;
  if (cancel) toast('Rig unchanged');
}
async function applyRigEdit() {
  const { c, root } = rigEdit, t = c.type;
  const ov = { bones: currentBones().map(([n, par, v]) => [n, par, root.worldToLocal(v).toArray()]) };
  toast('Generating rig…');
  IMPORTS[t].root = autoRig(IMPORTS[t].root, ov);
  IMPORTS[t].rig = ov;
  try {
    const rec = await idbDo('readonly', (st) => st.get(t));
    if (rec) await idbDo('readwrite', (st) => st.put({ ...rec, rig: ov }, t));
  } catch { /* not saved: the rig lasts this session */ }
  endRigEdit();
  pushUndo();
  const pos = c.group.position.clone(), rot = c.group.quaternion.clone();
  scene.remove(c.group); chars.splice(chars.indexOf(c), 1);
  const n = await addCharacter(t);
  n.group.position.copy(pos); n.group.quaternion.copy(rot);
  select({ char: n });
  toast('Rig generated and saved (' + ov.bones.length + ' bones)');
}

// ---------- IK limbs (Rigify-style): drag a hand or foot and the arm or leg follows ----------
let ikMode = false, ikTarget = null;
const IK_CHAINS = [['shoulderL', 'elbowL', 'wristL'], ['shoulderR', 'elbowR', 'wristR'], ['hipL', 'kneeL', 'ankleL'], ['hipR', 'kneeR', 'ankleR'],
  ['LeftArm', 'LeftForeArm', 'LeftHand'], ['RightArm', 'RightForeArm', 'RightHand'], ['LeftUpLeg', 'LeftLeg', 'LeftFoot'], ['RightUpLeg', 'RightLeg', 'RightFoot']];
function ikChainFor(c, joint) {
  const find = (n) => c.joints[n] ?? Object.entries(c.joints).find(([k]) => k.replace(/^mixamorig:?/, '') === n)?.[1];
  for (const ch of IK_CHAINS) { const js = ch.map(find); if (js.every(Boolean) && js[2] === joint) return { js, leg: /hip|Leg/.test(ch[0]) }; }
  return null;
}
const wpos = (o) => o.getWorldPosition(new THREE.Vector3());
function aimBone(bone, cur, want) { // rotate bone so a point that is at `cur` moves to `want`
  const p = wpos(bone), q = new THREE.Quaternion().setFromUnitVectors(cur.clone().sub(p).normalize(), want.clone().sub(p).normalize());
  const wq = bone.getWorldQuaternion(new THREE.Quaternion()), pq = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  bone.quaternion.copy(pq.multiply(q.multiply(wq)));
  bone.updateMatrixWorld(true);
}
function solveIK({ js: [a, b, e], leg }, target) {
  const pa = wpos(a), pb = wpos(b), pe = wpos(e), l1 = pa.distanceTo(pb), l2 = pb.distanceTo(pe);
  const dir = target.clone().sub(pa); const d = THREE.MathUtils.clamp(dir.length(), Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4); dir.normalize();
  const goal = pa.clone().addScaledVector(dir, d);
  // keep the current bend direction (elbows back, knees forward when the limb is straight)
  const pole = pb.clone().sub(pa); pole.addScaledVector(dir, -pole.dot(dir));
  if (pole.lengthSq() < 1e-8) pole.set(0, 0, leg ? 1 : -1).addScaledVector(dir, -dir.z * (leg ? 1 : -1));
  pole.normalize();
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d), y = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  aimBone(a, pb, pa.clone().addScaledVector(dir, x).addScaledVector(pole, y));
  aimBone(b, wpos(e), goal);
}
function dropIkTarget() { if (ikTarget) { scene.remove(ikTarget.obj); ikTarget = null; } }
tc.addEventListener('objectChange', () => { if (ikTarget && tc.object === ikTarget.obj) solveIK(ikTarget.chain, ikTarget.obj.position); });

// ---------- thumbnails (cards in the Add panel) ----------
let thumbR, thumbFx;
async function makeThumb(type) {
  thumbR ??= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  thumbR.setSize(160, 200, false);
  thumbFx ??= new OutlineEffect(thumbR, { defaultThickness: 0.012, defaultColor: [0, 0, 0] });
  const sc = new THREE.Scene();
  sc.add(new THREE.HemisphereLight(0xffffff, 0x777777, 1.6));
  const dl = new THREE.DirectionalLight(0xffffff, 1.6); dl.position.set(1, 2, 3); sc.add(dl);
  const c = STYLES[type] ? buildRig(type) : await buildGltf(type);
  sc.add(c.group); c.group.updateMatrixWorld(true);
  if (c.rig) updateTubes(c);
  c.dots.forEach((d) => (d.visible = false));
  const box = new THREE.Box3().setFromObject(c.group, true), size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
  const half = Math.max(size.y / 2, size.x / 2 / 0.8) * 1.06;
  const cam = new THREE.OrthographicCamera(-half * 0.8, half * 0.8, half, -half, 0.1, 50);
  cam.position.set(ctr.x + half * 0.35, ctr.y + half * 0.1, ctr.z + 10); cam.lookAt(ctr);
  thumbFx.render(sc, cam);
  return thumbR.domElement.toDataURL('image/png');
}

// Outline only the big shapes. The inverted-hull outline draws a black ring around every mesh, so tiny inner
// parts (eyes, teeth, lips, finger joints) and see-through layers turned into blobs and bands inside the body.
function tuneOutline(c) {
  c.group.updateMatrixWorld(true);
  const H = new THREE.Box3().setFromObject(c.group, true).getSize(new THREE.Vector3()).y || 1.75;
  const sphere = new THREE.Sphere(), ws = new THREE.Vector3();
  c.group.traverse((o) => {
    if (!o.isMesh || o.userData.isDot || !o.material) return;
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    sphere.copy(o.geometry.boundingSphere); o.getWorldScale(ws);
    const r = sphere.radius * Math.max(ws.x, ws.y, ws.z);
    const tiny = !o.userData.limb && r < 0.04 * H; // limb tubes rebuild every frame, keep them outlined
    // rig characters share one material across parts, so a tiny part gets its own copy before switching off
    if (tiny || o.material.transparent) { o.material = o.material.clone(); o.material.userData.outlineParameters = { visible: false }; }
  });
}

// ---------- 2D cel shading (flat colour + one hard shadow band) ----------
let cel = false;
const toonRamp = new THREE.DataTexture(new Uint8Array([140, 140, 140, 255, 255, 255, 255, 255]), 2, 1);
toonRamp.minFilter = toonRamp.magFilter = THREE.NearestFilter; toonRamp.needsUpdate = true;
function setCel(c, on) {
  c.group.traverse((o) => {
    if (!o.isMesh || o.userData.isDot) return;
    if (on) {
      const pbr = (o.userData.pbrMat ??= o.material);
      o.material = new THREE.MeshToonMaterial({ color: pbr.color, map: pbr.map ?? null, gradientMap: toonRamp });
      o.material.userData.outlineParameters = pbr.userData.outlineParameters;
      o.receiveShadow = false; // self-shadowing speckles the flat bands; keep the cast shadow on the floor
    } else if (o.userData.pbrMat) { o.material = o.userData.pbrMat; delete o.userData.pbrMat; o.receiveShadow = true; }
  });
}
function toggleCel() { cel = !cel; chars.forEach((c) => setCel(c, cel)); toast(cel ? '2D cel shading on' : '2D cel shading off'); }

// ---------- world state ----------
const chars = [], props = [];
let sel = null; // {char, joint} | {char} | {prop}
let showDots = true;

async function addCharacter(type, state) {
  const c = STYLES[type] ? buildRig(type) : await buildGltf(type);
  tuneOutline(c);
  if (cel) setCel(c, true);
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
    hipsPos: c.rig ? c.joints.hips.position.toArray() : null, joints };
}
function applyCharState(c, s) {
  c.group.position.fromArray(s.pos); c.group.quaternion.fromArray(s.rot);
  Object.assign(c, { squash: s.squash, hose: s.hose, bend: s.bend ?? 1, color: s.color, expr: s.expr, locked: s.locked });
  for (const [k, v] of Object.entries(s.joints)) { const j = c.joints[k]; if (j) { j.quaternion.fromArray(v); j.userData.stretch = v[4] ?? 1; } }
  if (s.hipsPos && c.rig) c.joints.hips.userData.base.fromArray(s.hipsPos);
  if (c.rig) setHand(c, s.hand || 'relaxed');
  applyStretch(c); tint(c);
}
const sceneState = () => ({ chars: chars.map(charState), props: props.map((p) => ({ kind: p.userData.kind, pos: p.position.toArray(), rot: p.quaternion.toArray(), scale: p.scale.toArray(), color: '#' + p.material.color.getHexString() })) });

async function loadScene(st) {
  select(null);
  for (const c of chars) scene.remove(c.group);
  for (const p of props) scene.remove(p);
  chars.length = props.length = 0;
  for (const s of st.chars) {
    if (!STYLES[s.type] && !MODELS[s.type] && !IMPORTS[s.type]) { toast('Imported model not loaded; import it again'); continue; }
    await addCharacter(s.type, s);
  }
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
  if (!c.rig && !c.autoRig) return toast('Presets work on Poseme characters and auto-rigged imports');
  pushUndo();
  const p = PRESETS[name];
  for (const [k, j] of Object.entries(c.joints)) {
    if (c.autoRig && !RIG.some(([n]) => n === k)) { j.quaternion.copy(j.userData.rest); continue; } // fingers, tail, extruded bones keep their rest
    const e = p[k] || [0, 0, 0];
    j.quaternion.setFromEuler(new THREE.Euler(e[0] * D2R, e[1] * D2R, e[2] * D2R));
  }
  c.joints.hips.userData.base.set(0, c.hipsY + (p._y || 0) * c.style.legK, 0);
  if (c.autoRig) c.joints.hips.position.copy(c.joints.hips.userData.base);
  applyStretch(c);
  if (name === 'Sad') { c.expr = 'sad'; drawFace(c); }
}
function resetPose(c) {
  pushUndo();
  for (const j of Object.values(c.joints)) { j.quaternion.copy(j.userData.rest || new THREE.Quaternion()); j.userData.stretch = 1; }
  if (c.rig) c.joints.hips.userData.base.set(0, c.hipsY, 0);
  c.squash = 1; applyStretch(c);
}
const swapSide = (n) => n.replace(/L$|R$|Left|Right/, (m) => ({ L: 'R', R: 'L', Left: 'Right', Right: 'Left' }[m]));
function mirror(c) {
  if (!c.rig && !c.autoRig) return toast('Mirror works on Poseme characters and auto-rigged imports');
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
  if (rigEdit) return; // joints are dragged directly while editing a rig
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
  dropIkTarget();
  const chain = s?.joint && ikMode ? ikChainFor(s.char, s.joint) : null;
  if (chain) {
    const obj = new THREE.Object3D(); obj.position.copy(wpos(s.joint)); scene.add(obj);
    ikTarget = { obj, chain }; mode = 'translate'; tc.setMode('translate'); tc.setSpace('world'); tc.attach(obj);
  } else if (s?.joint) { mode = 'rotate'; tc.setMode('rotate'); tc.setSpace('local'); tc.attach(s.joint); }
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
// picture cards like PoseMyArt's Add Models sheet
function cards(items, removable) {
  const g = document.createElement('div'); g.className = 'cards';
  for (const [t, label, img] of items) {
    const c = document.createElement('button'); c.className = 'card';
    const im = new Image(); im.alt = ''; im.loading = 'lazy'; if (img) im.src = img; im.onerror = () => (im.style.visibility = 'hidden');
    const cap = document.createElement('span'); cap.textContent = label;
    c.append(im, cap);
    c.onclick = async () => { pushUndo(); toast('Loading ' + label + '…'); select({ char: await addCharacter(t) }); };
    if (removable) {
      const x = document.createElement('span'); x.className = 'rm'; x.textContent = '✕'; x.title = 'Remove from my models';
      x.onclick = async (e) => { e.stopPropagation(); await removeImport(t); renderPanel('add'); toast('Removed ' + label); };
      c.append(x);
    }
    g.append(c);
  }
  return g;
}

const PANELS = {
  add: () => [
    'Poseme characters (all features)', cards(Object.entries(STYLES).map(([t, st]) => [t, st.label, 'thumbs/' + t + '.png'])),
    'Rigged models', cards(Object.entries(MODELS).map(([t, [l]]) => [t, l, 'thumbs/' + t + '.png'])),
    'My models (FBX, GLB, GLTF, OBJ; saved on this phone; models without bones are auto-rigged)',
    row(btn('＋ Import model…', () => pickFile('model'))),
    cards(Object.entries(IMPORTS).map(([t, m]) => [t, m.label, m.thumb]), true),
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
      btn('Arrows', () => { arrows.visible = !arrows.visible; renderPanel('light'); }, arrows.visible),
      btn('Outlines', () => { outlines = !outlines; renderPanel('light'); }, outlines),
      btn('2D cel shading', () => { toggleCel(); renderPanel('light'); }, cel)),
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
    if (c.rig) out.push(
      row(btn('Rubber hose limbs', () => { pushUndo(); c.hose = !c.hose; renderPanel('squash'); }, c.hose)),
      slider('Hose bend', 0, 2, 0.01, c.bend, (v) => { c.bend = v; }));
    out.push(row(btn('Reset squash & stretch', () => { pushUndo(); Object.values(c.joints).forEach((x) => (x.userData.stretch = 1)); c.squash = 1; applyStretch(c); renderPanel('squash'); })));
    return out;
  },
  face: () => { const c = charOf(); return !c?.style?.face ? ['This character has no face to change'] : [row(...EXPRESSIONS.map((e) => btn(e, () => { pushUndo(); c.expr = e; drawFace(c); renderPanel('face'); }, c.expr === e)))]; },
  hands: () => { const c = charOf(); return !c?.fingers?.[1]?.length ? ['This character has no posable fingers'] : [row(...['open', 'relaxed', 'fist', 'point', 'peace', 'thumbsup'].map((h) => btn(h, () => { pushUndo(); setHand(c, h); renderPanel('hands'); }, c.hand === h)))]; },
  rig: () => {
    if (!rigEdit) return ['Select an imported model, then tap 🦴'];
    const n = rigEdit.selected;
    return [
      '1. Metarig template (fitted to your model):',
      row(btn('Basic', () => fitTemplate('basic', 'auto'), rigEdit.template === 'basic'), btn('Human + fingers', () => fitTemplate('human', 'auto'), rigEdit.template === 'human'),
        btn('+ Tail', () => fitTemplate(rigEdit.template === 'human' ? 'human+tail' : 'tail', 'auto'), /tail/.test(rigEdit.template))),
      '2. Fit to the pose your model stands in:',
      row(btn('Auto-detect', () => fitTemplate(rigEdit.template, 'auto')), btn('T-pose', () => fitTemplate(rigEdit.template, 'T')), btn('A-pose', () => fitTemplate(rigEdit.template, 'A'))),
      '3. Adjust: drag joints with your finger (drag empty space to turn the camera). Selected: ' + (n || 'none'),
      row(btn('Extrude bone', extrudeBone), btn('Delete bone', deleteBone), btn('Mirror left ↔ right', () => { rigEdit.mirror = !rigEdit.mirror; renderPanel('rig'); }, rigEdit.mirror)),
      row(btn('✓ Generate rig', applyRigEdit), btn('Cancel', () => endRigEdit(true))),
      rigEdit.skel.length + ' bones',
    ];
  },
  color: () => {
    if (sel?.prop) return [swatches('#' + sel.prop.material.color.getHexString(), (col) => sel.prop.material.color.set(col))];
    const c = charOf(); return c ? [swatches(c.color, (col) => { c.color = col; tint(c); })] : [];
  },
};
const TITLES = { add: 'Add', poses: 'Poses', bg: 'Background', light: 'Light', camera: 'Camera', squash: 'Squash, stretch & rubber hose', face: 'Expression', hands: 'Hands', color: 'Color', rig: 'Skeleton editor (Rigify-style)' };
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
function pickFile(kind) { pickKind = kind; const f = $('#file'); f.value = ''; f.accept = kind === 'json' ? '.json,application/json' : kind === 'model' ? '.fbx,.glb,.gltf,.obj' : 'image/*'; f.click(); }
$('#file').onchange = async (e) => {
  const file = e.target.files[0]; if (!file) return;
  if (pickKind === 'model') {
    toast('Importing ' + file.name + '…');
    try { const t = await importModel(file); pushUndo(); select({ char: await addCharacter(t) }); toast(IMPORTS[t].root.userData.autoRig ? 'Auto-rigged ' + file.name : 'Imported ' + file.name); if (openPanel === 'add') renderPanel('add'); }
    catch (err) { toast('Could not import: ' + err.message); }
  } else if (pickKind === 'json') {
    try { const st = JSON.parse(await file.text()); pushUndo(); await loadScene(st); toast('Scene imported'); } catch { toast('Not a Poseme scene file'); }
  } else {
    const url = URL.createObjectURL(file);
    new THREE.TextureLoader().load(url, (t) => { t.colorSpace = THREE.SRGBColorSpace; scene.background = t; });
  }
};
function screenshot() {
  const hidden = [tc.getHelper(), arrows, grid, ...chars.flatMap((c) => c.dots)].filter((o) => o.visible);
  hidden.forEach((o) => (o.visible = false));
  (outlines ? effect : renderer).render(scene, camera);
  const b64 = renderer.domElement.toDataURL('image/png').split(',')[1];
  hidden.forEach((o) => (o.visible = true));
  saveFile(b64, 'image/png', `poseme-${Date.now()}.png`);
}

let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toastT); toastT = setTimeout(() => (t.style.display = 'none'), 1800); }

// ---------- toolbar wiring ----------
const ACTS = {
  ik: () => { ikMode = !ikMode; document.querySelector('[data-act=ik]').classList.toggle('on', ikMode); toast(ikMode ? 'IK on: tap a hand or foot and drag it' : 'IK off: joints rotate'); if (sel?.joint) select(sel); },
  rig: () => (sel?.char ? startRigEdit(sel.char) : toast('Select a character first')),
  cel: () => toggleCel(),
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
  for (const c of chars) if (c.rig) updateTubes(c);
  (outlines ? effect : renderer).render(scene, camera);
});

// test hook for automated checks
window.poseme = { chars, props, addCharacter, applyPreset, mirror, select, sceneState, loadScene, undo, applyStretch, setHand, drawFace, renderPanel, scene, camera, orbit, THREE, IMPORTS, importModel, makeThumb, STYLES, MODELS, startRigEdit, applyRigEdit, rigState: () => rigEdit, tc, extrudeBone, deleteBone, fitTemplate, selectRigBone, solveIK, ikChainFor };

await addCharacter('poseme');
$('#loading').remove();
restoreImports();
