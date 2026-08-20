const $ = (selector) => document.querySelector(selector);
const canvas = $("#avatar");
const ctx = canvas.getContext("2d");
const photoAvatar = new Image();
let photoAvatarReady = false;
photoAvatar.onload = () => { photoAvatarReady = true; };
photoAvatar.src = "/assets/photo-avatar-v1.png";
const facialFrames = {};
const lipBlendCanvas = document.createElement("canvas");
lipBlendCanvas.width = 320;
lipBlendCanvas.height = 176;
const lipBlendCtx = lipBlendCanvas.getContext("2d");
let stableViseme = "a";
let visemeCandidate = "a";
let visemeCandidateSince = 0;
for (const [name, src] of Object.entries({
  a: "/assets/visemes/viseme-a.png",
  i: "/assets/visemes/viseme-i.png",
  u: "/assets/visemes/viseme-u.png",
  e: "/assets/visemes/viseme-e.png",
  o: "/assets/visemes/viseme-o.png",
  blink: "/assets/visemes/blink-closed.png"
})) {
  const image = new Image();
  image.src = src;
  facialFrames[name] = image;
}
const state = {
  mode: "idle",
  level: 0,
  mouth: 0,
  mouthWidth: 0,
  viseme: { closed: 1, a: 0, i: 0, u: 0, e: 0, o: 0 },
  bass: 0,
  mids: 0,
  highs: 0,
  onset: 0,
  nod: 0,
  tilt: 0,
  headX: 0,
  headY: 0,
  headRot: 0,
  headVX: 0,
  headVY: 0,
  headVRot: 0,
  targetHeadX: 0,
  targetHeadY: 0,
  targetHeadRot: 0,
  shoulderY: 0,
  shoulderVY: 0,
  armLLift: 0,
  armLLiftV: 0,
  armLOpen: 0,
  armLOpenV: 0,
  armLFold: 0,
  armLFoldV: 0,
  armRLift: 0,
  armRLiftV: 0,
  armROpen: 0,
  armROpenV: 0,
  armRFold: 0,
  armRFoldV: 0,
  targetArmLLift: 0,
  targetArmLOpen: 0,
  targetArmLFold: 0,
  targetArmRLift: 0,
  targetArmROpen: 0,
  targetArmRFold: 0,
  gesture: "rest",
  gestureUntil: 0,
  gestureCooldownUntil: 0,
  gestureSide: 1,
  gazeX: 0,
  gazeY: 0,
  gazeVX: 0,
  gazeVY: 0,
  targetGazeX: 0,
  targetGazeY: 0,
  motionAmount: 1,
  sensitivity: 1.35,
  voiced: false,
  blink: 0,
  linked: false,
  muted: false,
  stream: null,
  audioContext: null,
  speechFrames: 0
};

for (let i = 0; i < 44; i++) {
  const bar = document.createElement("i");
  $(".meter").append(bar);
}
const bars = [...document.querySelectorAll(".meter i")];

function resize() {
  const ratio = Math.min(devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * ratio;
  canvas.height = rect.height * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}
addEventListener("resize", resize);
resize();

function roundedRect(x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function spring(position, velocity, target, stiffness, damping, dt) {
  velocity += (target - position) * stiffness * dt;
  velocity *= Math.exp(-damping * dt);
  position += velocity * dt;
  return [position, velocity];
}

function drawArm(side, lift, open, fold, activity, time) {
  const shoulder = { x: side * 68, y: 176 };
  const elbow = {
    x: side * (116 + open * 31 - fold * 10),
    y: 222 - lift * 62 - fold * 6
  };
  const restWrist = { x: side * 137, y: 278 };
  const raisedWrist = {
    x: side * (196 + open * 42),
    y: 166 - open * 8
  };
  const foldedWrist = {
    x: side * (57 + open * 42),
    y: 178 - lift * 12
  };
  const wrist = {
    x: restWrist.x * (1 - lift) + raisedWrist.x * lift,
    y: restWrist.y * (1 - lift) + raisedWrist.y * lift
  };
  wrist.x = wrist.x * (1 - fold) + foldedWrist.x * fold;
  wrist.y = wrist.y * (1 - fold) + foldedWrist.y * fold;
  const handOpen = Math.max(open, lift * .35) * activity;
  const pulse = Math.sin(time * 2.2 + side) * .8 * activity;

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#66568f";
  ctx.lineWidth = 38;
  ctx.beginPath(); ctx.moveTo(shoulder.x, shoulder.y); ctx.lineTo(elbow.x, elbow.y); ctx.stroke();
  ctx.strokeStyle = "#efb7bd";
  ctx.lineWidth = 25;
  ctx.beginPath(); ctx.moveTo(elbow.x, elbow.y); ctx.lineTo(wrist.x, wrist.y + pulse); ctx.stroke();
  ctx.fillStyle = "#f3c4c4";
  ctx.save();
  ctx.translate(wrist.x, wrist.y + pulse);
  ctx.rotate(side * (-.2 + fold * .55 - open * .2));
  ctx.beginPath(); ctx.ellipse(0, 0, 18 + handOpen * 3, 21 - handOpen * 2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(112,65,79,.4)";
  ctx.lineWidth = 3;
  const fingerSpread = 4 + handOpen * 5;
  for (let finger = -2; finger <= 2; finger++) {
    const offset = finger * fingerSpread;
    ctx.beginPath();
    ctx.moveTo(side * 5, offset * .55);
    ctx.lineTo(side * (19 + handOpen * 7), offset);
    ctx.stroke();
  }
  ctx.restore();
}

function setGesture(kind, side = state.gestureSide) {
  const poses = {
    rest:  { l: [0, 0, 0], r: [0, 0, 0], duration: 0 },
    beat:  { l: side < 0 ? [.68, .12, .8] : [.08, 0, .05], r: side > 0 ? [.68, .12, .8] : [.08, 0, .05], duration: 620 },
    open:  { l: [.72, 1, .08], r: [.72, 1, .08], duration: 1050 },
    explain:{ l: side < 0 ? [.58, .35, .58] : [.15, .05, .1], r: side > 0 ? [.58, .35, .58] : [.15, .05, .1], duration: 900 },
    emphasize:{ l: [.72, .18, .62], r: [.72, .18, .62], duration: 720 }
  };
  const pose = poses[kind] || poses.rest;
  [state.targetArmLLift, state.targetArmLOpen, state.targetArmLFold] = pose.l;
  [state.targetArmRLift, state.targetArmROpen, state.targetArmRFold] = pose.r;
  state.gesture = kind;
  state.gestureUntil = performance.now() + pose.duration;
  if (kind !== "rest") {
    state.gestureCooldownUntil = state.gestureUntil + 500 + Math.random() * 700;
    state.gestureSide *= -1;
  }
  $("#gestureState").textContent = kind.toUpperCase();
  $("#gestureGate").classList.toggle("active", kind !== "rest");
}

function drawMappedTriangle(image, source, destination) {
  const [s1, s2, s3] = source;
  const [d1, d2, d3] = destination;
  const denominator = s1.x * (s2.y - s3.y) + s2.x * (s3.y - s1.y) + s3.x * (s1.y - s2.y);
  if (Math.abs(denominator) < .0001) return;
  const a = (d1.x * (s2.y - s3.y) + d2.x * (s3.y - s1.y) + d3.x * (s1.y - s2.y)) / denominator;
  const c = (d1.x * (s3.x - s2.x) + d2.x * (s1.x - s3.x) + d3.x * (s2.x - s1.x)) / denominator;
  const e = (d1.x * (s2.x*s3.y - s3.x*s2.y) + d2.x * (s3.x*s1.y - s1.x*s3.y) + d3.x * (s1.x*s2.y - s2.x*s1.y)) / denominator;
  const b = (d1.y * (s2.y - s3.y) + d2.y * (s3.y - s1.y) + d3.y * (s1.y - s2.y)) / denominator;
  const d = (d1.y * (s3.x - s2.x) + d2.y * (s1.x - s3.x) + d3.y * (s2.x - s1.x)) / denominator;
  const f = (d1.y * (s2.x*s3.y - s3.x*s2.y) + d2.y * (s3.x*s1.y - s1.x*s3.y) + d3.y * (s1.x*s2.y - s2.x*s1.y)) / denominator;
  ctx.save();
  ctx.beginPath(); ctx.moveTo(d1.x,d1.y); ctx.lineTo(d2.x,d2.y); ctx.lineTo(d3.x,d3.y); ctx.closePath(); ctx.clip();
  ctx.transform(a,b,c,d,e,f);
  ctx.drawImage(image, 0, 0);
  ctx.restore();
}

function drawLandmarkFaceMesh(image, x, y, width, height, amount) {
  if (amount < .015 || !image.naturalWidth) return;
  const normalized = [
    [.34,.36], [.50,.34], [.66,.36],
    [.32,.47], [.50,.47], [.68,.47],
    [.34,.56], [.50,.56], [.66,.56],
    [.38,.65], [.50,.68], [.62,.65]
  ];
  const source = normalized.map(([px,py]) => ({x:px*image.naturalWidth,y:py*image.naturalHeight}));
  const destination = normalized.map(([px,py], index) => {
    let dx = 0;
    let dy = 0;
    // Keep the mesh perimeter fixed and move only interior landmarks.
    // This gives the lower face a soft jaw response without visible triangle seams.
    if (index === 4) dy = amount * height * .003;
    if (index === 7) dy = amount * height * .014;
    return {x:x+px*width+dx,y:y+py*height+dy};
  });
  const triangles = [
    [0,1,3],[1,4,3],[1,2,4],[2,5,4],
    [3,4,6],[4,7,6],[4,5,7],[5,8,7],
    [6,7,9],[7,10,9],[7,8,10],[8,11,10]
  ];
  for (const triangle of triangles) {
    drawMappedTriangle(image, triangle.map(i=>source[i]), triangle.map(i=>destination[i]));
  }
}

function drawImagePatch(image, x, y, width, height, region, alpha, scaleY = 1) {
  if (!image?.complete || !image.naturalWidth || alpha <= .005) return;
  const centerX = x + width * region.cx;
  const centerY = y + height * region.cy;
  const patchW = width * region.w;
  const patchH = height * region.h;
  ctx.save();
  ctx.beginPath(); ctx.ellipse(centerX, centerY, patchW/2, patchH/2, 0, 0, Math.PI*2); ctx.clip();
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.translate(centerX, centerY);
  ctx.scale(1, scaleY);
  ctx.translate(-centerX, -centerY);
  ctx.drawImage(image, x, y, width, height);
  ctx.restore();
}

function drawBlendedMouth(x, y, width, height, weights, alpha, scaleY = 1) {
  if (alpha <= .005) return;
  const region = { cx: .5, cy: .615, w: .31, h: .18 };
  const readyWeights = weights.filter(([key, value]) =>
    value > .002 && facialFrames[key]?.complete && facialFrames[key].naturalWidth
  );
  const total = readyWeights.reduce((sum, [, value]) => sum + value, 0);
  if (total <= .002) return;

  lipBlendCtx.setTransform(1, 0, 0, 1, 0, 0);
  lipBlendCtx.globalCompositeOperation = "source-over";
  lipBlendCtx.clearRect(0, 0, lipBlendCanvas.width, lipBlendCanvas.height);
  lipBlendCtx.globalCompositeOperation = "source-over";
  for (const [key, value] of readyWeights) {
    const image = facialFrames[key];
    const sourceX = (region.cx - region.w / 2) * image.naturalWidth;
    const sourceY = (region.cy - region.h / 2) * image.naturalHeight;
    const sourceW = region.w * image.naturalWidth;
    const sourceH = region.h * image.naturalHeight;
    lipBlendCtx.globalAlpha = value / total;
    lipBlendCtx.drawImage(
      image, sourceX, sourceY, sourceW, sourceH,
      0, 0, lipBlendCanvas.width, lipBlendCanvas.height
    );
  }

  // Soft elliptical alpha mask removes the hard edge around the photo patch.
  lipBlendCtx.globalCompositeOperation = "destination-in";
  lipBlendCtx.globalAlpha = 1;
  lipBlendCtx.save();
  lipBlendCtx.translate(lipBlendCanvas.width / 2, lipBlendCanvas.height / 2);
  lipBlendCtx.scale(1, lipBlendCanvas.height / lipBlendCanvas.width);
  const feather = lipBlendCtx.createRadialGradient(0, 0, lipBlendCanvas.width * .27, 0, 0, lipBlendCanvas.width * .5);
  feather.addColorStop(0, "rgba(255,255,255,1)");
  feather.addColorStop(.7, "rgba(255,255,255,.98)");
  feather.addColorStop(1, "rgba(255,255,255,0)");
  lipBlendCtx.fillStyle = feather;
  lipBlendCtx.fillRect(-lipBlendCanvas.width / 2, -lipBlendCanvas.width / 2, lipBlendCanvas.width, lipBlendCanvas.width);
  lipBlendCtx.restore();

  const centerX = x + width * region.cx;
  const centerY = y + height * region.cy;
  const patchW = width * region.w;
  const patchH = height * region.h;
  ctx.save();
  // Keep the center opaque. Using the audio level as global alpha exposes the
  // original mouth underneath and produces a visible double-mouth afterimage.
  ctx.globalAlpha = 1;
  ctx.translate(centerX, centerY);
  ctx.scale(1, scaleY);
  ctx.drawImage(lipBlendCanvas, -patchW / 2, -patchH / 2, patchW, patchH);
  ctx.restore();
}

function chooseStableViseme(weights, now) {
  const ranked = [...weights].sort((a, b) => b[1] - a[1]);
  const [dominant, dominantWeight] = ranked[0] || [stableViseme, 0];
  const currentWeight = weights.find(([key]) => key === stableViseme)?.[1] || 0;
  if (dominant === stableViseme) {
    visemeCandidate = dominant;
    visemeCandidateSince = now;
    return stableViseme;
  }
  const clearlyStronger = dominantWeight > Math.max(.24, currentWeight * 1.18);
  if (!clearlyStronger) return stableViseme;
  if (visemeCandidate !== dominant) {
    visemeCandidate = dominant;
    visemeCandidateSince = now;
  } else if (now - visemeCandidateSince > 70) {
    stableViseme = dominant;
  }
  return stableViseme;
}

function drawPhotoAvatar(time, w, h) {
  const t = time / 1000;
  const frameH = Math.min(h * .91, 680);
  const frameW = Math.min(w * .67, frameH * (photoAvatar.naturalWidth / photoAvatar.naturalHeight));
  const centerX = w * .5 + state.headX * state.motionAmount * .45;
  const centerY = h * .5 + Math.sin(t * 1.25) * 2.2 + state.headY * state.motionAmount * .28;
  const talk = state.mouth;
  let portraitFrame = photoAvatar;
  if (talk > .045) {
    const weights = Object.entries(state.viseme)
      .filter(([key]) => facialFrames[key])
      .map(([key, value]) => [key, Math.max(0, value)]);
    const selected = chooseStableViseme(weights, time);
    if (facialFrames[selected]?.complete && facialFrames[selected].naturalWidth) {
      portraitFrame = facialFrames[selected];
    }
  }
  if (state.blink > .55 && facialFrames.blink?.complete && facialFrames.blink.naturalWidth) {
    portraitFrame = facialFrames.blink;
  }

  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate(state.headRot * .0025 * state.motionAmount);
  const x = -frameW / 2;
  const y = -frameH / 2;
  ctx.beginPath();
  ctx.roundRect(x, y, frameW, frameH, 42);
  ctx.clip();
  // Exactly one opaque full portrait is rendered per frame. No mouth/eye
  // patches and no landmark overlay means there is nothing underneath that
  // can show through as a residual image.
  ctx.drawImage(portraitFrame, x, y, frameW, frameH);
  ctx.restore();

  ctx.strokeStyle = "rgba(194,163,255,.46)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(centerX-frameW/2, centerY-frameH/2, frameW, frameH, 42);
  ctx.stroke();
}

let lastFrameTime = 0;
function drawAvatar(time) {
  const dt = Math.min(.034, Math.max(.001, (time - (lastFrameTime || time - 16)) / 1000));
  lastFrameTime = time;
  [state.gazeX, state.gazeVX] = spring(state.gazeX, state.gazeVX, state.targetGazeX, 155, 18, dt);
  [state.gazeY, state.gazeVY] = spring(state.gazeY, state.gazeVY, state.targetGazeY, 155, 18, dt);
  [state.headX, state.headVX] = spring(state.headX, state.headVX, state.targetHeadX + state.gazeX * .22, 34, 8.5, dt);
  [state.headY, state.headVY] = spring(state.headY, state.headVY, state.targetHeadY, 31, 8, dt);
  [state.headRot, state.headVRot] = spring(state.headRot, state.headVRot, state.targetHeadRot + state.gazeX * .045, 27, 7.5, dt);
  [state.shoulderY, state.shoulderVY] = spring(state.shoulderY, state.shoulderVY, state.headY * .38 + state.bass * 3, 13, 6, dt);
  [state.armLLift, state.armLLiftV] = spring(state.armLLift, state.armLLiftV, state.targetArmLLift, 32, 9, dt);
  [state.armLOpen, state.armLOpenV] = spring(state.armLOpen, state.armLOpenV, state.targetArmLOpen, 25, 8, dt);
  [state.armLFold, state.armLFoldV] = spring(state.armLFold, state.armLFoldV, state.targetArmLFold, 30, 8, dt);
  [state.armRLift, state.armRLiftV] = spring(state.armRLift, state.armRLiftV, state.targetArmRLift, 32, 9, dt);
  [state.armROpen, state.armROpenV] = spring(state.armROpen, state.armROpenV, state.targetArmROpen, 25, 8, dt);
  [state.armRFold, state.armRFoldV] = spring(state.armRFold, state.armRFoldV, state.targetArmRFold, 30, 8, dt);

  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);
  if (photoAvatarReady) {
    drawPhotoAvatar(time, w, h);
    requestAnimationFrame(drawAvatar);
    return;
  }
  const t = time / 1000;
  const talk = state.mouth;
  const breathe = Math.sin(t * 1.3) * 3;
  const activity = state.motionAmount * (0.25 + state.mids * 0.75);
  const sway = Math.sin(t * .55) * 7 + Math.sin(t * 2.1) * state.headRot * 2.4 * activity;
  const cx = w * .5 + sway + state.headX * state.motionAmount;
  const scale = Math.min(w / 850, h / 825);
  const cy = h * .42 + breathe + state.headY * state.motionAmount;

  const glow = ctx.createRadialGradient(cx, cy, 10, cx, cy, 290 * scale);
  glow.addColorStop(0, "rgba(210,157,255,.25)");
  glow.addColorStop(1, "rgba(33,22,67,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(cx - 300, cy - 300, 600, 600);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(state.headRot * 0.018 * state.motionAmount);
  ctx.scale(scale, scale);

  // shoulders and neck
  ctx.save();
  ctx.translate(-state.headX * .2, state.shoulderY * state.motionAmount);
  const body = ctx.createLinearGradient(0, 140, 0, 340);
  body.addColorStop(0, "#7663a2");
  body.addColorStop(.55, "#493d70");
  body.addColorStop(1, "#211d3d");
  // two-head chibi lower body: chin-to-feet roughly equals head height
  ctx.strokeStyle = "#f1b8bd";
  ctx.lineWidth = 25;
  ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(-34, 300); ctx.lineTo(-36, 382); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(34, 300); ctx.lineTo(36, 382); ctx.stroke();
  ctx.strokeStyle = "#57477f";
  ctx.lineWidth = 31;
  ctx.beginPath(); ctx.moveTo(-36, 370); ctx.lineTo(-42, 420); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(36, 370); ctx.lineTo(42, 420); ctx.stroke();
  ctx.fillStyle = "#30284e";
  ctx.beginPath(); ctx.ellipse(-53, 423, 31, 15, -.08, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(53, 423, 31, 15, .08, 0, Math.PI * 2); ctx.fill();
  const skirt = ctx.createLinearGradient(0, 236, 0, 335);
  skirt.addColorStop(0, "#9275c7");
  skirt.addColorStop(1, "#594785");
  ctx.fillStyle = skirt;
  ctx.beginPath(); ctx.moveTo(-65, 235); ctx.quadraticCurveTo(-84, 278, -106, 326); ctx.quadraticCurveTo(0, 350, 106, 326); ctx.quadraticCurveTo(84, 278, 65, 235); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "#f3edff"; ctx.lineWidth = 8;
  ctx.beginPath(); ctx.moveTo(-101, 322); ctx.quadraticCurveTo(0, 344, 101, 322); ctx.stroke();

  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(-56, 152); ctx.bezierCurveTo(-76, 185, -164, 188, -188, 290);
  ctx.lineTo(188, 290); ctx.bezierCurveTo(164, 188, 76, 185, 56, 152); ctx.closePath(); ctx.fill();
  drawArm(-1, state.armLLift, state.armLOpen, state.armLFold, activity, t);
  drawArm(1, state.armRLift, state.armROpen, state.armRFold, activity, t);
  ctx.strokeStyle = "rgba(202,183,255,.5)"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-163, 290); ctx.quadraticCurveTo(-127, 216, -58, 193); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(163, 290); ctx.quadraticCurveTo(127, 216, 58, 193); ctx.stroke();
  ctx.restore();
  // bright collar
  ctx.fillStyle = "#f3edff";
  ctx.beginPath(); ctx.moveTo(-58,177); ctx.lineTo(-23,217); ctx.lineTo(0,198); ctx.lineTo(23,217); ctx.lineTo(58,177); ctx.lineTo(42,229); ctx.lineTo(-42,229); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#ff91cb";
  ctx.beginPath(); ctx.moveTo(-17,205); ctx.lineTo(17,205); ctx.lineTo(29,245); ctx.lineTo(0,231); ctx.lineTo(-29,245); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#edb4ba";
  roundedRect(-43, 94, 86, 108, 35); ctx.fill();

  // hair back
  const hair = ctx.createLinearGradient(-120, -180, 130, 180);
  hair.addColorStop(0, "#d88bd5"); hair.addColorStop(.5, "#966cc7"); hair.addColorStop(1, "#513f82");
  ctx.fillStyle = hair;
  // soft twin buns
  ctx.beginPath(); ctx.arc(-108, -98, 56, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(108, -98, 56, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(0, -25, 145, 195, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-122,-66); ctx.quadraticCurveTo(-169,100,-114,230); ctx.quadraticCurveTo(-70,181,-69,70); ctx.fill();
  ctx.beginPath(); ctx.moveTo(122,-66); ctx.quadraticCurveTo(169,100,114,230); ctx.quadraticCurveTo(70,181,69,70); ctx.fill();

  // face
  const skin = ctx.createRadialGradient(-35, -52, 8, 0, 0, 160);
  skin.addColorStop(0, "#ffe0d3"); skin.addColorStop(.7, "#f4c1bf"); skin.addColorStop(1, "#d99ba9");
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.moveTo(-106,-78); ctx.bezierCurveTo(-111,20,-85,104,0,128);
  ctx.bezierCurveTo(85,104,111,20,106,-78); ctx.quadraticCurveTo(0,-170,-106,-78); ctx.fill();

  // ears
  ctx.fillStyle = "#eab0b6";
  ctx.beginPath(); ctx.ellipse(-103, 9, 17, 32, -.12, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(103, 9, 17, 32, .12, 0, Math.PI*2); ctx.fill();

  // bangs
  ctx.fillStyle = hair;
  ctx.beginPath(); ctx.moveTo(-108,-80); ctx.quadraticCurveTo(-76,-175,18,-151); ctx.quadraticCurveTo(-15,-93,-21,-32); ctx.quadraticCurveTo(-55,-70,-108,-55); ctx.fill();
  ctx.beginPath(); ctx.moveTo(8,-151); ctx.quadraticCurveTo(90,-159,111,-78); ctx.quadraticCurveTo(69,-100,32,-38); ctx.quadraticCurveTo(31,-95,8,-151); ctx.fill();
  // glossy hair highlights
  ctx.strokeStyle = "rgba(255,225,255,.34)"; ctx.lineWidth = 8; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(-73,-132); ctx.quadraticCurveTo(-98,-78,-91,-17); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(72,-125); ctx.quadraticCurveTo(101,-68,91,-12); ctx.stroke();
  // star hair clip
  ctx.save(); ctx.translate(80,-88); ctx.rotate(.18); ctx.fillStyle = "#ffe985"; ctx.shadowColor = "#fff0a8"; ctx.shadowBlur = 12;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) { const radius = i % 2 ? 6 : 13; const angle = -Math.PI/2 + i*Math.PI/5; const x = Math.cos(angle)*radius; const y = Math.sin(angle)*radius; i ? ctx.lineTo(x,y) : ctx.moveTo(x,y); }
  ctx.closePath(); ctx.fill(); ctx.restore();

  // brows
  ctx.strokeStyle = "#805271"; ctx.lineWidth = 4.5; ctx.lineCap = "round";
  const browLift = state.highs * 8 + state.onset * 3;
  ctx.beginPath(); ctx.moveTo(-69,-30-browLift); ctx.quadraticCurveTo(-43,-44-browLift,-20,-31-browLift*.5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(69,-30-browLift); ctx.quadraticCurveTo(43,-44-browLift,20,-31-browLift*.5); ctx.stroke();

  // eyes with blinking
  const blink = state.blink;
  const eyeH = Math.max(1.2, 16 * (1 - blink));
  ctx.fillStyle = "#f6e9eb";
  ctx.beginPath(); ctx.ellipse(-48, 1, 34, eyeH, 0, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(48, 1, 34, eyeH, 0, 0, Math.PI*2); ctx.fill();
  if (eyeH > 3) {
    const eyeGlow = "#8d76ff";
    const gazeX = state.gazeX * 6;
    const gazeY = state.gazeY * 3.5;
    ctx.fillStyle = eyeGlow;
    ctx.beginPath(); ctx.ellipse(-46 + gazeX, 2 + gazeY, 12, eyeH * .9, 0, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(46 + gazeX, 2 + gazeY, 12, eyeH * .9, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = "#34214f";
    ctx.beginPath(); ctx.ellipse(-46 + gazeX, 2 + gazeY, 6, eyeH * .68, 0, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(46 + gazeX, 2 + gazeY, 6, eyeH * .68, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = "white";
    ctx.beginPath(); ctx.arc(-42 + gazeX, -4 + gazeY, 3.2, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(50 + gazeX, -4 + gazeY, 3.2, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(-49 + gazeX, 6 + gazeY, 1.7, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(43 + gazeX, 6 + gazeY, 1.7, 0, Math.PI*2); ctx.fill();
  }
  ctx.strokeStyle = "#6e4665"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(-82,1); ctx.quadraticCurveTo(-48,-22,-14,1); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(82,1); ctx.quadraticCurveTo(48,-22,14,1); ctx.stroke();
  // outer lashes
  ctx.beginPath(); ctx.moveTo(-78,-2); ctx.lineTo(-88,-8); ctx.moveTo(78,-2); ctx.lineTo(88,-8); ctx.stroke();

  // nose and blush
  ctx.strokeStyle = "rgba(118,64,77,.45)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-4,12); ctx.quadraticCurveTo(-9,44,4,45); ctx.stroke();
  ctx.fillStyle = "rgba(255,103,158,.22)";
  ctx.beginPath(); ctx.ellipse(-69,52,29,12,0,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(69,52,29,12,0,0,Math.PI*2); ctx.fill();

  // vowel-driven mouth: closed / A / I / U / E / O
  const v = state.viseme;
  const roundness = Math.min(1, v.u + v.o);
  const mouthOpen = 2 + talk * (v.a * 30 + v.i * 8 + v.u * 14 + v.e * 16 + v.o * 24);
  const mouthWidth = 18 + v.a * 9 + v.i * 19 + v.u * 2 + v.e * 15 + v.o * 4;
  ctx.fillStyle = "#a34872";
  if (talk < .06) {
    ctx.strokeStyle = "#a34872"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(-20,75); ctx.quadraticCurveTo(0,89,20,75); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.ellipse(0, 77, mouthWidth + talk * 3, mouthOpen, 0, 0, Math.PI * 2); ctx.fill();
  }
  if (talk > .18) {
    ctx.fillStyle = "#e5879c";
    ctx.beginPath(); ctx.ellipse(0, 82 + roundness * 2, Math.max(7, mouthWidth * .68), mouthOpen * .35, 0, 0, Math.PI); ctx.fill();
  }
  if (talk >= .06) {
    ctx.strokeStyle = "rgba(255,184,205,.55)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-mouthWidth-2,76); ctx.quadraticCurveTo(0,84 + talk*3,mouthWidth+2,76); ctx.stroke();
  }

  // cyber ornaments
  ctx.strokeStyle = "rgba(107,229,255,.75)"; ctx.lineWidth = 1.3;
  ctx.beginPath(); ctx.moveTo(111,-42); ctx.lineTo(132,-19); ctx.lineTo(126,35); ctx.stroke();
  ctx.fillStyle = "#74eaff"; ctx.beginPath(); ctx.arc(127,37,3,0,Math.PI*2); ctx.fill();
  ctx.restore();
  requestAnimationFrame(drawAvatar);
}
requestAnimationFrame(drawAvatar);

let nextBlink = performance.now() + 1800;
let nextGaze = performance.now() + 1200;
setInterval(() => {
  const now = performance.now();
  if (now > nextBlink) {
    const start = now;
    const blinkAnim = () => {
      const p = (performance.now() - start) / 180;
      state.blink = p < .5 ? p * 2 : Math.max(0, 2 - p * 2);
      if (p < 1) requestAnimationFrame(blinkAnim);
      else state.blink = 0;
    };
    blinkAnim();
    nextBlink = now + 2200 + Math.random() * 3600;
  }
  if (now > nextGaze) {
    if (state.voiced) {
      // During speech, frequently reconnect with the viewer.
      state.targetGazeX = (Math.random() - .5) * .18;
      state.targetGazeY = (Math.random() - .5) * .12;
      nextGaze = now + 900 + Math.random() * 1300;
    } else {
      // Eyes move first; head follows through the slower spring in drawAvatar().
      state.targetGazeX = (Math.random() - .5) * 1.35;
      state.targetGazeY = (Math.random() - .5) * .7;
      nextGaze = now + 1800 + Math.random() * 3200;
    }
  }
}, 100);

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 4000);
}

function setMode(mode, label) {
  state.mode = mode;
  $("#stateLabel").textContent = label;
  $("#stateDot").style.background = mode === "listening" ? "#ff73cf" : "#65e8ff";
}

function normalizedWeights(scores) {
  const peak = Math.max(...Object.values(scores));
  const entries = Object.entries(scores).map(([key, value]) => [key, Math.exp((value - peak) * 2.6)]);
  const total = entries.reduce((sum, [, value]) => sum + value, 0) || 1;
  return Object.fromEntries(entries.map(([key, value]) => [key, value / total]));
}

async function enumerateDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs = devices.filter((item) => item.kind === "audioinput");
  $("#inputDevice").innerHTML = "";
  inputs.forEach((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || `Audio input ${index + 1}`;
    if (/cable output|vb-audio|virtual cable/i.test(device.label)) option.selected = true;
    $("#inputDevice").append(option);
  });
}

async function startLink() {
  const deviceId = $("#inputDevice").value;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1
    }
  });
  state.stream = stream;
  state.audioContext = new AudioContext();
  const source = state.audioContext.createMediaStreamSource(stream);
  const analyser = state.audioContext.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = .45;
  source.connect(analyser);
  const buffer = new Float32Array(analyser.fftSize);
  const frequencies = new Uint8Array(analyser.frequencyBinCount);
  let previousVoiced = false;
  let phase = 0;

  const monitor = () => {
    if (!state.linked) return;
    analyser.getFloatTimeDomainData(buffer);
    analyser.getByteFrequencyData(frequencies);
    let sum = 0;
    for (const value of buffer) sum += value * value;
    const rms = Math.sqrt(sum / buffer.length);
    state.level += (rms - state.level) * .32;
    const db = state.level > 0 ? 20 * Math.log10(state.level) : -Infinity;
    const visual = Math.max(0, Math.min(1, (db + 56) / 48));
    $("#inputLevel").style.width = `${visual * 100}%`;
    $("#dbLabel").textContent = Number.isFinite(db) ? `${Math.round(db)}` : "-∞";
    bars.forEach((bar, i) => {
      const center = 1 - Math.abs(i - bars.length / 2) / (bars.length / 2);
      bar.style.height = `${2 + visual * center * (8 + Math.random() * 15)}px`;
    });

    const binHz = state.audioContext.sampleRate / analyser.fftSize;
    const averageBandHz = (lowHz, highHz) => {
      const from = Math.max(0, Math.floor(lowHz / binHz));
      const to = Math.min(frequencies.length, Math.ceil(highHz / binHz));
      let total = 0;
      for (let i = from; i < to; i++) total += frequencies[i];
      return total / Math.max(1, to - from) / 255;
    };
    const bass = averageBandHz(80, 280);
    const mids = averageBandHz(280, 1450);
    const highs = averageBandHz(1450, 3600);
    // A small hysteresis prevents the mouth from rapidly opening/closing near silence.
    const voiced = !state.muted && db > (previousVoiced ? -50 : -44);
    const gate = voiced ? Math.min(1, Math.max(0, (db + 46) / 30)) : 0;

    state.bass += (bass - state.bass) * .32;
    state.mids += (mids - state.mids) * .4;
    state.highs += (highs - state.highs) * .45;
    const targetMouth = Math.min(1, gate * state.sensitivity * (0.58 + mids * 1.2));
    state.mouth += (targetMouth - state.mouth) * (voiced ? .3 : .16);
    state.mouthWidth += (Math.min(1, highs * 2.3) - state.mouthWidth) * .18;
    state.onset = Math.max(voiced && !previousVoiced ? 1 : 0, state.onset * .84);
    state.speechFrames = voiced ? state.speechFrames + 1 : 0;

    const f1Low = averageBandHz(180, 380);
    const f1Mid = averageBandHz(380, 650);
    const f1High = averageBandHz(650, 1000);
    const f2Low = averageBandHz(700, 1250);
    const f2Mid = averageBandHz(1250, 1900);
    const f2High = averageBandHz(1900, 3200);
    const vowelWeights = voiced ? normalizedWeights({
      a: f1High * 1.9 + f2Low * .7 + mids * .35,
      i: f1Low * 1.1 + f2High * 2.1 - f1High * .45,
      u: f1Low * 1.2 + f2Low * 1.75 - f2High * .35,
      e: f1Mid * 1.45 + f2High * 1.35,
      o: f1Mid * 1.35 + f2Low * 1.65 - f2High * .3
    }) : { a: 0, i: 0, u: 0, e: 0, o: 0 };
    for (const key of ["a", "i", "u", "e", "o"]) {
      state.viseme[key] += (vowelWeights[key] - state.viseme[key]) * (voiced ? .16 : .12);
    }
    state.viseme.closed += ((voiced ? 0 : 1) - state.viseme.closed) * (voiced ? .24 : .18);

    phase += .08 + mids * .12;
    state.targetHeadY = Math.sin(phase) * gate * 4.5 + state.onset * 5.5;
    state.targetHeadRot = Math.sin(phase * .37) * gate * .85 + (highs - bass) * .8;
    state.targetHeadX = Math.sin(phase * .23) * gate * 2.5;

    state.voiced = voiced;
    previousVoiced = voiced;

    $("#voiceGate").classList.toggle("active", voiced);
    $("#voiceState").textContent = state.muted ? "MUTED" : voiced ? "ACTIVE" : "WAIT";
    $("#caption").textContent = state.muted
      ? "ミュート中"
      : voiced ? "AUDIO REACTIVE" : "入力音声を待っています";
    if (voiced && state.mode !== "listening") setMode("listening", "音声に同期中");
    if (!voiced && state.mode !== "idle") setMode("idle", "入力待機中");
    requestAnimationFrame(monitor);
  };
  state.linked = true;
  $("#linkButton").classList.add("active");
  $("#linkButton b").textContent = "音声リンク停止";
  $("#muteButton").disabled = false;
  setMode("idle", "入力待機中");
  await enumerateDevices();
  monitor();
}

function stopLink() {
  state.linked = false;
  state.stream?.getTracks().forEach((track) => track.stop());
  state.audioContext?.close();
  state.mouth = 0;
  state.mouthWidth = 0;
  state.targetHeadX = 0;
  state.targetHeadY = 0;
  state.targetHeadRot = 0;
  state.targetGazeX = 0;
  state.targetGazeY = 0;
  state.viseme = { closed: 1, a: 0, i: 0, u: 0, e: 0, o: 0 };
  state.voiced = false;
  $("#linkButton").classList.remove("active");
  $("#linkButton b").textContent = "音声リンク開始";
  $("#muteButton").disabled = true;
  $("#inputLevel").style.width = "0";
  $("#voiceGate").classList.remove("active");
  $("#voiceState").textContent = "WAIT";
  $("#caption").textContent = "音声リンクを開始してください";
  setMode("idle", "待機中");
}

$("#linkButton").onclick = async () => {
  try {
    if (state.linked) stopLink();
    else await startLink();
  } catch (error) {
    showToast(`音声入力を開始できません: ${error.message}`);
  }
};
$("#muteButton").onclick = () => {
  state.muted = !state.muted;
  $("#muteButton").textContent = state.muted ? "◆" : "◇";
};
$("#inputDevice").onchange = async () => {
  if (state.linked) { stopLink(); await startLink(); }
};

$("#sensitivity").oninput = (event) => {
  state.sensitivity = Number(event.target.value);
  $("#sensitivityValue").textContent = state.sensitivity.toFixed(2);
};
$("#motionAmount").oninput = (event) => {
  state.motionAmount = Number(event.target.value);
  $("#motionValue").textContent = state.motionAmount.toFixed(2);
};

let facePreviewTimer = 0;
document.querySelectorAll("[data-face-preview]").forEach((button) => {
  button.onclick = () => {
    clearTimeout(facePreviewTimer);
    document.querySelectorAll("[data-face-preview]").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    const name = button.dataset.facePreview;
    if (name === "blink") {
      state.blink = 1;
      facePreviewTimer = setTimeout(() => {
        state.blink = 0;
        button.classList.remove("active");
      }, 550);
      return;
    }
    state.mouth = name === "i" || name === "u" ? .62 : .84;
    state.viseme = { closed: 0, a: 0, i: 0, u: 0, e: 0, o: 0, [name]: 1 };
    facePreviewTimer = setTimeout(() => {
      state.mouth = 0;
      state.viseme = { closed: 1, a: 0, i: 0, u: 0, e: 0, o: 0 };
      button.classList.remove("active");
    }, 1500);
  };
});

setInterval(() => {
  $("#clock").textContent = new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
}, 1000);

navigator.mediaDevices?.getUserMedia({ audio: true })
  .then((stream) => { stream.getTracks().forEach((track) => track.stop()); return enumerateDevices(); })
  .catch(() => {});
