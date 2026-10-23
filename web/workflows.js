import { MODES, ROLES, models, turboLora, rapidAdapter, videoFiles, dimensions, videoDimensions, usesRefs, mediaPath } from "./app.js";
import { prefs } from "./setup.js";
import { FRAMES_LINE, KREA2_ENHANCE, MOSS_ENHANCE, START_LINE } from "./prompts.js";

// H3 frame counts sit on a 17k+5 grid at 24 fps.
function videoLength(seconds) {
  const n = Math.max(5, Math.round(seconds * 24));
  return n + (((5 - (n % 17)) % 17) + 17) % 17;
}

export function buildWorkflow(s) {
  const { width, height } = dimensions(s.aspect, s.mp);
  return MODES[s.mode].build(s, models.find((m) => m.name === s.model), width, height);
}

// Quality, and Turbo with its LoRA. ComfyUI's native MOSS model takes raw 0-1 timesteps:
// ModelSamplingSD3 would scale them by 1000 and produce pure noise, so the shift goes through the
// AuraFlow node instead.
export function buildMossWorkflow(s, model, width, height) {
  const turbo = s.mode === "turbo";
  const cache = s.easyCache && !turbo;
  return {
    ...loaderNodes(model, "moss_image"),
    ...(turbo && { "20": { class_type: "LoraLoaderModelOnly", inputs: { lora_name: turboLora, strength_model: 1, model: ["1", 0] } } }),
    ...(s.enhance && mossEnhanceNodes(s)),
    "4": { class_type: "CLIPTextEncode", inputs: { text: s.enhance ? ["30", 0] : s.prompt, clip: ["2", 0] } },
    "5": { class_type: "CLIPTextEncode", inputs: { text: s.negative, clip: ["2", 0] } },
    "6": { class_type: "EmptyFlux2LatentImage", inputs: { width, height, batch_size: s.batch } },
    "15": { class_type: "ModelSamplingAuraFlow", inputs: { shift: s.shift, model: [turbo ? "20" : "1", 0] } },
    "13": {
      class_type: "SkipLayerGuidanceDiTSimple",
      inputs: { double_layers: "", single_layers: s.slgLayer, start_percent: 0, end_percent: 1, model: ["15", 0] },
    },
    ...(cache && easyCacheNode(["13", 0])),
    "16": {
      class_type: "KSampler",
      inputs: {
        seed: s.seed, steps: s.steps, cfg: s.cfg, sampler_name: s.sampler, scheduler: s.scheduler, denoise: 1,
        model: [cache ? "40" : "13", 0], positive: ["4", 0], negative: ["5", 0], latent_image: ["6", 0],
      },
    },
    "17": { class_type: "VAEDecode", inputs: { samples: ["16", 0], vae: ["3", 0] } },
    "18": saveNode("studio/moss", s),
  };
}

// Fast mode, as in rapid-moss's native example: its node patches the model and hands
// SamplerCustomAdvanced the adapter's own sampler and sigmas. No CFG, so BasicGuider and no negative prompt.
export function buildRapidWorkflow(s, model, width, height) {
  return {
    ...loaderNodes(model, "moss_image"),
    "20": { class_type: "RapidMOSSAdapter", inputs: { model: ["1", 0], adapter: rapidAdapter, steps: s.steps, lora_strength: 1 } },
    ...(s.enhance && mossEnhanceNodes(s)),
    "4": { class_type: "CLIPTextEncode", inputs: { text: s.enhance ? ["30", 0] : s.prompt, clip: ["2", 0] } },
    "6": { class_type: "EmptyFlux2LatentImage", inputs: { width, height, batch_size: s.batch } },
    "21": { class_type: "BasicGuider", inputs: { model: ["20", 0], conditioning: ["4", 0] } },
    "22": { class_type: "RandomNoise", inputs: { noise_seed: s.seed } },
    "16": { class_type: "SamplerCustomAdvanced", inputs: { noise: ["22", 0], guider: ["21", 0], sampler: ["20", 1], sigmas: ["20", 2], latent_image: ["6", 0] } },
    "17": { class_type: "VAEDecode", inputs: { samples: ["16", 0], vae: ["3", 0] } },
    "18": saveNode("studio/moss", s),
  };
}

function loaderNodes(model, clipType) {
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: model.unet, weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: model.clip, type: clipType, device: "default" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: model.vae } },
  };
}

function mossEnhanceNodes(s) {
  return enhanceNodes(s, { prompt: s.prompt, system_prompt: MOSS_ENHANCE, max_length: 4096, "sampling_mode.repetition_penalty": 1, mtp: "auto" });
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
// Krea 2's 8. Turbo and Fast skip none, so they never get it.
function easyCacheNode(model) {
  return { "40": { class_type: "EasyCache", inputs: { model, reuse_threshold: 0.2, start_percent: 0.15, end_percent: 0.95, verbose: false } } };
}

// Apoclada's save nodes write the generation time and enhanced prompt into the file for the viewer's Info.
function saveNode(prefix, s) {
  const inputs = { filename_prefix: prefix, images: ["17", 0], ...(s.enhance && { enhanced_prompt: ["30", 0] }) };
  if (prefs.image_format === "jxl") return { class_type: "ApocladaSaveImageJXL", inputs: { ...inputs, lossless: prefs.jxl_lossless } };
  return { class_type: "ApocladaSaveImage", inputs };
}

// Follows Comfy's Krea 2 Turbo template (euler, simple scheduler), with the shift exposed through
// ModelSamplingAuraFlow, which matches Krea 2's own flow sampling. Node ids line up with NODE_STAGES.
export function buildKrea2Workflow(s, model, width, height) {
  return {
    ...loaderNodes(model, "krea2"),
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

// Each mode's LoRA and steps. The reference model has its own Turbo LoRA, which ComfyUI's template
// runs at 4 steps, and no Fast or Orbit one. Orbit isn't distilled, so its steps are adjustable like Quality's.
export function videoLoras(v) {
  return usesRefs(v)
    ? { turbo: [videoFiles?.ref_lora, 4] }
    : { turbo: [videoFiles?.lora, 8], fast: [videoFiles?.fast_lora, 4], orbit: [videoFiles?.orbit_lora] };
}

// An orbit turns a start image into a camera orbit that ends where it began, so it can't continue a video.
export function canOrbit(v) { return !v.extend && v.items.some((i) => i.role === "start"); }

// Fast runs as Turbo on the reference model, and so does Orbit without a start image. Each falls back to
// Quality when its LoRA isn't on the PC.
export function videoMode(v) {
  const loras = videoLoras(v);
  const mode = v.mode in loras && (v.mode !== "orbit" || canOrbit(v)) ? v.mode : "turbo";
  return v.mode !== "quality" && loras[mode][0] ? mode : "quality";
}

export function videoSteps(v, mode) {
  return videoLoras(v)[mode]?.[1] ?? v[stepsField(mode)];
}

// Orbit keeps its own steps, since its LoRA recommends 28 where Quality's template uses 20.
export function stepsField(mode) { return mode === "orbit" ? "orbitSteps" : "steps"; }

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
// or 20 by default without it. Fast swaps in the DMAD LoRA at 4 steps, and Orbit the orbit LoRA at
// 28 by default. Start and end images go to Image to Video, which shows them to the text encoder;
// images partway are Add Guide nodes at their frame. References switch to the reference model and its node, where every keyframe is an Add Guide.
// Node ids line up with NODE_STAGES; the images, references and extended video are numbered from 50.
export function buildVideoWorkflow(s) {
  const v = s.video;
  const { width, height } = videoDimensions(v);
  const refs = usesRefs(v);
  const mode = videoMode(v);
  const orbit = mode === "orbit";
  const lora = mode === "quality" ? null : videoLoras(v)[mode][0];
  const model = [lora ? "20" : "1", 0];
  // Extending makes a new video that opens on the old one's last 22 frames, from a second before its end.
  const length = videoLength(v.seconds + (v.extend ? 1 : 0));
  const graph = {
    "1": { class_type: "UNETLoader", inputs: { unet_name: refs ? videoFiles.ref_unet : videoFiles.unet, weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: videoFiles.clip, type: "minimax", device: "default" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: videoFiles.vae } },
    "19": { class_type: "VAELoader", inputs: { vae_name: videoFiles.audio_vae } },
    ...(lora && { "20": { class_type: "LoraLoaderModelOnly", inputs: { lora_name: lora, strength_model: 1, model: ["1", 0] } } }),  };
  let next = 50;
  const add = (class_type, inputs) => { graph[next] = { class_type, inputs }; return String(next++); };
  const image = (item) => [add("LoadImage", { image: mediaPath(item) }), 0];
  const video = (item) => add("GetVideoComponents", { video: [add("LoadVideo", { file: `${mediaPath(item)} [output]` }), 0] });
  const ends = (orbit ? ["start"] : ["start", "end"]).map((role) => v.items.find((i) => i.role === role)).filter(Boolean);
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
    for (const i of ends) guides.push({ image: image(i), frame_idx: ROLES[i.role].frame });
  } else {
    const line = !orbit && !FRAMES_LINE.test(v.prompt) && framesLine(v, length);
    const frames = Object.fromEntries(ends.map((i) => [ROLES[i.role].input, image(i)]));
    // The orbit comes back around to the start image, so it's the end image too. Its prompt stays verbatim.
    if (orbit) frames.last_frame = frames.first_frame;
    graph["4"] = {
      class_type: "MiniMaxH3ImageToVideo",
      inputs: { ...shared, prompt: line ? `${line}\n\n${v.prompt}` : v.prompt, ...frames },
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
    // Orbits are silent, as the LoRA recommends.
    ...(!orbit && { "22": { class_type: "VAEDecodeAudio", inputs: { samples: ["16", 0], vae: ["19", 0] } } }),
    "23": {
      class_type: "CreateVideo",
      inputs: head
        ? { images: [add("BatchImagesNode", { "images.image0": [head.images, 0], "images.image1": ["17", 0] }), 0], audio: [add("AudioConcat", { audio1: [head.audio, 0], audio2: ["22", 0], direction: "after" }), 0], fps: 24 }
        : { images: ["17", 0], ...(!orbit && { audio: ["22", 0] }), fps: 24 },
    },
    // Codec and encoder come from Setup.
    "18": { class_type: "ApocladaSaveVideo", inputs: { video: ["23", 0], filename_prefix: "studio/h3", codec: prefs.video_codec, encoder: prefs.video_encoder ?? "software", lossless_copy: prefs.video_copy } },
  });
  return graph;
}
