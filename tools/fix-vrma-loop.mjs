import fs from "node:fs";
import path from "node:path";
import { Quaternion } from "three";

const componentCounts = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const [, , inputName, outputName, windowArgument] = process.argv;
if (!inputName || !outputName) {
  console.error("Usage: node tools/fix-vrma-loop.mjs <input.vrma> <output.vrma> [windowSeconds]");
  process.exit(1);
}
const blendSeconds = Number(windowArgument) || .9;

const source = fs.readFileSync(inputName);
const output = Buffer.from(source);
let chunkOffset = 12;
let gltf;
let binaryOffset = -1;
while (chunkOffset < output.length) {
  const length = output.readUInt32LE(chunkOffset);
  const type = output.toString("ascii", chunkOffset + 4, chunkOffset + 8);
  if (type === "JSON") {
    gltf = JSON.parse(
      output.subarray(chunkOffset + 8, chunkOffset + 8 + length)
        .toString("utf8")
        .replace(/\0+$/g, "")
    );
  }
  if (type === "BIN\0") binaryOffset = chunkOffset + 8;
  chunkOffset += 8 + length;
}
if (!gltf || binaryOffset < 0) throw new Error("有効なGLBではありません");

function accessorLayout(index) {
  const accessor = gltf.accessors[index];
  const view = gltf.bufferViews[accessor.bufferView];
  if (accessor.componentType !== 5126) throw new Error("FLOAT以外のAccessorには未対応");
  const size = componentCounts[accessor.type];
  return {
    accessor,
    size,
    stride: view.byteStride || size * 4,
    start: binaryOffset + (view.byteOffset || 0) + (accessor.byteOffset || 0)
  };
}

function readAccessor(index) {
  const layout = accessorLayout(index);
  const rows = [];
  for (let row = 0; row < layout.accessor.count; row += 1) {
    const values = [];
    for (let component = 0; component < layout.size; component += 1) {
      values.push(output.readFloatLE(layout.start + row * layout.stride + component * 4));
    }
    rows.push(values);
  }
  return rows;
}

function writeAccessor(index, rows) {
  const layout = accessorLayout(index);
  for (let row = 0; row < rows.length; row += 1) {
    for (let component = 0; component < layout.size; component += 1) {
      output.writeFloatLE(rows[row][component], layout.start + row * layout.stride + component * 4);
    }
  }
}

function normalize(values) {
  const length = Math.hypot(...values) || 1;
  return values.map((value) => value / length);
}

function dot(a, b) {
  return a.reduce((sum, value, index) => sum + value * b[index], 0);
}

function derivative(values, times, index) {
  const before = Math.max(0, index - 1);
  const after = Math.min(values.length - 1, index + 1);
  const duration = Math.max(1e-6, times[after][0] - times[before][0]);
  return values[index].map((_, component) =>
    (values[after][component] - values[before][component]) / duration
  );
}

function hermite(p0, m0, p1, m1, x, duration) {
  const x2 = x * x;
  const x3 = x2 * x;
  const h00 = 2 * x3 - 3 * x2 + 1;
  const h10 = x3 - 2 * x2 + x;
  const h01 = -2 * x3 + 3 * x2;
  const h11 = x3 - x2;
  return p0.map((value, component) =>
    h00 * value +
    h10 * m0[component] * duration +
    h01 * p1[component] +
    h11 * m1[component] * duration
  );
}

const animation = gltf.animations?.[0];
if (!animation) throw new Error("Animationがありません");
let modifiedTracks = 0;

for (const channel of animation.channels) {
  const sampler = animation.samplers[channel.sampler];
  const times = readAccessor(sampler.input);
  const values = readAccessor(sampler.output);
  if (times.length < 4 || values.length !== times.length) continue;
  const isQuaternion = channel.target.path === "rotation" && values[0].length === 4;

  if (isQuaternion) {
    for (let index = 1; index < values.length; index += 1) {
      if (dot(values[index - 1], values[index]) < 0) {
        values[index] = values[index].map((value) => -value);
      }
    }
  }

  const duration = times.at(-1)[0];
  const window = Math.min(blendSeconds, duration * .2);
  if (!(window > .05)) continue;
  let startEnd = 1;
  while (startEnd + 1 < times.length && times[startEnd + 1][0] <= window) startEnd += 1;
  let endStart = times.length - 2;
  while (endStart - 1 > 0 && times[endStart - 1][0] >= duration - window) endStart -= 1;

  let seam = values[0].map((value, component) => (value + values.at(-1)[component]) * .5);
  if (isQuaternion) seam = normalize(seam);
  const startVelocity = derivative(values, times, 0);
  const endVelocity = derivative(values, times, values.length - 1);
  const seamVelocity = startVelocity.map(
    (value, component) => (value + endVelocity[component]) * .5
  );

  const startAnchor = [...values[startEnd]];
  const startAnchorVelocity = derivative(values, times, startEnd);
  const startDuration = times[startEnd][0];
  for (let index = 0; index <= startEnd; index += 1) {
    const x = times[index][0] / Math.max(1e-6, startDuration);
    values[index] = hermite(
      seam, seamVelocity, startAnchor, startAnchorVelocity, x, startDuration
    );
    if (isQuaternion) values[index] = normalize(values[index]);
  }

  const endAnchor = [...values[endStart]];
  const endAnchorVelocity = derivative(values, times, endStart);
  const endDuration = duration - times[endStart][0];
  for (let index = endStart; index < values.length; index += 1) {
    const x = (times[index][0] - times[endStart][0]) / Math.max(1e-6, endDuration);
    values[index] = hermite(
      endAnchor, endAnchorVelocity, seam, seamVelocity, x, endDuration
    );
    if (isQuaternion) values[index] = normalize(values[index]);
  }

  values[0] = [...seam];
  values[values.length - 1] = [...seam];
  const firstGap = Math.max(1e-6, times[1][0] - times[0][0]);
  const lastGap = Math.max(1e-6, times.at(-1)[0] - times.at(-2)[0]);
  if (isQuaternion) {
    const seamQuaternion = new Quaternion().fromArray(seam).normalize();
    const nextQuaternion = new Quaternion().fromArray(values[1]).normalize();
    const forwardDelta = seamQuaternion.clone().invert().multiply(nextQuaternion).normalize();
    if (forwardDelta.w < 0) {
      forwardDelta.x *= -1;
      forwardDelta.y *= -1;
      forwardDelta.z *= -1;
      forwardDelta.w *= -1;
    }
    const previousDelta = new Quaternion().identity()
      .slerp(forwardDelta.clone().invert(), lastGap / firstGap)
      .normalize();
    values[1] = nextQuaternion.toArray();
    values[values.length - 2] = seamQuaternion.clone()
      .multiply(previousDelta)
      .normalize()
      .toArray();
  } else {
    const sharedTangent = seam.map((value, component) => {
      const forward = (values[1][component] - value) / firstGap;
      const backward = (value - values.at(-2)[component]) / lastGap;
      return (forward + backward) * .5;
    });
    values[1] = seam.map(
      (value, component) => value + sharedTangent[component] * firstGap
    );
    values[values.length - 2] = seam.map(
      (value, component) => value - sharedTangent[component] * lastGap
    );
  }
  writeAccessor(sampler.output, values);
  modifiedTracks += 1;
}

fs.mkdirSync(path.dirname(path.resolve(outputName)), { recursive: true });
fs.writeFileSync(outputName, output);
console.log(`Created ${outputName}`);
console.log(`Modified tracks: ${modifiedTracks}, blend window: ${blendSeconds.toFixed(2)}s`);
