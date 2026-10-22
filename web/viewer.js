import {
  $, el, load, save, getJson, post, toast, settings, models, videoFiles, galleryUrl, ASPECTS, MEGAPIXELS, VIDEO_MP, MODES, ROLES,
  isVideo, imageUrl, showImage, imageKey, thumbUrl, mediaPath, referenceTags, modeAvailable, familyMode, syncForm, editVideo,
  selectTab, addFromGallery, removeResult,
} from "./app.js";
import { FRAMES_LINE, KREA2_ENHANCE } from "./prompts.js";

let gallery = [];
let viewer = { list: [], index: 0 };

export function thumbButton(img, onclick) {
  const btn = el("button", { type: "button", className: isVideo(img) ? "video" : "", onclick }, el("img", { loading: "lazy", src: thumbUrl(img), alt: img.filename }));
  btn.dataset.key = imageKey(img);
  return btn;
}

// Tiles whose thumbnail hasn't changed are kept: fresh ones flash blank while they decode, even from cache.
export async function loadGallery() {
  gallery = await getJson(galleryUrl, []);
  showGalleryCount();
  const tiles = new Map([...$("grid").querySelectorAll("img")].map((i) => [i.getAttribute("src"), i.parentElement]));
  $("grid").replaceChildren(...(gallery.length
    ? gallery.map((img) => {
      const open = () => openViewer(gallery, gallery.indexOf(img));
      const tile = tiles.get(thumbUrl(img));
      if (!tile) return thumbButton(img, open);
      tile.onclick = open;
      return tile;
    })
    : [el("p", { className: "empty", textContent: "Nothing here yet." })]));
}

function showGalleryCount() {
  $("gallery-count").textContent = `${gallery.length} item${gallery.length === 1 ? "" : "s"}`;
}

export function openViewer(list, index) {
  viewer = { list, index };
  $("viewer").hidden = false;
  $("viewer").classList.remove("bare");
  document.body.style.overflow = "hidden";
  showViewerImage();
}

// Hides the buttons around the image, except on videos, whose taps belong to the video's own
// controls, and while Info is open. Their rows close up to give the image their space.
function setBare(on) {
  $("viewer").classList.toggle("bare", on && !isVideo(viewer.list[viewer.index]) && $("v-info-panel").hidden);
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

function showViewerImage() {
  const { list, index } = viewer;
  if (!list.length) { closeViewer(); return; }
  if (zoom) setZoom(null);
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
  $("v-animate").title = video ? "Continues the video in Create, sound included" : "Starts a video from the image in Create";
  $("v-hint").hidden = !video;
  // Videos keep their buttons, so their size never changes.
  $("v-size").hidden = video;
  if (video) setBare(false);
  $("v-pos").textContent = list.length > 1 ? `${viewer.index + 1} / ${list.length}` : "";
  // Decodes the next pictures each way ahead of time; otherwise Safari decodes one as it first slides
  // into view, and the slide stalls for a couple of frames.
  for (const k of [-2, -1, 1, 2]) {
    const near = list[viewer.index + k];
    if (!near || isVideo(near)) continue;
    const img = new Image();
    showImage(img, near);
    img.decode().catch(() => {});
  }
  $("v-prev").disabled = viewer.index === 0;
  $("v-next").disabled = viewer.index === list.length - 1;
  if (!$("v-info-panel").hidden) showInfo();
}

function step(delta) {
  viewer.index += delta;
  showViewerImage();
}

// The neighbour `delta` away, laid over the picture's space to slide in beside it. Videos show their
// thumbnail.
function peekAt(delta) {
  const item = viewer.list[viewer.index + delta];
  if (!item) return null;
  const peek = el("img", { className: "peek", alt: "" });
  if (isVideo(item)) peek.src = thumbUrl(item);
  else showImage(peek, item);
  $("v-img").parentNode.append(peek);
  return peek;
}

function shown() { return $("v-video").hidden ? $("v-img") : $("v-video"); }

function pageWidth() { return $("v-img").parentNode.clientWidth; }

// A strip of pictures a page width apart: the current one `dx` from its place, and copies of the
// neighbours (by offset; null past the ends), added as they're needed.
function addPeeks(strip, from, to) {
  for (let k = from; k <= to; k++) if (k && !strip.peeks.has(k)) strip.peeks.set(k, peekAt(k));
}

// translate3d gives each picture a layer of its own that Safari moves as it is. Repainting them
// instead left slivers of their edges behind in the black space.
function layOut(strip, dx) {
  const w = pageWidth();
  strip.dx = dx;
  addPeeks(strip, Math.floor(-dx / w), Math.ceil(-dx / w));
  shown().style.transform = `translate3d(${dx}px, 0, 0)`;
  for (const [k, peek] of strip.peeks) if (peek) peek.style.transform = `translate3d(${dx + k * w}px, 0, 0)`;
}

// The page the strip can go to nearest `goal`.
function within(goal) { return Math.min(Math.max(goal, -viewer.index), viewer.list.length - 1 - viewer.index); }

// The slide playing, if any. It stops `moving` once in place, while the picture it turned to loads.
let sliding = null;

// How far the picture is zoomed in (`s`) and moved from its place (`x`, `y`, px), or null. Like a
// slide, it moves on a layer of its own (see layOut).
let zoom = null;

function setZoom(z, ease) {
  const img = $("v-img"), from = img.style.transform || "none";
  zoom = z;
  img.style.transform = z ? `translate3d(${z.x}px, ${z.y}px, 0) scale(${z.s})` : "";
  if (ease) img.animate({ transform: [from, img.style.transform || "none"] }, { duration: 300, easing: "ease-out" });
}

// Springs the strip until the picture `goal` pages along is in place, then shows it for real. The
// spring is critically damped and starts at the finger's speed (`v`, px/ms), capped so it doesn't
// overshoot; stiffness 13 matches Photos' paging, measured from screen recordings. Its time runs
// faster as it goes (t + 3t³), so it starts out the same but doesn't crawl the last few pixels into
// place, ending in about 0.45 s rather than 0.75. It's drawn frame by frame rather than as an
// animation, which Safari plays apart from the page: a touch catching one found it a few frames back
// from where it showed, and the picture jumped back.
async function slide(strip, goal, v = 0) {
  const cur = shown();
  const k = 13, to = -goal * pageWidth(), c1 = strip.dx - to;
  let c2 = v * 1000 + k * c1;
  if (c1 * c2 < 0) c2 = 0;
  addPeeks(strip, Math.min(goal, 0), Math.max(goal, 0));
  const s = sliding = { strip, goal, v, moving: true };
  const start = performance.now();
  // A touch or another turn can catch the slide and carry on from there, which stops it.
  const settled = await new Promise((done) => requestAnimationFrame(function frame(now) {
    if (sliding !== s) return done(false);
    const t = Math.max(0, now - start) / 1000, w = t + 3 * t ** 3, y = (c1 + c2 * w) * Math.exp(-k * w);
    if (t > 0.1 && Math.abs(y) < 0.5) return done(true);
    s.v = (c2 - k * (c1 + c2 * w)) * Math.exp(-k * w) * (1 + 9 * t * t) / 1000;
    layOut(strip, to + y);
    requestAnimationFrame(frame);
  }));
  if (!settled) return;
  layOut(strip, to);
  s.moving = false;
  if (goal) {
    step(goal);
    // The copy covers the real picture until it has loaded, so nothing blinks.
    const img = shown();
    if (img === $("v-img")) await new Promise((done) => { img.addEventListener("load", done, { once: true }); img.addEventListener("error", done, { once: true }); });
  }
  cur.style.transform = "";
  for (const peek of strip.peeks.values()) peek?.remove();
  sliding = null;
}

// Prev, Next and the arrow keys turn the page with the same slide a swipe ends in. During a slide they
// go a page on from where it was headed, at the speed it was going.
function turn(delta) {
  if (sliding && !sliding.moving) return;
  const { strip, goal, v } = sliding ?? { strip: { dx: 0, peeks: new Map() }, goal: 0, v: 0 };
  if (!viewer.list[viewer.index + goal + delta]) return;
  if (zoom) setZoom(null);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) step(delta);
  else slide(strip, goal + delta, v);
}

async function deleteCurrent() {
  const img = viewer.list[viewer.index];
  const res = await post("/studio/images/delete", img).catch(() => null);
  if (!res || !res.ok) { toast("Couldn't delete the image"); return; }
  const key = imageKey(img);
  for (const el of $("grid").querySelectorAll("[data-key]")) if (el.dataset.key === key) el.remove();
  viewer.list.splice(viewer.index, 1);
  gallery = gallery.filter((g) => imageKey(g) !== key);
  removeResult(key);
  showGalleryCount();
  if (!gallery.length && !$("tab-gallery").hidden) loadGallery();
  toast("Deleted");
  showViewerImage();
}

async function revealCurrent() {
  const img = viewer.list[viewer.index];
  const res = await post("/studio/images/reveal", { filename: img.filename, subfolder: img.subfolder || "" }).catch(() => null);
  toast(res && res.ok ? "Opened the folder on the PC" : "Couldn't open the folder");
}

function imageInfo(img) {
  return getJson(`/studio/images/info?${new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || "" })}`);
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

// Saved workflows are read back by node type, following links (["id", output]) to the nodes they name.
function inputsOf(graph, type) { return Object.values(graph).find((n) => n.class_type === type)?.inputs; }
function linked(graph, link) { return Array.isArray(link) ? graph[link[0]] : null; }

// Fast images sample with SamplerCustomAdvanced; this reads them back under KSampler's input names
// (no CFG, sampler or scheduler: the adapter sets those).
function samplerInputs(graph) {
  const rapid = inputsOf(graph, "RapidMOSSAdapter");
  const sampler = inputsOf(graph, "SamplerCustomAdvanced");
  if (!rapid || !sampler) return inputsOf(graph, "KSampler");
  return { positive: graph[sampler.guider[0]].inputs.conditioning, steps: rapid.steps, seed: graph[sampler.noise[0]].inputs.noise_seed, latent_image: sampler.latent_image };
}

// With Enhance prompt on, the positive prompt comes from TextGenerate, whose input holds the typed
// prompt (after the Krea 2 instructions).
function typedPrompt(graph, s) {
  const text = linked(graph, s.positive)?.inputs.text;
  const rewriter = linked(graph, text);
  return { rewriter, prompt: rewriter ? rewriter.inputs.prompt.replace(KREA2_ENHANCE, "") : text };
}

// The image mode a saved workflow ran in, told by the node that marks it. Krea 2 is told by its model instead.
function savedMode(graph) {
  return Object.keys(MODES).find((m) => MODES[m].node && inputsOf(graph, MODES[m].node)) ?? "full";
}

// A saved video's mode LoRA, if any, and whether the orbit LoRA ran after it.
function videoLoras(graph) {
  const names = Object.values(graph).filter((n) => n.class_type === "LoraLoaderModelOnly").map((n) => n.inputs.lora_name);
  return { lora: names.find((name) => name !== videoFiles?.orbit_lora), orbit: names.includes(videoFiles?.orbit_lora) };
}

function h3Node(graph) { return inputsOf(graph, "MiniMaxH3ImageToVideo") ?? inputsOf(graph, "MiniMaxH3ReferenceToVideo"); }

function infoRows(info) {
  const graph = info?.prompt;
  if (!graph) return [["Settings", "This file has no saved settings."]];
  const find = (type) => inputsOf(graph, type);
  const size = `${info.width}×${info.height}`;
  const h3 = h3Node(graph);
  if (h3) {
    const { lora, orbit } = videoLoras(graph);
    const mode = `${!lora ? "" : lora === videoFiles?.fast_lora ? " · Fast" : " · Turbo"}${orbit ? " · 360° orbit" : ""}`;
    const { items, extend } = videoMedia(graph, h3);
    const tags = referenceTags({ items });
    const e = info.encoding;
    return [
      ["Prompt", h3.prompt.replace(FRAMES_LINE, "")],
      ["Model", `MiniMax H3${find("MiniMaxH3ReferenceToVideo") ? " references" : ""}${mode}`],
      ["Continues", extend && mediaPath(extend)],
      ...Object.entries(ROLES).map(([role, r]) => [r.info, items.filter((i) => i.role === role).map((i) => r.detail(i, tags.get(i)?.[0])).join("\n")]),
      ["Size", size],
      ["Length", `${Math.round((e?.frames || h3.length) / (e?.fps || 24))} s`],
      ["Steps", find("BasicScheduler")?.steps],
      ["Seed", find("RandomNoise")?.noise_seed],
    ];
  }
  const s = samplerInputs(graph);
  if (!s) return [["Settings", "This file has no saved settings."]];
  const { rewriter, prompt } = typedPrompt(graph, s);
  const unet = find("UNETLoader")?.unet_name.replace(/\.safetensors$/, "") ?? (find("MOSSImageHFLoader") && "MOSS-Image");
  const slg = find("SkipLayerGuidanceDiTSimple")?.single_layers;
  return [
    [rewriter ? "Original prompt" : "Prompt", prompt],
    ["Enhanced prompt", rewriter && (info.enhanced_prompt ?? "Not saved in this file.")],
    ["Negative prompt", s.cfg > 1 ? linked(graph, s.negative)?.inputs.text : null],
    ["Model", unet && [unet, MODES[savedMode(graph)].label].filter(Boolean).join(" · ")],
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
export function duration(seconds) {
  const s = Math.round(seconds);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

const FORMATS = { PNG: "PNG", JXL: "JPEG XL", JPEG: "JPEG", WEBP: "WebP", h264: "H.264", hevc: "H.265", av1: "AV1", vp9: "VP9", aac: "AAC", opus: "Opus" };
const ENCODERS = { h264_nvenc: "NVIDIA NVENC", hevc_nvenc: "NVIDIA NVENC", h264_amf: "AMD AMF", hevc_amf: "AMD AMF", libx264: "Software (x264)", libx265: "Software (x265)" };

// What the file itself is: its format, the encoder that made it, and its size.
function encodingRows(info) {
  const e = info?.encoding;
  if (!e) return [];
  const graph = info.prompt ?? {};
  const jxl = inputsOf(graph, "ApocladaSaveImageJXL");
  // Videos saved before the encoder was recorded came from ComfyUI's SaveVideo, which uses x264 for H.264.
  const encoder = e.encoder ?? (e.format === "h264" && inputsOf(graph, "SaveVideo") ? "libx264" : null);
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
  const h3 = graph && h3Node(graph);
  if (h3) { reuseVideo(graph, h3); return; }
  const s = graph && samplerInputs(graph);
  if (!s) { toast("This image has no saved settings"); return; }
  const { rewriter, prompt } = typedPrompt(graph, s);
  settings.enhance = Boolean(rewriter);
  settings.prompt = prompt ?? settings.prompt;
  settings.negative = linked(graph, s.negative)?.inputs.text ?? "";
  settings.steps = s.steps;
  // Fast images have no CFG, sampler or scheduler; the current ones stay.
  settings.cfg = s.cfg ?? settings.cfg;
  settings.sampler = s.sampler_name ?? settings.sampler;
  settings.scheduler = s.scheduler ?? settings.scheduler;
  settings.seed = s.seed;
  settings.randomSeed = false;
  const latent = linked(graph, s.latent_image)?.inputs;
  if (latent) {
    settings.aspect = nearestAspect(latent.width, latent.height);
    settings.mp = nearest(MEGAPIXELS, latent.width * latent.height);
    settings.batch = latent.batch_size || 1;
  }
  const mode = savedMode(graph);
  if (!modeAvailable(mode)) { toast(`This image used ${MODES[mode].label} mode, but ${MODES[mode].missing}`); return; }
  settings.mode = mode;
  settings.easyCache = Boolean(inputsOf(graph, "EasyCache"));
  settings.shift = (inputsOf(graph, "ModelSamplingAuraFlow") ?? inputsOf(graph, "ModelSamplingSD3"))?.shift ?? settings.shift;
  const slg = inputsOf(graph, "SkipLayerGuidanceDiTSimple");
  settings.slgLayer = slg ? String(slg.single_layers).trim() : "";
  // Images from before the switch to native files used the moss-image node's full model folder.
  const unet = inputsOf(graph, "UNETLoader")?.unet_name;
  const model = inputsOf(graph, "MOSSImageHFLoader") ? models.find((m) => m.family === "moss") : models.find((m) => m.unet === unet);
  if (model) settings.model = model.name;
  else if (unet) toast("This image used a model that is no longer on the PC");
  settings.mode = familyMode(settings.model) ?? settings.mode;
  toCreate("image", "Settings loaded with the same seed. Turn on “Randomize” for variations.");
}

// The listed megapixel size nearest a pixel count, and the listed shape nearest a width and height.
function nearest(list, pixels) {
  const mp = pixels / (1024 * 1024);
  return list.reduce((best, m) => (Math.abs(m - mp) < Math.abs(best - mp) ? m : best));
}
function nearestAspect(width, height) {
  const off = (a) => Math.abs(Math.log(a[1] / a[2] / (width / height)));
  return ASPECTS.reduce((best, a) => (off(a) < off(best) ? a : best))[0];
}

// Opens Create on images or video with what the viewer just loaded into it.
function toCreate(kind, message) {
  settings.kind = kind;
  syncForm();
  closeViewer();
  selectTab("create");
  toast(message);
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
  for (const [role, r] of Object.entries(ROLES)) if (h3[r.input]) items.push(item(h3[r.input], role));
  for (const g of guides) {
    if (node(g.image).class_type === "LoadImage") items.push(item(g.image, Object.keys(ROLES).find((r) => ROLES[r].frame === g.frame_idx) ?? "at", g.frame_idx));
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
  v.prompt = h3.prompt.replace(FRAMES_LINE, "");
  v.seconds = Math.min(15, Math.max(2, Math.round(h3.length / 24) - (extend ? 1 : 0)));
  const { lora, orbit } = videoLoras(graph);
  v.mode = !lora ? "quality" : lora === videoFiles.fast_lora ? "fast" : "turbo";
  v.orbit = orbit;
  const scheduler = inputsOf(graph, "BasicScheduler");
  if (!lora && scheduler) v.steps = scheduler.steps;
  v.mp = nearest(VIDEO_MP, h3.width * h3.height);
  // An orbit's end image is its start image again, which the orbit adds itself.
  v.items = orbit ? items.filter((i) => i.role !== "end") : items;
  v.extend = extend;
  v.aspect = nearestAspect(h3.width, h3.height);
  settings.seed = inputsOf(graph, "RandomNoise")?.noise_seed ?? settings.seed;
  settings.randomSeed = false;
  toCreate("video", "Settings loaded with the same seed. Turn on “Randomize” for variations.");
}

// Starts a new video from the viewer's image, replacing the images, references and extended video
// chosen before.
async function animateCurrent() {
  const item = await addFromGallery(viewer.list[viewer.index], "start");
  if (!item) return;
  editVideo((v) => {
    v.items = [item];
    v.extend = null;
  });
  toCreate("video", "Image set as the video's start frame. Describe the motion and press Generate.");
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
  toCreate("video", "Describe what happens next and press Generate.");
}

export function bindViewer() {
  $("v-close").onclick = closeViewer;
  $("v-prev").onclick = () => turn(-1);
  $("v-next").onclick = () => turn(1);
  $("v-delete").onclick = deleteCurrent;
  $("v-reuse").onclick = reuseCurrent;
  $("v-animate").onclick = () => (isVideo(viewer.list[viewer.index]) ? extendCurrent() : animateCurrent());
  $("v-reveal").onclick = revealCurrent;
  $("v-info").onclick = () => ($("v-info-panel").hidden ? showInfo() : ($("v-info-panel").hidden = true));
  $("v-info-close").onclick = () => { $("v-info-panel").hidden = true; };
  const area = $("viewer");
  // Fit Both scales the image to fill the space; Original shows it at its own size where it fits.
  // The choice is per device.
  const setOriginal = (on) => {
    area.classList.toggle("original", on);
    $("v-size").setAttribute("aria-label", on ? "Original" : "Fit Both");
    $("v-size").title = on ? "Original: images show at their own size. Switches to Fit Both" : "Fit Both: images scale to fill the space. Switches to Original";
  };
  setOriginal(load("moss-studio-viewer-original", false));
  $("v-size").onclick = () => {
    const on = !area.classList.contains("original");
    setOriginal(on);
    save("moss-studio-viewer-original", on);
  };
  // A tap on the picture hides or shows the buttons; one on the black space around it closes the
  // viewer, like Close does. A tap that catches a slide does neither (see touchstart).
  area.addEventListener("click", (e) => {
    if (e.target === $("v-img")) setBare(!area.classList.contains("bare"));
    else if (!e.target.closest("img, video, button, a, .viewer-info")) closeViewer();
  });
  // Grid rows only animate between lengths, and Safari won't start from a length set in the same
  // moment as the change, so the rows always hold the bars' heights in pixels. The bars sit at
  // the rows' outer edges, so their heights stay their own even while the rows are closed. The zero
  // heights of a closed viewer are skipped, or the rows would grow in from nothing on opening.
  const rows = new ResizeObserver(() => {
    if (area.hidden) return;
    area.style.setProperty("--top", `${area.querySelector(".viewer-top").offsetHeight}px`);
    area.style.setProperty("--bar", `${area.querySelector(".viewer-bar").offsetHeight}px`);
  });
  rows.observe(area.querySelector(".viewer-top"));
  rows.observe(area.querySelector(".viewer-bar"));
  // The image is sized from its shape in CSS, so small ones scale up to fill the space too.
  $("v-img").onload = ({ target: img }) => {
    img.style.setProperty("--ar", img.naturalWidth / img.naturalHeight);
    img.style.setProperty("--w", `${img.naturalWidth}px`);
  };
  // A swipe drags the strip of pictures. Letting go mid-flick, or after a 60 px drag, slides a page
  // on the way it moved; otherwise it settles on the nearest picture. A touch during a slide
  // catches it where it is: holding pauses it, and a swipe goes a page further on from where the
  // slide was headed, so two quick swipes turn two pages. Past the first or last picture the strip
  // moves at a third of the finger's pace. Swipes on the video would fight with scrubbing its
  // timeline, and swipes in Info with selecting its text, so neither moves anything.
  //
  // Two fingers zoom the picture about the point between them, up to 5×, and zooming in hides the
  // buttons. Zoomed in, one finger moves it about instead of turning the page. Letting go, it moves
  // back to fill the space where it's big enough to, and to the middle where it isn't; zoomed out
  // past its size, it springs back to it. The picture grows as the buttons' rows close, so a pinch
  // keeps its size on screen and the point under the fingers as fractions of the picture.
  const box = area.querySelector(".viewer-img");
  let drag = null, pinch = null, pan = null;
  const fingers = (e) => {
    const [a, b] = e.touches, r = box.getBoundingClientRect();
    return { x: (a.clientX + b.clientX) / 2 - r.left, y: (a.clientY + b.clientY) / 2 - r.top, d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) };
  };
  // The picture's middle in its space, before it's zoomed.
  const middle = () => { const img = $("v-img"); return { x: img.offsetLeft + img.offsetWidth / 2, y: img.offsetTop + img.offsetHeight / 2 }; };
  const fit = (t, c, half, size) => (half * 2 <= size ? size / 2 - c : Math.min(Math.max(t, size - half - c), half - c));
  const settle = () => {
    pinch = pan = null;
    if (zoom.s <= 1) return setZoom(null, true);
    const img = $("v-img"), c = middle();
    setZoom({ s: zoom.s, x: fit(zoom.x, c.x, img.offsetWidth * zoom.s / 2, box.clientWidth), y: fit(zoom.y, c.y, img.offsetHeight * zoom.s / 2, box.clientHeight) }, true);
  };
  const ends = () => [-(viewer.list.length - 1 - viewer.index) * pageWidth(), viewer.index * pageWidth()];
  const nearest = () => within(Math.round(-drag.strip.dx / pageWidth()));
  const letGo = (goal, v) => {
    const { strip } = drag;
    drag = null;
    if (strip.dx || goal) slide(strip, goal, v);
    else for (const peek of strip.peeks.values()) peek?.remove();
  };
  area.addEventListener("touchstart", (e) => {
    if (drag) letGo(nearest());
    for (const a of $("v-img").getAnimations()) a.finish();
    // Taps on the buttons are theirs alone, so a second tap on Next goes a page further rather than
    // catching the slide.
    if (e.target.closest("video, .viewer-info, button, a")) return;
    // A second finger zooms, unless the first has already sent the strip sliding.
    if (e.touches.length === 2 && !sliding && !$("v-img").hidden) {
      const f = fingers(e), c = middle(), z = zoom ?? { s: 1, x: 0, y: 0 }, img = $("v-img");
      const w = img.offsetWidth * z.s, h = img.offsetHeight * z.s;
      pan = null;
      pinch = { d: f.d, w, x: (f.x - c.x - z.x) / w, y: (f.y - c.y - z.y) / h };
      return;
    }
    if (e.touches.length !== 1) return;
    if (zoom) {
      pan = { x: e.touches[0].clientX - zoom.x, y: e.touches[0].clientY - zoom.y };
      return;
    }
    // `goal` is where a caught slide was headed.
    let strip = { dx: 0, peeks: new Map() }, goal;
    if (sliding) {
      // After a turn, the new picture takes a moment to load, and can't be caught.
      if (!sliding.moving) return;
      ({ strip, goal } = sliding);
      sliding = null;
      // Catching isn't a tap or a long press, so it doesn't toggle the buttons or open the picture's menu.
      e.preventDefault();
    }
    const [lo, hi] = ends(), dx = strip.dx;
    const raw = dx < lo ? lo + (dx - lo) * 3 : dx > hi ? hi + (dx - hi) * 3 : dx;
    drag = { strip, goal, x: e.touches[0].clientX - raw, y: e.touches[0].clientY, from: raw, raw, track: [{ raw, time: e.timeStamp }] };
  });
  area.addEventListener("touchmove", (e) => {
    if (pinch && e.touches.length === 2) {
      const f = fingers(e), c = middle(), img = $("v-img"), w = img.offsetWidth, h = img.offsetHeight;
      const s = Math.min(Math.max(pinch.w * f.d / pinch.d / w, 0.5), 5);
      if (s > 1) setBare(true);
      setZoom({ s, x: f.x - c.x - pinch.x * s * w, y: f.y - c.y - pinch.y * s * h });
    }
    if (pan) setZoom({ s: zoom.s, x: e.touches[0].clientX - pan.x, y: e.touches[0].clientY - pan.y });
    if (!drag) return;
    const raw = e.touches[0].clientX - drag.x;
    // The last 100 ms of movement give the speed at letting go.
    drag.track.push({ raw, time: e.timeStamp });
    while (e.timeStamp - drag.track[0].time > 100) drag.track.shift();
    // Small movements are taps, which hide or show the buttons. Movements more up or down than across
    // aren't swipes between pictures, such as the one up from the bottom edge to the Dock. A caught
    // slide follows the finger at once.
    if (!drag.moved && drag.goal === undefined) {
      const across = Math.abs(raw - drag.from), down = Math.abs(e.touches[0].clientY - drag.y);
      if (Math.max(across, down) < 10) return;
      if (down > across) { drag = null; return; }
    }
    drag.moved = true;
    drag.raw = raw;
    const [lo, hi] = ends();
    layOut(drag.strip, raw < lo ? lo + (raw - lo) / 3 : raw > hi ? hi + (raw - hi) / 3 : raw);
  }, { passive: true });
  area.addEventListener("touchend", (e) => {
    if (pinch || pan) settle();
    if (!drag) return;
    const first = drag.track[0], last = drag.track.at(-1);
    const v = drag.moved && e.timeStamp - last.time < 100 && last.time > first.time ? (last.raw - first.raw) / (last.time - first.time) : 0;
    const moved = drag.raw - drag.from;
    const dir = Math.abs(v) > 0.3 ? -Math.sign(v) : Math.abs(moved) > 60 ? -Math.sign(moved) : 0;
    const page = -drag.strip.dx / pageWidth();
    if (dir > 0) letGo(within(Math.max(Math.ceil(page), (drag.goal ?? -Infinity) + 1)), v);
    else if (dir < 0) letGo(within(Math.min(Math.floor(page), (drag.goal ?? Infinity) - 1)), v);
    else letGo(nearest(), v);
  });
  area.addEventListener("touchcancel", () => {
    if (pinch || pan) settle();
    if (drag) letGo(nearest());
  });
  document.addEventListener("keydown", (e) => {
    if ($("viewer").hidden) return;
    if (e.key === "Escape") closeViewer();
    if (e.key === "ArrowLeft") turn(-1);
    if (e.key === "ArrowRight") turn(1);
  });
}
