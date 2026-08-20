import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  VRMLoaderPlugin,
  VRMUtils,
  VRMExpressionPresetName,
  VRMHumanBoneName
} from "@pixiv/three-vrm";
import {
  VRMAnimationLoaderPlugin,
  createVRMAnimationClip
} from "@pixiv/three-vrm-animation";

const $ = (selector) => document.querySelector(selector);
const canvas = $("#vrmCanvas");
const stage = $("#stage");
const DB_NAME = "neon-vrm-studio";
const DB_STORE = "local-files";
const urlOptions = new URLSearchParams(location.search);
const requestedQuality = urlOptions.get("quality");
const requestedBackground = urlOptions.get("background");
const hasQualityOverride = ["auto", "low", "standard", "high"].includes(requestedQuality);
const hasBackgroundOverride = ["blue", "transparent", "green"].includes(requestedBackground);
const startupBroadcast = ["1", "true", "yes"].includes(
  (urlOptions.get("broadcast") || "").toLowerCase()
) || urlOptions.get("ui") === "0";
const savedSettings = JSON.parse(localStorage.getItem("neon-settings") || "{}");
const modelProfiles = JSON.parse(localStorage.getItem("neon-model-profiles") || "{}");
const savedNumber = (key, fallback) => {
  const value = Number(savedSettings[key]);
  return Number.isFinite(value) ? value : fallback;
};
let renderQuality = hasQualityOverride
  ? requestedQuality
  : ["auto", "low", "standard", "high"].includes(savedSettings.renderQuality)
    ? savedSettings.renderQuality
    : "high";
const renderPixelRatios = { auto: 1.5, low: 1, standard: 1.5, high: 2 };
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, renderPixelRatios[renderQuality]));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();
const lookTarget = new THREE.Object3D();
scene.add(lookTarget);
const camera = new THREE.PerspectiveCamera(28, 1, .05, 100);
camera.position.set(0, 1.35, 2.7);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 1.25, 0);
controls.minDistance = .8;
controls.maxDistance = 5;
controls.update();

const hemisphereLight = new THREE.HemisphereLight(0xbfc8ff, 0x30204e, 2.2);
scene.add(hemisphereLight);
const keyLight = new THREE.DirectionalLight(0xffffff, 2.8);
keyLight.position.set(1.4, 2.2, 2.5);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x8b6cff, 2.2);
rimLight.position.set(-2, 1.6, -1.5);
scene.add(rimLight);
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(1.6, 64),
  new THREE.MeshBasicMaterial({ color: 0x8bdcff, transparent: true, opacity: .16, depthWrite: false })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = .005;
scene.add(floor);

const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));
const animationLoader = new GLTFLoader();
animationLoader.register((parser) => new VRMAnimationLoaderPlugin(parser));
let vrm = null;
let modelFilename = "";
let audio = null;
let analyser = null;
let stream = null;
let audioWaveData = null;
let audioSpectrumData = null;
let linked = false;
let knownInputDeviceSignature = "";
let deviceRefreshTimer = 0;
let sensitivity = savedNumber("sensitivity", 1.3);
let lipSyncDelayMs = savedNumber("lipSyncDelayMs", 0);
let motionAmount = savedNumber("motionAmount", 1);
let naturalness = savedNumber("naturalness", 1);
let expressionAmount = savedNumber("expressionAmount", 1);
let gazeMotionAmount = savedNumber("gazeMotionAmount", 1);
let nodAmount = savedNumber("nodAmount", 1);
let motionPlaybackSpeed = savedNumber("motionPlaybackSpeed", 1);
let motionFadeScale = savedNumber("motionFadeScale", 1);
let backgroundMode = hasBackgroundOverride
  ? requestedBackground
  : ["blue", "transparent", "green"].includes(savedSettings.backgroundMode)
    ? savedSettings.backgroundMode
    : "blue";
let idleExpressionPreset = ["happy", "relaxed", "off"].includes(savedSettings.idleExpressionPreset)
  ? savedSettings.idleExpressionPreset
  : "happy";
let emphasisExpressionPreset = ["surprised", "happy", "off"].includes(savedSettings.emphasisExpressionPreset)
  ? savedSettings.emphasisExpressionPreset
  : "surprised";
let lightingPreset = ["soft", "bright", "stage"].includes(savedSettings.lightingPreset)
  ? savedSettings.lightingPreset
  : "soft";
let audioLevel = 0;
let noiseFloorDb = -60;
let audioCalibrationUntil = 0;
let targetMouth = 0;
let smoothedMouth = 0;
let previousVoiceGate = 0;
let prosodyImpulse = 0;
let prosodyNod = 0;
let lastProsodyImpulseTime = -10;
let consonantClosure = 0;
const lipFrameQueue = [];
let blink = 0;
let nextBlink = performance.now() + 2200;
let blinkStart = 0;
let blinkDuration = 170;
let queuedDoubleBlink = false;
let nextBlinkIsFollowup = false;
let warmExpression = 0;
let engagedExpression = 0;
let eyeSoftness = 0;
let restBones = new Map();
let restPositions = new Map();
let mixer = null;
let activeAction = null;
let activeMotionSlot = "";
const retiringActions = new Map();
let requestedMotionSlot = "idle";
let selectedSpeechMotion = "talk";
let previousSpeechMotion = "talkAlt";
let lastVoiceTime = -10;
let speechStartedAt = -10;
let nextSpeechMotionChange = -10;
let oneShotPlaying = false;
let lastEmphasisTime = -10;
let lipTestUntil = -10;
const motionSlots = ["idle", "talk", "talkAlt", "emphasis", "listen", "nod", "greeting"];
const oneShotSlots = new Set(["emphasis", "nod", "greeting"]);
const motionSlotLabels = {
  idle: "IDLE",
  talk: "TALK A",
  talkAlt: "TALK B",
  emphasis: "EMPHASIS",
  listen: "LISTEN",
  nod: "NOD",
  greeting: "GREETING"
};
const motionAnimations = { idle: null, talk: null, talkAlt: null, emphasis: null, listen: null, nod: null, greeting: null };
const motionActions = { idle: null, talk: null, talkAlt: null, emphasis: null, listen: null, nod: null, greeting: null };
const motionTargetSpeeds = new Map();
const seamlessLoopPartners = new Map();
let seamlessLoopTransitionUntil = 0;
let motionTransitionUntil = 0;
let queuedMotionRequest = null;
let speaking = false;
let gestureStart = -10;
let gestureSide = 1;
const viseme = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
const targetViseme = { ...viseme };
let lastRenderTime = performance.now();
let elapsedTime = 0;
let performanceWindowStart = performance.now();
let performanceFrameCount = 0;
let performanceWorkTotal = 0;
let autoQualityLowWindows = 0;
let autoQualityHighWindows = 0;
let modelCenter = new THREE.Vector3(0, 1, 0);
let modelHeight = 1.6;
let modelFloorY = 0;
let cameraTransition = null;
const footGroundState = {
  left: { floorOffset: 0 },
  right: { floorOffset: 0 }
};
let smoothedGroundCorrection = 0;
let groundCorrectionInitialized = false;
let rootHeightWasStabilized = false;
const leftFootWorldPosition = new THREE.Vector3();
const rightFootWorldPosition = new THREE.Vector3();
let gazeX = 0;
let gazeY = 0;
let headGazeX = 0;
let headGazeY = 0;
let eyeSaccadeX = 0;
let eyeSaccadeY = 0;
let targetEyeSaccadeX = 0;
let targetEyeSaccadeY = 0;
let nextEyeSaccade = .8;
let bodyWeightShift = 0;
let chestWeightFollow = 0;
let shoulderWeightFollow = 0;
let appliedHipWeightOffset = 0;
const appliedWeightRotations = new Map();
const appliedBreathRotations = new Map();
let breathPhase = 0;
let breathCycleDuration = 3.9;
let breathDepth = 1;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveLocalFile(key, file, data) {
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(DB_STORE, "readwrite");
    transaction.objectStore(DB_STORE).put({
      name: file.name,
      type: file.type || "application/octet-stream",
      data
    }, key);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function readLocalFile(key) {
  const db = await openDatabase();
  const result = await new Promise((resolve, reject) => {
    const request = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result;
}

async function deleteLocalFile(key) {
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(DB_STORE, "readwrite");
    transaction.objectStore(DB_STORE).delete(key);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function replaceLocalFiles(entries) {
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(DB_STORE, "readwrite");
    const store = transaction.objectStore(DB_STORE);
    store.clear();
    for (const entry of entries) {
      store.put({
        name: entry.name,
        type: entry.type || "application/octet-stream",
        data: entry.data
      }, entry.key);
    }
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("環境パックを保存できません"));
  });
  db.close();
}

function saveSettings() {
  localStorage.setItem("neon-settings", JSON.stringify({
    sensitivity,
    lipSyncDelayMs,
    motionAmount,
    naturalness,
    expressionAmount,
    gazeMotionAmount,
    nodAmount,
    motionPlaybackSpeed,
    motionFadeScale,
    backgroundMode: hasBackgroundOverride
      ? (["blue", "transparent", "green"].includes(savedSettings.backgroundMode) ? savedSettings.backgroundMode : "blue")
      : backgroundMode,
    renderQuality: hasQualityOverride
      ? (["auto", "low", "standard", "high"].includes(savedSettings.renderQuality) ? savedSettings.renderQuality : "high")
      : renderQuality,
    idleExpressionPreset,
    emphasisExpressionPreset,
    lightingPreset,
    inputDeviceId: $("#inputDevice")?.value || savedSettings.inputDeviceId || ""
  }));
  saveModelProfile();
}

function saveModelProfile() {
  if (!modelFilename) return;
  modelProfiles[modelFilename] = {
    sensitivity,
    motionAmount,
    naturalness,
    expressionAmount,
    gazeMotionAmount,
    nodAmount,
    motionPlaybackSpeed,
    motionFadeScale,
    idleExpressionPreset,
    emphasisExpressionPreset,
    lightingPreset,
    cameraPosition: camera.position.toArray(),
    cameraTarget: controls.target.toArray()
  };
  localStorage.setItem("neon-model-profiles", JSON.stringify(modelProfiles));
}

function restoreModelProfile(name) {
  const profile = modelProfiles[name];
  if (!profile) return false;
  const read = (key, fallback) => {
    const value = Number(profile[key]);
    return Number.isFinite(value) ? value : fallback;
  };
  sensitivity = read("sensitivity", sensitivity);
  motionAmount = read("motionAmount", motionAmount);
  naturalness = read("naturalness", naturalness);
  expressionAmount = read("expressionAmount", expressionAmount);
  gazeMotionAmount = read("gazeMotionAmount", gazeMotionAmount);
  nodAmount = read("nodAmount", nodAmount);
  motionPlaybackSpeed = read("motionPlaybackSpeed", motionPlaybackSpeed);
  motionFadeScale = read("motionFadeScale", motionFadeScale);
  if (["happy", "relaxed", "off"].includes(profile.idleExpressionPreset)) {
    idleExpressionPreset = profile.idleExpressionPreset;
  }
  if (["surprised", "happy", "off"].includes(profile.emphasisExpressionPreset)) {
    emphasisExpressionPreset = profile.emphasisExpressionPreset;
  }
  if (["soft", "bright", "stage"].includes(profile.lightingPreset)) {
    lightingPreset = profile.lightingPreset;
    applyLightingPreset(lightingPreset, false);
  }
  if (Array.isArray(profile.cameraPosition) && profile.cameraPosition.length === 3) {
    camera.position.fromArray(profile.cameraPosition);
  }
  if (Array.isArray(profile.cameraTarget) && profile.cameraTarget.length === 3) {
    controls.target.fromArray(profile.cameraTarget);
  }
  syncSettingsUI();
  controls.update();
  return true;
}

async function fileData(file) {
  if (file.data instanceof ArrayBuffer) return file.data;
  if (ArrayBuffer.isView(file.data)) return file.data.buffer.slice(file.data.byteOffset, file.data.byteOffset + file.data.byteLength);
  return file.arrayBuffer();
}

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2600);
}

function setModelUI(name) {
  $("#emptyState").classList.add("hidden");
  $("#activeModel").textContent = name;
  $("#modelName").textContent = name.toUpperCase();
  $("#modelDot").classList.add("on");
  $("#vrmFeature").classList.add("on");
  $("#vrmState").textContent = "READY";
  $("#stageDot").classList.add("on");
  $("#stageLabel").textContent = "VRM READY";
}

function frameModel(model) {
  cameraTransition = null;
  const box = new THREE.Box3().setFromObject(model.scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const height = Math.max(size.y, .5);
  modelCenter.copy(center);
  modelHeight = height;
  modelFloorY = box.min.y;
  controls.target.set(center.x, center.y + height * .08, center.z);
  camera.position.set(center.x, center.y + height * .06, center.z + height * 1.18);
  controls.minDistance = height * .28;
  controls.maxDistance = height * 3;
  camera.near = Math.max(.01, height / 100);
  camera.far = height * 20;
  camera.updateProjectionMatrix();
  lookTarget.position.set(center.x, center.y + height * .22, center.z + height * 1.4);
  if (model.lookAt) model.lookAt.target = lookTarget;
  controls.update();
}

function applyCameraPreset(preset) {
  if (!vrm) {
    toast("先にVRMを読み込んでください");
    return;
  }
  const layouts = {
    full: { targetY: .08, cameraY: .06, distance: 1.18 },
    bust: { targetY: .2, cameraY: .2, distance: .78 },
    face: { targetY: .38, cameraY: .38, distance: .46 }
  };
  const layout = layouts[preset];
  if (!layout) return;
  const target = new THREE.Vector3(
    modelCenter.x,
    modelCenter.y + modelHeight * layout.targetY,
    modelCenter.z
  );
  const position = new THREE.Vector3(
    modelCenter.x,
    modelCenter.y + modelHeight * layout.cameraY,
    modelCenter.z + modelHeight * layout.distance
  );
  cameraTransition = {
    startedAt: elapsedTime,
    duration: .55,
    fromPosition: camera.position.clone(),
    fromTarget: controls.target.clone(),
    toPosition: position,
    toTarget: target
  };
}

for (const button of document.querySelectorAll("[data-camera-preset]")) {
  button.onclick = () => applyCameraPreset(button.dataset.cameraPreset);
}
controls.addEventListener("start", () => { cameraTransition = null; });

function applyLightingPreset(preset, persist = true) {
  const presets = {
    soft: {
      sky: 0xbfc8ff, ground: 0x30204e, hemisphere: 2.2,
      key: 0xffffff, keyIntensity: 2.8, rim: 0x8b6cff, rimIntensity: 2.2
    },
    bright: {
      sky: 0xe8f3ff, ground: 0x4a526d, hemisphere: 2.8,
      key: 0xffffff, keyIntensity: 3.6, rim: 0x91baff, rimIntensity: 1.5
    },
    stage: {
      sky: 0x9fb5ff, ground: 0x24183c, hemisphere: 1.6,
      key: 0xfff2e3, keyIntensity: 2.5, rim: 0x9b6cff, rimIntensity: 3.3
    }
  };
  const values = presets[preset];
  if (!values) return;
  lightingPreset = preset;
  hemisphereLight.color.setHex(values.sky);
  hemisphereLight.groundColor.setHex(values.ground);
  hemisphereLight.intensity = values.hemisphere;
  keyLight.color.setHex(values.key);
  keyLight.intensity = values.keyIntensity;
  rimLight.color.setHex(values.rim);
  rimLight.intensity = values.rimIntensity;
  for (const button of document.querySelectorAll("[data-lighting-preset]")) {
    button.classList.toggle("active", button.dataset.lightingPreset === preset);
  }
  if (persist) saveSettings();
}

for (const button of document.querySelectorAll("[data-lighting-preset]")) {
  button.onclick = () => applyLightingPreset(button.dataset.lightingPreset);
}
applyLightingPreset(lightingPreset, false);

function updateCameraTransition() {
  if (!cameraTransition) return;
  const progress = THREE.MathUtils.clamp(
    (elapsedTime - cameraTransition.startedAt) / cameraTransition.duration,
    0,
    1
  );
  const eased = progress * progress * (3 - 2 * progress);
  camera.position.lerpVectors(
    cameraTransition.fromPosition,
    cameraTransition.toPosition,
    eased
  );
  controls.target.lerpVectors(
    cameraTransition.fromTarget,
    cameraTransition.toTarget,
    eased
  );
  if (progress >= 1) {
    cameraTransition = null;
    saveModelProfile();
  }
}

function resetFootIK() {
  if (!vrm) return;
  smoothedGroundCorrection = 0;
  groundCorrectionInitialized = false;
  rootHeightWasStabilized = false;
  vrm.scene.updateMatrixWorld(true);
  for (const [side, boneName] of [
    ["left", VRMHumanBoneName.LeftFoot],
    ["right", VRMHumanBoneName.RightFoot]
  ]) {
    const foot = vrm.humanoid?.getNormalizedBoneNode(boneName);
    const state = footGroundState[side];
    if (!foot) continue;
    const position = foot.getWorldPosition(new THREE.Vector3());
    state.floorOffset = Math.max(0, position.y - modelFloorY);
  }
}

function makeClipLoopSeamless(sourceClip) {
  const clip = sourceClip.clone();
  const duration = clip.duration;
  const blendWindow = Math.min(duration * .12, .35);
  if (!(blendWindow > .03)) return clip;
  const smoothstep = (value) => value * value * (3 - 2 * value);

  for (const track of clip.tracks) {
    const valueSize = track.getValueSize();
    const count = track.times.length;
    if (count < 2 || valueSize < 1) continue;
    const trackEnd = track.times[count - 1];
    const trackBlendWindow = Math.min(trackEnd * .12, blendWindow);
    if (!(trackBlendWindow > .03)) continue;
    const first = Array.from(track.values.slice(0, valueSize));
    const lastOffset = (count - 1) * valueSize;
    const last = Array.from(track.values.slice(lastOffset, lastOffset + valueSize));
    const isQuaternion = track.name.endsWith(".quaternion") && valueSize === 4;
    let seam;

    if (isQuaternion) {
      const firstQuaternion = new THREE.Quaternion().fromArray(first);
      const lastQuaternion = new THREE.Quaternion().fromArray(last);
      seam = firstQuaternion.clone().slerp(lastQuaternion, .5).normalize().toArray();
    } else {
      seam = first.map((value, index) => (value + last[index]) * .5);
    }

    for (let index = 0; index < count; index += 1) {
      const time = track.times[index];
      const distanceToSeam = Math.min(time, trackEnd - time);
      if (distanceToSeam >= trackBlendWindow) continue;
      const originalWeight = smoothstep(
        THREE.MathUtils.clamp(distanceToSeam / trackBlendWindow, 0, 1)
      );
      const offset = index * valueSize;
      if (isQuaternion) {
        const original = new THREE.Quaternion().fromArray(track.values, offset);
        const blended = new THREE.Quaternion().fromArray(seam)
          .slerp(original, originalWeight)
          .normalize();
        blended.toArray(track.values, offset);
      } else {
        for (let component = 0; component < valueSize; component += 1) {
          track.values[offset + component] = THREE.MathUtils.lerp(
            seam[component],
            track.values[offset + component],
            originalWeight
          );
        }
      }
    }
  }
  clip.resetDuration();
  return clip;
}

function isClipLoopContinuous(clip) {
  let worstGap = 0;
  for (const track of clip.tracks) {
    const size = track.getValueSize();
    const count = track.times.length;
    if (count < 3) continue;
    const firstGap = Math.max(1e-6, track.times[1] - track.times[0]);
    const lastGap = Math.max(1e-6, track.times[count - 1] - track.times[count - 2]);
    const firstOffset = 0;
    const secondOffset = size;
    const beforeLastOffset = (count - 2) * size;
    const lastOffset = (count - 1) * size;
    let startSpeed;
    let endSpeed;
    if (track.name.endsWith(".quaternion") && size === 4) {
      const first = new THREE.Quaternion().fromArray(track.values, firstOffset).normalize();
      const second = new THREE.Quaternion().fromArray(track.values, secondOffset).normalize();
      const beforeLast = new THREE.Quaternion().fromArray(track.values, beforeLastOffset).normalize();
      const last = new THREE.Quaternion().fromArray(track.values, lastOffset).normalize();
      startSpeed = first.angleTo(second) / firstGap;
      endSpeed = beforeLast.angleTo(last) / lastGap;
    } else {
      let startDistance = 0;
      let endDistance = 0;
      for (let component = 0; component < size; component += 1) {
        startDistance += Math.pow(
          track.values[secondOffset + component] - track.values[firstOffset + component],
          2
        );
        endDistance += Math.pow(
          track.values[lastOffset + component] - track.values[beforeLastOffset + component],
          2
        );
      }
      startSpeed = Math.sqrt(startDistance) / firstGap;
      endSpeed = Math.sqrt(endDistance) / lastGap;
    }
    worstGap = Math.max(worstGap, Math.abs(startSpeed - endSpeed));
  }
  return worstGap < .001;
}

function setupMotionActions() {
  activeAction?.stop();
  mixer?.stopAllAction();
  mixer = vrm ? new THREE.AnimationMixer(vrm.scene) : null;
  for (const slot of motionSlots) motionActions[slot] = null;
  activeAction = null;
  activeMotionSlot = "";
  retiringActions.clear();
  motionTargetSpeeds.clear();
  seamlessLoopPartners.clear();
  seamlessLoopTransitionUntil = 0;
  motionTransitionUntil = 0;
  queuedMotionRequest = null;
  for (const button of document.querySelectorAll("[data-motion-slot]")) {
    button.classList.remove("playing");
  }
  oneShotPlaying = false;
  if (!vrm || !mixer) return;
  mixer.addEventListener("finished", (event) => {
    if (event.action !== activeAction) return;
    const finishedSlot = activeMotionSlot;
    oneShotPlaying = false;
    if (finishedSlot === "emphasis") {
      const normalSpeechSlots = ["talk", "talkAlt"].filter((slot) => motionActions[slot]);
      if (speaking && normalSpeechSlots.length) {
        selectedSpeechMotion = normalSpeechSlots.find(
          (slot) => slot !== previousSpeechMotion
        ) || normalSpeechSlots[0];
        previousSpeechMotion = selectedSpeechMotion;
        selectMotion(selectedSpeechMotion);
      } else {
        selectMotion("idle");
      }
      return;
    }
    selectMotion(speaking ? selectedSpeechMotion : "idle");
  });
  mixer.addEventListener("loop", (event) => {
    const slot = motionSlots.find((name) => motionActions[name] === event.action);
    if (slot === "idle") {
      motionTargetSpeeds.set(event.action, motionPlaybackSpeed * (.975 + Math.random() * .05));
    } else if (slot === "talk" || slot === "talkAlt") {
      motionTargetSpeeds.set(event.action, motionPlaybackSpeed * (.985 + Math.random() * .03));
    }
  });
  for (const slot of motionSlots) {
    const animation = motionAnimations[slot];
    if (!animation) continue;
    const sourceClip = createVRMAnimationClip(animation, vrm);
    const clip = slot === "idle" || oneShotSlots.has(slot)
      ? sourceClip
      : makeClipLoopSeamless(sourceClip);
    const action = mixer.clipAction(clip);
    const idleNeedsCrossfade = slot === "idle" && !isClipLoopContinuous(clip);
    if (idleNeedsCrossfade) {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = false;
    } else if (oneShotSlots.has(slot)) {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    } else {
      action.setLoop(THREE.LoopRepeat, Infinity);
    }
    motionActions[slot] = action;
    motionTargetSpeeds.set(action, motionPlaybackSpeed);
    if (idleNeedsCrossfade) {
      const partnerClip = clip.clone();
      partnerClip.name = `${clip.name || "Idle"}__seamless_partner`;
      const partner = mixer.clipAction(partnerClip);
      partner.setLoop(THREE.LoopOnce, 1);
      partner.clampWhenFinished = false;
      motionTargetSpeeds.set(partner, motionPlaybackSpeed);
      seamlessLoopPartners.set(action, partner);
      seamlessLoopPartners.set(partner, action);
    }
    const slotButton = $(`[data-motion-slot="${slot}"]`);
    const loopLabel = oneShotSlots.has(slot) ? "1×" : "∞";
    slotButton.querySelector("span").textContent =
      `${motionSlotLabels[slot]} · ${clip.duration.toFixed(1)}s · ${loopLabel}`;
    slotButton.title = `${slotButton.querySelector("b").textContent} / ${clip.duration.toFixed(2)}秒 / ${oneShotSlots.has(slot) ? "1回再生" : "ループ"} / 右クリックで解除`;
  }
  const first = motionActions.idle || motionActions.talk || motionActions.talkAlt || motionActions.emphasis;
  if (first) {
    first.reset().setEffectiveTimeScale(motionPlaybackSpeed).fadeIn(.2 * motionFadeScale).play();
    activeAction = first;
    activeMotionSlot = motionSlots.find((slot) => motionActions[slot] === first) || "";
    $(`[data-motion-slot="${activeMotionSlot}"]`)?.classList.add("playing");
  }
}

function motionTransitionDuration(fromSlot, toSlot, requestedDuration) {
  if (Number.isFinite(requestedDuration)) return requestedDuration * motionFadeScale;
  if (toSlot === "idle") return .62 * motionFadeScale;
  if (toSlot === "emphasis") return .46 * motionFadeScale;
  if (fromSlot === "emphasis") return .56 * motionFadeScale;
  if (oneShotSlots.has(toSlot)) return .34 * motionFadeScale;
  if (toSlot === "listen") return .5 * motionFadeScale;
  if (fromSlot === "talk" || fromSlot === "talkAlt") {
    if (toSlot === "talk" || toSlot === "talkAlt") return .5 * motionFadeScale;
  }
  if (fromSlot === "idle") return .38 * motionFadeScale;
  return .42 * motionFadeScale;
}

function transitionMotion(next, slot, requestedDuration) {
  if (!next || next === activeAction) return;
  const previous = activeAction;
  const previousSlot = activeMotionSlot;
  const duration = motionTransitionDuration(previousSlot, slot, requestedDuration);
  retiringActions.delete(next);

  const preservePhase = previous &&
    (previousSlot === "talk" || previousSlot === "talkAlt") &&
    (slot === "talk" || slot === "talkAlt");
  const previousDuration = previous?.getClip().duration || 0;
  const nextDuration = next.getClip().duration || 0;
  const phase = previousDuration > 0 ? (previous.time % previousDuration) / previousDuration : 0;

  next.reset().setEffectiveTimeScale(motionPlaybackSpeed).setEffectiveWeight(1).play();
  motionTargetSpeeds.set(next, motionPlaybackSpeed);
  if (preservePhase && nextDuration > 0) next.time = phase * nextDuration;
  if (previous) {
    next.crossFadeFrom(previous, duration, false);
    retiringActions.set(previous, elapsedTime + duration + .08);
  } else {
    next.fadeIn(duration);
  }
  activeAction = next;
  activeMotionSlot = slot;
  motionTransitionUntil = elapsedTime + duration + .1;
  if (oneShotSlots.has(slot)) oneShotPlaying = true;
  if (slot === "emphasis") lastEmphasisTime = elapsedTime;
  for (const button of document.querySelectorAll("[data-motion-slot]")) {
    button.classList.toggle("playing", button.dataset.motionSlot === slot);
  }
}

function updateSeamlessIdleLoop() {
  if (activeMotionSlot !== "idle" || !activeAction) return;
  if (elapsedTime < seamlessLoopTransitionUntil) return;
  const partner = seamlessLoopPartners.get(activeAction);
  if (!partner) return;
  const duration = activeAction.getClip().duration;
  const overlap = Math.min(1, duration * .25);
  if (!(overlap > .05) || activeAction.time < duration - overlap) return;

  partner.reset()
    .setEffectiveTimeScale(activeAction.timeScale)
    .setEffectiveWeight(1)
    .play();
  partner.crossFadeFrom(activeAction, overlap, false);
  motionTargetSpeeds.set(partner, motionPlaybackSpeed);
  retiringActions.set(activeAction, elapsedTime + overlap + .05);
  activeAction = partner;
  seamlessLoopTransitionUntil = elapsedTime + overlap + .06;
}

function selectMotion(slot, duration) {
  if (oneShotPlaying) return;
  const next = motionActions[slot] || motionActions.talk || motionActions.talkAlt || motionActions.emphasis || motionActions.idle;
  const resolvedSlot = motionSlots.find((name) => motionActions[name] === next) || slot;
  if (resolvedSlot === activeMotionSlot) {
    queuedMotionRequest = null;
    return;
  }
  if (elapsedTime < motionTransitionUntil) {
    // Keep only the newest request. This prevents three or more VRMA actions
    // contributing to the same bones when speech state changes rapidly.
    queuedMotionRequest = { slot: resolvedSlot, duration };
    return;
  }
  queuedMotionRequest = null;
  transitionMotion(next, resolvedSlot, duration);
}

function updateQueuedMotion() {
  if (!queuedMotionRequest || oneShotPlaying || elapsedTime < motionTransitionUntil) return;
  const request = queuedMotionRequest;
  queuedMotionRequest = null;
  selectMotion(request.slot, request.duration);
}

function playMotion(slot) {
  const next = motionActions[slot];
  if (!next) {
    toast(`${slot.toUpperCase()}のVRMAを読み込んでください`);
    return;
  }
  if (slot === "listen") {
    oneShotPlaying = false;
    selectMotion("listen");
    return;
  }
  selectMotion(slot);
}

async function loadVRMA(file, slot = "idle", persist = true) {
  if (!file || !file.name.toLowerCase().endsWith(".vrma")) {
    toast("VRMAファイルを選択してください");
    return;
  }
  try {
    const data = await fileData(file);
    const gltf = await new Promise((resolve, reject) => animationLoader.parse(data, "", resolve, reject));
    const animation = gltf.userData.vrmAnimations?.[0];
    if (!animation) throw new Error("VRM Animationを認識できません");
    motionAnimations[slot] = animation;
    if (persist) await saveLocalFile(`motion:${slot}`, file, data);
    $(`#${slot}MotionName`).textContent = file.name;
    $(`[data-motion-slot="${slot}"]`).classList.add("loaded");
    setupMotionActions();
    const labels = { idle: "待機", talk: "会話A", talkAlt: "会話B", emphasis: "強調", listen: "傾聴", nod: "うなずき", greeting: "挨拶" };
    toast(`${labels[slot]}モーションを読み込みました`);
  } catch (error) {
    console.error(error);
    toast(`VRMAを読み込めません: ${error.message}`);
  }
}

async function clearVRMA(slot) {
  if (!motionAnimations[slot]) return;
  const button = $(`[data-motion-slot="${slot}"]`);
  const filename = button.querySelector("b").textContent;
  if (!confirm(`${motionSlotLabels[slot]} の「${filename}」を解除しますか？`)) return;
  motionAnimations[slot] = null;
  await deleteLocalFile(`motion:${slot}`);
  button.classList.remove("loaded", "playing");
  button.querySelector("span").textContent = motionSlotLabels[slot];
  button.querySelector("b").textContent = slot === "idle" || slot === "talk" ? "VRMAを選択" : "任意";
  button.removeAttribute("title");
  setupMotionActions();
  toast(`${motionSlotLabels[slot]}モーションを解除しました`);
}

function rememberBone(name) {
  if (!name) return;
  const node = vrm?.humanoid?.getNormalizedBoneNode(name);
  if (node) {
    restBones.set(name, node.quaternion.clone());
    restPositions.set(name, node.position.clone());
  }
}

async function loadVRM(file, persist = true) {
  if (!file || !file.name.toLowerCase().endsWith(".vrm")) {
    toast("VRMファイルを選択してください");
    return;
  }
  $("#stageLabel").textContent = "LOADING";
  $("#modelName").textContent = file.name;
  try {
    const data = await fileData(file);
    const gltf = await new Promise((resolve, reject) => loader.parse(data, "", resolve, reject));
    const next = gltf.userData.vrm;
    if (!next) throw new Error("VRMデータを認識できません");
    if (vrm) {
      scene.remove(vrm.scene);
      VRMUtils.deepDispose(vrm.scene);
    }
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons(gltf.scene);
    VRMUtils.rotateVRM0(next);
    vrm = next;
    if (persist) await saveLocalFile("model", file, data);
    modelFilename = file.name;
    scene.add(vrm.scene);
    restBones = new Map();
    restPositions = new Map();
    [
      VRMHumanBoneName.Hips,
      VRMHumanBoneName.Spine,
      VRMHumanBoneName.Chest,
      VRMHumanBoneName.UpperChest,
      VRMHumanBoneName.Neck,
      VRMHumanBoneName.Head,
      VRMHumanBoneName.LeftShoulder,
      VRMHumanBoneName.RightShoulder,
      VRMHumanBoneName.LeftUpperArm,
      VRMHumanBoneName.RightUpperArm,
      VRMHumanBoneName.LeftLowerArm,
      VRMHumanBoneName.RightLowerArm,
      VRMHumanBoneName.LeftHand,
      VRMHumanBoneName.RightHand,
      VRMHumanBoneName.LeftUpperLeg,
      VRMHumanBoneName.RightUpperLeg,
      VRMHumanBoneName.LeftLowerLeg,
      VRMHumanBoneName.RightLowerLeg,
      VRMHumanBoneName.LeftFoot,
      VRMHumanBoneName.RightFoot
    ].forEach(rememberBone);
    frameModel(vrm);
    restoreModelProfile(file.name);
    resetFootIK();
    setupMotionActions();
    setModelUI(file.name);
  } catch (error) {
    console.error(error);
    $("#stageLabel").textContent = "LOAD ERROR";
    toast(`VRMを読み込めません: ${error.message}`);
  }
}

function handleFiles(files) {
  const all = [...files];
  const model = all.find((item) => item.name.toLowerCase().endsWith(".vrm"));
  const animations = all.filter((item) => item.name.toLowerCase().endsWith(".vrma"));
  if (model) loadVRM(model);
  const openSlots = motionSlots.filter((slot) => !motionAnimations[slot]);
  animations.forEach((file, index) => loadVRMA(file, openSlots[index] || "talkAlt"));
  if (!model && !animations.length) toast("VRMまたはVRMAファイルをドロップしてください");
}

for (const button of [$("#chooseModel"), $("#changeModel")]) button.onclick = () => $("#modelFile").click();
$("#modelFile").onchange = (event) => handleFiles(event.target.files);
document.querySelectorAll("[data-motion-slot]").forEach((button) => {
  button.onclick = () => {
    requestedMotionSlot = button.dataset.motionSlot;
    $("#motionFile").click();
  };
  button.oncontextmenu = (event) => {
    event.preventDefault();
    clearVRMA(button.dataset.motionSlot).catch((error) => {
      console.error(error);
      toast(`VRMAを解除できません: ${error.message}`);
    });
  };
});
document.querySelectorAll("[data-play-motion]").forEach((button) => {
  button.onclick = () => playMotion(button.dataset.playMotion);
});
$("#lipTest").onclick = () => {
  if (!vrm) return toast("先にVRMを読み込んでください");
  lipTestUntil = elapsedTime + 1.2;
};
$("#motionFile").onchange = (event) => {
  loadVRMA(event.target.files[0], requestedMotionSlot);
  event.target.value = "";
};
for (const eventName of ["dragenter", "dragover"]) {
  stage.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    $("#dropCover").classList.add("show");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  stage.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (eventName === "drop") handleFiles(event.dataTransfer.files);
    $("#dropCover").classList.remove("show");
  });
}
async function enumerateDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs = devices.filter((device) => device.kind === "audioinput");
  const selected = $("#inputDevice").value || savedSettings.inputDeviceId || "";
  $("#inputDevice").replaceChildren(...inputs.map((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || `入力デバイス ${index + 1}`;
    return option;
  }));
  if (inputs.some((item) => item.deviceId === selected)) $("#inputDevice").value = selected;
  knownInputDeviceSignature = inputs.map((device) => device.deviceId).sort().join("|");
  return inputs;
}

async function startAudio() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs = devices.filter((device) => device.kind === "audioinput");
  const selectedDeviceId = $("#inputDevice").value;
  const deviceId = inputs.some((device) => device.deviceId === selectedDeviceId)
    ? selectedDeviceId
    : "";
  const audioOptions = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false
  };

  if (selectedDeviceId && !deviceId) {
    $("#inputDevice").value = "";
    localStorage.setItem("neon-settings", JSON.stringify({
      sensitivity,
      motionAmount,
      inputDeviceId: ""
    }));
  }

  try {
    stream = deviceId
      ? await navigator.mediaDevices.getUserMedia({
          audio: { ...audioOptions, deviceId: { exact: deviceId } }
        })
      : await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    const unavailableDevice = (
      error.name === "NotFoundError" ||
      error.name === "OverconstrainedError" ||
      /device not found|requested device not found/i.test(error.message)
    );
    if (!deviceId || !unavailableDevice) throw error;

    // Device IDs can change after reconnecting a cable or moving to another PC.
    $("#inputDevice").value = "";
    localStorage.setItem("neon-settings", JSON.stringify({
      sensitivity,
      motionAmount,
      inputDeviceId: ""
    }));
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    toast("保存済みデバイスが見つからないため、既定の入力へ切り替えました");
  }
  audio = new AudioContext();
  analyser = audio.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = .48;
  audioWaveData = new Float32Array(analyser.fftSize);
  audioSpectrumData = new Uint8Array(analyser.frequencyBinCount);
  audio.createMediaStreamSource(stream).connect(analyser);
  for (const track of stream.getAudioTracks()) {
    track.addEventListener("ended", () => {
      if (!linked || !stream?.getTracks().includes(track)) return;
      stopAudio();
      toast("使用中の音声入力が切断されました");
    });
  }
  linked = true;
  lipFrameQueue.length = 0;
  noiseFloorDb = -60;
  audioCalibrationUntil = elapsedTime + .8;
  $("#audioButton").classList.add("active");
  $("#audioButton b").textContent = "音声リンク停止";
  $("#voiceFeature").classList.add("on");
  $("#voiceState").textContent = "WAIT";
  await enumerateDevices();
}

function stopAudio() {
  linked = false;
  stream?.getTracks().forEach((track) => track.stop());
  audio?.close();
  stream = null;
  audio = null;
  analyser = null;
  audioWaveData = null;
  audioSpectrumData = null;
  lipFrameQueue.length = 0;
  targetMouth = 0;
  for (const key in targetViseme) targetViseme[key] = 0;
  $("#audioButton").classList.remove("active");
  $("#audioButton b").textContent = "音声リンク開始";
  $("#voiceFeature").classList.remove("on");
  $("#voiceState").textContent = "OFF";
  $("#levelBar").style.width = "0";
  $("#levelText").textContent = "-∞";
}

$("#audioButton").onclick = async () => {
  try {
    if (linked) stopAudio();
    else await startAudio();
  } catch (error) {
    const detail = error.name === "NotFoundError"
      ? "Windowsに有効な録音デバイスがありません"
      : error.name === "NotAllowedError"
        ? "マイクの使用が許可されていません"
        : error.name === "NotReadableError"
          ? "入力デバイスが他のアプリで使用中です"
          : error.message;
    toast(`音声入力を開始できません: ${detail}`);
  }
};
$("#inputDevice").onchange = async () => {
  saveSettings();
  if (linked) { stopAudio(); await startAudio(); }
};

function applyBackgroundMode() {
  document.body.classList.toggle("bg-transparent", backgroundMode === "transparent");
  document.body.classList.toggle("bg-green", backgroundMode === "green");
  floor.visible = backgroundMode === "blue";
  $("#backgroundMode").value = backgroundMode;
}

$("#backgroundMode").onchange = (event) => {
  backgroundMode = event.target.value;
  applyBackgroundMode();
  saveSettings();
};
applyBackgroundMode();

function applyRenderQuality() {
  autoQualityLowWindows = 0;
  autoQualityHighWindows = 0;
  renderer.setPixelRatio(Math.min(devicePixelRatio, renderPixelRatios[renderQuality]));
  $("#renderQuality").value = renderQuality;
  resize();
}

$("#renderQuality").onchange = (event) => {
  renderQuality = event.target.value;
  applyRenderQuality();
  saveSettings();
};
applyRenderQuality();

$("#idleExpressionPreset").onchange = (event) => {
  idleExpressionPreset = event.target.value;
  saveSettings();
};
$("#emphasisExpressionPreset").onchange = (event) => {
  emphasisExpressionPreset = event.target.value;
  saveSettings();
};

$("#sensitivity").oninput = (event) => {
  sensitivity = Number(event.target.value);
  $("#sensitivityValue").textContent = sensitivity.toFixed(2);
  saveSettings();
};
$("#lipDelay").oninput = (event) => {
  lipSyncDelayMs = Number(event.target.value);
  lipFrameQueue.length = 0;
  $("#lipDelayValue").textContent = `${lipSyncDelayMs.toFixed(0)} ms`;
  saveSettings();
};
$("#motion").oninput = (event) => {
  motionAmount = Number(event.target.value);
  $("#motionValue").textContent = motionAmount.toFixed(2);
  saveSettings();
};
$("#sensitivity").value = String(sensitivity);
$("#sensitivityValue").textContent = sensitivity.toFixed(2);
$("#lipDelay").value = String(lipSyncDelayMs);
$("#lipDelayValue").textContent = `${lipSyncDelayMs.toFixed(0)} ms`;
$("#motion").value = String(motionAmount);
$("#motionValue").textContent = motionAmount.toFixed(2);

function bindAmountRange(inputId, outputId, initialValue, update) {
  const input = $(`#${inputId}`);
  const output = $(`#${outputId}`);
  input.value = String(initialValue);
  output.textContent = initialValue.toFixed(2);
  input.oninput = (event) => {
    const value = Number(event.target.value);
    update(value);
    output.textContent = value.toFixed(2);
    saveSettings();
  };
}

bindAmountRange("naturalness", "naturalnessValue", naturalness, (value) => { naturalness = value; });
bindAmountRange("expressionAmount", "expressionValue", expressionAmount, (value) => { expressionAmount = value; });
bindAmountRange("gazeMotion", "gazeMotionValue", gazeMotionAmount, (value) => {
  gazeMotionAmount = value;
  if (value === 0) {
    targetEyeSaccadeX = 0;
    targetEyeSaccadeY = 0;
  }
});
bindAmountRange("nodAmount", "nodAmountValue", nodAmount, (value) => { nodAmount = value; });
bindAmountRange("playbackSpeed", "playbackSpeedValue", motionPlaybackSpeed, (value) => {
  motionPlaybackSpeed = value;
  for (const action of Object.values(motionActions)) {
    if (action) motionTargetSpeeds.set(action, value);
  }
});
bindAmountRange("fadeScale", "fadeScaleValue", motionFadeScale, (value) => { motionFadeScale = value; });

function syncSettingsUI() {
  for (const [inputId, outputId, value] of [
    ["sensitivity", "sensitivityValue", sensitivity],
    ["motion", "motionValue", motionAmount],
    ["naturalness", "naturalnessValue", naturalness],
    ["expressionAmount", "expressionValue", expressionAmount],
    ["gazeMotion", "gazeMotionValue", gazeMotionAmount],
    ["nodAmount", "nodAmountValue", nodAmount],
    ["playbackSpeed", "playbackSpeedValue", motionPlaybackSpeed],
    ["fadeScale", "fadeScaleValue", motionFadeScale]
  ]) {
    $(`#${inputId}`).value = String(value);
    $(`#${outputId}`).textContent = value.toFixed(2);
  }
  $("#lipDelay").value = String(lipSyncDelayMs);
  $("#lipDelayValue").textContent = `${lipSyncDelayMs.toFixed(0)} ms`;
  $("#idleExpressionPreset").value = idleExpressionPreset;
  $("#emphasisExpressionPreset").value = emphasisExpressionPreset;
}

syncSettingsUI();
controls.addEventListener("end", saveModelProfile);

const tuningPresets = {
  subtle: {
    motionAmount: .85,
    naturalness: .65,
    expressionAmount: .7,
    gazeMotionAmount: .65,
    nodAmount: .6,
    motionPlaybackSpeed: .96,
    motionFadeScale: 1.2
  },
  balanced: {
    motionAmount: 1,
    naturalness: 1,
    expressionAmount: 1,
    gazeMotionAmount: 1,
    nodAmount: 1,
    motionPlaybackSpeed: 1,
    motionFadeScale: 1
  },
  lively: {
    motionAmount: 1.15,
    naturalness: 1.3,
    expressionAmount: 1.2,
    gazeMotionAmount: 1.25,
    nodAmount: 1.15,
    motionPlaybackSpeed: 1.05,
    motionFadeScale: .85
  }
};

for (const button of document.querySelectorAll("[data-tuning-preset]")) {
  button.onclick = () => {
    const preset = tuningPresets[button.dataset.tuningPreset];
    if (!preset) return;
    ({
      motionAmount,
      naturalness,
      expressionAmount,
      gazeMotionAmount,
      nodAmount,
      motionPlaybackSpeed,
      motionFadeScale
    } = preset);
    for (const action of Object.values(motionActions)) {
      if (action) motionTargetSpeeds.set(action, motionPlaybackSpeed);
    }
    syncSettingsUI();
    saveSettings();
    toast(`${button.textContent}プリセットを適用しました`);
  };
}

$("#exportSettings").onclick = () => {
  saveSettings();
  const payload = {
    format: "neon-vrm-settings",
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: JSON.parse(localStorage.getItem("neon-settings") || "{}"),
    modelProfiles
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `neon-settings-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  toast("設定ファイルを書き出しました");
};

$("#importSettings").onclick = () => $("#settingsFile").click();
$("#settingsFile").onchange = async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error("設定ファイルが大きすぎます");
    const payload = JSON.parse(await file.text());
    if (
      payload?.format !== "neon-vrm-settings" ||
      payload.version !== 1 ||
      !payload.settings ||
      typeof payload.settings !== "object" ||
      Array.isArray(payload.settings) ||
      !payload.modelProfiles ||
      typeof payload.modelProfiles !== "object" ||
      Array.isArray(payload.modelProfiles)
    ) {
      throw new Error("NEON設定ファイルではありません");
    }
    localStorage.setItem("neon-settings", JSON.stringify(payload.settings));
    localStorage.setItem("neon-model-profiles", JSON.stringify(payload.modelProfiles));
    toast("設定を読み込みました。画面を更新します");
    setTimeout(() => location.reload(), 450);
  } catch (error) {
    toast(`設定を読み込めません: ${error.message}`);
  }
};

const packMagic = "NEONPACK1";
const packKeys = ["model", ...motionSlots.map((slot) => `motion:${slot}`)];

$("#exportPack").onclick = async () => {
  try {
    saveSettings();
    const metadata = [];
    const dataParts = [];
    for (const key of packKeys) {
      const stored = await readLocalFile(key);
      if (!stored?.data) continue;
      const data = stored.data instanceof ArrayBuffer
        ? stored.data
        : await new Blob([stored.data]).arrayBuffer();
      metadata.push({
        key,
        name: stored.name,
        type: stored.type || "application/octet-stream",
        length: data.byteLength
      });
      dataParts.push(data);
    }
    if (!metadata.some((entry) => entry.key === "model")) {
      throw new Error("保存済みVRMがありません");
    }
    const header = {
      format: "neon-environment-pack",
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: JSON.parse(localStorage.getItem("neon-settings") || "{}"),
      modelProfiles,
      entries: metadata
    };
    const encoder = new TextEncoder();
    const magicBytes = encoder.encode(packMagic);
    const headerBytes = encoder.encode(JSON.stringify(header));
    const headerLength = new Uint8Array(4);
    new DataView(headerLength.buffer).setUint32(0, headerBytes.byteLength, true);
    const blob = new Blob(
      [magicBytes, headerLength, headerBytes, ...dataParts],
      { type: "application/octet-stream" }
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `neon-environment-${new Date().toISOString().slice(0, 10)}.neonpack`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`環境パックを書き出しました（${metadata.length}ファイル）`);
  } catch (error) {
    toast(`環境パックを書き出せません: ${error.message}`);
  }
};

$("#importPack").onclick = () => $("#packFile").click();
$("#packFile").onchange = async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    const prefixLength = packMagic.length + 4;
    if (file.size < prefixLength) throw new Error("ファイルが壊れています");
    const prefix = await file.slice(0, prefixLength).arrayBuffer();
    const magic = new TextDecoder().decode(prefix.slice(0, packMagic.length));
    if (magic !== packMagic) throw new Error("NEON環境パックではありません");
    const headerLength = new DataView(prefix).getUint32(packMagic.length, true);
    if (headerLength <= 0 || headerLength > 10 * 1024 * 1024) {
      throw new Error("ヘッダーサイズが不正です");
    }
    const dataOffset = prefixLength + headerLength;
    if (dataOffset > file.size) throw new Error("ヘッダーが途中で終了しています");
    const header = JSON.parse(await file.slice(prefixLength, dataOffset).text());
    if (
      header?.format !== "neon-environment-pack" ||
      header.version !== 1 ||
      !Array.isArray(header.entries) ||
      !header.settings ||
      typeof header.settings !== "object" ||
      !header.modelProfiles ||
      typeof header.modelProfiles !== "object"
    ) {
      throw new Error("対応していない環境パックです");
    }
    const allowedKeys = new Set(packKeys);
    const seenKeys = new Set();
    let expectedSize = dataOffset;
    for (const entry of header.entries) {
      if (
        !allowedKeys.has(entry.key) ||
        seenKeys.has(entry.key) ||
        typeof entry.name !== "string" ||
        !Number.isSafeInteger(entry.length) ||
        entry.length < 0
      ) {
        throw new Error("ファイル一覧が不正です");
      }
      seenKeys.add(entry.key);
      expectedSize += entry.length;
    }
    if (!seenKeys.has("model")) throw new Error("VRMモデルが含まれていません");
    if (expectedSize !== file.size) throw new Error("データサイズが一致しません");
    if (!confirm("現在保存されているVRM・VRMA・設定を、この環境パックで置き換えますか？")) return;

    const importedEntries = [];
    let offset = dataOffset;
    for (const entry of header.entries) {
      const data = await file.slice(offset, offset + entry.length).arrayBuffer();
      importedEntries.push({ ...entry, data });
      offset += entry.length;
    }
    await replaceLocalFiles(importedEntries);
    localStorage.setItem("neon-settings", JSON.stringify(header.settings));
    localStorage.setItem("neon-model-profiles", JSON.stringify(header.modelProfiles));
    toast("環境パックを読み込みました。画面を更新します");
    setTimeout(() => location.reload(), 500);
  } catch (error) {
    console.error(error);
    toast(`環境パックを読み込めません: ${error.message}`);
  }
};

function setBroadcastMode(enabled, notify = true) {
  document.body.classList.toggle("broadcast", enabled);
  if (enabled && notify) toast("配信表示を開始しました。Escで戻ります");
  requestAnimationFrame(resize);
}

$("#broadcastMode").onclick = () => setBroadcastMode(true);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.body.classList.contains("broadcast")) {
    setBroadcastMode(false);
  }
});
stage.addEventListener("dblclick", () => {
  if (document.body.classList.contains("broadcast")) setBroadcastMode(false);
});
if (startupBroadcast) setBroadcastMode(true, false);

async function restoreSession() {
  try {
    const savedModel = await readLocalFile("model");
    const savedMotions = {};
    for (const slot of motionSlots) savedMotions[slot] = await readLocalFile(`motion:${slot}`);
    if (savedModel) {
      $("#stageLabel").textContent = "RESTORING";
      await loadVRM(savedModel, false);
    }
    for (const slot of motionSlots) {
      if (savedMotions[slot]) await loadVRMA(savedMotions[slot], slot, false);
    }
    if (savedModel) toast("前回のVRM・VRMA設定を復元しました");
  } catch (error) {
    console.warn("前回設定を復元できません", error);
    toast("前回設定の復元に失敗しました");
  }
}

function averageBand(data, sampleRate, fromHz, toHz) {
  const hzPerBin = sampleRate / (data.length * 2);
  const from = Math.max(0, Math.floor(fromHz / hzPerBin));
  const to = Math.min(data.length, Math.ceil(toHz / hzPerBin));
  let sum = 0;
  for (let i = from; i < to; i++) sum += data[i];
  return sum / Math.max(1, to - from) / 255;
}

function chooseSpeechMotion(intensity) {
  if (
    intensity > .58 &&
    motionActions.emphasis &&
    elapsedTime - lastEmphasisTime > 4.5
  ) return "emphasis";
  const normal = ["talk", "talkAlt"].filter((slot) => motionActions[slot]);
  if (!normal.length) return motionActions.emphasis ? "emphasis" : "talk";
  if (normal.length === 1) return normal[0];
  return normal.find((slot) => slot !== previousSpeechMotion) || normal[0];
}

function applyLipFrame(mouth, shapes) {
  if (lipSyncDelayMs <= 0) {
    lipFrameQueue.length = 0;
    targetMouth = mouth;
    Object.assign(targetViseme, shapes);
    return;
  }
  lipFrameQueue.push({ time: elapsedTime, mouth, shapes });
  const delayedTime = elapsedTime - lipSyncDelayMs / 1000;
  let delayedFrame = null;
  while (lipFrameQueue.length && lipFrameQueue[0].time <= delayedTime) {
    delayedFrame = lipFrameQueue.shift();
  }
  if (delayedFrame) {
    targetMouth = delayedFrame.mouth;
    Object.assign(targetViseme, delayedFrame.shapes);
  } else {
    targetMouth = 0;
    for (const key in targetViseme) targetViseme[key] = 0;
  }
  if (lipFrameQueue.length > 240) lipFrameQueue.splice(0, lipFrameQueue.length - 240);
}

function analyzeAudio() {
  if (!linked || !analyser || !audioWaveData || !audioSpectrumData) return;
  const wave = audioWaveData;
  const spectrum = audioSpectrumData;
  analyser.getFloatTimeDomainData(wave);
  analyser.getByteFrequencyData(spectrum);
  let sum = 0;
  for (const sample of wave) sum += sample * sample;
  const rms = Math.sqrt(sum / wave.length);
  const db = rms > 0 ? 20 * Math.log10(rms) : -100;
  const calibrating = elapsedTime < audioCalibrationUntil;
  const boundedDb = THREE.MathUtils.clamp(db, -72, -35);
  const canLearnNoise = calibrating || (!speaking && db < noiseFloorDb + 8);
  const learningRate = calibrating ? .12 : canLearnNoise ? .012 : .001;
  noiseFloorDb += (boundedDb - noiseFloorDb) * learningRate;
  noiseFloorDb = THREE.MathUtils.clamp(noiseFloorDb, -72, -42);
  const voiceThresholdDb = noiseFloorDb + 9;
  const gate = calibrating
    ? 0
    : THREE.MathUtils.clamp((db - voiceThresholdDb) / 22, 0, 1);
  const gateRise = gate - previousVoiceGate;
  const gateDrop = previousVoiceGate - gate;
  if (
    gate > .16 &&
    gateRise > .1 &&
    elapsedTime - lastProsodyImpulseTime > .72
  ) {
    prosodyImpulse = Math.max(prosodyImpulse, Math.min(.08, gateRise * .75));
    lastProsodyImpulseTime = elapsedTime;
  }
  if (speaking && gate > .025 && gateDrop > .09) {
    consonantClosure = Math.max(
      consonantClosure,
      THREE.MathUtils.clamp(gateDrop * 1.35, .08, .4)
    );
  }
  previousVoiceGate += (gate - previousVoiceGate) * .32;
  const rawSpeaking = gate > .07;
  if (rawSpeaking) lastVoiceTime = elapsedTime;
  // Preserve one conversational gesture through short gaps between syllables.
  const isSpeaking = rawSpeaking || elapsedTime - lastVoiceTime < .34;
  if (isSpeaking && !speaking) {
    gestureStart = elapsedTime;
    speechStartedAt = elapsedTime;
    nextSpeechMotionChange = elapsedTime + 3.6 + Math.random() * 2.4;
    gestureSide *= -1;
    selectedSpeechMotion = chooseSpeechMotion(gate);
    previousSpeechMotion = selectedSpeechMotion;
    selectMotion(selectedSpeechMotion);
  } else if (
    isSpeaking &&
    elapsedTime - speechStartedAt < .24 &&
    gate > .48 &&
    motionActions.emphasis &&
    elapsedTime - lastEmphasisTime > 4.5 &&
    selectedSpeechMotion !== "emphasis"
  ) {
    selectedSpeechMotion = "emphasis";
    previousSpeechMotion = "emphasis";
    selectMotion("emphasis");
  } else if (
    isSpeaking &&
    elapsedTime >= nextSpeechMotionChange &&
    gate < .42 &&
    !oneShotPlaying
  ) {
    const nextSpeechMotion = chooseSpeechMotion(gate);
    if (motionActions[nextSpeechMotion] && nextSpeechMotion !== activeMotionSlot) {
      selectedSpeechMotion = nextSpeechMotion;
      previousSpeechMotion = nextSpeechMotion;
      gestureStart = elapsedTime;
      gestureSide *= -1;
      selectMotion(nextSpeechMotion);
    }
    nextSpeechMotionChange = elapsedTime + 3.8 + Math.random() * 3.2;
  } else if (!isSpeaking && speaking) {
    selectMotion("idle");
  }
  speaking = isSpeaking;
  audioLevel += (gate - audioLevel) * .24;
  const nextMouth = Math.min(1, gate * sensitivity) * (1 - consonantClosure);

  const rate = audio.sampleRate;
  const f1Low = averageBand(spectrum, rate, 180, 380);
  const f1Mid = averageBand(spectrum, rate, 380, 650);
  const f1High = averageBand(spectrum, rate, 650, 1000);
  const f2Low = averageBand(spectrum, rate, 700, 1250);
  const f2High = averageBand(spectrum, rate, 1900, 3200);
  const raw = {
    aa: f1High * 1.9 + f2Low * .7,
    ih: f1Low * 1.1 + f2High * 2.1,
    ou: f1Low * 1.2 + f2Low * 1.75,
    ee: f1Mid * 1.45 + f2High * 1.35,
    oh: f1Mid * 1.35 + f2Low * 1.65
  };
  // Emphasize the dominant vowel while retaining neighboring shapes for
  // coarticulation. This avoids a muddy blend of all five mouth presets.
  const shaped = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, Math.pow(Math.max(0, value), 1.5)])
  );
  const total = Object.values(shaped).reduce((a, b) => a + b, 0) || 1;
  const nextViseme = {};
  for (const key in shaped) nextViseme[key] = gate > .02 ? shaped[key] / total : 0;
  applyLipFrame(nextMouth, nextViseme);
  $("#levelBar").style.width = `${audioLevel * 100}%`;
  $("#levelText").textContent = db > -99 ? `${db.toFixed(0)}` : "-∞";
  $("#voiceState").textContent = calibrating ? "CAL" : gate > .04 ? "ACTIVE" : "WAIT";
}

function setExpression(name, value) {
  if (!vrm?.expressionManager) return;
  vrm.expressionManager.setValue(name, THREE.MathUtils.clamp(value, 0, 1));
}

function applyFacialExpressions(delta) {
  if (!vrm?.expressionManager) return;
  const testing = elapsedTime < lipTestUntil;
  const warmTarget = testing ? 0 : speaking
    ? .018 + smoothedMouth * .018
    : .035 + Math.sin(elapsedTime * .27) * .006;
  const engagedTarget = testing ? 0 : speaking && smoothedMouth > .5
    ? (smoothedMouth - .5) * .045
    : 0;
  const eyeTarget = testing ? 0 : .008 + (speaking ? smoothedMouth * .018 : 0);
  warmExpression = THREE.MathUtils.damp(warmExpression, warmTarget * expressionAmount, 2.2, delta);
  engagedExpression = THREE.MathUtils.damp(engagedExpression, engagedTarget * expressionAmount, 7, delta);
  eyeSoftness = THREE.MathUtils.damp(eyeSoftness, eyeTarget * expressionAmount, 3.5, delta);

  setExpression(VRMExpressionPresetName.Aa, testing ? .9 : viseme.aa * smoothedMouth);
  setExpression(VRMExpressionPresetName.Ih, testing ? 0 : viseme.ih * smoothedMouth);
  setExpression(VRMExpressionPresetName.Ou, testing ? 0 : viseme.ou * smoothedMouth);
  setExpression(VRMExpressionPresetName.Ee, testing ? 0 : viseme.ee * smoothedMouth);
  setExpression(VRMExpressionPresetName.Oh, testing ? 0 : viseme.oh * smoothedMouth);
  const automaticExpressions = {
    [VRMExpressionPresetName.Happy]: 0,
    [VRMExpressionPresetName.Relaxed]: 0,
    [VRMExpressionPresetName.Surprised]: 0
  };
  if (idleExpressionPreset !== "off") {
    automaticExpressions[idleExpressionPreset] = Math.max(
      automaticExpressions[idleExpressionPreset] || 0,
      warmExpression
    );
  }
  if (emphasisExpressionPreset !== "off") {
    automaticExpressions[emphasisExpressionPreset] = Math.max(
      automaticExpressions[emphasisExpressionPreset] || 0,
      engagedExpression
    );
  }
  for (const [name, value] of Object.entries(automaticExpressions)) setExpression(name, value);
  setExpression(VRMExpressionPresetName.Blink, Math.max(blink, eyeSoftness));
  // Apply after AnimationMixer/VRM updates so VRMA expression tracks cannot
  // overwrite the audio-driven mouth on the same frame.
  vrm.expressionManager.update();
}

function updateGaze(delta) {
  if (!vrm) return;
  const eyeHeight = modelCenter.y + modelHeight * .22;
  const targetX = THREE.MathUtils.clamp(
    (camera.position.x - modelCenter.x) / (modelHeight * 1.15),
    -1,
    1
  );
  const targetY = THREE.MathUtils.clamp(
    (camera.position.y - eyeHeight) / (modelHeight * .8),
    -.65,
    .65
  );
  // Eyes arrive first. Head follows with a lower damping rate.
  gazeX = THREE.MathUtils.damp(gazeX, targetX, 9.5, delta);
  gazeY = THREE.MathUtils.damp(gazeY, targetY, 9.5, delta);
  headGazeX = THREE.MathUtils.damp(headGazeX, gazeX, 3.4, delta);
  headGazeY = THREE.MathUtils.damp(headGazeY, gazeY, 3.4, delta);
  prosodyNod = THREE.MathUtils.damp(prosodyNod, prosodyImpulse, 4.2, delta);
  prosodyImpulse = THREE.MathUtils.damp(prosodyImpulse, 0, 2.8, delta);

  if (elapsedTime >= nextEyeSaccade) {
    const returnToLens = Math.random() < .28;
    const activity = speaking ? 1.22 : 1;
    targetEyeSaccadeX = returnToLens ? 0 : (Math.random() * 2 - 1) * modelHeight * .0085 * activity * gazeMotionAmount;
    targetEyeSaccadeY = returnToLens ? 0 : (Math.random() * 2 - 1) * modelHeight * .0048 * activity * gazeMotionAmount;
    nextEyeSaccade = elapsedTime + (speaking ? .3 : .42) + Math.random() * (speaking ? .72 : 1.05);
  }
  eyeSaccadeX = THREE.MathUtils.damp(eyeSaccadeX, targetEyeSaccadeX, 17, delta);
  eyeSaccadeY = THREE.MathUtils.damp(eyeSaccadeY, targetEyeSaccadeY, 17, delta);

  // Keep the target inside a tiny area around the camera lens. The avatar
  // remains camera-facing while avoiding a mechanically frozen eye pose.
  lookTarget.position.copy(camera.position);
  lookTarget.position.x += eyeSaccadeX;
  lookTarget.position.y += eyeSaccadeY;
  if (vrm.lookAt) vrm.lookAt.target = lookTarget;

  const head = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Head);
  const neck = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Neck);
  const headDelta = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(
      -headGazeY * .032 + prosodyNod * .018 * nodAmount,
      headGazeX * .062,
      -headGazeX * .006 + prosodyNod * .003 * gestureSide * nodAmount
    )
  );
  const neckDelta = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(0, 0, 0)
  );
  head?.quaternion.multiply(headDelta);
  neck?.quaternion.multiply(neckDelta);
}

function applyFootGrounding(delta) {
  if (!vrm) return;
  const hips = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Hips);
  const leftFoot = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.LeftFoot);
  const rightFoot = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.RightFoot);
  const hipsRest = restPositions.get(VRMHumanBoneName.Hips);
  if (!hips || !leftFoot || !rightFoot || !hipsRest) return;

  // Remove accumulated root drift while preserving small lateral weight shifts.
  // Root Z keys differ substantially between some VRMA clips (especially
  // Emphasis), and repeatedly blending those keys looks like camera-facing
  // forward/back vibration.
  hips.position.x = THREE.MathUtils.damp(hips.position.x, hipsRest.x, 12, delta);
  hips.position.z = hipsRest.z;
  vrm.scene.updateMatrixWorld(true);

  const stabilizeRootHeight =
    speaking ||
    activeMotionSlot === "emphasis" ||
    elapsedTime < motionTransitionUntil;
  if (stabilizeRootHeight) {
    // Speech clips can contain small, fast Hips-Y keys. Combining those with
    // sole correction creates a visible vertical feedback wobble, so keep the
    // root height fixed until the conversational transition has settled.
    hips.position.y = hipsRest.y;
    smoothedGroundCorrection = 0;
    groundCorrectionInitialized = true;
    rootHeightWasStabilized = true;
    vrm.scene.updateMatrixWorld(true);
    return;
  }

  const left = leftFoot.getWorldPosition(leftFootWorldPosition);
  const right = rightFoot.getWorldPosition(rightFootWorldPosition);
  const leftSoleY = left.y - footGroundState.left.floorOffset;
  const rightSoleY = right.y - footGroundState.right.floorOffset;
  const plantedSoleY = Math.min(leftSoleY, rightSoleY);
  const maxCorrection = modelHeight * .12;
  const correction = THREE.MathUtils.clamp(modelFloorY - plantedSoleY, -maxCorrection, maxCorrection);
  if (rootHeightWasStabilized) {
    // Match the first settled Idle frame exactly. Starting the filter from
    // zero here causes a single visible hop after speech ends.
    smoothedGroundCorrection = correction;
    groundCorrectionInitialized = true;
    rootHeightWasStabilized = false;
  } else if (!groundCorrectionInitialized) {
    smoothedGroundCorrection = correction;
    groundCorrectionInitialized = true;
  } else {
    // Slow only the sudden correction changes produced by a VRMA crossfade.
    // Outside transitions, follow the floor more firmly to avoid foot float.
    const groundingRate = elapsedTime < motionTransitionUntil ? 5 : speaking ? 9 : 16;
    smoothedGroundCorrection = THREE.MathUtils.damp(
      smoothedGroundCorrection,
      correction,
      groundingRate,
      delta
    );
  }
  hips.position.y += smoothedGroundCorrection;
  vrm.scene.updateMatrixWorld(true);
}

function applyWeightShift(elapsed, delta) {
  if (!vrm) return;
  const hips = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Hips);
  const spine = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Spine);
  const chest = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Chest);
  const leftShoulder = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.LeftShoulder);
  const rightShoulder = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.RightShoulder);
  if (!hips) return;

  const speechEnergy = speaking ? .22 + smoothedMouth * .18 : 0;
  const target = Math.sin(elapsed * (.34 + speechEnergy));
  bodyWeightShift = THREE.MathUtils.damp(bodyWeightShift, target, 1.9, delta);
  chestWeightFollow = THREE.MathUtils.damp(chestWeightFollow, bodyWeightShift, 1.25, delta);
  shoulderWeightFollow = THREE.MathUtils.damp(shoulderWeightFollow, chestWeightFollow, .9, delta);

  const amount = motionAmount * naturalness * (activeAction ? .48 : .3);
  const hipLean = bodyWeightShift * .008 * amount;
  const chestCounterLean = -chestWeightFollow * .006 * amount;
  const shoulderLag = shoulderWeightFollow * .004 * amount;

  // Keep Y untouched so the sole-height correction remains authoritative.
  appliedHipWeightOffset = bodyWeightShift * modelHeight * .0025 * amount;
  hips.position.x += appliedHipWeightOffset;
  const addRotation = (node, z) => {
    if (!node) return;
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, z));
    node.quaternion.multiply(rotation);
    appliedWeightRotations.set(node, rotation);
  };
  addRotation(hips, hipLean);
  addRotation(spine, chestCounterLean * .55);
  addRotation(chest, chestCounterLean);
  addRotation(leftShoulder, -shoulderLag);
  addRotation(rightShoulder, -shoulderLag);
  vrm.scene.updateMatrixWorld(true);
}

function clearAppliedWeightShift() {
  if (!vrm) return;
  const hips = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Hips);
  if (hips) hips.position.x -= appliedHipWeightOffset;
  appliedHipWeightOffset = 0;
  for (const [node, rotation] of appliedWeightRotations) {
    node.quaternion.multiply(rotation.clone().invert());
  }
  appliedWeightRotations.clear();
}

function applyBreathing(elapsed, delta) {
  if (!vrm) return;
  const spine = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Spine);
  const chest = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Chest);
  const upperChest = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.UpperChest);
  const leftShoulder = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.LeftShoulder);
  const rightShoulder = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.RightShoulder);
  breathPhase += delta / breathCycleDuration;
  if (breathPhase >= 1) {
    breathPhase %= 1;
    breathCycleDuration = 3.3 + Math.random() * 2.1;
    breathDepth = Math.random() < .09
      ? 1.3 + Math.random() * .18
      : .88 + Math.random() * .22;
  }
  const inhaleEnd = .36;
  const smoothstep = (value) => value * value * (3 - 2 * value);
  const expansion = breathPhase < inhaleEnd
    ? smoothstep(breathPhase / inhaleEnd)
    : 1 - smoothstep((breathPhase - inhaleEnd) / (1 - inhaleEnd));
  const breath = (expansion - .32) * breathDepth;
  const uneven = Math.sin(elapsed * .73 + 1.4);
  const speechReduction = speaking ? .62 : 1;
  const amount = motionAmount * naturalness * speechReduction * (activeAction ? .52 : .34);
  const addRotation = (node, x, z = 0) => {
    if (!node) return;
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, 0, z));
    node.quaternion.multiply(rotation);
    appliedBreathRotations.set(node, rotation);
  };

  addRotation(spine, breath * .0024 * amount);
  addRotation(chest, breath * .0048 * amount);
  addRotation(upperChest, breath * .0055 * amount);
  addRotation(leftShoulder, -breath * .0018 * amount, uneven * .0012 * amount);
  addRotation(rightShoulder, -breath * .0017 * amount, -uneven * .001 * amount);
}

function clearAppliedBreathing() {
  for (const [node, rotation] of appliedBreathRotations) {
    node.quaternion.multiply(rotation.clone().invert());
  }
  appliedBreathRotations.clear();
}

function animateBones(elapsed) {
  if (!vrm) return;
  const amount = motionAmount;
  const breath = Math.sin(elapsed * 1.35);
  const sway = Math.sin(elapsed * .48);
  const weight = Math.sin(elapsed * .31);
  const wristDrift = Math.sin(elapsed * .82 + .7);
  const speechBeat = Math.sin(elapsed * 4.1) * smoothedMouth;
  const gestureProgress = (elapsed - gestureStart) / 1.75;
  const gesture = gestureProgress >= 0 && gestureProgress <= 1
    ? Math.sin(gestureProgress * Math.PI) * (.35 + smoothedMouth * .65)
    : 0;
  const leftGesture = gestureSide < 0 ? gesture : gesture * .2;
  const rightGesture = gestureSide > 0 ? gesture : gesture * .2;
  const motions = [
    [VRMHumanBoneName.Hips, 0, weight * .012 * amount, -sway * .018 * amount],
    [VRMHumanBoneName.Spine, breath * .008 * amount, sway * .007 * amount, -sway * .008 * amount],
    [VRMHumanBoneName.Chest, breath * .012 * amount, sway * .012 * amount, -sway * .012 * amount],
    [VRMHumanBoneName.UpperChest, breath * .008 * amount, sway * .009 * amount, -sway * .008 * amount],
    [VRMHumanBoneName.Neck, Math.sin(elapsed * .63) * .006 * amount, Math.sin(elapsed * .41) * .008 * amount, 0],
    [VRMHumanBoneName.Head, Math.sin(elapsed * .63) * .018 * amount, Math.sin(elapsed * .41) * .022 * amount, Math.sin(elapsed * .31) * .012 * amount],
    [VRMHumanBoneName.LeftShoulder, -breath * .006 * amount, 0, -.025 * leftGesture * amount],
    [VRMHumanBoneName.RightShoulder, -breath * .006 * amount, 0, .025 * rightGesture * amount],
    // Normalized VRM bones start in a T-pose. These ±Z rotations establish
    // a relaxed arms-down pose before idle motion and gestures are added.
    [VRMHumanBoneName.LeftUpperArm, -.13 + -.12 * leftGesture * amount, -.08 * leftGesture * amount, 1.08 + (-.58 * leftGesture - sway * .012) * amount],
    [VRMHumanBoneName.RightUpperArm, -.13 + -.12 * rightGesture * amount, .08 * rightGesture * amount, -1.08 + (.58 * rightGesture + sway * .012) * amount],
    // Elbows stay softly bent at rest and flex further during speech gestures.
    [VRMHumanBoneName.LeftLowerArm, -.12 - .32 * leftGesture * amount, -.44 - .48 * leftGesture * amount, -.06 - .08 * leftGesture * amount],
    [VRMHumanBoneName.RightLowerArm, -.12 - .32 * rightGesture * amount, .44 + .48 * rightGesture * amount, .06 + .08 * rightGesture * amount],
    // Wrists lag behind the forearms and add a small speech-driven turn.
    [VRMHumanBoneName.LeftHand,
      .08 + (.1 * leftGesture + wristDrift * .035 + speechBeat * .025) * amount,
      -.1 + (-.16 * leftGesture - speechBeat * .045) * amount,
      -.08 + (-.18 * leftGesture + wristDrift * .045) * amount],
    [VRMHumanBoneName.RightHand,
      .08 + (.1 * rightGesture - wristDrift * .035 + speechBeat * .025) * amount,
      .1 + (.16 * rightGesture + speechBeat * .045) * amount,
      .08 + (.18 * rightGesture - wristDrift * .045) * amount],
    [VRMHumanBoneName.LeftUpperLeg, .006 * breath * amount, 0, -.012 * weight * amount],
    [VRMHumanBoneName.RightUpperLeg, -.006 * breath * amount, 0, .012 * weight * amount],
    [VRMHumanBoneName.LeftLowerLeg, .01 * Math.max(0, weight) * amount, 0, 0],
    [VRMHumanBoneName.RightLowerLeg, .01 * Math.max(0, -weight) * amount, 0, 0],
    [VRMHumanBoneName.LeftFoot, -.006 * weight * amount, 0, 0],
    [VRMHumanBoneName.RightFoot, .006 * weight * amount, 0, 0]
  ];
  for (const [name, x, y, z] of motions) {
    const node = vrm.humanoid?.getNormalizedBoneNode(name);
    const rest = restBones.get(name);
    if (!node || !rest) continue;
    node.quaternion.copy(rest).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)));
  }
  const hips = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Hips);
  const hipsRest = restPositions.get(VRMHumanBoneName.Hips);
  if (hips && hipsRest) {
    hips.position.copy(hipsRest);
    hips.position.x += weight * .012 * amount;
    hips.position.y += (breath * .0025 - Math.abs(weight) * .0015) * amount;
  }
}

function updateBlink(now) {
  if (now >= nextBlink && !blinkStart) {
    const isFollowupBlink = nextBlinkIsFollowup;
    blinkStart = now;
    blinkDuration = 135 + Math.random() * 75;
    queuedDoubleBlink = !isFollowupBlink && Math.random() < .18;
    nextBlinkIsFollowup = false;
    if (!isFollowupBlink && Math.random() < .62) {
      const activity = speaking ? 1.18 : 1;
      targetEyeSaccadeX = (Math.random() * 2 - 1) * modelHeight * .007 * activity * gazeMotionAmount;
      targetEyeSaccadeY = (Math.random() * 2 - 1) * modelHeight * .004 * activity * gazeMotionAmount;
      nextEyeSaccade = elapsedTime + .55 + Math.random() * .75;
    }
  }
  if (!blinkStart) { blink += (0 - blink) * .35; return; }
  const phase = (now - blinkStart) / blinkDuration;
  // Eyelids close faster than they reopen.
  blink = phase < .38 ? phase / .38 : Math.max(0, 1 - (phase - .38) / .62);
  if (phase >= 1) {
    blink = 0;
    blinkStart = 0;
    if (queuedDoubleBlink) {
      queuedDoubleBlink = false;
      nextBlinkIsFollowup = true;
      nextBlink = now + 105 + Math.random() * 95;
    } else {
      // Speaking slightly increases blink frequency without synchronizing it
      // mechanically to every phrase.
      const speechFactor = speaking ? .78 : 1;
      nextBlink = now + (2100 + Math.random() * 4200) * speechFactor;
    }
  }
}

function resize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(1, height);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas);
resize();

function render(now) {
  requestAnimationFrame(render);
  const frameWorkStart = performance.now();
  const delta = Math.min(Math.max((now - lastRenderTime) / 1000, 0), .05);
  lastRenderTime = now;
  elapsedTime += delta;
  analyzeAudio();
  consonantClosure = THREE.MathUtils.damp(consonantClosure, 0, 16, delta);
  smoothedMouth = THREE.MathUtils.damp(
    smoothedMouth,
    targetMouth,
    targetMouth > smoothedMouth ? 22 : 11,
    delta
  );
  for (const key in viseme) {
    viseme[key] = THREE.MathUtils.damp(
      viseme[key],
      targetViseme[key],
      targetViseme[key] > viseme[key] ? 15 : 9,
      delta
    );
  }
  updateBlink(now);
  if (vrm) {
    clearAppliedBreathing();
    clearAppliedWeightShift();
    for (const [action, targetSpeed] of motionTargetSpeeds) {
      action.timeScale = THREE.MathUtils.damp(action.timeScale, targetSpeed, 1.6, delta);
    }
    updateSeamlessIdleLoop();
    mixer?.update(delta);
    for (const [action, stopAt] of retiringActions) {
      if (elapsedTime < stopAt || action === activeAction) continue;
      action.stop();
      retiringActions.delete(action);
    }
    updateQueuedMotion();
    if (!activeAction) animateBones(elapsedTime);
    applyFootGrounding(delta);
    applyWeightShift(elapsedTime, delta);
    applyBreathing(elapsedTime, delta);
    updateGaze(delta);
    vrm.update(delta);
    applyFacialExpressions(delta);
  }
  updateCameraTransition();
  controls.update();
  renderer.render(scene, camera);
  performanceFrameCount += 1;
  performanceWorkTotal += performance.now() - frameWorkStart;
  const performanceElapsed = now - performanceWindowStart;
  if (performanceElapsed >= 600) {
    const fps = performanceFrameCount * 1000 / performanceElapsed;
    const frameTime = performanceElapsed / Math.max(1, performanceFrameCount);
    const frameWork = performanceWorkTotal / Math.max(1, performanceFrameCount);
    if (renderQuality === "auto") {
      if (fps < 50 && frameWork > 10) {
        autoQualityLowWindows += 1;
        autoQualityHighWindows = 0;
      } else if (fps > 57 && frameWork < 7) {
        autoQualityHighWindows += 1;
        autoQualityLowWindows = 0;
      } else {
        autoQualityLowWindows = 0;
        autoQualityHighWindows = 0;
      }
      const maximumRatio = Math.min(devicePixelRatio, 2);
      const currentRatio = renderer.getPixelRatio();
      if (autoQualityLowWindows >= 3 && currentRatio > 1) {
        renderer.setPixelRatio(Math.max(1, currentRatio - .25));
        resize();
        autoQualityLowWindows = 0;
      } else if (autoQualityHighWindows >= 8 && currentRatio < maximumRatio) {
        renderer.setPixelRatio(Math.min(maximumRatio, currentRatio + .25));
        resize();
        autoQualityHighWindows = 0;
      }
    }
    const triangles = renderer.info.render.triangles;
    const triangleLabel = triangles >= 1000000
      ? `${(triangles / 1000000).toFixed(1)}M`
      : triangles >= 1000
        ? `${(triangles / 1000).toFixed(0)}K`
        : String(triangles);
    $("#performance").textContent =
      `FPS ${fps.toFixed(0)} / FRAME ${frameTime.toFixed(1)} / CPU ${frameWork.toFixed(1)} / TRI ${triangleLabel} / Q ${renderer.getPixelRatio().toFixed(1)}x / LIP ${lipSyncDelayMs.toFixed(0)} ms`;
    performanceWindowStart = now;
    performanceFrameCount = 0;
    performanceWorkTotal = 0;
  }
}
requestAnimationFrame(render);
restoreSession();

setInterval(() => {
  $("#clock").textContent = new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
}, 1000);
navigator.mediaDevices?.getUserMedia({ audio: true })
  .then((permissionStream) => {
    permissionStream.getTracks().forEach((track) => track.stop());
    return enumerateDevices();
  })
  .catch(() => {});

navigator.mediaDevices?.addEventListener("devicechange", () => {
  clearTimeout(deviceRefreshTimer);
  deviceRefreshTimer = setTimeout(async () => {
    const previousSignature = knownInputDeviceSignature;
    try {
      const inputs = await enumerateDevices();
      if (knownInputDeviceSignature !== previousSignature) {
        toast(inputs.length ? "音声入力デバイス一覧を更新しました" : "音声入力デバイスが見つかりません");
      }
    } catch (error) {
      console.warn("音声入力デバイスを更新できません", error);
    }
  }, 250);
});
