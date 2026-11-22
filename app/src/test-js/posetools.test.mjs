import test from 'node:test';
import assert from 'node:assert/strict';
import * as t from '../main/assets/web/posetools.js';

const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} !~ ${b}`);
const rotAbout = (axis, deg) => { const h = deg * Math.PI / 360; return [...axis.map(v => v * Math.sin(h)), Math.cos(h)]; };
const angleOf = q => 2 * Math.acos(Math.min(1, Math.abs(q[3]))) * 180 / Math.PI;

test('classifyCurve', () => {
  assert.equal(t.classifyCurve([[0, 0], [0, 5], [0, 10]]).kind, 'straight');
  const c = t.classifyCurve([[0, 0], [2, 5], [0, 10]]);
  assert.equal(c.kind, 'C'); near(c.bend, 0.2);
  assert.equal(t.classifyCurve([[0, 0], [2, 3], [-2, 7], [0, 10]]).kind, 'S');
});

test('pushRotation', () => {
  const rest = rotAbout([0, 1, 0], 10), cur = qMulY(rest, 40);
  function qMulY(r, deg) { return t.qMul(r, rotAbout([0, 1, 0], deg)); }
  const same = (a, b) => near(Math.abs(a.reduce((s, v, i) => s + v * b[i], 0)), 1);
  same(t.pushRotation(rest, cur, 0), rest);
  same(t.pushRotation(rest, cur, 1), cur);
  near(angleOf(t.qMul(t.qInv(rest), t.pushRotation(rest, cur, 1.5))), 60, 1e-4);
});

test('twins', () => {
  assert.ok(t.twins([1, 0, 0], [-1, 0.05, 0]));
  assert.ok(!t.twins([1, 0, 0], [1, 0, 0]));
  assert.ok(t.limbTwins([1, 0, 0], [0, -1, 0], [-1, 0, 0], [0, -1, 0]));
  assert.ok(!t.limbTwins([1, 0, 0], [0, -1, 0], [-1, 0, 0], [1, 0, 0]));
});

test('tilt and weight shift', () => {
  near(t.tiltDeg([0, 0], [10, 10]), 45);
  assert.ok(t.noWeightShift([0, 0], [10, 0.1], [0, 0], [10, 0]));
  assert.ok(!t.noWeightShift([0, 0], [10, 2], [0, 0], [10, 0]));
});

test('hiddenArm', () => {
  const body = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.ok(t.hiddenArm([[2, 2], [5, 5]], body));
  assert.ok(!t.hiddenArm([[2, 2], [15, 5]], body));
});

test('smoothCurve + checkPose', () => {
  assert.ok(t.smoothCurve([[0, 0], [1, 1], [2, 0]], 24).length >= 24);
  const L = { upper: [1, 0, 0], lower: [0, -1, 0] }, R = { upper: [-1, 0, 0], lower: [0, -1, 0] };
  const ids = t.checkPose({ lineKind: 'straight', armsL: L, armsR: R, legsL: L, legsR: R,
    hipL: [0, 0], hipR: [10, 0], shL: [0, 0], shR: [10, 0],
    armPts2D: { L: [[1, 1]], R: [[1, 1]] }, torso2D: [[0, 0], [10, 0], [10, 10], [0, 10]] }).map(x => x.id);
  assert.deepEqual(ids, ['twins', 'straight', 'level', 'hidden']);
});
