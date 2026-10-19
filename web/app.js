"use strict";

const ASPECTS = [["1:1", 1, 1], ["4:3", 4, 3], ["3:4", 3, 4], ["3:2", 3, 2], ["2:3", 2, 3], ["16:9", 16, 9], ["9:16", 9, 16]];
// The MOSS team recommends 1 to 2 MP and says the model extrapolates from 0.25 to 4 MP.
const MEGAPIXELS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4];
const SLG_LAYERS = [["", "Off"], ["22", "22"], ["24", "24"], ["26", "26"]];
// Recommended by the MOSS-Image authors (README and USERGUIDE.md): Euler, 50 steps, CFG 3,
// shift 5, uncond skip at layer 22, ~1 MP output, and their suggested negative tags minus "nsfw".
// The default prompt mixes both formats from USERGUIDE.md: a first line of tags in their recommended
// order (quality, score, meta, year, character, series, artist, general), then prose for the scene,
// framing, lighting and mood, with exact quoted text for lettering. The guide doesn't spell out score
// or year tags, so those follow Anima, whose order it matches. No artist tag: users report @artist
// tags barely work on MOSS.
const DEFAULTS = {
  prompt: "masterpiece, best quality, score_7, highres, year 2025, hatsune miku, vocaloid, 1girl, solo, smile, cream sweater\nShe sits at a small table by the rain-streaked window of a corner café on a rainy evening, holding a steaming mug in both hands, her long twintails falling over her shoulders. Seen from the side at eye level, warm amber light from a pendant lamp falls across her face, while the street outside glows cool blue with blurred city lights. A small chalkboard on the table reads \"Open late\" in white chalk. Soft anime illustration with clean lines; the mood is calm and cozy.",
  negative: "worst quality, bad anatomy, watermark, jpeg artifact",
  aspect: "1:1", mp: 1, steps: 50, cfg: 3, seed: 42,
  randomSeed: true, batch: 1, shift: 5, slgLayer: "22", model: "",
  mode: "full", tuning: {}, kind: "image",
  video: { prompt: "", aspect: "16:9", mp: 0.4, seconds: 5, turbo: true, steps: 20, start: null },
};
// MiniMax H3 is trained on a 768 short edge capped at 768×1344; the official template defaults to ~0.4 MP.
// 0.98 MP is H3's native canvas (1344×768 at 16:9); Comfy's guide warns 1 MP rounds above it.
const VIDEO_MP = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.98];
const PROMPT_HINTS = {
  image: "Describe the image. Put any text you want written in the picture inside quotes, e.g. a café sign that says \"Open late\"",
  video: "Describe the scene, how things move and what you hear, e.g. a fox trots through snow at sunset, the camera tracks alongside, wind and crunching snow",
};
// Per-mode sampler settings. Fast is lodestones' 8-step DMD LoRA: distilled for 8 steps without
// CFG, so layer skip guidance (which acts on the uncond pass) is off. Shift 5 tested best.
// krea2 is used whenever a Krea 2 model is picked: lodestones recommend 8 to 12 steps, CFG 1 to 1.5
// and Krea 2's own shift of 1.15 for Kroma, and Comfy's Krea 2 Turbo template uses 8 steps at CFG 1.
const MOSS_NOTES = {
  sizeNote: "1 to 2 MP is recommended. Other sizes work but are less reliable.",
  cfgNote: "3 suits long prompts. Try 4 to 6 for short prompts.",
};
const MODES = {
  full: { tuning: { steps: 50, cfg: 3, shift: 5, slgLayer: "22" }, steps: [10, 80], note: "Best results are achieved with 50 or more steps.", ...MOSS_NOTES },
  fast: { tuning: { steps: 8, cfg: 1, shift: 5, slgLayer: "" }, steps: [4, 16], note: "8 is recommended.", ...MOSS_NOTES },
  krea2: {
    tuning: { steps: 8, cfg: 1, shift: 1.15, slgLayer: "" }, steps: [4, 16], note: "8 to 12 is recommended.",
    sizeNote: "1 MP is the official default.",
    cfgNote: "1 to 1.5 is recommended. Above 1, the negative prompt is used and each step takes about twice as long.",
  },
};
const NODE_STAGES = { "1": "Loading model…", "2": "Loading model…", "3": "Loading model…", "4": "Reading prompt…", "5": "Reading prompt…", "16": "Generating…", "17": "Decoding…", "18": "Saving…" };
const SETTINGS_KEY = "moss-studio-settings-v2";
const PENDING_KEY = "moss-studio-pending";

const $ = (id) => document.getElementById(id);

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

// ComfyUI only sends progress and completion events to the client that queued the job. The "moss-"
// prefix asks __init__.py to copy every job's events to each Apoclada Studio page, so the id needn't
// survive a reload; a fresh one per page keeps two open tabs from taking each other's socket.
const clientId = `moss-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

let settings = { ...DEFAULTS, ...load(SETTINGS_KEY, null) };
if (settings.negative === "nsfw, worst quality, bad anatomy, watermark, jpeg artifact") settings.negative = DEFAULTS.negative;
settings.video = { ...DEFAULTS.video, ...settings.video };
if (settings.video.mp === 1) settings.video.mp = 0.98;
// Start images moved from input/mobile to input/studio with the rename to Apoclada Studio.
if (settings.video.start?.subfolder === "mobile") settings.video.start.subfolder = "studio";
let models = [];
let fastLora = null;
let videoFiles = null;
let pending = load(PENDING_KEY, []);
let running = null;
let stopping = null;
let progressStart = 0;
let gallery = [];
let viewer = { list: [], index: 0 };
let previewUrl = null;
// latent_preview.preview_to_image reads a non_blocking GPU->CPU copy without syncing, so on
// ROCm the first preview of a job still holds the previous job's last frame. Skip it.
let skipNextPreview = false;

/* ---------- sizes ---------- */

function round16(n) { return Math.max(256, Math.round(n / 16) * 16); }
function dimensions(aspect, mp) {
  const [, a, b] = ASPECTS.find((x) => x[0] === aspect) || ASPECTS[0];
  const area = mp * 1024 * 1024;
  return { width: round16(Math.sqrt(area * a / b)), height: round16(Math.sqrt(area * b / a)) };
}

// A start image keeps its own shape, since H3 stretches the first frame onto the canvas.
// Rounding to the 32 px grid can push the area past H3's native 768×1344 cap, so the target area
// shrinks until the rounded size fits; the shape is kept.
function round32(n) { return Math.max(32, Math.round(n / 32) * 32); }
function videoDimensions(v) {
  const [a, b] = v.start ? [v.start.width, v.start.height] : (ASPECTS.find((x) => x[0] === v.aspect) || ASPECTS[5]).slice(1);
  for (let area = v.mp * 1024 * 1024; ; area *= 0.99) {
    const width = round32(Math.sqrt(area * a / b)), height = round32(Math.sqrt(area * b / a));
    if (width * height <= 768 * 1344) return { width, height };
  }
}

// H3 frame counts sit on a 17k+5 grid at 24 fps.
function videoLength(seconds) {
  const n = Math.max(5, Math.round(seconds * 24));
  return n + (((5 - (n % 17)) % 17) + 17) % 17;
}

function isVideo(item) { return /\.(mp4|webm|mov)$/i.test(item.filename); }

/* ---------- form ---------- */

// The slider moves over list indexes, so it snaps to each size.
function sizeSlider(slider, sizes, pick) {
  slider.max = sizes.length - 1;
  slider.oninput = () => { pick(sizes[slider.value]); syncForm(); };
}

function renderChoices() {
  $("aspects").replaceChildren(...ASPECTS.map(([name, a, b]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("role", "radio");
    btn.dataset.aspect = name;
    const scale = 18 / Math.max(a, b);
    const shape = document.createElement("span");
    shape.className = "shape";
    shape.style.width = `${a * scale}px`;
    shape.style.height = `${b * scale}px`;
    btn.append(shape, name);
    btn.onclick = () => { (settings.kind === "video" ? settings.video : settings).aspect = name; syncForm(); };
    return btn;
  }));
  sizeSlider($("megapixels"), MEGAPIXELS, (mp) => { settings.mp = mp; });
  $("slg").replaceChildren(...SLG_LAYERS.map(([layer, label]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("role", "radio");
    btn.dataset.layer = layer;
    btn.textContent = label;
    btn.onclick = () => { settings.slgLayer = layer; syncForm(); };
    return btn;
  }));
  sizeSlider($("video-mp"), VIDEO_MP, (mp) => { settings.video.mp = mp; });
  for (const b of $("mode").children) b.onclick = () => setMode(b.dataset.mode);
  for (const b of $("video-mode").children) b.onclick = () => { settings.video.turbo = Boolean(b.dataset.turbo); syncForm(); };
  for (const b of $("kind").children) b.onclick = () => { settings.kind = b.dataset.kind; syncForm(); };
}

// Each mode keeps its own steps/CFG/shift/layer skip, so switching back restores what you had.
function setMode(mode) {
  if (mode === settings.mode) return;
  const keys = Object.keys(MODES[mode].tuning);
  settings.tuning[settings.mode] = Object.fromEntries(keys.map((k) => [k, settings[k]]));
  Object.assign(settings, MODES[mode].tuning, settings.tuning[mode], { mode });
  syncForm();
}

function renderModels() {
  $("model").replaceChildren(...models.map((m) => new Option(m.name, m.name)));
  if (!models.some((m) => m.name === settings.model)) {
    settings.model = models[0]?.name || "";
  }
  matchModeToModel();
}

// Krea 2 models get their own mode, and leaving them returns to the MOSS mode used before.
function matchModeToModel() {
  const krea2 = models.find((m) => m.name === settings.model)?.family === "krea2";
  if (krea2 && settings.mode !== "krea2") {
    settings.mossMode = settings.mode;
    setMode("krea2");
  } else if (!krea2 && settings.mode === "krea2") {
    setMode(settings.mossMode || "full");
  }
}

function syncForm() {
  const video = settings.kind === "video";
  const v = settings.video;
  $("form").dataset.kind = settings.kind;
  $("kind").hidden = !videoFiles;
  for (const b of $("kind").children) b.setAttribute("aria-checked", b.dataset.kind === settings.kind);
  $("prompt").value = video ? v.prompt : settings.prompt;
  $("prompt").placeholder = PROMPT_HINTS[settings.kind];
  $("negative").value = settings.negative;
  if (settings.negative) $("negative").closest("details").open = true;
  for (const b of $("aspects").children) b.setAttribute("aria-checked", b.dataset.aspect === (video ? v.aspect : settings.aspect));
  setUnused($("shape-field"), video && Boolean(v.start), "The video takes the start image's shape");
  syncVideoForm();
  $("megapixels").value = MEGAPIXELS.indexOf(settings.mp);
  const { width, height } = dimensions(settings.aspect, settings.mp);
  $("size-out").textContent = `${settings.mp} MP · ${width} × ${height}`;
  const fast = settings.mode === "fast";
  const krea2 = settings.mode === "krea2";
  const mode = MODES[settings.mode];
  $("mode-field").hidden = !fastLora;
  setUnused($("mode-field"), krea2, "Krea 2 models have no Fast mode");
  for (const b of $("mode").children) b.setAttribute("aria-checked", b.dataset.mode === settings.mode);
  setUnused($("negative-field"), fast || settings.cfg <= 1, fast ? "Not used in Fast mode" : "Not used at CFG 1");
  setUnused($("cfg-field"), fast, "Not used in Fast mode");
  setUnused($("slg-field"), fast || krea2, fast ? "Not used in Fast mode" : "Not used with Krea 2 models");
  [$("steps").min, $("steps").max] = mode.steps;
  $("steps-note").textContent = mode.note;
  $("size-note").textContent = mode.sizeNote;
  $("cfg-note").textContent = mode.cfgNote;
  const vsize = videoDimensions(v);
  $("settings-summary").textContent = (video
    ? [
        v.turbo && videoFiles?.lora ? "Turbo" : `Quality ${v.steps} steps`,
        `${vsize.width}×${vsize.height}`,
        `${v.seconds} s`,
        v.start ? "from image" : "",
        settings.randomSeed ? "random seed" : `seed ${settings.seed}`,
      ]
    : [
        fast ? "Fast" : "",
        `${width}×${height}`,
        `${settings.steps} steps`,
        fast ? "" : `CFG ${Number(settings.cfg).toFixed(1)}`,
        settings.randomSeed ? "random seed" : `seed ${settings.seed}`,
        settings.batch > 1 ? `${settings.batch} images` : "",
      ]).filter(Boolean).join(" · ");
  $("steps").value = settings.steps;
  $("steps-out").textContent = settings.steps;
  $("cfg").value = settings.cfg;
  $("cfg-out").textContent = Number(settings.cfg).toFixed(1);
  $("seed").value = settings.seed;
  $("seed").disabled = settings.randomSeed;
  $("random-seed").checked = settings.randomSeed;
  $("batch-out").textContent = settings.batch;
  $("model").value = settings.model;
  // Krea 2's shift of 1.15 sits between MOSS's half steps.
  $("shift").step = krea2 ? 0.05 : 0.5;
  $("shift").value = settings.shift;
  $("shift-out").textContent = Number(settings.shift).toFixed(krea2 ? 2 : 1);
  for (const b of $("slg").children) b.setAttribute("aria-checked", b.dataset.layer === settings.slgLayer);
  save(SETTINGS_KEY, settings);
}

// Settings the current mode ignores stay in place, grayed out, so the form doesn't jump around.
function setUnused(field, unused, reason) {
  field.classList.toggle("unused", unused);
  field.title = unused ? reason : "";
  for (const el of field.querySelectorAll("input, textarea, select, button")) el.disabled = unused;
}

function syncVideoForm() {
  const v = settings.video;
  const turbo = v.turbo && Boolean(videoFiles?.lora);
  const turboBtn = $("video-mode").querySelector("[data-turbo='1']");
  turboBtn.disabled = !videoFiles?.lora;
  for (const b of $("video-mode").children) b.setAttribute("aria-checked", Boolean(b.dataset.turbo) === turbo);
  $("video-mode").querySelector("[data-turbo=''] small").textContent = `${v.steps} steps`;
  setUnused($("vsteps-field"), turbo, "Turbo always uses 8 steps");
  $("vsteps").value = v.steps;
  $("vsteps-out").textContent = v.steps;
  $("video-mp").value = VIDEO_MP.indexOf(v.mp);
  const { width, height } = videoDimensions(v);
  $("vsize-out").textContent = `${v.mp} MP · ${width} × ${height}`;
  $("length").value = v.seconds;
  $("length-out").textContent = `${v.seconds} s`;
  $("start-thumb").hidden = !v.start;
  if (v.start) $("start-thumb").src = startUrl(v.start);
  $("start-clear").hidden = !v.start;
  $("start-pick").textContent = v.start ? "Change…" : "Choose image…";
}

function startUrl(start) {
  return `/view?${new URLSearchParams({ filename: start.name, subfolder: start.subfolder, type: "input" })}`;
}

function imageSize(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = url;
  });
}

// Start images go into ComfyUI's input folder (input/studio), where LoadImage reads them.
async function setStartImage(file) {
  const form = new FormData();
  form.append("image", file);
  form.append("subfolder", "studio");
  const res = await fetch("/upload/image", { method: "POST", body: form }).catch(() => null);
  if (!res || !res.ok) { toast("Couldn't upload the image"); return false; }
  const { name, subfolder } = await res.json();
  const size = await imageSize(startUrl({ name, subfolder })).catch(() => null);
  if (!size) { toast("That image format isn't supported"); return false; }
  settings.video.start = { name, subfolder, ...size };
  syncForm();
  return true;
}

// − and + beside each slider move it one step, which is hard to do by dragging on a touch screen.
// They're drawn as SVG because text glyphs sit at a different height in each font.
const MINUS = "M3 8h10", PLUS = "M3 8h10M8 3v10";
function addSliderButtons() {
  for (const slider of document.querySelectorAll("input[type=range]")) {
    const nudge = (path, label, move) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="${path}" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
      btn.setAttribute("aria-label", label);
      btn.onclick = () => { move(); slider.dispatchEvent(new Event("input")); };
      return btn;
    };
    const row = document.createElement("div");
    row.className = "slider";
    slider.replaceWith(row);
    row.append(nudge(MINUS, "Less", () => slider.stepDown()), slider, nudge(PLUS, "More", () => slider.stepUp()));
  }
}

function bindForm() {
  addSliderButtons();
  $("prompt").oninput = (e) => { (settings.kind === "video" ? settings.video : settings).prompt = e.target.value; save(SETTINGS_KEY, settings); };
  $("length").oninput = (e) => { settings.video.seconds = Number(e.target.value); syncForm(); };
  $("vsteps").oninput = (e) => { settings.video.steps = Number(e.target.value); syncForm(); };
  $("start-file").onchange = (e) => { const file = e.target.files[0]; e.target.value = ""; if (file) setStartImage(file); };
  $("start-clear").onclick = () => { settings.video.start = null; syncForm(); };
  $("negative").oninput = (e) => { settings.negative = e.target.value; save(SETTINGS_KEY, settings); };
  $("steps").oninput = (e) => { settings.steps = Number(e.target.value); syncForm(); };
  $("cfg").oninput = (e) => { settings.cfg = Number(e.target.value); syncForm(); };
  $("shift").oninput = (e) => { settings.shift = Number(e.target.value); syncForm(); };
  $("seed").onchange = (e) => { settings.seed = Math.max(0, Math.floor(Number(e.target.value) || 0)); syncForm(); };
  $("random-seed").onchange = (e) => { settings.randomSeed = e.target.checked; syncForm(); };
  $("model").onchange = (e) => { settings.model = e.target.value; matchModeToModel(); syncForm(); };
  for (const b of document.querySelectorAll(".stepper button")) {
    b.onclick = () => { settings.batch = Math.min(4, Math.max(1, settings.batch + Number(b.dataset.step))); syncForm(); };
  }
  $("reset").onclick = () => {
    const { video, kind } = settings;
    if (kind === "video") {
      settings.video = { ...DEFAULTS.video, prompt: video.prompt, start: video.start };
      Object.assign(settings, { seed: DEFAULTS.seed, randomSeed: DEFAULTS.randomSeed });
    } else {
      settings = { ...DEFAULTS, ...MODES[settings.mode].tuning, prompt: settings.prompt, negative: settings.negative, model: settings.model, mode: settings.mode, tuning: {}, video, kind };
    }
    syncForm();
    toast("Default settings restored (your prompts were kept)");
  };
  $("reset-prompts").onclick = () => {
    const video = settings.kind === "video";
    if (!confirm(video ? "Clear the prompt?" : "Replace your prompts with the default example prompt and negative prompt?")) return;
    if (video) settings.video.prompt = DEFAULTS.video.prompt;
    else Object.assign(settings, { prompt: DEFAULTS.prompt, negative: DEFAULTS.negative });
    syncForm();
  };
  $("settings").open = load("moss-studio-settings-open", false);
  $("settings").ontoggle = () => save("moss-studio-settings-open", $("settings").open);
  $("form").onsubmit = (e) => { e.preventDefault(); generate(); };
  $("cancel").onclick = cancelAll;
}

/* ---------- generation ---------- */

function buildWorkflow(s) {
  const model = models.find((m) => m.name === s.model);
  const { width, height } = dimensions(s.aspect, s.mp);
  if (model.family === "krea2") return buildKrea2Workflow(s, model, width, height);
  const fast = s.mode === "fast";
  // ComfyUI's native MOSS model takes raw 0-1 timesteps: ModelSamplingSD3 would scale them by 1000
  // and produce pure noise, so the shift goes through the AuraFlow node instead.
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: model.unet, weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: model.clip, type: "moss_image", device: "default" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: model.vae } },
    ...(fast && { "20": { class_type: "LoraLoaderModelOnly", inputs: { lora_name: fastLora, strength_model: 1, model: ["1", 0] } } }),
    "4": { class_type: "CLIPTextEncode", inputs: { text: s.prompt, clip: ["2", 0] } },
    "5": { class_type: "CLIPTextEncode", inputs: { text: s.negative, clip: ["2", 0] } },
    "6": { class_type: "EmptyFlux2LatentImage", inputs: { width, height, batch_size: s.batch } },
    "15": { class_type: "ModelSamplingAuraFlow", inputs: { shift: s.shift, model: [fast ? "20" : "1", 0] } },
    "13": {
      class_type: "SkipLayerGuidanceDiTSimple",
      inputs: { double_layers: "", single_layers: s.slgLayer, start_percent: 0, end_percent: 1, model: ["15", 0] },
    },
    "16": {
      class_type: "KSampler",
      inputs: {
        seed: s.seed, steps: s.steps, cfg: s.cfg, sampler_name: "euler", scheduler: "sgm_uniform", denoise: 1,
        model: ["13", 0], positive: ["4", 0], negative: ["5", 0], latent_image: ["6", 0],
      },
    },
    "17": { class_type: "VAEDecode", inputs: { samples: ["16", 0], vae: ["3", 0] } },
    "18": { class_type: "SaveImage", inputs: { filename_prefix: "studio/moss", images: ["17", 0] } },
  };
}

// Follows Comfy's Krea 2 Turbo template (euler, simple scheduler), with the shift exposed through
// ModelSamplingAuraFlow, which matches Krea 2's own flow sampling. Node ids line up with NODE_STAGES.
function buildKrea2Workflow(s, model, width, height) {
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: model.unet, weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: model.clip, type: "krea2", device: "default" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: model.vae } },
    "4": { class_type: "CLIPTextEncode", inputs: { text: s.prompt, clip: ["2", 0] } },
    "5": { class_type: "CLIPTextEncode", inputs: { text: s.negative, clip: ["2", 0] } },
    "6": { class_type: "EmptyLatentImage", inputs: { width, height, batch_size: s.batch } },
    "15": { class_type: "ModelSamplingAuraFlow", inputs: { shift: s.shift, model: ["1", 0] } },
    "16": {
      class_type: "KSampler",
      inputs: {
        seed: s.seed, steps: s.steps, cfg: s.cfg, sampler_name: "euler", scheduler: "simple", denoise: 1,
        model: ["15", 0], positive: ["4", 0], negative: ["5", 0], latent_image: ["6", 0],
      },
    },
    "17": { class_type: "VAEDecode", inputs: { samples: ["16", 0], vae: ["3", 0] } },
    "18": { class_type: "SaveImage", inputs: { filename_prefix: "studio/krea2", images: ["17", 0] } },
  };
}

// Mirrors ComfyUI's official MiniMax H3 text/image-to-video template: no CFG, res_multistep,
// 8 steps with the turbo LoRA, or 20 by default without it. Node ids line up with NODE_STAGES.
function buildVideoWorkflow(s) {
  const v = s.video;
  const { width, height } = videoDimensions(v);
  const turbo = v.turbo && videoFiles.lora;
  const model = [turbo ? "20" : "1", 0];
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: videoFiles.unet, weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: videoFiles.clip, type: "minimax", device: "default" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: videoFiles.vae } },
    "19": { class_type: "VAELoader", inputs: { vae_name: videoFiles.audio_vae } },
    ...(turbo && { "20": { class_type: "LoraLoaderModelOnly", inputs: { lora_name: videoFiles.lora, strength_model: 1, model: ["1", 0] } } }),
    ...(v.start && { "21": { class_type: "LoadImage", inputs: { image: `${v.start.subfolder}/${v.start.name}` } } }),
    "4": {
      class_type: "MiniMaxH3ImageToVideo",
      inputs: { clip: ["2", 0], vae: ["3", 0], prompt: v.prompt, width, height, length: videoLength(v.seconds), ...(v.start && { first_frame: ["21", 0] }) },
    },
    "7": { class_type: "RandomNoise", inputs: { noise_seed: s.seed } },
    "8": { class_type: "KSamplerSelect", inputs: { sampler_name: "res_multistep" } },
    "9": { class_type: "BasicScheduler", inputs: { scheduler: "simple", steps: turbo ? 8 : v.steps, denoise: 1, model } },
    "10": { class_type: "BasicGuider", inputs: { model, conditioning: ["4", 0] } },
    "16": { class_type: "SamplerCustomAdvanced", inputs: { noise: ["7", 0], guider: ["10", 0], sampler: ["8", 0], sigmas: ["9", 0], latent_image: ["4", 1] } },
    "17": { class_type: "VAEDecode", inputs: { samples: ["16", 0], vae: ["3", 0] } },
    "22": { class_type: "VAEDecodeAudio", inputs: { samples: ["16", 0], vae: ["19", 0] } },
    "23": { class_type: "CreateVideo", inputs: { images: ["17", 0], audio: ["22", 0], fps: 24 } },
    "18": { class_type: "SaveVideo", inputs: { video: ["23", 0], filename_prefix: "studio/h3", format: "auto", codec: "auto" } },
  };
}

async function generate() {
  const video = settings.kind === "video";
  if (!(video ? settings.video.prompt : settings.prompt).trim()) { toast("Write a prompt first"); $("prompt").focus(); return; }
  if (!video && !models.length) { toast("No image model yet. Download one in Setup."); return; }
  if (video && !videoFiles) { toast("The MiniMax H3 files are missing. Download them in Setup."); return; }
  if (settings.randomSeed) settings.seed = Math.floor(Math.random() * 2 ** 48);
  syncForm();
  const res = await fetch("/prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: video ? buildVideoWorkflow(settings) : buildWorkflow(settings), client_id: clientId }),
  }).catch(() => null);
  if (!res) { toast("Can't reach the PC"); return; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const nodeErrors = Object.values(data.node_errors || {}).flatMap((n) => n.errors || []).map((e) => e.details || e.message);
    toast(nodeErrors[0] || data.error?.message || `Request failed (${res.status})`);
    return;
  }
  pending.push(data.prompt_id);
  save(PENDING_KEY, pending);
  updateStatus(running ? null : "Queued…");
  if (window.matchMedia("(max-width: 899px)").matches) $("results").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function cancelAll() {
  if (running && stopping === running) return forceStop();
  const queued = pending.filter((id) => id !== running);
  if (queued.length) await fetch("/queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ delete: queued }) });
  if (running) {
    await fetch("/interrupt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt_id: running }) });
    stopping = running;
    $("cancel").textContent = "Force stop";
    updateStatus("Stopping…");
  }
  for (const id of queued) finish(id);
}

// ComfyUI only notices a cancel between GPU operations, which can be minutes apart on a big video.
// Restarting it stops the GPU at once; the websocket reconnects and resync() clears the lost job.
async function forceStop() {
  if (!confirm("Force stop restarts ComfyUI on the PC. The video is lost and the models load again on the next run (about a minute).")) return;
  const res = await fetch("/studio/restart", { method: "POST" }).catch(() => null);
  toast(res && res.ok ? "Restarting ComfyUI…" : "Can't reach the PC");
}

function updateStatus(text, fraction) {
  const waiting = pending.length;
  $("status").hidden = waiting === 0;
  if (!waiting) return;
  if (text && stopping && stopping === running) text = "Stopping…";
  const extra = waiting > 1 ? ` · ${waiting - 1} more queued` : "";
  if (text) $("status-text").textContent = text + extra;
  if (fraction !== undefined) $("bar-fill").style.width = `${Math.round(fraction * 100)}%`;
  $("generate").textContent = "Generate (adds to queue)";
}

function finish(id) {
  pending = pending.filter((p) => p !== id);
  save(PENDING_KEY, pending);
  if (running === id) running = null;
  if (stopping === id) { stopping = null; $("cancel").textContent = "Cancel"; }
  if (!pending.length) {
    $("status").hidden = true;
    $("bar-fill").style.width = "0";
    $("generate").textContent = "Generate";
    removePreview();
  }
}

// SaveImage reuses a deleted file's name for the next image, so every URL carries a
// version (prompt id or mtime) to keep Safari from showing the cached old picture.
function imageUrl(img) {
  return `/view?${new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || "", type: "output", v: img.version ?? img.mtime ?? "" })}`;
}

function imageKey(img) {
  return `${img.subfolder || ""}/${img.filename}`;
}

function thumbUrl(img) {
  return `/studio/images/thumb?${new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || "", t: img.mtime })}`;
}

async function collectResult(id) {
  const res = await fetch(`/history/${id}`).catch(() => null);
  const entry = res && res.ok ? (await res.json())[id] : null;
  if (!entry) return false;
  const images = Object.values(entry.outputs || {}).flatMap((o) => o.images || []).filter((i) => i.type === "output");
  if (images.length) showResults(images, id);
  else if (entry.status?.status_str === "error") {
    const err = (entry.status.messages || []).find((m) => m[0] === "execution_error");
    if (err) toast(`Error: ${err[1].exception_message}`);
  }
  finish(id);
  return true;
}

function showResults(images, version) {
  removePreview();
  const box = $("results");
  box.querySelector(".empty")?.remove();
  const list = images.map((i) => ({ filename: i.filename, subfolder: i.subfolder, version }));
  for (const img of [...list].reverse()) {
    let el;
    // Videos loop silently here as a preview; a tap opens the viewer, like images, for sound, controls
    // and Delete. iOS only autoplays inline videos that start muted, and the muted property is not taken
    // from the attribute on elements created by script, so both are set. The wrapper carries the same
    // ▶ badge as the gallery, which a <video> can't draw itself.
    if (isVideo(img)) {
      const video = document.createElement("video");
      for (const attr of ["muted", "loop", "autoplay", "playsinline"]) video.setAttribute(attr, "");
      video.muted = true;
      video.src = imageUrl(img);
      el = document.createElement("div");
      el.className = "video";
      el.append(video);
    } else {
      el = document.createElement("img");
      el.alt = settings.prompt;
      el.src = imageUrl(img);
    }
    el.onclick = () => openViewer(list, list.indexOf(img));
    el.dataset.key = imageKey(img);
    box.prepend(el);
  }
  while (box.children.length > 12) box.lastElementChild.remove();
}

function showPreview(blob) {
  const box = $("results");
  box.querySelector(".empty")?.remove();
  let el = box.querySelector(".preview");
  if (!el) {
    el = document.createElement("img");
    el.className = "preview";
    el.alt = "Live preview";
    box.prepend(el);
  }
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(blob);
  el.src = previewUrl;
}

function removePreview() {
  $("results").querySelector(".preview")?.remove();
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
}

/* ---------- websocket ---------- */

function connect() {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?clientId=${clientId}`);
  ws.binaryType = "arraybuffer";
  ws.onopen = () => { $("conn").classList.add("on"); resync(); };
  ws.onclose = () => { $("conn").classList.remove("on"); setTimeout(connect, 2000); };
  ws.onmessage = (e) => (typeof e.data === "string" ? onEvent(JSON.parse(e.data)) : onBinary(e.data));
}

function onEvent({ type, data }) {
  if (!data) return;
  // Jobs queued from another browser are followed too, from when they start.
  if (type === "execution_start" && !pending.includes(data.prompt_id)) { pending.push(data.prompt_id); save(PENDING_KEY, pending); }
  if (data.prompt_id && !pending.includes(data.prompt_id)) return;
  switch (type) {
    case "execution_start":
      running = data.prompt_id;
      progressStart = 0;
      skipNextPreview = true;
      updateStatus("Starting…", 0);
      break;
    case "executing":
      if (data.node && NODE_STAGES[data.node]) updateStatus(NODE_STAGES[data.node]);
      break;
    case "progress": {
      // Timed from the first step seen, which is later than step 1 when following a job already running.
      if (!progressStart || data.value <= 1) progressStart = { time: performance.now(), step: data.value };
      const perStep = data.value > progressStart.step ? (performance.now() - progressStart.time) / (data.value - progressStart.step) : 0;
      const eta = perStep ? ` · about ${Math.ceil((perStep * (data.max - data.value)) / 1000)}s left` : "";
      updateStatus(`Step ${data.value} of ${data.max}${eta}`, data.value / data.max);
      break;
    }
    case "execution_success":
      collectResult(data.prompt_id);
      break;
    case "execution_interrupted":
      toast("Cancelled");
      finish(data.prompt_id);
      break;
    case "execution_error":
      toast(`Error: ${data.exception_message}`);
      finish(data.prompt_id);
      break;
  }
}

function onBinary(buffer) {
  if (skipNextPreview) { skipNextPreview = false; return; }
  const view = new DataView(buffer);
  const type = view.getUint32(0);
  if (type === 1) {
    showPreview(new Blob([buffer.slice(8)], { type: view.getUint32(4) === 2 ? "image/png" : "image/jpeg" }));
  } else if (type === 4) {
    const len = view.getUint32(4);
    const meta = JSON.parse(new TextDecoder().decode(buffer.slice(8, 8 + len)));
    if (meta.prompt_id && !pending.includes(meta.prompt_id)) return;
    showPreview(new Blob([buffer.slice(8 + len)], { type: meta.image_type || "image/jpeg" }));
  }
}

async function resync() {
  const queue = await fetch("/queue").then((r) => r.json()).catch(() => null);
  if (!queue) return;
  const runningIds = queue.queue_running.map((q) => q[1]);
  const queuedIds = queue.queue_pending.map((q) => q[1]);
  // Also follow a job that was started from another browser before this page opened.
  pending.push(...runningIds.filter((id) => !pending.includes(id)));
  save(PENDING_KEY, pending);
  for (const id of [...pending]) {
    if (runningIds.includes(id)) { running = id; updateStatus("Generating…"); continue; }
    if (queuedIds.includes(id)) continue;
    if (!(await collectResult(id))) finish(id);
  }
  updateStatus(running ? null : "Queued…");
}

/* ---------- gallery & viewer ---------- */

async function loadGallery() {
  gallery = await fetch("/studio/images").then((r) => r.json()).catch(() => []);
  $("gallery-count").textContent = `${gallery.length} item${gallery.length === 1 ? "" : "s"}`;
  if (!gallery.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "Nothing here yet.";
    $("grid").replaceChildren(p);
    return;
  }
  $("grid").replaceChildren(...gallery.map((img, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.classList.toggle("video", Boolean(img.video));
    const el = document.createElement("img");
    el.loading = "lazy";
    el.src = thumbUrl(img);
    el.alt = img.filename;
    btn.append(el);
    btn.onclick = () => openViewer(gallery, i);
    return btn;
  }));
}

function openViewer(list, index) {
  viewer = { list, index };
  $("viewer").hidden = false;
  document.body.style.overflow = "hidden";
  showViewerImage();
}

function closeViewer() {
  $("viewer").hidden = true;
  unloadVideo($("v-video"));
  document.body.style.overflow = "";
}

function unloadVideo(el) {
  el.pause();
  el.removeAttribute("src");
  el.load();
}

// Rewinds the inline result videos so leaving the page doesn't leave one mid-play.
function resetResultVideos() {
  for (const v of $("results").querySelectorAll("video")) {
    v.pause();
    v.currentTime = 0;
  }
}

function showViewerImage() {
  const { list, index } = viewer;
  if (!list.length) { closeViewer(); return; }
  viewer.index = Math.min(Math.max(index, 0), list.length - 1);
  const item = list[viewer.index];
  const video = isVideo(item);
  $("v-img").hidden = video;
  $("v-video").hidden = !video;
  if (video) {
    $("v-img").removeAttribute("src");
    $("v-video").src = imageUrl(item);
  } else {
    unloadVideo($("v-video"));
    $("v-img").src = imageUrl(item);
  }
  $("v-save").hidden = !video;
  $("v-save").href = imageUrl(item);
  $("v-save").download = item.filename;
  $("v-animate").hidden = video || !videoFiles;
  $("v-hint").textContent = video
    ? "Save puts the video in Files. Open it there and use Share › Save Video to add it to Photos."
    : "Press and hold the image to save it to Photos";
  $("v-pos").textContent = list.length > 1 ? `${viewer.index + 1} / ${list.length}` : "";
  $("v-prev").disabled = viewer.index === 0;
  $("v-next").disabled = viewer.index === list.length - 1;
}

function step(delta) {
  viewer.index += delta;
  showViewerImage();
}

async function deleteCurrent() {
  const img = viewer.list[viewer.index];
  if (!img) return;
  const res = await fetch("/studio/images/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(img),
  }).catch(() => null);
  if (!res || !res.ok) { toast("Couldn't delete the image"); return; }
  for (const el of $("results").querySelectorAll("[data-key]")) if (el.dataset.key === imageKey(img)) el.remove();
  viewer.list.splice(viewer.index, 1);
  if (viewer.list !== gallery) gallery = gallery.filter((g) => !(g.filename === img.filename && g.subfolder === img.subfolder));
  if (!$("tab-gallery").hidden) loadGallery();
  toast("Deleted");
  showViewerImage();
}

async function revealCurrent() {
  const img = viewer.list[viewer.index];
  const res = await fetch("/studio/images/reveal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: img.filename, subfolder: img.subfolder || "" }),
  }).catch(() => null);
  toast(res && res.ok ? "Opened the folder on the PC" : "Couldn't open the folder");
}

async function reuseCurrent() {
  const img = viewer.list[viewer.index];
  const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || "" });
  const info = await fetch(`/studio/images/info?${q}`).then((r) => r.json()).catch(() => null);
  const graph = info?.prompt;
  const h3 = graph && Object.values(graph).find((n) => n.class_type === "MiniMaxH3ImageToVideo");
  if (h3) { reuseVideo(graph, h3.inputs); return; }
  const sampler = graph && Object.values(graph).find((n) => n.class_type === "KSampler");
  if (!sampler) { toast("This image has no saved settings"); return; }
  const node = (link) => (Array.isArray(link) ? graph[link[0]] : null);
  const s = sampler.inputs;
  settings.prompt = node(s.positive)?.inputs.text ?? settings.prompt;
  settings.negative = node(s.negative)?.inputs.text ?? "";
  settings.steps = s.steps;
  settings.cfg = s.cfg;
  settings.seed = s.seed;
  settings.randomSeed = false;
  const latent = node(s.latent_image)?.inputs;
  if (latent) {
    const ratio = Math.log(latent.width / latent.height);
    settings.aspect = ASPECTS.reduce((best, a) => (Math.abs(Math.log(a[1] / a[2]) - ratio) < Math.abs(Math.log(best[1] / best[2]) - ratio) ? a : best))[0];
    const mp = (latent.width * latent.height) / (1024 * 1024);
    settings.mp = MEGAPIXELS.reduce((best, m) => (Math.abs(m - mp) < Math.abs(best - mp) ? m : best));
    settings.batch = latent.batch_size || 1;
  }
  const fast = Object.values(graph).some((n) => n.class_type === "LoraLoaderModelOnly");
  if (fast && !fastLora) { toast("This image used Fast mode, but its LoRA is missing on the PC"); return; }
  settings.mode = fast ? "fast" : "full";
  settings.slgLayer = "";
  for (const n of Object.values(graph)) {
    if (n.class_type === "ModelSamplingSD3" || n.class_type === "ModelSamplingAuraFlow") settings.shift = n.inputs.shift;
    if (n.class_type === "SkipLayerGuidanceDiTSimple") settings.slgLayer = String(n.inputs.single_layers).trim();
    // Images from before the switch to native files used the moss-image node's full model folder.
    if (n.class_type === "MOSSImageHFLoader") {
      const m = models.find((x) => x.family === "moss");
      if (m) settings.model = m.name;
    }
    if (n.class_type === "UNETLoader") {
      const m = models.find((x) => x.unet === n.inputs.unet_name);
      if (m) settings.model = m.name;
      else toast("This image used a model that is no longer on the PC");
    }
  }
  if (models.find((m) => m.name === settings.model)?.family === "krea2") settings.mode = "krea2";
  settings.kind = "image";
  syncForm();
  closeViewer();
  selectTab("create");
  toast("Settings loaded with the same seed. Turn on “Randomize” for variations.");
}

function reuseVideo(graph, h3) {
  if (!videoFiles) { toast("The MiniMax H3 files are missing on the PC"); return; }
  const v = settings.video;
  const nodes = Object.values(graph);
  v.prompt = h3.prompt;
  v.seconds = Math.min(15, Math.max(2, Math.round(h3.length / 24)));
  v.turbo = nodes.some((n) => n.class_type === "LoraLoaderModelOnly");
  const scheduler = nodes.find((n) => n.class_type === "BasicScheduler");
  if (!v.turbo && scheduler) v.steps = scheduler.inputs.steps;
  const mp = (h3.width * h3.height) / (1024 * 1024);
  v.mp = VIDEO_MP.reduce((best, m) => (Math.abs(m - mp) < Math.abs(best - mp) ? m : best));
  const start = Array.isArray(h3.first_frame) ? graph[h3.first_frame[0]]?.inputs.image : null;
  if (start) {
    const cut = start.lastIndexOf("/");
    const subfolder = start.slice(0, Math.max(cut, 0));
    v.start = { subfolder: subfolder === "mobile" ? "studio" : subfolder, name: start.slice(cut + 1), width: h3.width, height: h3.height };
  } else {
    const ratio = Math.log(h3.width / h3.height);
    v.start = null;
    v.aspect = ASPECTS.reduce((best, a) => (Math.abs(Math.log(a[1] / a[2]) - ratio) < Math.abs(Math.log(best[1] / best[2]) - ratio) ? a : best))[0];
  }
  const noise = nodes.find((n) => n.class_type === "RandomNoise");
  if (noise) settings.seed = noise.inputs.noise_seed;
  settings.randomSeed = false;
  settings.kind = "video";
  syncForm();
  closeViewer();
  selectTab("create");
  toast("Settings loaded with the same seed. Turn on “Randomize” for variations.");
}

// Sends an image from the gallery to Video mode as the start frame.
async function animateCurrent() {
  const img = viewer.list[viewer.index];
  const blob = await fetch(imageUrl(img)).then((r) => r.blob()).catch(() => null);
  if (!blob || !(await setStartImage(new File([blob], img.filename, { type: blob.type })))) return;
  settings.kind = "video";
  syncForm();
  closeViewer();
  selectTab("create");
  toast("Image set as the video's start frame. Describe the motion and press Generate.");
}

function bindViewer() {
  $("v-close").onclick = closeViewer;
  $("v-prev").onclick = () => step(-1);
  $("v-next").onclick = () => step(1);
  $("v-delete").onclick = deleteCurrent;
  $("v-reuse").onclick = reuseCurrent;
  $("v-animate").onclick = animateCurrent;
  $("v-reveal").onclick = revealCurrent;
  let startX = null;
  const area = $("viewer");
  // Swipes on the video would fight with scrubbing its timeline, so they don't change pages.
  area.addEventListener("touchstart", (e) => { startX = e.touches.length === 1 && e.target.tagName !== "VIDEO" ? e.touches[0].clientX : null; }, { passive: true });
  area.addEventListener("touchend", (e) => {
    if (startX === null) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 60) step(dx < 0 ? 1 : -1);
    startX = null;
  });
  document.addEventListener("keydown", (e) => {
    if ($("viewer").hidden) return;
    if (e.key === "Escape") closeViewer();
    if (e.key === "ArrowLeft") step(-1);
    if (e.key === "ArrowRight") step(1);
  });
}

/* ---------- setup ---------- */

let setupTimer = null;
let downloading = false;

function gb(bytes) { return `${(bytes / 1e9).toFixed(1)} GB`; }

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== false));
  return node;
}

// Polls while a download runs, on any tab, so new models show up in Create as soon as they land.
async function loadSetup() {
  clearTimeout(setupTimer);
  const setup = await fetch("/studio/setup").then((r) => r.json()).catch(() => null);
  if (!setup) return;
  const dl = setup.download;
  const active = Boolean(dl && !dl.error);
  if (downloading && !active) await loadModels();
  downloading = active;
  $("packs").replaceChildren(...setup.packs.map((p) => renderPack(p, dl, active)));
  if (active) setupTimer = setTimeout(loadSetup, 2000);
}

function renderPack(p, dl, active) {
  const mine = dl?.pack === p.id;
  const running = mine && active;
  const state = p.installed ? "Installed"
    : running ? (dl.total ? `${Math.floor((dl.done / dl.total) * 100)}% · ${gb(dl.done)} of ${gb(dl.total)}` : "Starting…")
    : p.missing ? `${gb(p.missing)} to download` : "";
  const button = running
    ? el("button", { type: "button", className: "ghost danger", textContent: "Stop", onclick: () => setupAction("cancel") })
    : p.missing > 0 && el("button", {
      type: "button", className: "ghost", disabled: active,
      textContent: mine && dl.error ? "Retry" : "Download",
      onclick: () => setupAction("download", p.id),
    });
  const manual = p.manual && !p.manual.found && el("span", { className: "note" },
    "The model itself comes from Civitai, which needs an account. Download ",
    el("a", { href: p.manual.url, target: "_blank", rel: "noopener", textContent: p.manual.file }),
    ` and put it in ComfyUI's ${p.manual.folder} folder.`);
  return el("div", { className: "pack" },
    el("div", { className: "pack-head" },
      el("span", { className: "pack-name", textContent: p.name }),
      el("span", { className: `pack-state${p.installed ? " ok" : ""}`, textContent: state })),
    el("span", { className: "note", textContent: p.about }),
    running && el("div", { className: "bar" }, el("div", { style: `width: ${dl.total ? (dl.done / dl.total) * 100 : 0}%` })),
    mine && dl.error && el("span", { className: "warn", textContent: `Download stopped: ${dl.error}` }),
    manual,
    button && el("div", { className: "actions-row" }, button));
}

async function setupAction(action, pack) {
  const res = await fetch(`/studio/setup/${action}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pack }),
  }).catch(() => null);
  if (!res) toast("Can't reach the PC");
  else if (!res.ok) toast((await res.json().catch(() => ({}))).error || "That didn't work");
  if (res?.ok && action === "download") downloading = true;
  loadSetup();
}

async function loadUpdates(check) {
  const u = await fetch(`/studio/update${check ? "?check=1" : ""}`).then((r) => r.json()).catch(() => null);
  if (!u) return;
  document.querySelector(".tabs [data-tab=setup]").classList.toggle("badge", u.behind > 0 || !u.comfyui_ok);
  const status = !u.source
    ? "Updates aren't set up: this copy has no git source to update from."
    : u.behind ? `An update is available (${u.behind} change${u.behind === 1 ? "" : "s"}).` : "Up to date.";
  const button = u.source && (u.behind
    ? el("button", { type: "button", className: "ghost", textContent: "Update and restart", onclick: runUpdate })
    : el("button", { type: "button", className: "ghost", textContent: "Check now", onclick: () => loadUpdates(true) }));
  $("updates").replaceChildren(...[
    el("span", {}, `Apoclada Studio ${u.version || ""}`.trim(), el("br"), el("span", { className: "note", textContent: status })),
    el("span", {}, `ComfyUI ${u.comfyui}`),
    !u.comfyui_ok && el("span", { className: "warn", textContent: `Apoclada needs ComfyUI ${u.comfyui_min} or newer. Update ComfyUI before generating.` }),
    button && el("div", { className: "actions-row" }, button),
  ].filter(Boolean));
}

async function runUpdate() {
  if (!confirm("Updating restarts ComfyUI on the PC. Anything generating now is lost.")) return;
  const res = await fetch("/studio/update", { method: "POST" }).catch(() => null);
  if (!res) { toast("Can't reach the PC"); return; }
  if (!res.ok) { toast(((await res.json().catch(() => ({}))).error || "The update failed").split("\n")[0]); return; }
  toast("Updated. Restarting ComfyUI…");
  // The page reloads once the restarted server answers, picking up the new version.
  await new Promise((r) => setTimeout(r, 4000));
  while (!(await fetch("/studio/update").then((r) => r.ok).catch(() => false))) await new Promise((r) => setTimeout(r, 2000));
  location.reload();
}

/* ---------- misc ---------- */

function selectTab(name) {
  resetResultVideos();
  for (const b of document.querySelectorAll(".tabs button")) b.setAttribute("aria-selected", b.dataset.tab === name);
  $("tab-create").hidden = name !== "create";
  $("tab-gallery").hidden = name !== "gallery";
  $("tab-setup").hidden = name !== "setup";
  if (name === "gallery") loadGallery();
  if (name === "setup") { loadSetup(); loadUpdates(); }
}

let toastTimer;
function toast(text) {
  $("toast").textContent = text;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $("toast").hidden = true; }, 3500);
}

async function init() {
  renderChoices();
  bindForm();
  bindViewer();
  for (const b of document.querySelectorAll(".tabs button")) b.onclick = () => selectTab(b.dataset.tab);
  $("refresh").onclick = loadGallery;
  // Only one video plays at a time: starting one pauses the others. "play" doesn't bubble, hence capture.
  document.addEventListener("play", (e) => {
    for (const v of document.querySelectorAll("video")) if (v !== e.target) v.pause();
  }, true);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) resync(); });
  await loadModels();
  // A fresh install has nothing to generate with yet, so it opens on Setup.
  if (!models.length && !videoFiles) selectTab("setup");
  else { loadSetup(); loadUpdates(); }
  connect();
}

async function loadModels() {
  [models, { lora: fastLora }, videoFiles] = await Promise.all([
    fetch("/studio/models").then((r) => r.json()).catch(() => []),
    fetch("/studio/fast").then((r) => r.json()).catch(() => ({ lora: null })),
    fetch("/studio/video").then((r) => r.json()).catch(() => null),
  ]);
  if (!fastLora && settings.mode === "fast") setMode("full");
  if (!videoFiles) settings.kind = "image";
  else if (!models.length) settings.kind = "video";
  renderModels();
  syncForm();
}

init();
