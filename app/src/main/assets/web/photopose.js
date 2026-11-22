import * as THREE from 'three';

let landmarker;
export async function detectPose(img) {
  try {
    if (!landmarker) {
      const { FilesetResolver, PoseLandmarker } = await import('./lib/mediapipe/vision_bundle.mjs');
      const fileset = await FilesetResolver.forVisionTasks('./lib/mediapipe/wasm');
      const make = (delegate) => PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: './models/pose_landmarker_lite.task', delegate }, runningMode: 'IMAGE', numPoses: 1 });
      landmarker = await make('GPU').catch(() => make('CPU'));
    }
  } catch (e) { throw new Error('Pose model failed to load: ' + (e.message || e)); }
  return landmarker.detect(img).worldLandmarks[0] ?? null;
}

const P = (lm, i) => new THREE.Vector3(lm[i].x, -lm[i].y, -lm[i].z); // flip y (MP y is down) and z (MP z toward camera is negative); x kept: person's left = image right = character +X (L), no mirror
const mid = (a, b) => a.clone().add(b).multiplyScalar(0.5);
const wpos = (o) => o.getWorldPosition(new THREE.Vector3());

export function applyLandmarks(c, lm) {
  const J = c.joints, g = c.group, gq = g.getWorldQuaternion(new THREE.Quaternion());
  for (const b of Object.values(J)) b.quaternion.copy(b.userData.rest ?? new THREE.Quaternion());
  g.updateMatrixWorld(true);
  // rotate bone so world direction `cur` becomes `want` (like aimBone in main.js)
  const aim = (bone, cur, want) => {
    const q = new THREE.Quaternion().setFromUnitVectors(cur.clone().normalize(), want.clone().applyQuaternion(gq).normalize());
    const wq = bone.getWorldQuaternion(new THREE.Quaternion()), pq = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    bone.quaternion.copy(pq.multiply(q.multiply(wq)));
    g.updateMatrixWorld(true);
  };
  const toChild = (a, b, want) => { if (J[a] && J[b]) aim(J[a], wpos(J[b]).sub(wpos(J[a])), want); };
  const p = (i) => P(lm, i), sub = (a, b) => a.clone().sub(b);
  const hipM = mid(p(23), p(24)), shM = mid(p(11), p(12)), earM = mid(p(7), p(8));
  const torso = sub(shM, hipM);

  if (J.hips && J.hipL && J.hipR) aim(J.hips, wpos(J.hipL).sub(wpos(J.hipR)), sub(p(23), p(24)));
  toChild('spine', 'chest', torso);
  toChild('chest', 'neck', torso);
  toChild('neck', 'head', sub(earM, shM));
  if (J.head) aim(J.head, new THREE.Vector3(0, 0, 1), sub(p(0), earM)); // head faces nose direction
  for (const [s, sh, el, wr, hp, kn, an] of [['L', 11, 13, 15, 23, 25, 27], ['R', 12, 14, 16, 24, 26, 28]]) {
    toChild('shoulder' + s, 'elbow' + s, sub(p(el), p(sh)));
    toChild('elbow' + s, 'wrist' + s, sub(p(wr), p(el)));
    toChild('hip' + s, 'knee' + s, sub(p(kn), p(hp)));
    toChild('knee' + s, 'ankle' + s, sub(p(an), p(kn)));
  }
  return true;
}
