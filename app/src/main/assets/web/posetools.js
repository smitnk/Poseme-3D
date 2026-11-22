// Pure pose-analysis helpers. No dependencies; quaternions are [x,y,z,w], points are plain arrays.
export const STRAIGHT_MAX = 0.04; // max normalized bend below this = straight line
export const S_SIDE_MIN = 0.03;   // bend needed on BOTH sides of the chord for an S curve
export const TWIN_DEG = 10;
export const LEVEL_DEG = 3;

/** Line of action: pts [[x,y],...] (>=3). Returns {kind:'straight'|'C'|'S', bend}. */
export function classifyCurve(pts) {
  const a = pts[0], b = pts[pts.length - 1];
  const cx = b[0] - a[0], cy = b[1] - a[1], len = Math.hypot(cx, cy) || 1;
  const d = pts.slice(1, -1).map(p => (cx * (p[1] - a[1]) - cy * (p[0] - a[0])) / (len * len));
  const bend = Math.max(0, ...d.map(Math.abs));
  if (bend < STRAIGHT_MAX) return { kind: 'straight', bend };
  const s = d.some(v => v > S_SIDE_MIN) && d.some(v => v < -S_SIDE_MIN);
  return { kind: s ? 'S' : 'C', bend };
}

/** Catmull-Rom through pts; returns about n+ points for drawing. */
export function smoothCurve(pts, n = 24) {
  const segs = pts.length - 1, steps = Math.ceil(n / segs), out = [];
  const at = i => pts[Math.max(0, Math.min(pts.length - 1, i))];
  for (let i = 0; i < segs; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      out.push(p1.map((_, k) => 0.5 * (2 * p1[k] + (p2[k] - p0[k]) * t +
        (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * t3)));
    }
  }
  out.push(pts[pts.length - 1].slice());
  return out;
}

export const qMul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
export const qInv = q => [-q[0], -q[1], -q[2], q[3]]; // unit quaternions only

export function qSlerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (d < 0) { b = b.map(v => -v); d = -d; }
  if (d > 0.9995) { const l = a.map((v, i) => v + t * (b[i] - v)), n = Math.hypot(...l); return l.map(v => v / n); }
  const th = Math.acos(d), sa = Math.sin((1 - t) * th) / Math.sin(th), sb = Math.sin(t * th) / Math.sin(th);
  return a.map((v, i) => v * sa + b[i] * sb);
}

/** rest * pow(inv(rest)*cur, k), k in [0,1.5]; k=0 -> rest, k=1 -> cur, shortest path. */
export function pushRotation(rest, cur, k) {
  let d = qMul(qInv(rest), cur);
  if (d[3] < 0) d = d.map(v => -v);
  const half = Math.acos(Math.min(1, d[3])), s = Math.sin(half);
  if (s < 1e-9) return rest.slice();
  const h = half * Math.max(0, Math.min(1.5, k)), f = Math.sin(h) / s;
  return qMul(rest, [d[0] * f, d[1] * f, d[2] * f, Math.cos(h)]);
}

/** Angle between 3D vectors, degrees. */
export function angleDeg(a, b) {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const c = dot / ((Math.hypot(...a) * Math.hypot(...b)) || 1);
  return Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI;
}

/** True when the right direction mirrored across X matches the left one. */
export const twins = (leftDir, rightDir) => angleDeg(leftDir, [-rightDir[0], rightDir[1], rightDir[2]]) < TWIN_DEG;
export const limbTwins = (lUpper, lLower, rUpper, rLower) => twins(lUpper, rUpper) && twins(lLower, rLower);

/** Tilt of line pL->pR from horizontal, degrees 0..90 (uses x,y only). */
export const tiltDeg = (pL, pR) => Math.atan2(Math.abs(pR[1] - pL[1]), Math.abs(pR[0] - pL[0])) * 180 / Math.PI;
export const noWeightShift = (hipL, hipR, shL, shR) => tiltDeg(hipL, hipR) < LEVEL_DEG && tiltDeg(shL, shR) < LEVEL_DEG;

export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Andrew monotone chain, returns hull vertices. */
export function convexHull(pts) {
  const s = pts.map(p => p.slice()).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (s.length < 3) return s;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = list => {
    const h = [];
    for (const p of list) { while (h.length > 1 && cr(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop(); h.push(p); }
    h.pop(); return h;
  };
  return half(s).concat(half(s.slice().reverse()));
}

export const hiddenArm = (armPts, bodyPts) => {
  const hull = convexHull(bodyPts);
  return armPts.every(p => pointInPolygon(p, hull));
};

/**
 * checkPose input:
 *  lineKind: 'straight'|'C'|'S' (from classifyCurve)
 *  armsL, armsR, legsL, legsR: {upper:[x,y,z], lower:[x,y,z]} segment direction vectors
 *  hipL, hipR, shL, shR: [x,y] screen positions
 *  armPts2D: {L:[[x,y]..], R:[[x,y]..]} shoulder->wrist points; torso2D: [[x,y]..] body outline points
 * Returns [{id,title,tip}] of problems found.
 */
export function checkPose(o) {
  const out = [], add = (id, title, tip) => out.push({ id, title, tip });
  const lt = (l, r) => limbTwins(l.upper, l.lower, r.upper, r.lower);
  if (lt(o.armsL, o.armsR) || lt(o.legsL, o.legsR)) add('twins', 'Twins', 'Change one arm or leg so the sides do different things.');
  if (o.lineKind === 'straight') add('straight', 'Straight spine', 'Bend the body into a C curve to add energy.');
  if (noWeightShift(o.hipL, o.hipR, o.shL, o.shR)) add('level', 'No weight shift', 'Tilt the hips one way and the shoulders the other way.');
  if (hiddenArm(o.armPts2D.L, o.torso2D) || hiddenArm(o.armPts2D.R, o.torso2D)) add('hidden', 'Hidden arm', 'Move the arm away from the body so it shows in the silhouette.');
  return out;
}
