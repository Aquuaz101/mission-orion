import * as THREE from 'three';

/**
 * Perseverance's robotic arm, driven joint by joint.
 *
 * NASA's model ships the arm motion as ~10 separate clips of different lengths. Played through
 * an AnimationMixer the short ones loop while the long ones run, so the arm appears to repeat
 * and jump. Here the keyframe tracks are sampled directly (clamped, never looping) for the
 * stow ↔ deploy motion, and the reach to a rock is solved with a small inverse-kinematics
 * search over the real joints (shoulder azimuth, shoulder elevation, elbow, wrist).
 */
const JOINTS: [string, 'x' | 'y' | 'z'][] = [
  ['arm003', 'y'], // shoulder azimuth
  ['arm002', 'z'], // shoulder elevation
  ['arm', 'z'],    // elbow
  ['arm004', 'z'], // wrist
];
const CLIPS = /^(arm\.00[234]Action|armAction|turret_objAction|arm_0[12]_pivotAction)$/;
/** Clip time at which the launch restraints are released and the arm starts to unfold. */
const T_RELEASED = 3.79;
/** Clip time at which the arm is fully deployed. */
export const T_DEPLOYED = 6.25;

const AXIS = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

export class RoverArm {
  readonly turret: THREE.Object3D;
  readonly shoulder: THREE.Object3D;
  /** Every node this rig animates (kept out of static-mesh merging). */
  readonly nodes: THREE.Object3D[] = [];
  /** 0 = stowed, 1 = deployed. */
  deploy = 0;
  /** Extra joint angles (rad) on top of the deployed pose, scaled by `reach` (0..1). */
  reachPose = [0, 0, 0, 0];
  reach = 0;
  /** Turret (drill) spin in radians. */
  spin = 0;

  private tracks: { node: THREE.Object3D; interp: THREE.Interpolant; t0: number; t1: number; rest: THREE.Quaternion }[] = [];
  private joints: { node: THREE.Object3D; axis: THREE.Vector3 }[] = [];
  private q = new THREE.Quaternion();

  static create(model: THREE.Object3D, clips: THREE.AnimationClip[]): RoverArm | null {
    const turret = model.getObjectByName('turret_obj');
    const joints = JOINTS.map(([n]) => model.getObjectByName(n));
    if (!turret || joints.some((j) => !j)) return null;
    return new RoverArm(model, clips, turret, joints as THREE.Object3D[]);
  }

  private constructor(private model: THREE.Object3D, clips: THREE.AnimationClip[], turret: THREE.Object3D, joints: THREE.Object3D[]) {
    this.turret = turret;
    this.shoulder = joints[0];
    this.joints = joints.map((node, i) => ({ node, axis: AXIS[JOINTS[i][1]] }));
    for (const clip of clips) {
      if (!CLIPS.test(clip.name)) continue;
      for (const tr of clip.tracks) {
        if (!tr.name.endsWith('.quaternion') || tr.times.length < 2) continue;
        const node = model.getObjectByName(THREE.PropertyBinding.parseTrackName(tr.name).nodeName);
        if (!node) continue;
        const interp = (tr as unknown as { createInterpolant(result: Float32Array): THREE.Interpolant }).createInterpolant(new Float32Array(4));
        this.tracks.push({ node, interp, t0: tr.times[0], t1: tr.times[tr.times.length - 1], rest: node.quaternion.clone() });
        this.nodes.push(node);
      }
    }
    for (const j of joints) if (!this.nodes.includes(j)) this.nodes.push(j);
    if (!this.nodes.includes(turret)) this.nodes.push(turret);
  }

  /** Map deploy 0..1 to clip time: restraints release quickly, then the arm unfolds. */
  private clipTime() {
    const d = THREE.MathUtils.clamp(this.deploy, 0, 1);
    return d < 0.2 ? (d / 0.2) * T_RELEASED : T_RELEASED + ((d - 0.2) / 0.8) * (T_DEPLOYED - T_RELEASED);
  }

  /** Write the current pose to the model. Call once per frame (or after changing any input). */
  apply(reachOverride?: number[]) {
    const t = this.clipTime();
    for (const tr of this.tracks) {
      const v = tr.interp.evaluate(THREE.MathUtils.clamp(t, tr.t0, tr.t1)) as ArrayLike<number>;
      tr.node.quaternion.set(v[0], v[1], v[2], v[3]);
    }
    const pose = reachOverride ?? this.reachPose;
    const k = reachOverride ? 1 : this.reach;
    if (k > 0) {
      this.joints.forEach((j, i) => {
        if (pose[i]) j.node.quaternion.multiply(this.q.setFromAxisAngle(j.axis, pose[i] * k));
      });
    }
    if (this.spin) this.turret.quaternion.multiply(this.q.setFromAxisAngle(AXIS.y, this.spin));
  }

  /** Turret position in model space for the current node quaternions. */
  private tip(out: THREE.Vector3) {
    this.shoulder.updateWorldMatrix(false, true);
    return this.model.worldToLocal(this.turret.getWorldPosition(out));
  }
  private jointPos(i: number, out: THREE.Vector3) {
    return this.model.worldToLocal(this.joints[i].node.getWorldPosition(out));
  }

  /**
   * Inverse kinematics: find joint offsets (from the deployed pose) that bring the turret to
   * `target` (model space). Coordinate descent with a shrinking step; keeps the elbow and
   * wrist above the ground. Returns the pose and the remaining distance in metres.
   */
  solve(target: THREE.Vector3): { pose: number[]; error: number } {
    const saved = { deploy: this.deploy, reach: this.reach, spin: this.spin };
    this.deploy = 1;
    this.spin = 0;
    this.model.updateWorldMatrix(true, false);
    const tip = new THREE.Vector3(), jp = new THREE.Vector3();
    const cost = (p: number[]) => {
      this.apply(p);
      let c = this.tip(tip).distanceToSquared(target);
      for (const i of [2, 3]) {
        const low = 0.42 - this.jointPos(i, jp).y; // elbow / wrist clearance
        if (low > 0) c += low * low * 4;
      }
      return c + 0.0015 * (p[0] * p[0] + p[1] * p[1] + p[2] * p[2] + p[3] * p[3]);
    };
    // A single descent can stall in a local minimum, so start from several elbow-up poses
    // (the family that reaches the ground in front of the rover) and keep the best result.
    const seeds = [[0, 0.45, 2.0, 0.6], [0, 0.8, 1.7, 0.65], [0, 0.2, 2.3, 0.45], [-0.5, 0.45, 2.0, 0.6], [0.5, 0.45, 2.0, 0.6], [0, 0, 0, 0]];
    let pose = seeds[0], bestCost = Infinity;
    for (const seed of seeds) {
      const p = seed.slice();
      let best = cost(p), step = 0.4;
      for (let it = 0; it < 90 && step > 0.002; it++) {
        let improved = false;
        for (let j = 0; j < 4; j++) {
          for (const dir of [1, -1]) {
            const trial = p.slice();
            trial[j] = THREE.MathUtils.clamp(trial[j] + dir * step, -2.6, 2.6);
            const c = cost(trial);
            if (c < best - 1e-7) { best = c; p[j] = trial[j]; improved = true; break; }
          }
        }
        if (!improved) step *= 0.5;
      }
      if (best < bestCost) { bestCost = best; pose = p; }
      if (bestCost < 0.012) break; // within a centimetre or so: good enough
    }
    this.apply(pose);
    const error = this.tip(tip).distanceTo(target);
    Object.assign(this, saved);
    this.apply();
    return { pose, error };
  }

  /** Put the model back exactly as it was loaded (the GLB is shared between mission runs). */
  restore() {
    for (const tr of this.tracks) tr.node.quaternion.copy(tr.rest);
  }
}
