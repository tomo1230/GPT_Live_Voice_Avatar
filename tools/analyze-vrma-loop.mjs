import fs from "node:fs";
import path from "node:path";

const componentCounts = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function parseGlb(filename) {
  const buffer = fs.readFileSync(filename);
  if (buffer.toString("utf8", 0, 4) !== "glTF") throw new Error("GLBではありません");
  let offset = 12;
  let json;
  let binary;
  while (offset < buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "JSON") json = JSON.parse(data.toString("utf8").replace(/\0+$/g, ""));
    if (type === "BIN\0") binary = data;
    offset += 8 + length;
  }
  if (!json || !binary) throw new Error("JSONまたはBINチャンクがありません");
  return { json, binary };
}

function readAccessor(gltf, binary, index) {
  const accessor = gltf.accessors[index];
  const view = gltf.bufferViews[accessor.bufferView];
  if (accessor.componentType !== 5126) throw new Error("FLOAT以外のAccessorには未対応");
  const size = componentCounts[accessor.type];
  const stride = view.byteStride || size * 4;
  const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const rows = [];
  for (let row = 0; row < accessor.count; row += 1) {
    const values = [];
    for (let component = 0; component < size; component += 1) {
      values.push(binary.readFloatLE(start + row * stride + component * 4));
    }
    rows.push(values);
  }
  return rows;
}

function distance(a, b) {
  return Math.hypot(...a.map((value, index) => value - b[index]));
}

function quaternionAngle(a, b) {
  const lengthA = Math.hypot(...a) || 1;
  const lengthB = Math.hypot(...b) || 1;
  const normalizedDot = a.reduce(
    (sum, value, index) => sum + (value / lengthA) * (b[index] / lengthB),
    0
  );
  return 2 * Math.acos(Math.min(1, Math.abs(normalizedDot)));
}

function analyze(filename) {
  const { json, binary } = parseGlb(filename);
  const animation = json.animations?.[0];
  if (!animation) throw new Error("Animationがありません");
  const humanBones = json.extensions?.VRMC_vrm_animation?.humanoid?.humanBones || {};
  const boneByNode = new Map(
    Object.entries(humanBones).map(([bone, data]) => [data.node, bone])
  );
  const rows = [];
  for (const channel of animation.channels) {
    const sampler = animation.samplers[channel.sampler];
    const times = readAccessor(json, binary, sampler.input).flat();
    const values = readAccessor(json, binary, sampler.output);
    if (times.length < 3) continue;
    const pathName = channel.target.path;
    const firstGap = Math.max(1e-6, times[1] - times[0]);
    const lastGap = Math.max(1e-6, times.at(-1) - times.at(-2));
    const seam = pathName === "rotation"
      ? quaternionAngle(values[0], values.at(-1))
      : distance(values[0], values.at(-1));
    const firstSpeed = pathName === "rotation"
      ? quaternionAngle(values[0], values[1]) / firstGap
      : distance(values[0], values[1]) / firstGap;
    const lastSpeed = pathName === "rotation"
      ? quaternionAngle(values.at(-2), values.at(-1)) / lastGap
      : distance(values.at(-2), values.at(-1)) / lastGap;
    rows.push({
      bone: boneByNode.get(channel.target.node) || json.nodes?.[channel.target.node]?.name || `node:${channel.target.node}`,
      path: pathName,
      duration: times.at(-1),
      keys: times.length,
      seam,
      firstSpeed,
      lastSpeed,
      speedGap: Math.abs(firstSpeed - lastSpeed)
    });
  }
  rows.sort((a, b) => (b.seam + b.speedGap) - (a.seam + a.speedGap));
  console.log(`\n${filename}`);
  console.log(`duration=${rows[0]?.duration.toFixed(3) || "?"}s channels=${rows.length}`);
  console.table(rows.slice(0, 18).map((row) => ({
    bone: row.bone,
    path: row.path,
    keys: row.keys,
    seam: row.seam.toFixed(5),
    startSpeed: row.firstSpeed.toFixed(5),
    endSpeed: row.lastSpeed.toFixed(5),
    speedGap: row.speedGap.toFixed(5)
  })));
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error("Usage: node tools/analyze-vrma-loop.mjs <file.vrma> [...]");
  process.exit(1);
}
for (const filename of files) analyze(path.resolve(filename));
