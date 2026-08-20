import * as THREE from "three";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "motions", "simple-generated");

const bones = [
  ["hips", null, [0, 1, 0]],
  ["spine", "hips", [0, .1, 0]],
  ["chest", "spine", [0, .16, 0]],
  ["upperChest", "chest", [0, .16, 0]],
  ["neck", "upperChest", [0, .18, 0]],
  ["head", "neck", [0, .11, 0]],
  ["leftShoulder", "upperChest", [.08, .12, 0]],
  ["leftUpperArm", "leftShoulder", [.14, 0, 0]],
  ["leftLowerArm", "leftUpperArm", [.26, 0, 0]],
  ["leftHand", "leftLowerArm", [.24, 0, 0]],
  ["leftThumbMetacarpal", "leftHand", [.025, -.015, .025]],
  ["leftThumbProximal", "leftThumbMetacarpal", [.035, 0, 0]],
  ["leftThumbDistal", "leftThumbProximal", [.028, 0, 0]],
  ["leftIndexProximal", "leftHand", [.055, .012, .025]],
  ["leftIndexIntermediate", "leftIndexProximal", [.035, 0, 0]],
  ["leftIndexDistal", "leftIndexIntermediate", [.025, 0, 0]],
  ["leftMiddleProximal", "leftHand", [.06, .006, .008]],
  ["leftMiddleIntermediate", "leftMiddleProximal", [.04, 0, 0]],
  ["leftMiddleDistal", "leftMiddleIntermediate", [.027, 0, 0]],
  ["leftRingProximal", "leftHand", [.056, 0, -.01]],
  ["leftRingIntermediate", "leftRingProximal", [.037, 0, 0]],
  ["leftRingDistal", "leftRingIntermediate", [.025, 0, 0]],
  ["leftLittleProximal", "leftHand", [.048, -.006, -.026]],
  ["leftLittleIntermediate", "leftLittleProximal", [.03, 0, 0]],
  ["leftLittleDistal", "leftLittleIntermediate", [.021, 0, 0]],
  ["rightShoulder", "upperChest", [-.08, .12, 0]],
  ["rightUpperArm", "rightShoulder", [-.14, 0, 0]],
  ["rightLowerArm", "rightUpperArm", [-.26, 0, 0]],
  ["rightHand", "rightLowerArm", [-.24, 0, 0]],
  ["rightThumbMetacarpal", "rightHand", [-.025, -.015, .025]],
  ["rightThumbProximal", "rightThumbMetacarpal", [-.035, 0, 0]],
  ["rightThumbDistal", "rightThumbProximal", [-.028, 0, 0]],
  ["rightIndexProximal", "rightHand", [-.055, .012, .025]],
  ["rightIndexIntermediate", "rightIndexProximal", [-.035, 0, 0]],
  ["rightIndexDistal", "rightIndexIntermediate", [-.025, 0, 0]],
  ["rightMiddleProximal", "rightHand", [-.06, .006, .008]],
  ["rightMiddleIntermediate", "rightMiddleProximal", [-.04, 0, 0]],
  ["rightMiddleDistal", "rightMiddleIntermediate", [-.027, 0, 0]],
  ["rightRingProximal", "rightHand", [-.056, 0, -.01]],
  ["rightRingIntermediate", "rightRingProximal", [-.037, 0, 0]],
  ["rightRingDistal", "rightRingIntermediate", [-.025, 0, 0]],
  ["rightLittleProximal", "rightHand", [-.048, -.006, -.026]],
  ["rightLittleIntermediate", "rightLittleProximal", [-.03, 0, 0]],
  ["rightLittleDistal", "rightLittleIntermediate", [-.021, 0, 0]],
  ["leftUpperLeg", "hips", [.09, -.08, 0]],
  ["leftLowerLeg", "leftUpperLeg", [0, -.42, 0]],
  ["leftFoot", "leftLowerLeg", [0, -.4, 0]],
  ["rightUpperLeg", "hips", [-.09, -.08, 0]],
  ["rightLowerLeg", "rightUpperLeg", [0, -.42, 0]],
  ["rightFoot", "rightLowerLeg", [0, -.4, 0]]
];

const basePose = {
  leftUpperArm: [0, 0, 1.08],
  rightUpperArm: [0, 0, -1.08],
  leftLowerArm: [-.1, -.38, -.06],
  rightLowerArm: [-.1, .38, .06],
  leftHand: [.05, -.08, -.06],
  rightHand: [.05, .08, .06]
};
const idleArms = {
  // 1.08rad + 15deg (0.262rad): lower both upper arms only in Idle.
  leftUpperArm: [0, 0, 1.342],
  rightUpperArm: [0, 0, -1.342]
};

const k = (time, pose = {}, hips = [0, 0, 0]) => ({ time, pose: { ...basePose, ...pose }, hips });

const motions = {
  "Idle.vrma": [
    k(0, idleArms),
    k(1, { ...idleArms, chest: [.018, .008, -.01], head: [.012, -.014, .006] }, [.008, .003, 0]),
    k(2, { ...idleArms, chest: [0, -.006, .012], head: [-.006, .012, -.008] }, [0, 0, 0]),
    k(3, { ...idleArms, chest: [-.015, .006, .008], head: [.008, .016, .006] }, [-.008, .003, 0]),
    k(4, idleArms)
  ],
  "Talk-A.vrma": [
    k(0),
    k(.4, { chest: [.025, -.025, -.02], head: [-.015, .035, -.015], leftUpperArm: [-.08, -.08, .82], leftLowerArm: [-.32, -.7, -.12], leftHand: [.1, -.16, -.16] }),
    k(.8, { chest: [-.012, .018, .016], head: [.018, -.025, .012], leftUpperArm: [-.12, -.12, .7], leftLowerArm: [-.42, -.82, -.16], leftHand: [.14, -.2, -.2] }),
    k(1.2, { chest: [.018, -.012, -.012], head: [-.01, .02, -.008], rightUpperArm: [-.08, .08, -.84], rightLowerArm: [-.3, .68, .12], rightHand: [.1, .16, .15] }),
    k(1.7, { chest: [-.01, .01, .008], head: [.012, -.018, .01], rightUpperArm: [-.12, .1, -.72], rightLowerArm: [-.4, .8, .16], rightHand: [.14, .2, .2] }),
    k(2.4)
  ],
  "Talk-B.vrma": [
    k(0),
    k(.45, { chest: [.018, .03, .018], head: [.014, -.04, .012], rightUpperArm: [-.08, .12, -.76], rightLowerArm: [-.36, .78, .14], rightHand: [.12, .22, .18] }),
    k(.9, { chest: [-.02, -.02, -.016], head: [-.018, .03, -.012], leftUpperArm: [-.1, -.12, .78], leftLowerArm: [-.38, -.76, -.14], leftHand: [.12, -.2, -.18] }),
    k(1.35, { chest: [.015, .018, -.012], head: [.012, -.02, .008], rightUpperArm: [-.14, .1, -.68], rightLowerArm: [-.46, .86, .18], rightHand: [.16, .22, .22] }),
    k(1.8, { chest: [-.012, -.015, .01], head: [-.01, .018, -.008], leftUpperArm: [-.12, -.1, .72], leftLowerArm: [-.42, -.82, -.17], leftHand: [.14, -.22, -.2] }),
    k(2.5)
  ],
  "Emphasis.vrma": [
    k(0),
    k(.35, { spine: [-.03, 0, 0], chest: [-.06, 0, 0], head: [.04, 0, 0], leftUpperArm: [-.16, -.12, .58], rightUpperArm: [-.16, .12, -.58], leftLowerArm: [-.55, -.82, -.16], rightLowerArm: [-.55, .82, .16], leftHand: [.18, -.25, -.22], rightHand: [.18, .25, .22] }, [0, -.008, .018]),
    k(.75, { spine: [.025, 0, 0], chest: [.05, 0, 0], head: [-.045, 0, 0], leftUpperArm: [-.22, -.14, .42], rightUpperArm: [-.22, .14, -.42], leftLowerArm: [-.72, -.94, -.2], rightLowerArm: [-.72, .94, .2], leftHand: [.22, -.3, -.25], rightHand: [.22, .3, .25] }, [0, .006, -.012]),
    k(1.15, { chest: [-.025, .02, 0], head: [.025, -.025, 0], leftUpperArm: [-.12, -.08, .68], rightUpperArm: [-.12, .08, -.68], leftLowerArm: [-.42, -.7, -.12], rightLowerArm: [-.42, .7, .12] }),
    k(1.8)
  ],
  "Listen.vrma": [
    k(0, { spine: [-.025, 0, 0], chest: [-.035, 0, 0], head: [.015, -.04, .025] }, [0, 0, .012]),
    k(1.2, { spine: [-.03, .008, 0], chest: [-.04, .012, 0], head: [.025, -.055, .032] }, [.004, .002, .015]),
    k(2.4, { spine: [-.025, -.006, 0], chest: [-.035, -.01, 0], head: [.01, -.03, .018] }, [-.004, 0, .012]),
    k(3.6, { spine: [-.025, 0, 0], chest: [-.035, 0, 0], head: [.015, -.04, .025] }, [0, 0, .012])
  ],
  "Nod.vrma": [
    k(0),
    k(.22, { neck: [.04, 0, 0], head: [.12, 0, 0] }),
    k(.46, { neck: [-.055, 0, 0], head: [-.2, 0, 0], chest: [-.025, 0, 0] }),
    k(.7, { neck: [.025, 0, 0], head: [.09, 0, 0], chest: [.012, 0, 0] }),
    k(.95, { neck: [-.018, 0, 0], head: [-.06, 0, 0] }),
    k(1.25)
  ],
  "Greeting.vrma": [
    k(0),
    k(.4, { chest: [0, -.03, -.018], head: [0, .035, .012], rightUpperArm: [-.2, .08, -.35], rightLowerArm: [-.7, .9, .1], rightHand: [.08, .15, .18] }),
    k(.75, { rightUpperArm: [-.28, .12, -.18], rightLowerArm: [-.9, 1.0, .12], rightHand: [.08, .12, -.35] }),
    k(1.05, { rightUpperArm: [-.28, .08, -.2], rightLowerArm: [-.9, .98, .12], rightHand: [.08, .12, .35] }),
    k(1.35, { rightUpperArm: [-.28, .12, -.18], rightLowerArm: [-.9, 1.0, .12], rightHand: [.08, .12, -.35] }),
    k(1.7, { rightUpperArm: [-.24, .08, -.32], rightLowerArm: [-.72, .88, .1], rightHand: [.08, .12, .18] }),
    k(2.3)
  ]
};

function quaternion(euler = [0, 0, 0], bone = "") {
  const corrected = [...euler];
  // VRMA source humanoid arms extend along ±X in their rest pose. Its local
  // Z direction is opposite to direct rotations on a loaded VRM normalized
  // skeleton, so invert upper-arm Z only while authoring the animation.
  if (bone === "leftUpperArm" || bone === "rightUpperArm") corrected[2] *= -1;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...corrected, "XYZ")).normalize();
  return [q.x, q.y, q.z, q.w];
}

function minMax(values, components) {
  const min = Array(components).fill(Infinity);
  const max = Array(components).fill(-Infinity);
  for (let i = 0; i < values.length; i += components) {
    for (let c = 0; c < components; c++) {
      min[c] = Math.min(min[c], values[i + c]);
      max[c] = Math.max(max[c], values[i + c]);
    }
  }
  return { min, max };
}

const boneDelay = {
  leftShoulder: .015,
  rightShoulder: .015,
  leftUpperArm: .055,
  rightUpperArm: .055,
  leftLowerArm: .115,
  rightLowerArm: .115,
  leftHand: .175,
  rightHand: .175,
  leftThumbMetacarpal: .19,
  rightThumbMetacarpal: .19,
  leftThumbProximal: .21,
  rightThumbProximal: .21,
  leftThumbDistal: .23,
  rightThumbDistal: .23,
  leftIndexProximal: .2,
  rightIndexProximal: .2,
  leftIndexIntermediate: .22,
  rightIndexIntermediate: .22,
  leftIndexDistal: .24,
  rightIndexDistal: .24,
  leftMiddleProximal: .2,
  rightMiddleProximal: .2,
  leftMiddleIntermediate: .22,
  rightMiddleIntermediate: .22,
  leftMiddleDistal: .24,
  rightMiddleDistal: .24,
  leftRingProximal: .2,
  rightRingProximal: .2,
  leftRingIntermediate: .22,
  rightRingIntermediate: .22,
  leftRingDistal: .24,
  rightRingDistal: .24,
  leftLittleProximal: .2,
  rightLittleProximal: .2,
  leftLittleIntermediate: .22,
  rightLittleIntermediate: .22,
  leftLittleDistal: .24,
  rightLittleDistal: .24,
  chest: .025,
  upperChest: .04,
  neck: .055,
  head: .075
};

function smoothstep(value) {
  return value * value * (3 - 2 * value);
}

function sampleValues(keyframes, time, getter) {
  if (time <= keyframes[0].time) return [...getter(keyframes[0])];
  const last = keyframes[keyframes.length - 1];
  if (time >= last.time) return [...getter(last)];
  let right = 1;
  while (keyframes[right].time < time) right++;
  const a = keyframes[right - 1];
  const b = keyframes[right];
  const blend = smoothstep((time - a.time) / (b.time - a.time));
  const from = getter(a);
  const to = getter(b);
  return from.map((value, index) => THREE.MathUtils.lerp(value, to[index], blend));
}

function resampleMotion(keyframes, fps = 30) {
  const duration = keyframes[keyframes.length - 1].time;
  const frameCount = Math.max(2, Math.round(duration * fps));
  return Array.from({ length: frameCount + 1 }, (_, index) => {
    const time = duration * index / frameCount;
    const endpointFade = Math.sin(Math.PI * time / duration);
    const pose = {};
    for (const [bone] of bones) {
      // Distal joints follow later than proximal joints. The delay fades to
      // zero at clip boundaries so looping and one-shot returns stay seamless.
      const sourceTime = THREE.MathUtils.clamp(
        time - (boneDelay[bone] || 0) * endpointFade,
        0,
        duration
      );
      pose[bone] = sampleValues(keyframes, sourceTime, (frame) => frame.pose[bone] || [0, 0, 0]);
    }
    const hips = sampleValues(keyframes, time, (frame) => frame.hips);
    return { time, pose, hips };
  });
}

function fingerRotations(leftCurl, rightCurl) {
  const pose = {};
  for (const side of ["left", "right"]) {
    const curl = side === "left" ? leftCurl : rightCurl;
    const sign = side === "left" ? -1 : 1;
    pose[`${side}ThumbMetacarpal`] = [0, sign * curl * .18, sign * curl * .42];
    pose[`${side}ThumbProximal`] = [0, 0, sign * curl * .55];
    pose[`${side}ThumbDistal`] = [0, 0, sign * curl * .42];
    for (const finger of ["Index", "Middle", "Ring", "Little"]) {
      const weight = finger === "Index" ? .88 : finger === "Middle" ? 1 : finger === "Ring" ? 1.06 : 1.12;
      pose[`${side}${finger}Proximal`] = [0, 0, sign * curl * .72 * weight];
      pose[`${side}${finger}Intermediate`] = [0, 0, sign * curl * .9 * weight];
      pose[`${side}${finger}Distal`] = [0, 0, sign * curl * .58 * weight];
    }
  }
  return pose;
}

function addFingerMotion(frames, name) {
  const duration = frames[frames.length - 1].time;
  for (const frame of frames) {
    const phase = frame.time / duration;
    let left = .22;
    let right = .22;
    if (name === "Idle") {
      left = .2 + Math.sin(phase * Math.PI * 2) * .035;
      right = .21 + Math.sin(phase * Math.PI * 2 + .8) * .03;
    } else if (name === "Talk-A") {
      left = .28 + Math.sin(phase * Math.PI * 4) * .18;
      right = .2 + Math.sin(phase * Math.PI * 4 + 1.7) * .08;
    } else if (name === "Talk-B") {
      left = .2 + Math.sin(phase * Math.PI * 4 + 1.4) * .08;
      right = .28 + Math.sin(phase * Math.PI * 4) * .18;
    } else if (name === "Emphasis") {
      const open = Math.sin(phase * Math.PI);
      left = right = .24 - open * .2;
    } else if (name === "Listen") {
      left = .25 + Math.sin(phase * Math.PI * 2) * .025;
      right = .24 + Math.sin(phase * Math.PI * 2 + .9) * .02;
    } else if (name === "Greeting") {
      left = .22;
      right = .04 + (1 - Math.sin(phase * Math.PI)) * .08;
    }
    Object.assign(frame.pose, fingerRotations(
      THREE.MathUtils.clamp(left, .02, .55),
      THREE.MathUtils.clamp(right, .02, .55)
    ));
  }
  return frames;
}

function createVRMA(keyframes, name) {
  keyframes = addFingerMotion(resampleMotion(keyframes), name);
  const nodes = bones.map(([bone, , translation]) => ({ name: bone, translation }));
  const nodeIndex = Object.fromEntries(bones.map(([bone], index) => [bone, index]));
  bones.forEach(([bone, parent], index) => {
    if (parent) (nodes[nodeIndex[parent]].children ||= []).push(index);
  });

  const chunks = [];
  const bufferViews = [];
  const accessors = [];
  let byteOffset = 0;
  function addAccessor(values, type, components) {
    const data = Buffer.from(new Float32Array(values).buffer);
    const padding = (4 - (byteOffset % 4)) % 4;
    if (padding) { chunks.push(Buffer.alloc(padding)); byteOffset += padding; }
    const view = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset, byteLength: data.length });
    chunks.push(data);
    byteOffset += data.length;
    const accessor = accessors.length;
    accessors.push({ bufferView: view, componentType: 5126, count: values.length / components, type, ...minMax(values, components) });
    return accessor;
  }

  const times = keyframes.map((frame) => frame.time);
  const timeAccessor = addAccessor(times, "SCALAR", 1);
  const samplers = [];
  const channels = [];
  for (const [bone] of bones) {
    const values = keyframes.flatMap((frame) => quaternion(frame.pose[bone], bone));
    const output = addAccessor(values, "VEC4", 4);
    const sampler = samplers.length;
    samplers.push({ input: timeAccessor, output, interpolation: "LINEAR" });
    channels.push({ sampler, target: { node: nodeIndex[bone], path: "rotation" } });
  }
  const hipValues = keyframes.flatMap((frame) => {
    const base = bones[nodeIndex.hips][2];
    return base.map((value, i) => value + frame.hips[i]);
  });
  const hipOutput = addAccessor(hipValues, "VEC3", 3);
  samplers.push({ input: timeAccessor, output: hipOutput, interpolation: "LINEAR" });
  channels.push({ sampler: samplers.length - 1, target: { node: nodeIndex.hips, path: "translation" } });

  const binary = Buffer.concat(chunks);
  const json = {
    asset: { version: "2.0", generator: "NEON Simple VRMA Generator 1.0" },
    extensionsUsed: ["VRMC_vrm_animation"],
    extensions: {
      VRMC_vrm_animation: {
        specVersion: "1.0",
        humanoid: { humanBones: Object.fromEntries(bones.map(([bone]) => [bone, { node: nodeIndex[bone] }])) }
      }
    },
    scene: 0,
    scenes: [{ nodes: [nodeIndex.hips] }],
    nodes,
    buffers: [{ byteLength: binary.length }],
    bufferViews,
    accessors,
    animations: [{ name, samplers, channels }]
  };
  let jsonData = Buffer.from(JSON.stringify(json), "utf8");
  jsonData = Buffer.concat([jsonData, Buffer.alloc((4 - jsonData.length % 4) % 4, 0x20)]);
  const binData = Buffer.concat([binary, Buffer.alloc((4 - binary.length % 4) % 4)]);
  const totalLength = 12 + 8 + jsonData.length + 8 + binData.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonData.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binData.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, jsonData, binHeader, binData]);
}

await mkdir(OUTPUT, { recursive: true });
for (const [filename, frames] of Object.entries(motions)) {
  await writeFile(path.join(OUTPUT, filename), createVRMA(frames, path.basename(filename, ".vrma")));
  console.log(`Generated ${filename}`);
}
console.log(`Output: ${OUTPUT}`);
