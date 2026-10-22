// The form, generation and Setup. Workflows and the viewer import the settings and the PC's files from here.
import { ANIMATE_PROMPT, KREA2_PROMPT, MOSS_PROMPT, REFERENCE_PROMPT, VIDEO_PROMPT } from "./prompts.js";
import { buildKrea2Workflow, buildMossWorkflow, buildRapidWorkflow, buildVideoWorkflow, buildWorkflow, videoLoras, videoMode, videoSteps } from "./workflows.js";
import { bindViewer, duration, loadGallery, openViewer, thumbButton } from "./viewer.js";
import { loadPrefs, loadSetup, loadUpdates, refreshPrefs } from "./setup.js";

export const ASPECTS = [["1:1", 1, 1], ["4:3", 4, 3], ["3:4", 3, 4], ["3:2", 3, 2], ["2:3", 2, 3], ["16:9", 16, 9], ["9:16", 9, 16]];
// The MOSS team recommends 1 to 2 MP and says the model extrapolates from 0.25 to 4 MP.
export const MEGAPIXELS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4];
const SLG_LAYERS = [["", "Off"], ["22", "22"], ["24", "24"], ["26", "26"]];
// Recommended by the MOSS-Image authors (README and USERGUIDE.md): Euler, 50 steps, CFG 3,
// shift 5, uncond skip at layer 22, ~1 MP output, and their suggested negative tags minus "nsfw".
// Each image mode: its sampler settings and step range, the settings it grays out (by field, with the
// reason), the file it needs and the node that marks it in a saved workflow, and its builder.
// Turbo is lodestones' 8-step DMD LoRA: distilled for 8 steps without CFG, so layer skip guidance
// (which acts on the uncond pass) is off. Shift 5 tested best.
// krea2 is used whenever a Krea 2 model is picked: lodestones recommend 8 to 12 steps, CFG 1 to 1.5
// and Krea 2's own shift of 1.15 for Kroma, and Comfy's Krea 2 Turbo template uses 8 steps at CFG 1.
const MOSS_NOTES = {
  sizeNote: "1 to 2 MP is recommended. Other sizes work but are less reliable.",
  cfgNote: "3 suits long prompts. Try 4 to 6 for short prompts.",
};
const MOSS_SAMPLER = { sampler: "euler", scheduler: "sgm_uniform" };
export const MODES = {
  full: {
    tuning: { steps: 50, cfg: 3, shift: 5, slgLayer: "22", ...MOSS_SAMPLER }, steps: [10, 80], note: "50 or more is recommended.", ...MOSS_NOTES,
    label: "Quality", unused: {}, build: buildMossWorkflow,
  },
  turbo: {
    tuning: { steps: 8, cfg: 1, shift: 5, slgLayer: "", ...MOSS_SAMPLER }, steps: [4, 16], note: "8 is recommended.", ...MOSS_NOTES,
    label: "Turbo", distilled: [], build: buildMossWorkflow,
    file: () => turboLora, node: "LoraLoaderModelOnly", missing: "its LoRA is missing on the PC",
  },
  // Fast is darask0's rapid-moss adapter, which brings its own sampler and sigmas, so only the step
  // count applies. Its id stays "rapid" so saved settings carry over.
  rapid: {
    tuning: { steps: 4, cfg: 1, shift: 5, slgLayer: "", ...MOSS_SAMPLER }, steps: [1, 4], note: "4 is recommended.",
    ...MOSS_NOTES, sizeNote: "Trained at about 1 MP. Other sizes are untested.",
    label: "Fast", distilled: ["shift", "sampler", "scheduler"], build: buildRapidWorkflow,
    file: () => rapidAdapter, node: "RapidMOSSAdapter", missing: "it needs the rapid-moss node and adapter on the PC",
  },
  // Krea 2's shift of 1.15 sits between MOSS's half steps.
  krea2: {
    tuning: { steps: 8, cfg: 1, shift: 1.15, slgLayer: "", sampler: "euler", scheduler: "simple" }, steps: [4, 16], note: "8 to 12 is recommended.",
    sizeNote: "1 MP is the official default.",
    cfgNote: "1 to 1.5 is recommended. Above 1, the negative prompt is used and each step takes about twice as long.",
    family: "krea2", prompt: KREA2_PROMPT, shiftStep: 0.05, build: buildKrea2Workflow,
    unused: { mode: "Krea 2 models have only one mode", slg: "Not used with Krea 2 models" },
  },
};
// The distilled modes have no CFG, so the negative prompt and layer skip go unused, and EasyCache has
// nothing to skip; `distilled` lists what else each ignores. The reasons name the mode by its label.
for (const mode of Object.values(MODES)) {
  if (!mode.distilled) continue;
  const reason = `Not used in ${mode.label} mode`;
  mode.unused = { ...Object.fromEntries(["negative", "cfg", "slg", ...mode.distilled].map((id) => [id, reason])), easycache: `${reason}: its few steps all change the image too much to skip` };
}
const DEFAULTS = {
  prompt: MOSS_PROMPT,
  negative: "worst quality, bad anatomy, watermark, jpeg artifact",
  aspect: "1:1", mp: 1, ...MODES.full.tuning, seed: 42,
  randomSeed: true, batch: 1, model: "", enhance: false, easyCache: false,
  mode: "full", tuning: {}, kind: "image",
  video: { prompt: VIDEO_PROMPT, aspect: "16:9", mp: 0.4, seconds: 5, mode: "turbo", steps: 20, items: [], extend: null },
};
// MiniMax H3 is trained on a 768 short edge capped at 768×1344; the official template defaults to ~0.4 MP.
// 0.98 MP is H3's native canvas (1344×768 at 16:9); Comfy's guide warns 1 MP rounds above it.
export const VIDEO_MP = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.98];
// Video modes by id, with the names shown for them.
const VIDEO_MODES = { fast: "Fast", turbo: "Turbo", quality: "Quality" };
const PROMPT_HINTS = {
  image: "Describe the image. Tap \"Default prompts\" for an example tailored to the selected model.",
  video: "Describe the video and its sound. Tap \"Default prompts\" for an example in MiniMax's format.",
};
const NODE_STAGES = { "1": "Loading model…", "2": "Loading model…", "3": "Loading model…", "4": "Reading prompt…", "5": "Reading prompt…", "30": "Rewriting prompt…", "16": "Generating…", "17": "Decoding…", "18": "Saving…" };
const SETTINGS_KEY = "moss-studio-settings-v2";
const PENDING_KEY = "moss-studio-pending";

export const $ = (id) => document.getElementById(id);

export function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
export function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

export function getJson(url, fallback = null) {
  return fetch(url).then((r) => r.json()).catch(() => fallback);
}
export function post(url, body) {
  return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== false));
  return node;
}

// Marks the button in a radio group whose data-<key> matches.
function check(group, key, value) {
  for (const b of group.children) b.setAttribute("aria-checked", b.dataset[key] === value);
}

// ComfyUI only sends progress and completion events to the client that queued the job. The "moss-"
// prefix asks __init__.py to copy every job's events to each Apoclada page, so the id needn't
// survive a reload; a fresh one per page keeps two open tabs from taking each other's socket.
// /studio?folder=<subfolder> shows only that part of the output folder, and leaves out other
// pages' jobs so nothing from elsewhere shows up on it either.
const folder = new URLSearchParams(location.search).get("folder") || "";
const clientId = `${folder ? "folder-" : "moss-"}${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
export const galleryUrl = `/studio/images?${new URLSearchParams({ folder })}`;

export let settings = { ...DEFAULTS, ...load(SETTINGS_KEY, null) };
settings.video = { ...DEFAULTS.video, ...settings.video };
// The start image became one of the video's images.
if (settings.video.start) settings.video.items = [{ kind: "image", role: "start", at: 2.5, ...settings.video.start }];
delete settings.video.start;
export let models = [];
export let turboLora = null;
export let rapidAdapter = null;
export let videoFiles = null;
// Safari and Chrome 155+ show JPEG XL. Other browsers get .jxl images as PNG copies made by the PC.
const JXL_PROBE = "data:image/jxl;base64,/woAEBAJCAABACgASxiLFcJJQU5/AA==";
let jxlShown = false;
let pending = load(PENDING_KEY, []);
let running = null;
let stopping = null;
let progressStart = 0;
// What Create shows, newest first, so the viewer steps across every job's results.
let results = [];
let previewUrl = null;
// latent_preview.preview_to_image reads a non_blocking GPU->CPU copy without syncing, so on
// ROCm the first preview of a job still holds the previous job's last frame. Skip it.
let skipNextPreview = false;

function round16(n) { return Math.max(256, Math.round(n / 16) * 16); }
export function dimensions(aspect, mp) {
  const [, a, b] = ASPECTS.find((x) => x[0] === aspect) || ASPECTS[0];
  const area = mp * 1024 * 1024;
  return { width: round16(Math.sqrt(area * a / b)), height: round16(Math.sqrt(area * b / a)) };
}

// A start image keeps its own shape, since H3 stretches the first frame onto the canvas, and an
// extended video keeps its size. Rounding to the 32 px grid can push the area past H3's native
// 768×1344 cap, so the target area shrinks until the rounded size fits; the shape is kept.
function round32(n) { return Math.max(32, Math.round(n / 32) * 32); }
export function videoDimensions(v) {
  if (v.extend) return { width: v.extend.width, height: v.extend.height };
  const start = v.items.find((i) => i.role === "start");
  const [a, b] = start ? [start.width, start.height] : (ASPECTS.find((x) => x[0] === v.aspect) || ASPECTS[5]).slice(1);
  for (let area = v.mp * 1024 * 1024; ; area *= 0.99) {
    const width = round32(Math.sqrt(area * a / b)), height = round32(Math.sqrt(area * b / a));
    if (width * height <= 768 * 1344) return { width, height };
  }
}

export function isVideo(item) { return /\.(mp4|webm|mov)$/i.test(item.filename); }
function isJxl(item) { return /\.jxl$/i.test(item.filename); }

// The slider moves over list indexes, so it snaps to each size.
function sizeSlider(slider, sizes, pick) {
  slider.max = sizes.length - 1;
  slider.oninput = () => { pick(sizes[slider.value]); syncForm(); };
}

function choice(key, value, onclick, ...children) {
  const btn = el("button", { type: "button", onclick }, ...children);
  btn.setAttribute("role", "radio");
  btn.dataset[key] = value;
  return btn;
}

function renderChoices() {
  $("aspects").replaceChildren(...ASPECTS.map(([name, a, b]) => {
    const scale = 18 / Math.max(a, b);
    const shape = el("span", { className: "shape" });
    shape.style.width = `${a * scale}px`;
    shape.style.height = `${b * scale}px`;
    return choice("aspect", name, () => { (settings.kind === "video" ? settings.video : settings).aspect = name; syncForm(); }, shape, name);
  }));
  sizeSlider($("megapixels"), MEGAPIXELS, (mp) => { settings.mp = mp; });
  $("slg").replaceChildren(...SLG_LAYERS.map(([layer, label]) => choice("layer", layer, () => { settings.slgLayer = layer; syncForm(); }, label)));
  sizeSlider($("video-mp"), VIDEO_MP, (mp) => { settings.video.mp = mp; });
  for (const b of $("mode").children) {
    const mode = MODES[b.dataset.mode];
    b.replaceChildren(mode.label, el("small", { textContent: `${mode.tuning.steps} steps` }));
    b.onclick = () => setMode(b.dataset.mode);
  }
  // Video step counts are filled in by syncVideoForm, since Turbo's depends on the model.
  for (const b of $("video-mode").children) {
    b.replaceChildren(VIDEO_MODES[b.dataset.mode], el("small"));
    b.onclick = () => { settings.video.mode = b.dataset.mode; syncForm(); };
  }
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

function defaultPrompt() {
  return MODES[settings.mode].prompt ?? DEFAULTS.prompt;
}

// Whether the PC has the file a mode needs.
export function modeAvailable(mode) { return !MODES[mode].file || Boolean(MODES[mode].file()); }

// The mode of a model family that has one of its own (Krea 2).
export function familyMode(modelName) {
  const family = models.find((m) => m.name === modelName)?.family;
  return family && Object.keys(MODES).find((m) => MODES[m].family === family);
}

// Krea 2 models get their own mode, and leaving them returns to the MOSS mode used before.
// An untouched example prompt switches to the one written for the new model.
function matchModeToModel() {
  const untouched = settings.prompt === defaultPrompt();
  const own = familyMode(settings.model);
  if (own && settings.mode !== own) {
    settings.mossMode = settings.mode;
    setMode(own);
  } else if (!own && MODES[settings.mode].family) {
    setMode(settings.mossMode || "full");
  }
  if (untouched) settings.prompt = defaultPrompt();
}

export function syncForm() {
  const video = settings.kind === "video";
  const v = settings.video;
  $("form").dataset.kind = settings.kind;
  $("kind").hidden = !videoFiles;
  check($("kind"), "kind", settings.kind);
  $("prompt").value = video ? v.prompt : settings.prompt;
  $("prompt").placeholder = PROMPT_HINTS[settings.kind];
  $("negative").value = settings.negative;
  check($("aspects"), "aspect", video ? v.aspect : settings.aspect);
  setUnused($("shape-field"), video && Boolean(v.extend || v.items.some((i) => i.role === "start")),
    v.extend ? "The video keeps the shape of the one it continues" : "The video takes the start image's shape");
  syncVideoForm();
  $("megapixels").value = MEGAPIXELS.indexOf(settings.mp);
  const { width, height } = dimensions(settings.aspect, settings.mp);
  $("size-out").textContent = `${settings.mp} MP · ${width}×${height}`;
  const mode = MODES[settings.mode];
  const buttons = [...$("mode").children];
  for (const b of buttons) b.hidden = !modeAvailable(b.dataset.mode);
  const shown = buttons.filter((b) => !b.hidden).length;
  $("mode-field").hidden = shown < 2;
  $("mode").className = shown === 3 ? "segmented" : "segmented two";
  check($("mode"), "mode", settings.mode);
  const unused = { ...(settings.cfg <= 1 && { negative: "Not used at CFG 1" }), ...mode.unused };
  for (const id of ["mode", "negative", "cfg", "slg", "easycache", "shift", "sampler", "scheduler"]) setUnused($(`${id}-field`), id in unused, unused[id]);
  [$("steps").min, $("steps").max] = mode.steps;
  $("steps-note").textContent = mode.note;
  $("size-note").textContent = mode.sizeNote;
  $("cfg-note").textContent = mode.cfgNote;
  const vsize = videoDimensions(v);
  $("settings-summary").textContent = (video
    ? [
        VIDEO_MODES[videoMode(v)],
        `${vsize.width}×${vsize.height}`,
        `${videoSteps(v, videoMode(v))} steps`,
        `${v.extend ? "+" : ""}${v.seconds} s`,
        settings.randomSeed ? "random seed" : `seed ${settings.seed}`,
      ]
    : [
        mode.label,
        settings.enhance ? "enhanced prompt" : "",
        settings.easyCache && !mode.unused.easycache ? "EasyCache" : "",
        `${width}×${height}`,
        `${settings.steps} steps`,
        mode.unused.cfg ? "" : `CFG ${Number(settings.cfg).toFixed(1)}`,
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
  $("enhance").checked = settings.enhance;
  $("easycache").checked = settings.easyCache;
  $("batch-out").textContent = settings.batch;
  $("model").value = settings.model;
  $("shift").step = mode.shiftStep ?? 0.5;
  $("shift").value = settings.shift;
  $("shift-out").textContent = Number(settings.shift).toFixed(mode.shiftStep ? 2 : 1);
  check($("slg"), "layer", settings.slgLayer);
  $("sampler").value = settings.sampler;
  $("scheduler").value = settings.scheduler;
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
  const mode = videoMode(v);
  const loras = videoLoras(v);
  $("video-mode").querySelector("[data-mode=turbo]").disabled = !loras.turbo[0];
  $("video-mode").querySelector("[data-mode=fast]").disabled = !loras.fast?.[0];
  for (const b of $("video-mode").children) {
    const steps = b.dataset.mode === "quality" ? DEFAULTS.video.steps : loras[b.dataset.mode]?.[1];
    b.querySelector("small").textContent = steps ? `${steps} steps` : "";
  }
  check($("video-mode"), "mode", mode);
  setUnused($("vsteps-field"), mode !== "quality", `${VIDEO_MODES[mode]} always uses ${videoSteps(v, mode)} steps`);
  $("vsteps").value = v.steps;
  $("vsteps-out").textContent = v.steps;
  $("video-mp").value = VIDEO_MP.indexOf(v.mp);
  const { width, height } = videoDimensions(v);
  $("vsize-out").textContent = v.extend ? `${width}×${height}` : `${v.mp} MP · ${width}×${height}`;
  setUnused($("vsize-field"), Boolean(v.extend), "The video keeps the size of the one it continues");
  $("length").value = v.seconds;
  $("length-out").textContent = `${v.extend ? "+" : ""}${v.seconds} s`;
  $("length-note").textContent = v.extend ? "How much to add, 2 to 15 seconds." : "2 to 15 seconds. Longer videos take longer to make.";
  renderMedia();
}

// Each item is an image (role start, at, end or ref), a gallery video or a voice (always ref).
// v.extend is the gallery video being continued.
export function usesRefs(v) { return v.items.some((i) => i.role === "ref"); }

// Each role's tile caption, note in the image dialog and Info row (tag is a reference's name in the
// prompt), and how start and end reach H3: Image to Video's frame inputs, or on the reference model an
// Add Guide at the first or last frame. Only one image can take each of those.
export const ROLES = {
  start: {
    caption: () => "Start", note: () => "The video starts on this image and keeps its shape.",
    info: "Start image", detail: (i) => mediaPath(i), input: "first_frame", frame: 0,
  },
  at: {
    caption: (i) => `At ${i.at} s`, note: () => "The video passes through this image at the time above.",
    info: "Images partway", detail: (i) => `${mediaPath(i)} at ${i.at} s`,
  },
  end: {
    caption: () => "End", note: () => "The video ends on this image.",
    info: "End image", detail: (i) => mediaPath(i), input: "last_frame", frame: -1,
  },
  ref: {
    caption: (i, tag) => tag, note: (tag) => `Called <${tag}> in the prompt. The video follows its character, place or style without showing it as a frame.`,
    info: "References", detail: (i, tag) => `${tag}: ${mediaPath(i)}`,
  },
};

export function mediaPath(item) { return item.subfolder ? `${item.subfolder}/${item.name}` : item.name; }

function mediaUrl(item) {
  return item.kind === "video"
    ? thumbUrl({ filename: item.name, subfolder: item.subfolder, mtime: "" })
    : `/view?${new URLSearchParams({ filename: item.name, subfolder: item.subfolder, type: "input" })}`;
}

// The reference model names its pictures first, then each video with its sound as the next <Audio N>,
// then the voices; the prompt uses these names.
export function referenceTags(v) {
  const tags = new Map();
  const count = { image: 0, video: 0, audio: 0 };
  for (const kind of ["image", "video", "audio"]) {
    for (const item of v.items.filter((i) => i.kind === kind && i.role === "ref")) {
      if (kind === "video") tags.set(item, [`Video ${++count.video}`, `Audio ${++count.audio}`]);
      else tags.set(item, [`${kind === "image" ? "Picture" : "Audio"} ${++count[kind]}`]);
    }
  }
  return tags;
}

function middle(v) { return Math.round(v.seconds) / 2; }

let mediaKey = null;
function renderMedia() {
  const v = settings.video;
  const refPack = Boolean(videoFiles?.ref_unet);
  $("media-label").textContent = refPack ? "Images and references" : "Images";
  const empty = !v.extend && !v.items.length;
  $("media-note").textContent = empty
    ? `Add a start or end image, images partway through${refPack ? ", or pictures, videos and voices for the video to follow" : ""}.`
    : `Tap one to change how it's used.${usesRefs(v) ? " Name references in the prompt as captioned, like <Picture 1>." : ""}`;
  // Rebuilding the tiles reloads their pictures, so it happens only when they change.
  const key = JSON.stringify([v.extend, v.items]);
  if (key === mediaKey) return;
  mediaKey = key;
  const tags = referenceTags(v);
  const tile = (item, caption) => el("button", { type: "button", onclick: () => openItem(item) },
    item.kind === "audio" ? el("span", { className: "tile-icon", textContent: "♪" }) : el("img", { src: mediaUrl(item), alt: "" }),
    el("span", { textContent: caption }));
  $("media").replaceChildren(
    ...(v.extend ? [tile(v.extend, "Continues")] : []),
    ...v.items.map((i) => tile(i, ROLES[i.role].caption(i, tags.get(i)?.[0]))),
    el("button", { type: "button", className: "add", onclick: pickMedia }, el("span", { className: "tile-icon", textContent: "+" }), el("span", { textContent: "Add" })));
}

// An untouched example prompt switches to the one that fits the video's new images.
export function editVideo(change) {
  const v = settings.video;
  const untouched = v.prompt === videoPrompt(v);
  change(v);
  if (untouched) v.prompt = videoPrompt(v);
  syncForm();
}

function videoPrompt(v) {
  return usesRefs(v) ? REFERENCE_PROMPT : v.items.some((i) => i.role === "start") ? ANIMATE_PROMPT : VIDEO_PROMPT;
}

// A new image starts the video, else ends it, else lands halfway; videos and voices are references.
function addMedia(item, role) {
  const v = settings.video;
  const free = (r) => !v.items.some((i) => i.role === r);
  item.role = role ?? (item.kind !== "image" ? "ref" : !v.extend && free("start") ? "start" : free("end") ? "end" : "at");
  if (item.kind === "image") item.at = middle(v);
  editVideo((v) => {
    v.items = [...v.items, item];
    setRole(item, item.role);
  });
  return item;
}

// Only one image can start or end the video; the one there before moves partway.
function setRole(item, role) {
  if (ROLES[role].input) for (const i of settings.video.items) if (i.role === role) i.role = "at";
  item.role = role;
}

function removeMedia(item) {
  editVideo((v) => {
    if (item === v.extend) v.extend = null;
    else v.items = v.items.filter((i) => i !== item);
  });
}

let shownItem = null;
function openItem(item) {
  shownItem = item;
  syncItem();
  $("item").showModal();
}

function syncItem() {
  const item = shownItem;
  const v = settings.video;
  const extend = item === v.extend;
  const tags = referenceTags(v).get(item);
  $("item-title").textContent = extend ? "Continues this video" : { image: "Image", video: "Reference video", audio: "Reference voice" }[item.kind];
  $("item-img").hidden = item.kind === "audio";
  $("item-audio").hidden = item.kind !== "audio";
  if (item.kind === "audio") $("item-audio").src = mediaUrl(item);
  else $("item-img").src = mediaUrl(item);
  $("item-role").hidden = item.kind !== "image" || extend;
  const ref = $("item-role").querySelector("[data-role=ref]");
  ref.hidden = !videoFiles?.ref_unet;
  ref.disabled = item.role !== "ref" && v.items.filter((i) => i.kind === "image" && i.role === "ref").length >= 9;
  $("item-role").className = ref.hidden ? "segmented" : "segmented four";
  $("item-role").querySelector("[data-role=start]").disabled = Boolean(v.extend);
  check($("item-role"), "role", item.role);
  $("item-at-field").hidden = item.role !== "at";
  $("item-at").max = Math.max(0.5, v.seconds - 0.5);
  $("item-at").value = item.at;
  $("item-at-out").textContent = `${item.at} s${v.extend ? " into the new part" : ""}`;
  $("item-note").textContent = extend
    ? "The new video picks up from the end of this one and is joined onto it. Describe what happens next."
    : item.kind === "video" ? `Called <${tags[0]}> in the prompt, and its sound <${tags[1]}>. The video can follow its characters, motion or camera work.`
    : item.kind === "audio" ? `Called <${tags[0]}> in the prompt. Use it as a voice, e.g. "<${tags[0]}> is the voice-timbre reference for <Subject 1> (S1)."`
    : ROLES[item.role].note(tags?.[0]);
}

// Images and voices go into ComfyUI's input folder (input/studio), where LoadImage and LoadAudio read them.
async function addFile(file, role) {
  const kind = file.type.startsWith("audio/") ? "audio" : "image";
  if (kind === "audio" && settings.video.items.filter((i) => i.kind === "audio").length >= 3) { toast("A video can follow up to 3 voices"); return null; }
  const form = new FormData();
  form.append("image", file);
  form.append("subfolder", "studio");
  const res = await fetch("/upload/image", { method: "POST", body: form }).catch(() => null);
  if (!res || !res.ok) { toast("Couldn't upload the file"); return null; }
  const { name, subfolder } = await res.json();
  const item = { kind, name, subfolder };
  if (kind === "image") {
    const size = await imageSize(mediaUrl(item)).catch(() => null);
    if (!size) { toast("That image format isn't supported"); return null; }
    Object.assign(item, size);
  }
  return addMedia(item, role);
}

function imageSize(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = url;
  });
}

// Uploads a gallery image to the video's images. JPEG XL goes as the PC's PNG copy so the image
// loads in any browser and in LoadImage.
export async function addFromGallery(img, role) {
  const blob = await fetch(isJxl(img) ? pngUrl(img) : imageUrl(img)).then((r) => r.blob()).catch(() => null);
  const name = img.filename.replace(/\.jxl$/i, ".png");
  return blob && addFile(new File([blob], name, { type: blob.type }), role);
}

// Gallery videos are offered as references only while the reference model is on the PC and the
// video has room for another; they're read straight from the output folder.
async function pickMedia() {
  const v = settings.video;
  const refPack = Boolean(videoFiles?.ref_unet);
  const videos = refPack && v.items.filter((i) => i.kind === "video").length < 3;
  $("media-file").accept = refPack ? "image/*,audio/*" : "image/*";
  const list = (await getJson(galleryUrl, [])).filter((img) => videos || !isVideo(img));
  $("picker-grid").replaceChildren(...(list.length ? list.map((img) => thumbButton(img, async () => {
    $("picker").close();
    const item = isVideo(img) ? addMedia({ kind: "video", name: img.filename, subfolder: img.subfolder || "" }) : await addFromGallery(img);
    if (item?.kind === "image") openItem(item);
  })) : [el("p", { className: "empty", textContent: "Nothing in the gallery yet." })]));
  $("picker").showModal();
  $("picker").scrollTop = 0;
}

// − and + beside each slider move it one step, which is hard to do by dragging on a touch screen.
// They're drawn as SVG because text glyphs sit at a different height in each font.
const MINUS = "M19 13H5v-2h14z", PLUS = "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z";
function addSliderButtons() {
  for (const slider of document.querySelectorAll("input[type=range]")) {
    const nudge = (path, label, move) => {
      const btn = el("button", {
        type: "button", onclick: () => { move(); slider.dispatchEvent(new Event("input")); },
        innerHTML: `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="${path}"/></svg>`,
      });
      btn.setAttribute("aria-label", label);
      return btn;
    };
    const row = el("div", { className: "slider" });
    slider.replaceWith(row);
    row.append(nudge(MINUS, "Less", () => slider.stepDown()), slider, nudge(PLUS, "More", () => slider.stepUp()));
  }
}

function bindForm() {
  addSliderButtons();
  $("prompt").oninput = (e) => { (settings.kind === "video" ? settings.video : settings).prompt = e.target.value; save(SETTINGS_KEY, settings); };
  $("length").oninput = (e) => { settings.video.seconds = Number(e.target.value); syncForm(); };
  $("vsteps").oninput = (e) => { settings.video.steps = Number(e.target.value); syncForm(); };
  $("media-file").onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    $("picker").close();
    const item = await addFile(file);
    if (item?.kind === "image") openItem(item);
  };
  for (const b of $("item-role").children) b.onclick = () => { editVideo(() => setRole(shownItem, b.dataset.role)); syncItem(); };
  $("item-at").oninput = (e) => { shownItem.at = Number(e.target.value); syncItem(); syncForm(); };
  $("item-remove").onclick = () => { $("item").close(); removeMedia(shownItem); };
  for (const id of ["picker", "item"]) {
    $(`${id}-close`).onclick = () => $(id).close();
    // A tap outside the panel lands on the dialog's backdrop, which counts as the dialog itself.
    $(id).onclick = (e) => { if (e.target === $(id)) $(id).close(); };
  }
  $("item").onclose = () => $("item-audio").pause();
  $("negative").oninput = (e) => { settings.negative = e.target.value; save(SETTINGS_KEY, settings); };
  $("steps").oninput = (e) => { settings.steps = Number(e.target.value); syncForm(); };
  $("cfg").oninput = (e) => { settings.cfg = Number(e.target.value); syncForm(); };
  $("shift").oninput = (e) => { settings.shift = Number(e.target.value); syncForm(); };
  $("sampler").onchange = (e) => { settings.sampler = e.target.value; syncForm(); };
  $("scheduler").onchange = (e) => { settings.scheduler = e.target.value; syncForm(); };
  $("seed").onchange = (e) => { settings.seed = Math.max(0, Math.floor(Number(e.target.value) || 0)); syncForm(); };
  $("random-seed").onchange = (e) => { settings.randomSeed = e.target.checked; syncForm(); };
  $("enhance").onchange = (e) => { settings.enhance = e.target.checked; syncForm(); };
  $("easycache").onchange = (e) => { settings.easyCache = e.target.checked; syncForm(); };
  $("model").onchange = (e) => { settings.model = e.target.value; matchModeToModel(); syncForm(); };
  for (const b of document.querySelectorAll(".stepper button")) {
    b.onclick = () => { settings.batch = Math.min(4, Math.max(1, settings.batch + Number(b.dataset.step))); syncForm(); };
  }
  $("reset").onclick = () => {
    const { video, kind } = settings;
    if (kind === "video") {
      settings.video = { ...DEFAULTS.video, prompt: video.prompt, items: video.items, extend: video.extend };
      Object.assign(settings, { seed: DEFAULTS.seed, randomSeed: DEFAULTS.randomSeed });
    } else {
      settings = { ...DEFAULTS, ...MODES[settings.mode].tuning, prompt: settings.prompt, negative: settings.negative, model: settings.model, mode: settings.mode, tuning: {}, video, kind };
    }
    syncForm();
    toast("Default settings restored (your prompts were kept)");
  };
  $("reset-prompts").onclick = () => {
    const video = settings.kind === "video";
    if (!confirm(video ? "Replace your prompt with the default example prompt?" : "Replace your prompts with the default example prompt and negative prompt?")) return;
    if (video) settings.video.prompt = videoPrompt(settings.video);
    else Object.assign(settings, { prompt: defaultPrompt(), negative: DEFAULTS.negative });
    syncForm();
  };
  $("settings").open = load("moss-studio-settings-open", false);
  $("settings").ontoggle = () => save("moss-studio-settings-open", $("settings").open);
  $("form").onsubmit = (e) => { e.preventDefault(); generate(); };
  $("cancel").onclick = cancelCurrent;
}

async function generate() {
  const video = settings.kind === "video";
  if (!(video ? settings.video.prompt : settings.prompt).trim()) { toast("Write a prompt first"); $("prompt").focus(); return; }
  if (!video && !models.length) { toast("No image model yet. Download one in Setup."); return; }
  if (video && !videoFiles) { toast("The MiniMax H3 files are missing. Download them in Setup."); return; }
  if (video && usesRefs(settings.video) && !videoFiles.ref_unet) { toast("References need the MiniMax H3 references pack. Download it in Setup."); return; }
  if (settings.randomSeed) settings.seed = Math.floor(Math.random() * 2 ** 48);
  syncForm();
  await refreshPrefs();
  // On AMD, a video made after another generation samples about 3x slower until ComfyUI unloads
  // everything (ComfyUI issue #16502). ComfyUI applies /free between jobs, so a video queued behind
  // another job still gets it just before it starts.
  if (video) await post("/free", { unload_models: true, free_memory: true }).catch(() => null);
  // ComfyUI sends no previews unless started with --preview-method, so each job asks for them.
  const res = await post("/prompt", {
    prompt: video ? buildVideoWorkflow(settings) : buildWorkflow(settings), client_id: clientId, extra_data: { preview_method: "latent2rgb" },
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
  // The preview's space is held from the start, so the page doesn't shrink and scroll back up while
  // the first preview loads.
  if (!$("results").querySelector(".preview")) {
    const { width, height } = video ? videoDimensions(settings.video) : dimensions(settings.aspect, settings.mp);
    previewSlot(width, height).style.aspectRatio = `${width} / ${height}`;
  }
  // A job queued behind another of this page's leaves the page where it is.
  if (pending.length === 1 && window.matchMedia("(max-width: 899px)").matches) document.querySelector(".stage").scrollIntoView({ behavior: "smooth", block: "start" });
}

// Stops the job generating now, or the next one if none has started, leaving the rest queued.
async function cancelCurrent() {
  if (running && stopping === running) return forceStop();
  if (running) {
    await post("/interrupt", { prompt_id: running });
    stopping = running;
    $("cancel").textContent = "Force stop";
    updateStatus("Stopping…");
  } else if (pending.length) {
    const next = pending[0];
    await post("/queue", { delete: [next] });
    finish(next);
  }
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
export function imageUrl(img) {
  return `/view?${new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || "", type: "output", v: img.version ?? img.mtime ?? "" })}`;
}

function pngUrl(img) {
  return `/studio/images/png?${new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || "", v: img.version ?? img.mtime ?? "" })}`;
}

// Shows an output image, switching to the PNG copy if the browser can't decode a .jxl file.
export function showImage(el, img) {
  el.onerror = isJxl(img) ? () => { el.onerror = null; el.src = pngUrl(img); } : null;
  el.src = isJxl(img) && !jxlShown ? pngUrl(img) : imageUrl(img);
}

export function imageKey(img) {
  return `${img.subfolder || ""}/${img.filename}`;
}

export function thumbUrl(img) {
  return `/studio/images/thumb?${new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || "", t: img.mtime })}`;
}

async function collectResult(id) {
  const res = await fetch(`/history/${id}`).catch(() => null);
  const entry = res && res.ok ? (await res.json())[id] : null;
  if (!entry) return false;
  const outputs = Object.values(entry.outputs || {});
  const images = outputs.flatMap((o) => o.images || []).filter((i) => i.type === "output");
  const seconds = outputs.find((o) => o.generation_time)?.generation_time[0];
  if (images.length) {
    showResults(images, id);
    if (seconds !== undefined) toast(`Done in ${duration(seconds)}`);
  } else if (entry.status?.status_str === "error") {
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
  results = [...list, ...results].slice(0, 12);
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
      showImage(el, img);
    }
    el.onclick = () => openViewer(results, results.indexOf(img));
    el.dataset.key = imageKey(img);
    box.prepend(el);
  }
  while (box.children.length > 12) box.lastElementChild.remove();
}

// The live preview's frame. Until the first preview arrives, waves of light sweep diagonally across
// square tiles, nine along the short side. The preview fades in over them, then they go.
function previewSlot(width = 16, height = 9) {
  let slot = $("results").querySelector(".preview");
  if (!slot) {
    const cols = Math.round(9 * Math.max(1, width / height));
    const rows = Math.round(9 * Math.max(1, height / width));
    const tiles = el("div", { className: "tiles" });
    tiles.style.gridTemplate = `repeat(${rows}, 1fr) / repeat(${cols}, 1fr)`;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        // A wave takes 2.76 s to cross any shape, so the next one starts as the last tile goes dark.
        const tile = el("i");
        tile.style.animationDelay = `${((x + y) / (cols + rows - 2)) * 2.76}s`;
        tiles.append(tile);
      }
    }
    slot = el("div", { className: "preview" }, el("img", { alt: "Live preview", onanimationend: () => tiles.remove() }), tiles);
    $("results").prepend(slot);
  }
  return slot;
}

function showPreview(blob) {
  const img = previewSlot().querySelector("img");
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(blob);
  img.src = previewUrl;
}

function removePreview() {
  $("results").querySelector(".preview")?.remove();
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
}

// Rewinds the inline result videos so leaving the page doesn't leave one mid-play.
function resetResultVideos() {
  for (const v of $("results").querySelectorAll("video")) {
    v.pause();
    v.currentTime = 0;
  }
}

// Takes an image deleted in the viewer out of the results.
export function removeResult(key) {
  results = results.filter((r) => imageKey(r) !== key);
  for (const el of $("results").querySelectorAll("[data-key]")) if (el.dataset.key === key) el.remove();
}

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
      // TextGenerate counts tokens against its length limit, which a rewrite rarely gets near.
      if (data.node === "30") { updateStatus(`Rewriting prompt… ${data.value} token${data.value === 1 ? "" : "s"}`); break; }
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
  const queue = await getJson("/queue");
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

export function selectTab(name) {
  resetResultVideos();
  for (const b of document.querySelectorAll(".tabs button")) b.setAttribute("aria-selected", b.dataset.tab === name);
  $("tab-create").hidden = name !== "create";
  $("tab-gallery").hidden = name !== "gallery";
  $("tab-setup").hidden = name !== "setup";
  if (name === "gallery") loadGallery();
  if (name === "setup") { loadSetup(); loadPrefs(); loadUpdates(); }
}

let toastTimer;
export function toast(text) {
  $("toast").textContent = text;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $("toast").hidden = true; }, 3500);
}

async function init() {
  renderChoices();
  bindForm();
  // Opened once on load, so the form never reopens it after it's collapsed.
  if (settings.negative) $("negative-field").open = true;
  bindViewer();
  for (const b of document.querySelectorAll(".tabs button")) b.onclick = () => selectTab(b.dataset.tab);
  $("refresh").onclick = loadGallery;
  // Only one video plays at a time: starting one pauses the others. "play" doesn't bubble, hence capture.
  document.addEventListener("play", (e) => {
    for (const v of document.querySelectorAll("video")) if (v !== e.target) v.pause();
  }, true);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) resync(); });
  getJson("/studio/host", {}).then(({ host }) => { $("v-reveal").hidden = !host; });
  jxlShown = await imageSize(JXL_PROBE).then(() => true, () => false);
  await loadModels();
  // A fresh install has nothing to generate with yet, so it opens on Setup.
  if (!models.length && !videoFiles) selectTab("setup");
  else { loadSetup(); loadUpdates(); }
  connect();
}

export async function loadModels() {
  let ksampler;
  [models, { lora: turboLora, rapid: rapidAdapter }, videoFiles, ksampler] = await Promise.all([
    getJson("/studio/models", []),
    getJson("/studio/turbo", { lora: null, rapid: null }),
    getJson("/studio/video"),
    getJson("/object_info/KSampler"),
  ]);
  // The lists come from ComfyUI, so samplers added by other custom nodes show up too.
  const { sampler_name, scheduler } = ksampler?.KSampler.input.required ?? {};
  $("sampler").replaceChildren(...(sampler_name?.[0] ?? [settings.sampler]).map((n) => new Option(n, n)));
  $("scheduler").replaceChildren(...(scheduler?.[0] ?? [settings.scheduler]).map((n) => new Option(n, n)));
  if (!modeAvailable(settings.mode)) setMode("full");
  if (!videoFiles) settings.kind = "image";
  else if (!models.length) settings.kind = "video";
  renderModels();
  syncForm();
}

init();
