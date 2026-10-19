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
// MiniMax's H3 prompt guide (VIDEO_PROMPT_WRITING_GUIDE_base_en.md) uses three fields: shots with camera
// moves and speaker-tagged <d> dialogue, ambient sound, and background score. Filling both sound fields
// keeps the model from inventing speech. Image-to-video prompts start with START_LINE and a blank line.
const VIDEO_PROMPT = `integrated_multimodal_description: [Shot 1] 2D-animated, soft anime style, a medium close-up shot frames Hatsune Miku, the only customer in a quiet corner café on a rainy evening, sitting by the rain-streaked window in a cream knit sweater with a steaming mug in both hands. The camera pushes in with small amplitude at slow speed as she blows gently across the mug, smiles, and with a soft, bright voice (S1) says: <d>[English] Just one more cup before I go.</d>

overall_soundscape: Rain patters steadily against the window glass, the ceramic mug clinks softly on the wooden table, and muffled traffic hums outside.

non_diegetic_music: A slow lo-fi piano melody with soft brushed drums.`;
// With a start image the guide describes only the motion and what <Picture 1> keeps, so this example
// fits any picture. It has no speaker, and both sound fields are filled so no speech is invented.
const ANIMATE_PROMPT = `integrated_multimodal_description: [Shot 1] The scene shown in <Picture 1> comes to life, keeping its art style, characters, clothing, lighting and composition. The camera pushes in with small amplitude at slow speed as the main character blinks, breathes gently and turns slightly toward the camera with a soft smile.

overall_soundscape: Soft ambient sound that fits the setting, with faint fabric rustling as the character moves.

non_diegetic_music: N/A`;
const START_LINE = "For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.";
const DEFAULTS = {
  prompt: "masterpiece, best quality, score_7, highres, year 2025, hatsune miku, vocaloid, 1girl, solo, smile, cream sweater\nShe sits at a small table by the rain-streaked window of a corner café on a rainy evening, holding a steaming mug in both hands, her long twintails falling over her shoulders. Seen from the side at eye level, warm amber light from a pendant lamp falls across her face, while the street outside glows cool blue with blurred city lights. A small chalkboard on the table reads \"Open late\" in white chalk. Soft anime illustration with clean lines; the mood is calm and cozy.",
  negative: "worst quality, bad anatomy, watermark, jpeg artifact",
  aspect: "1:1", mp: 1, steps: 50, cfg: 3, seed: 42,
  randomSeed: true, batch: 1, shift: 5, slgLayer: "22", model: "", enhance: false,
  mode: "full", tuning: {}, kind: "image",
  video: { prompt: VIDEO_PROMPT, aspect: "16:9", mp: 0.4, seconds: 5, turbo: true, steps: 20, start: null },
};
// Krea 2's prompting guide asks for natural-language sentences and quoted text, so Kroma gets the same
// scene in prose, ordered like the guide's examples: subject and details, then lighting, style and framing.
const KREA2_PROMPT = "Hatsune Miku sits at a small table by the rain-streaked window of a corner café on a rainy evening, smiling softly as she holds a steaming mug in both hands. She wears a cream knit sweater, and her long teal twintails fall over her shoulders. A small chalkboard on the table reads \"Open late\" in white chalk. Warm amber light from a pendant lamp falls across her face, while the street outside glows cool blue with blurred city lights. Soft anime illustration with clean lines and a muted, warm color palette, seen from the side at eye level in a medium shot. The mood is calm and cozy.";
// "Enhance prompt" copies the prompt rewriters in ComfyUI's MOSS and Krea 2 templates
// (comfyui-workflow-templates 0.11.89): the text encoder rewrites the prompt with TextGenerate first.
// MOSS passes its instructions as the system prompt; Krea 2's template puts them in front of the prompt.
const MOSS_ENHANCE = `You turn a user's image idea into one detailed caption for a text-to-image model. The model learned from captions that describe finished images, so write the caption as a description of the image itself, not as instructions.

Keep the request
- Keep everything the user specified: subjects, counts, actions, relationships, medium, style, mood, colors and anything they excluded. Never contradict or drop it.
- Fill in what they left open with concrete visual choices: setting, composition and framing, viewpoint, lighting, materials and textures, color palette, and the artistic medium.
- Describe only what can be seen. Leave out sounds, smells, backstory and intentions.
- Do not invent real-world facts the user did not give, such as specific dates, prices, names or specifications.

Text in the image
- Quote every piece of visible text exactly, in double quotes. Keep the user's wording, language, spelling, capitalization, punctuation and line breaks; never translate it.
- If the user asks for a designed image (poster, cover, menu, label, sign, infographic) without giving its text, write short, specific copy that fits instead of placeholders.
- Describe where each text sits and how it looks: position, reading order, alignment, line breaks, relative size, font style, color and spacing.
- Do not mention watermarks or artist signatures.

Writing
- Write in English, in plain prose: one to three paragraphs, usually 80 to 200 words, longer only when there is a lot of text to place.
- Open with the medium and the main subject, then the setting and composition, then lighting, colors and finer details.
- Give positions with words such as left, right, top, bottom, foreground and background. No coordinates, lists, headings, JSON or Markdown.
- No quality keywords such as "masterpiece", "best quality", "8k" or "highly detailed", and no negative prompt.

Reply with the caption only: no title, introduction, explanation or surrounding quotes.`;
const KREA2_ENHANCE = `You are an expert prompt engineer for text-to-image models. Your task is to expand the user's prompt into a highly effective image-generation prompt.

Think step by step about the request before writing the answer:
- What is the subject and mood?
- What visual styles, mediums, and lighting options would fit? Consider two or three alternatives and pick the one that best serves the request.
- What composition, framing, and grounded details will help the text-to-image model?

Then output a single expanded prompt paragraph.

Follow these rules strictly:
1. **Faithfulness First:** Preserve all original subjects, actions, colors, and spatial relationships. Do not add new objects, props, characters, or animals unless the user clearly implies them.
2. **Practical T2I Structure:** Write a prompt that a text-to-image model can parse cleanly. Group subjects with their own attributes and actions. Use grounded phrasing for poses, interactions, and spatial layout.
3. **Style Planning Stays Internal:** Use your internal reasoning to choose style, medium, framing, and lighting. Do not emit planning tags or wrappers in the visible answer body.
4. **Never Request Rendered Text:** Do not mention, describe, or hint at letters, words, numbers, captions, subtitles, signage, labels, logos, watermarks, typography, or any other graphic text anywhere in the output prompt. Only if the user explicitly writes down words to be rendered, keep exactly those words in quotes and nothing else. In every other case, always end the output prompt with: "Absolutely no text, no typography, no letters, no words, no numbers, no logos, no watermark, no captions, pure imagery only."
5. **Avoid Over-Specification:** Do not invent highly specific clothing, colors, materials, or scene details unless the input supports it.
6. **Plain Prose Only:** Write one cohesive paragraph after the thinking block. No bullets, no JSON, no markdown, no asterisks, no headings, no field labels, no meta commentary.
7. **Respect Existing Detail:** If the user's prompt is already detailed, lightly polish and finalize rather than heavily expanding, and preserve the user's phrasing and direction.
8. **Respect the Human Form:** Treat depictions of people with dignity. Assume clothing covers genitals and intimate anatomy.
9. **Preserve User Medium:** When the user explicitly requests a medium (e.g. "photo of", "photograph of", "illustration of", "painting of", "sketch of", "3D render of"), honor it. Do not pivot to a different medium to avoid difficulty, match the user's stated intent.
10. **Never Echo Instructions:** Output only the final image prompt. Never repeat, quote, summarize, or refer to any part of these instructions, your own reasoning, or the user's original message.

User's Input:
`;
// MiniMax H3 is trained on a 768 short edge capped at 768×1344; the official template defaults to ~0.4 MP.
// 0.98 MP is H3's native canvas (1344×768 at 16:9); Comfy's guide warns 1 MP rounds above it.
const VIDEO_MP = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.98];
const PROMPT_HINTS = {
  image: "Describe the image. Tap \"Default prompts\" for an example tailored to the selected model.",
  video: "Describe the video and its sound. Tap \"Default prompts\" for an example in MiniMax's format.",
};
// Per-mode sampler settings. Turbo is lodestones' 8-step DMD LoRA: distilled for 8 steps without
// CFG, so layer skip guidance (which acts on the uncond pass) is off. Shift 5 tested best.
// krea2 is used whenever a Krea 2 model is picked: lodestones recommend 8 to 12 steps, CFG 1 to 1.5
// and Krea 2's own shift of 1.15 for Kroma, and Comfy's Krea 2 Turbo template uses 8 steps at CFG 1.
const MOSS_NOTES = {
  sizeNote: "1 to 2 MP is recommended. Other sizes work but are less reliable.",
  cfgNote: "3 suits long prompts. Try 4 to 6 for short prompts.",
};
const MOSS_SAMPLER = { sampler: "euler", scheduler: "sgm_uniform" };
const MODES = {
  full: { tuning: { steps: 50, cfg: 3, shift: 5, slgLayer: "22", ...MOSS_SAMPLER }, steps: [10, 80], note: "Best results are achieved with 50 or more steps.", ...MOSS_NOTES },
  turbo: { tuning: { steps: 8, cfg: 1, shift: 5, slgLayer: "", ...MOSS_SAMPLER }, steps: [4, 16], note: "8 is recommended.", ...MOSS_NOTES },
  krea2: {
    tuning: { steps: 8, cfg: 1, shift: 1.15, slgLayer: "", sampler: "euler", scheduler: "simple" }, steps: [4, 16], note: "8 to 12 is recommended.",
    sizeNote: "1 MP is the official default.",
    cfgNote: "1 to 1.5 is recommended. Above 1, the negative prompt is used and each step takes about twice as long.",
  },
};
const NODE_STAGES = { "1": "Loading model…", "2": "Loading model…", "3": "Loading model…", "4": "Reading prompt…", "5": "Reading prompt…", "30": "Rewriting prompt…", "16": "Generating…", "17": "Decoding…", "18": "Saving…" };
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
// The video prompt started out empty; an empty one can't be generated, so it gets the example.
settings.video.prompt ||= videoPrompt(settings.video.start);
if (settings.video.mp === 1) settings.video.mp = 0.98;
// Start images moved from input/mobile to input/studio with the rename to Apoclada Studio.
if (settings.video.start?.subfolder === "mobile") settings.video.start.subfolder = "studio";
// The 8-step mode was saved as "fast" before it was renamed to Turbo.
for (const k of ["mode", "mossMode"]) if (settings[k] === "fast") settings[k] = "turbo";
if (settings.tuning?.fast) { settings.tuning.turbo = settings.tuning.fast; delete settings.tuning.fast; }
// Settings saved before the sampler could be picked get the mode's default.
settings.sampler ??= MODES[settings.mode].tuning.sampler;
settings.scheduler ??= MODES[settings.mode].tuning.scheduler;
let models = [];
let turboLora = null;
let videoFiles = null;
// Setup's file format, shared by every device through the PC; generate() refreshes it before each image.
let prefs = { image_format: "png", jxl_lossless: true, jxl_available: false };
// Safari and Chrome 155+ show JPEG XL. Other browsers get .jxl images as PNG copies made by the PC.
const JXL_PROBE = "data:image/jxl;base64,/woAEBAJCAABACgASxiLFcJJQU5/AA==";
let jxlShown = false;
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
function isJxl(item) { return /\.jxl$/i.test(item.filename); }

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

function defaultPrompt() {
  return settings.mode === "krea2" ? KREA2_PROMPT : DEFAULTS.prompt;
}

// Krea 2 models get their own mode, and leaving them returns to the MOSS mode used before.
// An untouched example prompt switches to the one written for the new model.
function matchModeToModel() {
  const untouched = settings.prompt === defaultPrompt();
  const krea2 = models.find((m) => m.name === settings.model)?.family === "krea2";
  if (krea2 && settings.mode !== "krea2") {
    settings.mossMode = settings.mode;
    setMode("krea2");
  } else if (!krea2 && settings.mode === "krea2") {
    setMode(settings.mossMode || "full");
  }
  if (untouched) settings.prompt = defaultPrompt();
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
  const turbo = settings.mode === "turbo";
  const krea2 = settings.mode === "krea2";
  const mode = MODES[settings.mode];
  $("mode-field").hidden = !turboLora;
  setUnused($("mode-field"), krea2, "Krea 2 models have no Turbo mode");
  for (const b of $("mode").children) b.setAttribute("aria-checked", b.dataset.mode === settings.mode);
  setUnused($("negative-field"), turbo || settings.cfg <= 1, turbo ? "Not used in Turbo mode" : "Not used at CFG 1");
  setUnused($("cfg-field"), turbo, "Not used in Turbo mode");
  setUnused($("slg-field"), turbo || krea2, turbo ? "Not used in Turbo mode" : "Not used with Krea 2 models");
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
        turbo ? "Turbo" : "",
        settings.enhance ? "enhanced prompt" : "",
        `${width}×${height}`,
        `${settings.steps} steps`,
        turbo ? "" : `CFG ${Number(settings.cfg).toFixed(1)}`,
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
  $("batch-out").textContent = settings.batch;
  $("model").value = settings.model;
  // Krea 2's shift of 1.15 sits between MOSS's half steps.
  $("shift").step = krea2 ? 0.05 : 0.5;
  $("shift").value = settings.shift;
  $("shift-out").textContent = Number(settings.shift).toFixed(krea2 ? 2 : 1);
  for (const b of $("slg").children) b.setAttribute("aria-checked", b.dataset.layer === settings.slgLayer);
  $("sampler").value = settings.sampler;
  $("scheduler").value = settings.scheduler;  save(SETTINGS_KEY, settings);
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
  setVideoStart({ name, subfolder, ...size });
  syncForm();
  return true;
}

function videoPrompt(start) {
  return start ? ANIMATE_PROMPT : VIDEO_PROMPT;
}

// An untouched example prompt switches to the one for a video with or without a start image.
function setVideoStart(start) {
  const v = settings.video;
  if (v.prompt === videoPrompt(v.start)) v.prompt = videoPrompt(start);
  v.start = start;
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
  $("start-clear").onclick = () => { setVideoStart(null); syncForm(); };
  $("start-gallery").onclick = pickFromGallery;
  $("picker-close").onclick = () => $("picker").close();
  // A tap outside the panel lands on the dialog's backdrop, which counts as the dialog itself.
  $("picker").onclick = (e) => { if (e.target === $("picker")) $("picker").close(); };
  $("negative").oninput = (e) => { settings.negative = e.target.value; save(SETTINGS_KEY, settings); };
  $("steps").oninput = (e) => { settings.steps = Number(e.target.value); syncForm(); };
  $("cfg").oninput = (e) => { settings.cfg = Number(e.target.value); syncForm(); };
  $("shift").oninput = (e) => { settings.shift = Number(e.target.value); syncForm(); };
  $("sampler").onchange = (e) => { settings.sampler = e.target.value; syncForm(); };
  $("scheduler").onchange = (e) => { settings.scheduler = e.target.value; syncForm(); };
  $("seed").onchange = (e) => { settings.seed = Math.max(0, Math.floor(Number(e.target.value) || 0)); syncForm(); };
  $("random-seed").onchange = (e) => { settings.randomSeed = e.target.checked; syncForm(); };
  $("enhance").onchange = (e) => { settings.enhance = e.target.checked; syncForm(); };
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
    if (!confirm(video ? "Replace your prompt with the default example prompt?" : "Replace your prompts with the default example prompt and negative prompt?")) return;
    if (video) settings.video.prompt = videoPrompt(settings.video.start);
    else Object.assign(settings, { prompt: defaultPrompt(), negative: DEFAULTS.negative });
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
  const turbo = s.mode === "turbo";
  // ComfyUI's native MOSS model takes raw 0-1 timesteps: ModelSamplingSD3 would scale them by 1000
  // and produce pure noise, so the shift goes through the AuraFlow node instead.
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: model.unet, weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: model.clip, type: "moss_image", device: "default" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: model.vae } },
    ...(turbo && { "20": { class_type: "LoraLoaderModelOnly", inputs: { lora_name: turboLora, strength_model: 1, model: ["1", 0] } } }),
    ...(s.enhance && enhanceNodes(s, { prompt: s.prompt, system_prompt: MOSS_ENHANCE, max_length: 4096, "sampling_mode.repetition_penalty": 1, mtp: "auto" })),
    "4": { class_type: "CLIPTextEncode", inputs: { text: s.enhance ? ["30", 0] : s.prompt, clip: ["2", 0] } },
    "5": { class_type: "CLIPTextEncode", inputs: { text: s.negative, clip: ["2", 0] } },
    "6": { class_type: "EmptyFlux2LatentImage", inputs: { width, height, batch_size: s.batch } },
    "15": { class_type: "ModelSamplingAuraFlow", inputs: { shift: s.shift, model: [turbo ? "20" : "1", 0] } },
    "13": {
      class_type: "SkipLayerGuidanceDiTSimple",
      inputs: { double_layers: "", single_layers: s.slgLayer, start_percent: 0, end_percent: 1, model: ["15", 0] },
    },
    "16": {
      class_type: "KSampler",
      inputs: {
        seed: s.seed, steps: s.steps, cfg: s.cfg, sampler_name: s.sampler, scheduler: s.scheduler, denoise: 1,
        model: ["13", 0], positive: ["4", 0], negative: ["5", 0], latent_image: ["6", 0],
      },
    },
    "17": { class_type: "VAEDecode", inputs: { samples: ["16", 0], vae: ["3", 0] } },
    "18": saveNode("studio/moss", s),
  };
}

// TextGenerate "30" rewrites the prompt with the template's sampler settings. It uses the image's
// seed, so Reuse settings repeats the rewrite.
function enhanceNodes(s, inputs) {
  return {
    "30": {
      class_type: "TextGenerate",
      inputs: {
        clip: ["2", 0], sampling_mode: "on", "sampling_mode.temperature": 0.7, "sampling_mode.top_k": 64, "sampling_mode.top_p": 0.95,
        "sampling_mode.min_p": 0.05, "sampling_mode.seed": s.seed, "sampling_mode.presence_penalty": 0, thinking: false, use_default_template: true, ...inputs,
      },
    },
  };
}

// Apoclada's save nodes write the enhanced prompt into the file for the viewer's Info.
function saveNode(prefix, s) {
  const inputs = { filename_prefix: prefix, images: ["17", 0], ...(s.enhance && { enhanced_prompt: ["30", 0] }) };
  if (prefs.image_format === "jxl" && prefs.jxl_available) return { class_type: "ApocladaSaveImageJXL", inputs: { ...inputs, lossless: prefs.jxl_lossless } };
  return { class_type: s.enhance ? "ApocladaSaveImage" : "SaveImage", inputs };
}

// Follows Comfy's Krea 2 Turbo template (euler, simple scheduler), with the shift exposed through
// ModelSamplingAuraFlow, which matches Krea 2's own flow sampling. Node ids line up with NODE_STAGES.
function buildKrea2Workflow(s, model, width, height) {
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: model.unet, weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: model.clip, type: "krea2", device: "default" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: model.vae } },
    ...(s.enhance && enhanceNodes(s, { prompt: KREA2_ENHANCE + s.prompt, max_length: 512, "sampling_mode.repetition_penalty": 1.05 })),
    "4": { class_type: "CLIPTextEncode", inputs: { text: s.enhance ? ["30", 0] : s.prompt, clip: ["2", 0] } },
    "5": { class_type: "CLIPTextEncode", inputs: { text: s.negative, clip: ["2", 0] } },
    "6": { class_type: "EmptyLatentImage", inputs: { width, height, batch_size: s.batch } },
    "15": { class_type: "ModelSamplingAuraFlow", inputs: { shift: s.shift, model: ["1", 0] } },
    "16": {
      class_type: "KSampler",
      inputs: {
        seed: s.seed, steps: s.steps, cfg: s.cfg, sampler_name: s.sampler, scheduler: s.scheduler, denoise: 1,
        model: ["15", 0], positive: ["4", 0], negative: ["5", 0], latent_image: ["6", 0],
      },
    },
    "17": { class_type: "VAEDecode", inputs: { samples: ["16", 0], vae: ["3", 0] } },
    "18": saveNode("studio/krea2", s),
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
      inputs: { clip: ["2", 0], vae: ["3", 0], prompt: v.start && !v.prompt.includes("is fully referenced") ? `${START_LINE}\n\n${v.prompt}` : v.prompt, width, height, length: videoLength(v.seconds), ...(v.start && { first_frame: ["21", 0] }) },
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
  if (!video) prefs = await fetch("/studio/prefs").then((r) => r.json()).catch(() => prefs);
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

function pngUrl(img) {
  return `/studio/images/png?${new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || "", v: img.version ?? img.mtime ?? "" })}`;
}

// Shows an output image, switching to the PNG copy if the browser can't decode a .jxl file.
function showImage(el, img) {
  el.onerror = isJxl(img) ? () => { el.onerror = null; el.src = pngUrl(img); } : null;
  el.src = isJxl(img) && !jxlShown ? pngUrl(img) : imageUrl(img);
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
      showImage(el, img);
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
  $("v-info-panel").hidden = true;
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
    showImage($("v-img"), item);
  }
  $("v-save").hidden = !video;
  $("v-save").href = imageUrl(item);
  $("v-save").download = item.filename;
  $("v-animate").hidden = video || !videoFiles;
  $("v-hint").hidden = !video;
  $("v-pos").textContent = list.length > 1 ? `${viewer.index + 1} / ${list.length}` : "";
  $("v-prev").disabled = viewer.index === 0;
  $("v-next").disabled = viewer.index === list.length - 1;
  if (!$("v-info-panel").hidden) showInfo();
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

function imageInfo(img) {
  const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || "" });
  return fetch(`/studio/images/info?${q}`).then((r) => r.json()).catch(() => null);
}

// Info lists the prompts and settings read back from the workflow saved in the file. Enhanced
// images keep the typed prompt in TextGenerate and the rewrite next to the workflow.
async function showInfo() {
  const img = viewer.list[viewer.index];
  $("v-info-panel").hidden = false;
  $("v-info-list").replaceChildren(el("dd", { className: "note", textContent: "Loading…" }));
  const info = await imageInfo(img);
  if (viewer.list[viewer.index] !== img) return;
  const rows = infoRows(info, img).filter(([, value]) => value !== null && value !== undefined && value !== "");
  $("v-info-list").replaceChildren(...rows.map(([label, value]) => el("div", {}, el("dt", { textContent: label }), el("dd", {}, value))));
}

function infoRows(info, img) {
  const graph = info?.prompt;
  if (!graph) return [["Settings", "This file has no saved settings."], ["File", img.filename]];
  const nodes = Object.values(graph);
  const find = (type) => nodes.find((n) => n.class_type === type)?.inputs;
  const linked = (link) => (Array.isArray(link) ? graph[link[0]] : null);
  const turbo = find("LoraLoaderModelOnly") ? " · Turbo" : "";
  const size = `${info.width} × ${info.height}`;
  const h3 = find("MiniMaxH3ImageToVideo");
  if (h3) {
    return [
      ["Prompt", h3.prompt.replace(`${START_LINE}\n\n`, "")],
      ["Model", `MiniMax H3${turbo}`],
      ["Start image", linked(h3.first_frame)?.inputs.image],
      ["Size", size],
      ["Length", `${Math.round(h3.length / 24)} s`],
      ["Steps", find("BasicScheduler")?.steps],
      ["Seed", find("RandomNoise")?.noise_seed],
      ["File", img.filename],
    ];
  }
  const s = find("KSampler");
  if (!s) return [["Settings", "This file has no saved settings."], ["File", img.filename]];
  const text = linked(s.positive)?.inputs.text;
  const rewriter = linked(text);
  const unet = find("UNETLoader")?.unet_name.replace(/\.safetensors$/, "") ?? (find("MOSSImageHFLoader") && "MOSS-Image");
  const slg = find("SkipLayerGuidanceDiTSimple")?.single_layers;
  return [
    [rewriter ? "Original prompt" : "Prompt", rewriter ? rewriter.inputs.prompt.replace(KREA2_ENHANCE, "") : text],
    ["Enhanced prompt", rewriter && (info.enhanced_prompt ?? "Not saved in this file.")],
    ["Negative prompt", s.cfg > 1 ? linked(s.negative)?.inputs.text : null],
    ["Model", unet && unet + turbo],
    ["Size", size],
    ["Steps", s.steps],
    ["Prompt strength (CFG)", s.cfg],
    ["Seed", s.seed],
    ["Sigma shift", (find("ModelSamplingAuraFlow") ?? find("ModelSamplingSD3"))?.shift],
    ["Layer skip guidance", slg === undefined ? null : String(slg).trim() || "Off"],
    ["Sampler", `${s.sampler_name} · ${s.scheduler}`],
    ["File", img.filename],
  ];
}

async function reuseCurrent() {
  const img = viewer.list[viewer.index];
  const info = await imageInfo(img);
  const graph = info?.prompt;
  const h3 = graph && Object.values(graph).find((n) => n.class_type === "MiniMaxH3ImageToVideo");
  if (h3) { reuseVideo(graph, h3.inputs); return; }
  const sampler = graph && Object.values(graph).find((n) => n.class_type === "KSampler");
  if (!sampler) { toast("This image has no saved settings"); return; }
  const node = (link) => (Array.isArray(link) ? graph[link[0]] : null);
  const s = sampler.inputs;
  // With Enhance prompt on, the positive prompt comes from TextGenerate, whose input holds the typed
  // prompt (after the Krea 2 instructions).
  const text = node(s.positive)?.inputs.text;
  const rewriter = node(text);
  settings.enhance = rewriter?.class_type === "TextGenerate";
  settings.prompt = (settings.enhance ? rewriter.inputs.prompt.replace(KREA2_ENHANCE, "") : text) ?? settings.prompt;
  settings.negative = node(s.negative)?.inputs.text ?? "";
  settings.steps = s.steps;
  settings.cfg = s.cfg;
  settings.sampler = s.sampler_name;
  settings.scheduler = s.scheduler;
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
  const turbo = Object.values(graph).some((n) => n.class_type === "LoraLoaderModelOnly");
  if (turbo && !turboLora) { toast("This image used Turbo mode, but its LoRA is missing on the PC"); return; }
  settings.mode = turbo ? "turbo" : "full";
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
  v.prompt = h3.prompt.replace(`${START_LINE}\n\n`, "");
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

// Uploads a gallery image as the video's start frame. JPEG XL goes as the PC's PNG copy so the start
// image loads in any browser and in LoadImage.
async function startFromGallery(img) {
  const blob = await fetch(isJxl(img) ? pngUrl(img) : imageUrl(img)).then((r) => r.blob()).catch(() => null);
  const name = img.filename.replace(/\.jxl$/i, ".png");
  return Boolean(blob) && setStartImage(new File([blob], name, { type: blob.type }));
}

async function pickFromGallery() {
  const images = (await fetch("/studio/images").then((r) => r.json()).catch(() => [])).filter((img) => !isVideo(img));
  if (!images.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "No images in the gallery yet.";
    $("picker-grid").replaceChildren(p);
  } else {
    $("picker-grid").replaceChildren(...images.map((img) => {
      const btn = document.createElement("button");
      btn.type = "button";
      const el = document.createElement("img");
      el.loading = "lazy";
      el.src = thumbUrl(img);
      el.alt = img.filename;
      btn.append(el);
      btn.onclick = () => { $("picker").close(); startFromGallery(img); };
      return btn;
    }));
  }
  $("picker").showModal();
  $("picker").scrollTop = 0;
}

// Sends the viewer's image to Video mode as the start frame.
async function animateCurrent() {
  if (!(await startFromGallery(viewer.list[viewer.index]))) return;
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
  $("v-info").onclick = () => ($("v-info-panel").hidden ? showInfo() : ($("v-info-panel").hidden = true));
  $("v-info-close").onclick = () => { $("v-info-panel").hidden = true; };
  let startX = null;
  const area = $("viewer");
  // A tap on the black space around the picture closes the viewer, like Close does.
  area.addEventListener("click", (e) => { if (!e.target.closest("img, video, button, a, .viewer-info")) closeViewer(); });
  // Swipes on the video would fight with scrubbing its timeline, and swipes in Info with selecting
  // its text, so neither changes pages.
  area.addEventListener("touchstart", (e) => { startX = e.touches.length === 1 && !e.target.closest("video, .viewer-info") ? e.touches[0].clientX : null; }, { passive: true });
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

// Sizes are from a 1 MP MOSS image: PNG 1.4 MB, lossless JPEG XL 0.9 MB, lossy (libjxl distance 1) 0.15 MB.
async function loadPrefs(change) {
  const p = await fetch("/studio/prefs", change && {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(change),
  }).then((r) => r.json()).catch(() => null);
  if (!p) { toast("Can't reach the PC"); return; }
  prefs = p;
  const radio = (label, detail, checked, change, disabled = false) => {
    const b = el("button", { type: "button", disabled, onclick: () => loadPrefs(change) }, label, el("small", { textContent: detail }));
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", checked);
    return b;
  };
  const group = (...buttons) => {
    const g = el("div", { className: "segmented two" }, ...buttons);
    g.setAttribute("role", "radiogroup");
    return g;
  };
  const jxl = p.image_format === "jxl" && p.jxl_available;
  $("image-format").replaceChildren(...[
    group(
      radio("PNG", "Works everywhere", !jxl, { image_format: "png" }),
      radio("JPEG XL", "Smaller files", jxl, { image_format: "jxl" }, !p.jxl_available)),
    jxl && group(
      radio("Lossless", "About 65% of PNG", p.jxl_lossless, { jxl_lossless: true }),
      radio("Lossy", "About 10% of PNG", !p.jxl_lossless, { jxl_lossless: false })),
    el("span", { className: "note", textContent: !jxl
      ? "PNG opens in every app and browser. A 1 MP image is about 1.4 MB."
      : p.jxl_lossless
        ? "Lossless keeps every pixel exactly as PNG would."
        : "Lossy looks the same as PNG at normal viewing, but isn't pixel-identical: very fine detail shifts slightly." }),
    jxl && el("span", { className: "note", textContent: "Safari and Chrome 155 or newer show JPEG XL; other browsers here see a PNG copy. Many apps outside the browser can't open .jxl files yet." }),
    el("span", { className: "note", textContent: "Applies to new images from every device. Existing images keep their format." }),
    !p.jxl_available && el("span", { className: "warn", textContent: "JPEG XL needs the pillow-jxl-plugin Python package on the PC. Install Apoclada's requirements.txt into ComfyUI's Python, then restart ComfyUI." }),
  ].filter(Boolean));
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
  if (name === "setup") { loadSetup(); loadPrefs(); loadUpdates(); }
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
  fetch("/studio/host").then((r) => r.json()).then(({ host }) => { $("v-reveal").hidden = !host; }).catch(() => {});
  jxlShown = await imageSize(JXL_PROBE).then(() => true, () => false);
  await loadModels();
  // A fresh install has nothing to generate with yet, so it opens on Setup.
  if (!models.length && !videoFiles) selectTab("setup");
  else { loadSetup(); loadUpdates(); }
  connect();
}

async function loadModels() {
  let ksampler;
  [models, { lora: turboLora }, videoFiles, ksampler] = await Promise.all([
    fetch("/studio/models").then((r) => r.json()).catch(() => []),
    fetch("/studio/turbo").then((r) => r.json()).catch(() => ({ lora: null })),
    fetch("/studio/video").then((r) => r.json()).catch(() => null),
    fetch("/object_info/KSampler").then((r) => r.json()).catch(() => null),
  ]);
  // The lists come from ComfyUI, so samplers added by other custom nodes show up too.
  const { sampler_name, scheduler } = ksampler?.KSampler.input.required ?? {};
  $("sampler").replaceChildren(...(sampler_name?.[0] ?? [settings.sampler]).map((n) => new Option(n, n)));
  $("scheduler").replaceChildren(...(scheduler?.[0] ?? [settings.scheduler]).map((n) => new Option(n, n)));
  if (!turboLora && settings.mode === "turbo") setMode("full");
  if (!videoFiles) settings.kind = "image";
  else if (!models.length) settings.kind = "video";
  renderModels();
  syncForm();
}

init();
