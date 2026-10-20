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
// The lines are Japanese, one of the 11 languages H3's README lists as stable for dialogue.
// Later shots start with their cut time (MM:SS.mmm), which has to fall inside the video, so the
// examples cut to a second shot at 1.5 s to fit every length from 2 s up.
const VIDEO_PROMPT = `integrated_multimodal_description: [Shot 1] 2D-animated, soft anime style, a medium close-up shot frames Hatsune Miku, the only customer in a quiet corner café on a rainy evening, sitting by the rain-streaked window in a cream knit sweater with a steaming mug in both hands. The camera pushes in with small amplitude at slow speed as she takes a slow sip from the mug and smiles. [Shot 2] At 00:01.500, the camera cuts to a close-up of Hatsune Miku's face lit by the warm café light as she lowers the mug, smiles, and with a soft, bright voice (S1) says: <d>[Japanese] 美味しい</d>

overall_soundscape: Rain patters steadily against the window glass, the ceramic mug clinks softly on the wooden table, and muffled traffic hums outside.

non_diegetic_music: A slow lo-fi piano melody with soft brushed drums.`;
// With a start image the guide describes only the motion and what <Picture 1> keeps, so this example
// swaps the scene description for that and the subject for "the main character"; the shots, timing,
// voice, line and music stay the same as VIDEO_PROMPT.
const ANIMATE_PROMPT = `integrated_multimodal_description: [Shot 1] The scene shown in <Picture 1> comes to life, keeping its art style, characters, clothing, lighting and composition. The camera pushes in with small amplitude at slow speed as the main character breathes gently and smiles. [Shot 2] At 00:01.500, the camera cuts to a close-up of the main character's face in the same setting and lighting as they smile, and with a soft, bright voice (S1) says: <d>[Japanese] 美味しい</d>

overall_soundscape: Soft ambient sound that fits the setting, with faint fabric rustling as the character moves.

non_diegetic_music: A slow lo-fi piano melody with soft brushed drums.`;
// Reference videos follow MiniMax's full-reference guide (VIDEO_PROMPT_WRITING_GUIDE_ref_en.md): the
// references get <Subject N> labels, a summary and a retention line, and the shots move to
// detailed_description after a style sentence. The scene, shots, voice, line and music match VIDEO_PROMPT,
// with <Subject 1> from <Picture 1> in place of the described character.
const REFERENCE_PROMPT = `subject_definitions:
<Subject 1> is the main character in <Picture 1>, with their face, hair and clothing.

summary:
[reference generation] The target video shows <Subject 1> sipping from a steaming mug by the window of a quiet café on a rainy evening, then a close-up as <Subject 1> lowers the mug and speaks.

retention_analysis:
<Subject 1> (appears in [Shot 1], [Shot 2]): fully_preserved - the character's face, hair and clothing are retained.

detailed_description:
The target video keeps the art style of <Picture 1>, with warm, soft lighting.
[Shot 1] A medium close-up shot frames <Subject 1>, the only customer in a quiet corner café on a rainy evening, sitting by the rain-streaked window with a steaming mug in both hands. The camera pushes in with small amplitude at slow speed as <Subject 1> takes a slow sip from the mug and smiles.
[Shot 2] At 00:01.500, the camera cuts to a close-up of <Subject 1>'s face lit by the warm café light as they lower the mug, smile, and with a soft, bright voice <Subject 1> (S1) says: <d>[Japanese] 美味しい</d>

overall_soundscape:
Rain patters steadily against the window glass, the ceramic mug clinks softly on the wooden table, and muffled traffic hums outside.

non_diegetic_music:
A slow lo-fi piano melody with soft brushed drums.`;
// MiniMax's guide opens prompts with start or end images with a line saying where they fall in the video.
const START_LINE = "For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.";
const FRAMES_LINE = /^(For the target video|How the reference pictures align)[^\n]*\n\n/;
const DEFAULTS = {
  prompt: "masterpiece, best quality, score_7, highres, year 2025, hatsune miku, vocaloid, 1girl, solo, smile, cream sweater\nShe sits at a small table by the rain-streaked window of a corner café on a rainy evening, holding a steaming mug in both hands, her long twintails falling over her shoulders. Seen from the side at eye level, warm amber light from a pendant lamp falls across her face, while the street outside glows cool blue with blurred city lights. A small chalkboard on the table reads \"Open late\" in white chalk. Soft anime illustration with clean lines; the mood is calm and cozy.",
  negative: "worst quality, bad anatomy, watermark, jpeg artifact",
  aspect: "1:1", mp: 1, steps: 50, cfg: 3, seed: 42,
  randomSeed: true, batch: 1, shift: 5, slgLayer: "22", model: "", enhance: false, easyCache: false,
  mode: "full", tuning: {}, kind: "image",
  video: { prompt: VIDEO_PROMPT, aspect: "16:9", mp: 0.4, seconds: 5, mode: "turbo", steps: 20, items: [], extend: null },
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
  // darask0's rapid-moss adapter brings its own sampler and sigmas, so only the step count applies.
  rapid: {
    tuning: { steps: 4, cfg: 1, shift: 5, slgLayer: "", ...MOSS_SAMPLER }, steps: [1, 4], note: "4 is recommended.",
    sizeNote: "Trained at about 1 MP. Other sizes are untested.", cfgNote: "",
  },
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
// Video mode was a Turbo on/off switch before Fast was added.
if ("turbo" in settings.video) { settings.video.mode = settings.video.turbo ? "turbo" : "quality"; delete settings.video.turbo; }
if (settings.video.mp === 1) settings.video.mp = 0.98;
// Start images moved from input/mobile to input/studio with the rename to Apoclada Studio.
if (settings.video.start?.subfolder === "mobile") settings.video.start.subfolder = "studio";
// The start image became one of the video's images.
if (settings.video.start) settings.video.items = [{ kind: "image", role: "start", at: 2.5, ...settings.video.start }];
delete settings.video.start;
// The video prompt started out empty; an empty one can't be generated, so it gets the example.
settings.video.prompt ||= videoPrompt(settings.video);
// The 8-step mode was saved as "fast" before it was renamed to Turbo.
for (const k of ["mode", "mossMode"]) if (settings[k] === "fast") settings[k] = "turbo";
if (settings.tuning?.fast) { settings.tuning.turbo = settings.tuning.fast; delete settings.tuning.fast; }
// Settings saved before the sampler could be picked get the mode's default.
settings.sampler ??= MODES[settings.mode].tuning.sampler;
settings.scheduler ??= MODES[settings.mode].tuning.scheduler;
let models = [];
let turboLora = null;
let rapidAdapter = null;
let videoFiles = null;
// Setup's file format, shared by every device through the PC; generate() refreshes it before each image.
let prefs = { image_format: "png", jxl_lossless: true, jxl_available: false, video_codec: "h264", video_encoder: null, video_encoders: { h264: [], hevc: [] } };
// Safari and Chrome 155+ show JPEG XL. Other browsers get .jxl images as PNG copies made by the PC.
const JXL_PROBE = "data:image/jxl;base64,/woAEBAJCAABACgASxiLFcJJQU5/AA==";
let jxlShown = false;
let pending = load(PENDING_KEY, []);
let running = null;
let stopping = null;
let progressStart = 0;
let gallery = [];
// What Create shows, newest first, so the viewer steps across every job's results.
let results = [];
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

// A start image keeps its own shape, since H3 stretches the first frame onto the canvas, and an
// extended video keeps its size. Rounding to the 32 px grid can push the area past H3's native
// 768×1344 cap, so the target area shrinks until the rounded size fits; the shape is kept.
function round32(n) { return Math.max(32, Math.round(n / 32) * 32); }
function videoDimensions(v) {
  if (v.extend) return { width: v.extend.width, height: v.extend.height };
  const start = v.items.find((i) => i.role === "start");
  const [a, b] = start ? [start.width, start.height] : (ASPECTS.find((x) => x[0] === v.aspect) || ASPECTS[5]).slice(1);
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
  for (const b of $("video-mode").children) b.onclick = () => { settings.video.mode = b.dataset.mode; syncForm(); };
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
  setUnused($("shape-field"), video && Boolean(v.extend || v.items.some((i) => i.role === "start")),
    v.extend ? "The video keeps the shape of the one it continues" : "The video takes the start image's shape");
  syncVideoForm();
  $("megapixels").value = MEGAPIXELS.indexOf(settings.mp);
  const { width, height } = dimensions(settings.aspect, settings.mp);
  $("size-out").textContent = `${settings.mp} MP · ${width} × ${height}`;
  const turbo = settings.mode === "turbo";
  const rapid = settings.mode === "rapid";
  const krea2 = settings.mode === "krea2";
  const distilled = turbo || rapid;
  const unusedHere = `Not used in ${turbo ? "Turbo" : "Rapid"} mode`;
  const mode = MODES[settings.mode];
  $("mode-field").hidden = !turboLora && !rapidAdapter;
  setUnused($("mode-field"), krea2, "Krea 2 models have no Turbo or Rapid mode");
  $("mode").querySelector("[data-mode=turbo]").hidden = !turboLora;
  $("mode").querySelector("[data-mode=rapid]").hidden = !rapidAdapter;
  $("mode").className = turboLora && rapidAdapter ? "segmented" : "segmented two";
  for (const b of $("mode").children) b.setAttribute("aria-checked", b.dataset.mode === settings.mode);
  setUnused($("negative-field"), distilled || settings.cfg <= 1, distilled ? unusedHere : "Not used at CFG 1");
  setUnused($("cfg-field"), distilled, unusedHere);
  setUnused($("slg-field"), distilled || krea2, distilled ? unusedHere : "Not used with Krea 2 models");
  setUnused($("easycache-field"), distilled, `${unusedHere}: its few steps all change the image too much to skip`);
  for (const id of ["shift-field", "sampler-field", "scheduler-field"]) setUnused($(id), rapid, unusedHere);
  [$("steps").min, $("steps").max] = mode.steps;
  $("steps-note").textContent = mode.note;
  $("size-note").textContent = mode.sizeNote;
  $("cfg-note").textContent = mode.cfgNote;
  const vsize = videoDimensions(v);
  $("settings-summary").textContent = (video
    ? [
        { turbo: "Turbo", fast: "Fast" }[videoMode(v)] ?? `Quality ${v.steps} steps`,
        `${vsize.width}×${vsize.height}`,
        `${v.extend ? "+" : ""}${v.seconds} s`,
        settings.randomSeed ? "random seed" : `seed ${settings.seed}`,
      ]
    : [
        turbo ? "Turbo" : rapid ? "Rapid" : "",
        settings.enhance ? "enhanced prompt" : "",
        settings.easyCache && !distilled ? "EasyCache" : "",
        `${width}×${height}`,
        `${settings.steps} steps`,
        distilled ? "" : `CFG ${Number(settings.cfg).toFixed(1)}`,
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
  const mode = videoMode(v);
  const refs = usesRefs(v);
  $("video-mode").querySelector("[data-mode=turbo]").disabled = !(refs ? videoFiles?.ref_lora : videoFiles?.lora);
  $("video-mode").querySelector("[data-mode=turbo] small").textContent = `${refs ? REF_LORA_STEPS : VIDEO_LORA_STEPS.turbo} steps`;
  $("video-mode").querySelector("[data-mode=fast]").disabled = refs || !videoFiles?.fast_lora;
  for (const b of $("video-mode").children) b.setAttribute("aria-checked", b.dataset.mode === mode);
  $("video-mode").querySelector("[data-mode=quality] small").textContent = `${v.steps} steps`;
  setUnused($("vsteps-field"), mode !== "quality", `${mode === "fast" ? "Fast" : "Turbo"} always uses ${videoSteps(v, mode)} steps`);
  $("vsteps").value = v.steps;
  $("vsteps-out").textContent = v.steps;
  $("video-mp").value = VIDEO_MP.indexOf(v.mp);
  const { width, height } = videoDimensions(v);
  $("vsize-out").textContent = v.extend ? `${width} × ${height}` : `${v.mp} MP · ${width} × ${height}`;
  setUnused($("vsize-field"), Boolean(v.extend), "The video keeps the size of the one it continues");
  $("length").value = v.seconds;
  $("length-out").textContent = `${v.extend ? "+" : ""}${v.seconds} s`;
  $("length-note").textContent = v.extend ? "How much to add, 2 to 15 seconds." : "2 to 15 seconds. Longer videos take longer to make.";
  renderMedia();
}

/* ---------- video images and references ---------- */

// Each item is an image (role start, at, end or ref), a gallery video or a voice (always ref).
// v.extend is the gallery video being continued.
function usesRefs(v) { return v.items.some((i) => i.role === "ref"); }

function mediaPath(item) { return item.subfolder ? `${item.subfolder}/${item.name}` : item.name; }

function mediaUrl(item) {
  return item.kind === "video"
    ? thumbUrl({ filename: item.name, subfolder: item.subfolder, mtime: "" })
    : `/view?${new URLSearchParams({ filename: item.name, subfolder: item.subfolder, type: "input" })}`;
}

// The reference model names its pictures first, then each video with its sound as the next <Audio N>,
// then the voices; the prompt uses these names.
function referenceTags(v) {
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
    ...v.items.map((i) => tile(i, i.role === "ref" ? tags.get(i)[0] : i.role === "at" ? `At ${i.at} s` : i.role === "start" ? "Start" : "End")),
    el("button", { type: "button", className: "add", onclick: pickMedia }, el("span", { className: "tile-icon", textContent: "+" }), el("span", { textContent: "Add" })));
}

// An untouched example prompt switches to the one that fits the video's new images.
function editVideo(change) {
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
  if (role === "start" || role === "end") for (const i of settings.video.items) if (i.role === role) i.role = "at";
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
  for (const b of $("item-role").children) b.setAttribute("aria-checked", b.dataset.role === item.role);
  $("item-at-field").hidden = item.role !== "at";
  $("item-at").max = Math.max(0.5, v.seconds - 0.5);
  $("item-at").value = item.at;
  $("item-at-out").textContent = `${item.at} s${v.extend ? " into the new part" : ""}`;
  $("item-note").textContent = extend
    ? "The new video picks up from the end of this one and is joined onto it. Describe what happens next."
    : item.kind === "video" ? `Called <${tags[0]}> in the prompt, and its sound <${tags[1]}>. The video can follow its characters, motion or camera work.`
    : item.kind === "audio" ? `Called <${tags[0]}> in the prompt. Use it as a voice, e.g. "<${tags[0]}> is the voice-timbre reference for <Subject 1> (S1)."`
    : {
        start: "The video starts on this image and keeps its shape.",
        at: "The video passes through this image at the time above.",
        end: "The video ends on this image.",
        ref: `Called <${tags?.[0]}> in the prompt. The video follows its character, place or style without showing it as a frame.`,
      }[item.role];
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
  $("cancel").onclick = cancelAll;
}

/* ---------- generation ---------- */

function buildWorkflow(s) {
  const model = models.find((m) => m.name === s.model);
  const { width, height } = dimensions(s.aspect, s.mp);
  if (model.family === "krea2") return buildKrea2Workflow(s, model, width, height);
  if (s.mode === "rapid") return buildRapidWorkflow(s, model, width, height);
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
    ...(s.easyCache && !turbo && easyCacheNode(["13", 0])),
    "16": {
      class_type: "KSampler",
      inputs: {
        seed: s.seed, steps: s.steps, cfg: s.cfg, sampler_name: s.sampler, scheduler: s.scheduler, denoise: 1,
        model: [s.easyCache && !turbo ? "40" : "13", 0], positive: ["4", 0], negative: ["5", 0], latent_image: ["6", 0],
      },
    },
    "17": { class_type: "VAEDecode", inputs: { samples: ["16", 0], vae: ["3", 0] } },
    "18": saveNode("studio/moss", s),
  };
}

// Rapid mode, as in rapid-moss's native example: its node patches the model and hands
// SamplerCustomAdvanced the adapter's own sampler and sigmas. No CFG, so BasicGuider and no negative prompt.
function buildRapidWorkflow(s, model, width, height) {
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: model.unet, weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: model.clip, type: "moss_image", device: "default" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: model.vae } },
    "20": { class_type: "RapidMOSSAdapter", inputs: { model: ["1", 0], adapter: rapidAdapter, steps: s.steps, lora_strength: 1 } },
    ...(s.enhance && enhanceNodes(s, { prompt: s.prompt, system_prompt: MOSS_ENHANCE, max_length: 4096, "sampling_mode.repetition_penalty": 1, mtp: "auto" })),
    "4": { class_type: "CLIPTextEncode", inputs: { text: s.enhance ? ["30", 0] : s.prompt, clip: ["2", 0] } },
    "6": { class_type: "EmptyFlux2LatentImage", inputs: { width, height, batch_size: s.batch } },
    "21": { class_type: "BasicGuider", inputs: { model: ["20", 0], conditioning: ["4", 0] } },
    "22": { class_type: "RandomNoise", inputs: { noise_seed: s.seed } },
    "16": { class_type: "SamplerCustomAdvanced", inputs: { noise: ["22", 0], guider: ["21", 0], sampler: ["20", 1], sigmas: ["20", 2], latent_image: ["6", 0] } },
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

// ComfyUI's EasyCache with its default settings, which skip about half of Quality's 50 steps and 3 of
// Krea 2's 8. Turbo and Rapid skip none, so they never get it.
function easyCacheNode(model) {
  return { "40": { class_type: "EasyCache", inputs: { model, reuse_threshold: 0.2, start_percent: 0.15, end_percent: 0.95, verbose: false } } };
}

// Apoclada's save nodes write the generation time and enhanced prompt into the file for the viewer's Info.
function saveNode(prefix, s) {
  const inputs = { filename_prefix: prefix, images: ["17", 0], ...(s.enhance && { enhanced_prompt: ["30", 0] }) };
  if (prefs.image_format === "jxl" && prefs.jxl_available) return { class_type: "ApocladaSaveImageJXL", inputs: { ...inputs, lossless: prefs.jxl_lossless } };
  return { class_type: "ApocladaSaveImage", inputs };
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
    ...(s.easyCache && easyCacheNode(["15", 0])),
    "16": {
      class_type: "KSampler",
      inputs: {
        seed: s.seed, steps: s.steps, cfg: s.cfg, sampler_name: s.sampler, scheduler: s.scheduler, denoise: 1,
        model: [s.easyCache ? "40" : "15", 0], positive: ["4", 0], negative: ["5", 0], latent_image: ["6", 0],
      },
    },
    "17": { class_type: "VAEDecode", inputs: { samples: ["16", 0], vae: ["3", 0] } },
    "18": saveNode("studio/krea2", s),
  };
}

// Turbo and Fast fall back to Quality when their LoRA isn't on the PC. The reference model has
// its own Turbo LoRA, which ComfyUI's template runs at 4 steps, and no Fast one, so Fast runs as Turbo.
const VIDEO_LORA_STEPS = { turbo: 8, fast: 4 };
const REF_LORA_STEPS = 4;
function videoMode(v) {
  const refs = usesRefs(v);
  const mode = refs && v.mode === "fast" ? "turbo" : v.mode;
  if (mode === "turbo" && (refs ? videoFiles?.ref_lora : videoFiles?.lora)) return "turbo";
  if (mode === "fast" && videoFiles?.fast_lora) return "fast";
  return "quality";
}

function videoSteps(v, mode) {
  return mode === "quality" ? v.steps : usesRefs(v) ? REF_LORA_STEPS : VIDEO_LORA_STEPS[mode];
}

// The line that opens the prompt for a start image, an end image or both, from MiniMax's guide:
// the end image belongs to the last shot and falls at the video's length.
function framesLine(v, length) {
  const start = v.items.some((i) => i.role === "start"), end = v.items.some((i) => i.role === "end");
  const shot = Math.max(1, ...[...v.prompt.matchAll(/\[Shot (\d+)\]/g)].map((m) => Number(m[1])));
  const at = (length / 24).toFixed(2);
  if (start && end) return `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot ${shot}) aligns with the ${at}-second mark of the target video.`;
  if (end) return `How the reference pictures align with the target video — <Picture 1> (from [Shot ${shot}]) aligns with the ${at}-second mark of the target video.`;
  return start ? START_LINE : null;
}

// Mirrors ComfyUI's official MiniMax H3 templates: no CFG, res_multistep, 8 steps with the turbo LoRA,
// or 20 by default without it. Fast swaps in the DMAD LoRA at 4 steps. Start and end images go to
// Image to Video, which shows them to the text encoder; images partway are Add Guide nodes at their
// frame. References switch to the reference model and its node, where every keyframe is an Add Guide.
// Node ids line up with NODE_STAGES; the images, references and extended video are numbered from 50.
function buildVideoWorkflow(s) {
  const v = s.video;
  const { width, height } = videoDimensions(v);
  const refs = usesRefs(v);
  const mode = videoMode(v);
  const lora = mode === "quality" ? null : refs ? videoFiles.ref_lora : { turbo: videoFiles.lora, fast: videoFiles.fast_lora }[mode];
  const model = [lora ? "20" : "1", 0];
  // Extending makes a new video that opens on the old one's last 22 frames, from a second before its end.
  const length = videoLength(v.seconds + (v.extend ? 1 : 0));
  const graph = {
    "1": { class_type: "UNETLoader", inputs: { unet_name: refs ? videoFiles.ref_unet : videoFiles.unet, weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: videoFiles.clip, type: "minimax", device: "default" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: videoFiles.vae } },
    "19": { class_type: "VAELoader", inputs: { vae_name: videoFiles.audio_vae } },
    ...(lora && { "20": { class_type: "LoraLoaderModelOnly", inputs: { lora_name: lora, strength_model: 1, model: ["1", 0] } } }),
  };
  let next = 50;
  const add = (class_type, inputs) => { graph[next] = { class_type, inputs }; return String(next++); };
  const image = (item) => [add("LoadImage", { image: mediaPath(item) }), 0];
  const video = (item) => add("GetVideoComponents", { video: [add("LoadVideo", { file: `${mediaPath(item)} [output]` }), 0] });
  const start = v.items.find((i) => i.role === "start"), end = v.items.find((i) => i.role === "end");
  const guides = [];
  let head = null;
  if (v.extend) {
    const source = video(v.extend);
    const cut = v.extend.frames - 24;
    guides.push({
      image: [add("ImageFromBatch", { image: [source, 0], batch_index: cut, length: 22 }), 0],
      audio: [add("TrimAudioDuration", { audio: [source, 1], start_index: cut / 24, duration: 22 / 24 }), 0],
      frame_idx: 0,
    });
    // The old video up to where the new one starts, joined in front of it at the end.
    head = { images: add("ImageFromBatch", { image: [source, 0], batch_index: 0, length: cut }), audio: add("TrimAudioDuration", { audio: [source, 1], start_index: 0, duration: cut / 24 }) };
  }
  const shared = { clip: ["2", 0], vae: ["3", 0], prompt: v.prompt, width, height, length };
  if (refs) {
    const inputs = { ...shared, audio_vae: ["19", 0], ref_image_size: "match" };
    const kinds = { image: [], video: [], audio: [] };
    for (const i of v.items) if (i.role === "ref") kinds[i.kind].push(i);
    kinds.image.forEach((i, n) => { inputs[`ref_images.ref_image_${n}`] = image(i); });
    kinds.video.forEach((i, n) => {
      const clip = video(i);
      inputs[`ref_videos.ref_video_${n}`] = [clip, 0];
      inputs[`ref_video_audios.ref_video_audio_${n}`] = [clip, 1];
    });
    kinds.audio.forEach((i, n) => { inputs[`ref_audios.ref_audio_${n}`] = [add("LoadAudio", { audio: mediaPath(i) }), 0]; });
    graph["4"] = { class_type: "MiniMaxH3ReferenceToVideo", inputs };
    if (start) guides.push({ image: image(start), frame_idx: 0 });
    if (end) guides.push({ image: image(end), frame_idx: -1 });
  } else {
    const line = !FRAMES_LINE.test(v.prompt) && framesLine(v, length);
    graph["4"] = {
      class_type: "MiniMaxH3ImageToVideo",
      inputs: { ...shared, prompt: line ? `${line}\n\n${v.prompt}` : v.prompt, ...(start && { first_frame: image(start) }), ...(end && { last_frame: image(end) }) },
    };
  }
  for (const i of v.items.filter((i) => i.role === "at")) {
    guides.push({ image: image(i), frame_idx: Math.min(Math.round((i.at + (v.extend ? 1 : 0)) * 24), length - 1) });
  }
  let positive = ["4", 0];
  for (const g of guides) positive = [add("MiniMaxH3AddGuide", { positive, vae: ["3", 0], audio_vae: ["19", 0], latent: ["4", 1], ...g }), 0];
  Object.assign(graph, {
    "7": { class_type: "RandomNoise", inputs: { noise_seed: s.seed } },
    "8": { class_type: "KSamplerSelect", inputs: { sampler_name: "res_multistep" } },
    "9": { class_type: "BasicScheduler", inputs: { scheduler: "simple", steps: videoSteps(v, mode), denoise: 1, model } },
    "10": { class_type: "BasicGuider", inputs: { model, conditioning: positive } },
    "16": { class_type: "SamplerCustomAdvanced", inputs: { noise: ["7", 0], guider: ["10", 0], sampler: ["8", 0], sigmas: ["9", 0], latent_image: ["4", 1] } },
    "17": { class_type: "VAEDecode", inputs: { samples: ["16", 0], vae: ["3", 0] } },
    "22": { class_type: "VAEDecodeAudio", inputs: { samples: ["16", 0], vae: ["19", 0] } },
    "23": {
      class_type: "CreateVideo",
      inputs: head
        ? { images: [add("BatchImagesNode", { "images.image0": [head.images, 0], "images.image1": ["17", 0] }), 0], audio: [add("AudioConcat", { audio1: [head.audio, 0], audio2: ["22", 0], direction: "after" }), 0], fps: 24 }
        : { images: ["17", 0], audio: ["22", 0], fps: 24 },
    },
    // Codec and encoder come from Setup.
    "18": { class_type: "ApocladaSaveVideo", inputs: { video: ["23", 0], filename_prefix: "studio/h3", codec: prefs.video_codec, encoder: prefs.video_encoder ?? "software" } },
  });
  return graph;
}

async function generate() {
  const video = settings.kind === "video";
  if (!(video ? settings.video.prompt : settings.prompt).trim()) { toast("Write a prompt first"); $("prompt").focus(); return; }
  if (!video && !models.length) { toast("No image model yet. Download one in Setup."); return; }
  if (video && !videoFiles) { toast("The MiniMax H3 files are missing. Download them in Setup."); return; }
  if (video && usesRefs(settings.video) && !videoFiles.ref_unet) { toast("References need the MiniMax H3 references pack. Download it in Setup."); return; }
  if (settings.randomSeed) settings.seed = Math.floor(Math.random() * 2 ** 48);
  syncForm();
  prefs = await fetch("/studio/prefs").then((r) => r.json()).catch(() => prefs);
  // On AMD, a video made after another generation samples about 3x slower until ComfyUI unloads
  // everything (ComfyUI issue #16502). ComfyUI applies /free between jobs, so a video queued behind
  // another job still gets it just before it starts.
  if (video) await fetch("/free", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ unload_models: true, free_memory: true }) }).catch(() => null);
  const res = await fetch("/prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // ComfyUI sends no previews unless started with --preview-method, so each job asks for them.
    body: JSON.stringify({ prompt: video ? buildVideoWorkflow(settings) : buildWorkflow(settings), client_id: clientId, extra_data: { preview_method: "latent2rgb" } }),
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
  $("v-animate").hidden = !videoFiles;
  $("v-animate").textContent = video ? "Extend" : "Animate";
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
  if (viewer.list !== results) results = results.filter((r) => imageKey(r) !== imageKey(img));
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
  const time = info?.generation_time;
  const rows = [...infoRows(info), ["Generation time", time == null ? null : duration(time)], ...encodingRows(info), ["File", img.filename]].filter(([, value]) => value !== null && value !== undefined && value !== "");
  $("v-info-list").replaceChildren(...rows.map(([label, value]) => el("div", {}, el("dt", { textContent: label }), el("dd", {}, value))));
}

// Rapid images sample with SamplerCustomAdvanced; this reads them back under KSampler's input names
// (no CFG, sampler or scheduler: the adapter sets those).
function samplerInputs(graph) {
  const nodes = Object.values(graph);
  const find = (type) => nodes.find((n) => n.class_type === type)?.inputs;
  const rapid = find("RapidMOSSAdapter");
  const sampler = find("SamplerCustomAdvanced");
  if (!rapid || !sampler) return find("KSampler");
  return { positive: graph[sampler.guider[0]].inputs.conditioning, steps: rapid.steps, seed: graph[sampler.noise[0]].inputs.noise_seed, latent_image: sampler.latent_image };
}

function infoRows(info) {
  const graph = info?.prompt;
  if (!graph) return [["Settings", "This file has no saved settings."]];
  const nodes = Object.values(graph);
  const find = (type) => nodes.find((n) => n.class_type === type)?.inputs;
  const linked = (link) => (Array.isArray(link) ? graph[link[0]] : null);
  const turbo = find("LoraLoaderModelOnly") ? " · Turbo" : find("RapidMOSSAdapter") ? " · Rapid" : "";
  const size = `${info.width} × ${info.height}`;
  const refs = find("MiniMaxH3ReferenceToVideo");
  const h3 = find("MiniMaxH3ImageToVideo") ?? refs;
  if (h3) {
    const fast = find("LoraLoaderModelOnly")?.lora_name === videoFiles?.fast_lora;
    const { items, extend } = videoMedia(graph, h3);
    const tags = referenceTags({ items });
    const role = (r) => items.filter((i) => i.role === r);
    const e = info.encoding;
    return [
      ["Prompt", h3.prompt.replace(FRAMES_LINE, "")],
      ["Model", `MiniMax H3${refs ? " references" : ""}${fast ? " · Fast" : turbo}`],
      ["Continues", extend && mediaPath(extend)],
      ["Start image", role("start").map(mediaPath).join()],
      ["Images partway", role("at").map((i) => `${mediaPath(i)} at ${i.at} s`).join("\n")],
      ["End image", role("end").map(mediaPath).join()],
      ["References", role("ref").map((i) => `${tags.get(i)[0]}: ${mediaPath(i)}`).join("\n")],
      ["Size", size],
      ["Length", `${Math.round((e?.frames || h3.length) / (e?.fps || 24))} s`],
      ["Steps", find("BasicScheduler")?.steps],
      ["Seed", find("RandomNoise")?.noise_seed],
    ];
  }
  const s = samplerInputs(graph);
  if (!s) return [["Settings", "This file has no saved settings."]];
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
    ["Sampler", s.sampler_name && `${s.sampler_name} · ${s.scheduler}`],
    ["EasyCache", find("EasyCache") && "On"],
  ];
}

// "48 s", or "2 min 5 s" from a minute up.
function duration(seconds) {
  const s = Math.round(seconds);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

const FORMATS = { PNG: "PNG", JXL: "JPEG XL", JPEG: "JPEG", WEBP: "WebP", h264: "H.264", hevc: "H.265", av1: "AV1", vp9: "VP9", aac: "AAC", opus: "Opus" };
const ENCODERS = { h264_nvenc: "NVIDIA NVENC", hevc_nvenc: "NVIDIA NVENC", h264_amf: "AMD AMF", hevc_amf: "AMD AMF", libx264: "Software (x264)", libx265: "Software (x265)" };

// What the file itself is: its format, the encoder that made it, and its size.
function encodingRows(info) {
  const e = info?.encoding;
  if (!e) return [];
  const nodes = Object.values(info.prompt ?? {});
  const jxl = nodes.find((n) => n.class_type === "ApocladaSaveImageJXL")?.inputs;
  // Videos saved before the encoder was recorded came from ComfyUI's SaveVideo, which uses x264 for H.264.
  const encoder = e.encoder ?? (e.format === "h264" && nodes.some((n) => n.class_type === "SaveVideo") ? "libx264" : null);
  const a = e.audio;
  return [
    ["Encoding", [FORMATS[e.format] ?? e.format, jxl && (jxl.lossless ? "Lossless" : "Lossy"), ENCODERS[encoder] ?? encoder].filter(Boolean).join(" · ")],
    ["Audio", a && [FORMATS[a.format] ?? a.format, `${a.sample_rate / 1000} kHz`, { 1: "Mono", 2: "Stereo" }[a.channels] ?? `${a.channels} channels`].join(" · ")],
    ["File size", info.bytes >= 1e6 ? `${(info.bytes / 1e6).toFixed(1)} MB` : `${Math.round(info.bytes / 1e3)} KB`],
  ];
}

async function reuseCurrent() {
  const img = viewer.list[viewer.index];
  const info = await imageInfo(img);
  const graph = info?.prompt;
  const h3 = graph && Object.values(graph).find((n) => n.class_type === "MiniMaxH3ImageToVideo" || n.class_type === "MiniMaxH3ReferenceToVideo");
  if (h3) { reuseVideo(graph, h3.inputs); return; }
  const s = graph && samplerInputs(graph);
  if (!s) { toast("This image has no saved settings"); return; }
  const node = (link) => (Array.isArray(link) ? graph[link[0]] : null);
  // With Enhance prompt on, the positive prompt comes from TextGenerate, whose input holds the typed
  // prompt (after the Krea 2 instructions).
  const text = node(s.positive)?.inputs.text;
  const rewriter = node(text);
  settings.enhance = rewriter?.class_type === "TextGenerate";
  settings.prompt = (settings.enhance ? rewriter.inputs.prompt.replace(KREA2_ENHANCE, "") : text) ?? settings.prompt;
  settings.negative = node(s.negative)?.inputs.text ?? "";
  settings.steps = s.steps;
  // Rapid images have no CFG, sampler or scheduler; the current ones stay.
  settings.cfg = s.cfg ?? settings.cfg;
  settings.sampler = s.sampler_name ?? settings.sampler;
  settings.scheduler = s.scheduler ?? settings.scheduler;
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
  const rapid = Object.values(graph).some((n) => n.class_type === "RapidMOSSAdapter");
  if (rapid && !rapidAdapter) { toast("This image used Rapid mode, which needs the rapid-moss node and adapter on the PC"); return; }
  settings.mode = rapid ? "rapid" : turbo ? "turbo" : "full";
  settings.easyCache = Object.values(graph).some((n) => n.class_type === "EasyCache");
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

// Reads a video's images, references and extended video back from its workflow, in the form
// settings.video keeps them. Images take the video's shape, as a start image would have given it.
function videoMedia(graph, h3) {
  const node = (link) => graph[link[0]];
  const guides = Object.values(graph).filter((n) => n.class_type === "MiniMaxH3AddGuide").map((n) => n.inputs);
  const source = guides.map((g) => node(g.image)).find((n) => n.class_type === "ImageFromBatch");
  const offset = source ? 1 : 0;
  const item = (link, role, frame) => {
    let loader = node(link);
    if (loader.class_type === "GetVideoComponents") loader = node(loader.inputs.video);
    const path = (loader.inputs.image ?? loader.inputs.audio ?? loader.inputs.file).replace(/ \[output\]$/, "");
    const cut = path.lastIndexOf("/");
    const subfolder = path.slice(0, Math.max(cut, 0));
    return {
      kind: { LoadImage: "image", LoadAudio: "audio", LoadVideo: "video" }[loader.class_type], role,
      at: frame > 0 ? Math.round((frame / 24 - offset) * 2) / 2 : Math.round(h3.length / 24 - offset) / 2,
      name: path.slice(cut + 1), subfolder: subfolder === "mobile" ? "studio" : subfolder, width: h3.width, height: h3.height,
    };
  };
  const items = [];
  if (h3.first_frame) items.push(item(h3.first_frame, "start"));
  if (h3.last_frame) items.push(item(h3.last_frame, "end"));
  for (const g of guides) {
    if (node(g.image).class_type === "LoadImage") items.push(item(g.image, g.frame_idx === 0 ? "start" : g.frame_idx === -1 ? "end" : "at", g.frame_idx));
  }
  for (const [key, link] of Object.entries(h3)) if (/^ref_(images|videos|audios)\./.test(key)) items.push(item(link, "ref"));
  if (!source) return { items, extend: null };
  const { kind, name, subfolder, width, height } = item(source.inputs.image);
  return { items, extend: { kind, name, subfolder, width, height, frames: source.inputs.batch_index + 24 } };
}

function reuseVideo(graph, h3) {
  if (!videoFiles) { toast("The MiniMax H3 files are missing on the PC"); return; }
  const { items, extend } = videoMedia(graph, h3);
  if (items.some((i) => i.role === "ref") && !videoFiles.ref_unet) { toast("This video used references, which need the MiniMax H3 references pack"); return; }
  const v = settings.video;
  const nodes = Object.values(graph);
  v.prompt = h3.prompt.replace(FRAMES_LINE, "");
  v.seconds = Math.min(15, Math.max(2, Math.round(h3.length / 24) - (extend ? 1 : 0)));
  const lora = nodes.find((n) => n.class_type === "LoraLoaderModelOnly")?.inputs.lora_name;
  v.mode = !lora ? "quality" : lora === videoFiles.fast_lora ? "fast" : "turbo";
  const scheduler = nodes.find((n) => n.class_type === "BasicScheduler");
  if (!lora && scheduler) v.steps = scheduler.inputs.steps;
  const mp = (h3.width * h3.height) / (1024 * 1024);
  v.mp = VIDEO_MP.reduce((best, m) => (Math.abs(m - mp) < Math.abs(best - mp) ? m : best));
  v.items = items;
  v.extend = extend;
  const ratio = Math.log(h3.width / h3.height);
  v.aspect = ASPECTS.reduce((best, a) => (Math.abs(Math.log(a[1] / a[2]) - ratio) < Math.abs(Math.log(best[1] / best[2]) - ratio) ? a : best))[0];
  const noise = nodes.find((n) => n.class_type === "RandomNoise");
  if (noise) settings.seed = noise.inputs.noise_seed;
  settings.randomSeed = false;
  settings.kind = "video";
  syncForm();
  closeViewer();
  selectTab("create");
  toast("Settings loaded with the same seed. Turn on “Randomize” for variations.");
}

// Uploads a gallery image to the video's images. JPEG XL goes as the PC's PNG copy so the image
// loads in any browser and in LoadImage.
async function addFromGallery(img, role) {
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
  const list = (await fetch("/studio/images").then((r) => r.json()).catch(() => [])).filter((img) => videos || !isVideo(img));
  $("picker-grid").replaceChildren(...(list.length ? list.map((img) => el("button", {
    type: "button", className: isVideo(img) ? "video" : "",
    onclick: async () => {
      $("picker").close();
      const item = isVideo(img) ? addMedia({ kind: "video", name: img.filename, subfolder: img.subfolder || "" }) : await addFromGallery(img);
      if (item?.kind === "image") openItem(item);
    },
  }, el("img", { loading: "lazy", src: thumbUrl(img), alt: img.filename }))) : [el("p", { className: "empty", textContent: "Nothing in the gallery yet." })]));
  $("picker").showModal();
  $("picker").scrollTop = 0;
}

// Sends the viewer's image to Video mode as the start frame.
async function animateCurrent() {
  if (!(await addFromGallery(viewer.list[viewer.index], "start"))) return;
  settings.kind = "video";
  syncForm();
  closeViewer();
  selectTab("create");
  toast("Image set as the video's start frame. Describe the motion and press Generate.");
}

// Sends the viewer's video to Video mode to be continued. The new part replaces the old video's last
// second, so it needs at least two seconds at H3's 24 fps.
async function extendCurrent() {
  const item = viewer.list[viewer.index];
  const info = await imageInfo(item);
  const e = info?.encoding;
  if (e?.fps !== 24 || !(e.frames >= 48)) { toast("Only 24 fps videos of 2 seconds or more can be extended"); return; }
  editVideo((v) => {
    v.extend = { kind: "video", name: item.filename, subfolder: item.subfolder || "", width: info.width, height: info.height, frames: e.frames };
    // The video it continues is where it starts.
    v.items = v.items.filter((i) => i.role !== "start");
  });
  settings.kind = "video";
  syncForm();
  closeViewer();
  selectTab("create");
  toast("Describe what happens next and press Generate.");
}

function bindViewer() {
  $("v-close").onclick = closeViewer;
  $("v-prev").onclick = () => step(-1);
  $("v-next").onclick = () => step(1);
  $("v-delete").onclick = deleteCurrent;
  $("v-reuse").onclick = reuseCurrent;
  $("v-animate").onclick = () => (isVideo(viewer.list[viewer.index]) ? extendCurrent() : animateCurrent());
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
    const g = el("div", { className: buttons.length === 3 ? "segmented" : "segmented two" }, ...buttons);
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
  // The PC lists the encoders it can run for each codec: an NVIDIA or AMD graphics card's, and the CPU.
  const hevc = p.video_codec === "hevc";
  const encoders = p.video_encoders[p.video_codec];
  const labels = { nvidia: "Hardware", amd: "Hardware", software: "Software" };
  $("video-format").replaceChildren(...[
    group(
      radio("H.264", "Works everywhere", !hevc, { video_codec: "h264" }),
      radio("H.265", "Smaller files", hevc, { video_codec: "hevc" }, !p.video_encoders.hevc.length)),
    encoders.length > 1 && group(...encoders.map((e) =>
      radio(labels[e], e === "software" ? "Smallest files" : "Fastest", e === p.video_encoder, { video_encoder: e }))),
    el("span", { className: "note", textContent: !hevc
      ? "H.264 plays in every app and browser."
      : "Safari, and Chrome or Edge on most PCs, play H.265. Some older apps can't." }),
    el("span", { className: "note", textContent: p.video_encoder !== "software"
      ? `The graphics card encodes the video.${hevc && p.video_encoder === "amd" ? " Very narrow videos use Software instead." : ""}`
      : `${hevc ? "x265" : "x264"} encodes the video on the CPU, a few seconds slower than a graphics card.${encoders.length > 1 ? "" : " No NVIDIA or AMD video encoder was found."}` }),
    el("span", { className: "note", textContent: "Applies to new videos from every device. Existing videos keep their format." }),
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
  [models, { lora: turboLora, rapid: rapidAdapter }, videoFiles, ksampler] = await Promise.all([
    fetch("/studio/models").then((r) => r.json()).catch(() => []),
    fetch("/studio/turbo").then((r) => r.json()).catch(() => ({ lora: null, rapid: null })),
    fetch("/studio/video").then((r) => r.json()).catch(() => null),
    fetch("/object_info/KSampler").then((r) => r.json()).catch(() => null),
  ]);
  // The lists come from ComfyUI, so samplers added by other custom nodes show up too.
  const { sampler_name, scheduler } = ksampler?.KSampler.input.required ?? {};
  $("sampler").replaceChildren(...(sampler_name?.[0] ?? [settings.sampler]).map((n) => new Option(n, n)));
  $("scheduler").replaceChildren(...(scheduler?.[0] ?? [settings.scheduler]).map((n) => new Option(n, n)));
  if ((!turboLora && settings.mode === "turbo") || (!rapidAdapter && settings.mode === "rapid")) setMode("full");
  if (!videoFiles) settings.kind = "image";
  else if (!models.length) settings.kind = "video";
  renderModels();
  syncForm();
}

init();
