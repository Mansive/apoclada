# Apoclada

Apoclada is a simple and mobile-friendly app to generate images and videos with ComfyUI. It lives at `/studio` inside ComfyUI, so you can make images from your phone or tablet while your PC does the heavy lifting. Pick a model, type a prompt, and tap Generate. A gallery, model downloads, and one-tap updates are provided.

## Features

- **Images** with MOSS-Image or Kroma (lodestones' Krea 2 fine-tune), with optional prompt enhancement
  that follows each model's official template.
- **Videos with sound** with MiniMax H3, from a prompt, images, references or an earlier video.
- **Gallery** of everything in ComfyUI's output folder, with a full-screen viewer, the settings
  each file was made with, and Reuse settings.
- **Setup** that downloads the models, picks image and video file formats, and updates Apoclada.
- Live previews while generating, and a progress bar for each job.
- Works as a home-screen app on iPhone and iPad.

## Requirements

- ComfyUI 0.41.0 or newer. Apoclada uses ComfyUI's native MOSS-Image, Krea 2 and MiniMax H3 nodes.
- Windows. Show in folder, Force stop and the restart after an update use Windows-only calls.
- Git, if you want Apoclada to update itself.
- A graphics card with plenty of VRAM. Apoclada was built and tested on an AMD RX 9070 (16 GB),
  including video. NVIDIA cards should work but haven't been tested.
- Disk space for the models you choose (see [Models](#models)).

## Install

1. Put this folder in `ComfyUI/custom_nodes/apoclada_studio`. Cloning it with git lets Setup
   update it later.
2. Start ComfyUI and open <http://localhost:8188/studio>.
3. For JPEG XL images, press **Install and restart** under Image files in Setup. It installs
   `requirements.txt` into ComfyUI's Python with pip, or with uv if that Python has no pip.
   Without it Apoclada still works and saves PNG.

To use Apoclada from another device on your network, start ComfyUI with `--listen` and open
`http://<PC's IP address>:8188/studio`. On iPhone or iPad, Share › Add to Home Screen opens it
full-screen like an app.

## Models

Open the **Setup** tab and download the packs you want. Files go into ComfyUI's `models` folder.
Downloads keep running if you close the page, and a stopped download resumes where it left off.

| Pack | What it makes | Download size |
|---|---|---|
| MOSS-Image | Images in Quality, Turbo and Fast modes | 15.4 GB |
| Kroma | Images in 8 steps | 5.1 GB, plus the model itself |
| MiniMax H3 | Videos with sound | 41.7 GB |
| MiniMax H3 references | Videos that follow reference pictures, videos and voices | 22.9 GB |

- **Kroma** is hosted on Civitai, which only lets signed-in accounts download. Setup links to it.
  Download `kromaKrea2_opd.safetensors` yourself and put it in `models/diffusion_models`. Setup
  downloads its text encoder and VAE.
- **Fast mode** for MOSS also needs the
  [rapid-moss custom node](https://huggingface.co/darask0/MOSS-Image_4-step_adapter_lora/tree/main/comfyui/rapid-moss),
  which runs darask0's 4-step adapter. Copy its `rapid-moss` folder into `ComfyUI/custom_nodes` and
  restart ComfyUI. Setup downloads the adapter files. Until the node is installed, the Fast button
  doesn't appear.

### What's in each pack

Most files are the ones ComfyUI's own templates use. The notes under each table explain where
Apoclada differs and why. Speed figures were measured on an RX 9070.

**MOSS-Image**

| Part | File | Source |
|---|---|---|
| Diffusion model | `moss_image_sft_int8_convrot` | Comfy-Org/MOSS-Image |
| Text encoder (Qwen3.5 9B) | `qwen3.5_9b_w4a8_gptq` | Comfy-Org/MOSS-Image |
| VAE | `flux2-vae_small` | Comfy-Org/MOSS-Image |
| Turbo LoRA (8 steps) | `moss-image-sft-8step-dmd` | lodestones/MOSS-Image-SFT-8-steps-dmd |
| Fast adapter (4 steps) | `rapid-moss-4step` (3 files) | darask0/MOSS-Image_4-step_adapter_lora |

- **VAE:** Apoclada started with Comfy-Org's full `flux2-vae`. The MOSS team said their own release
  decodes with FLUX.2's small decoder because it avoids odd spots and artifacts. It also decodes
  about 40% faster, with no visible difference. ComfyUI's MOSS template has since moved to the same
  small decoder, and Apoclada now uses the template's copy of Black Forest Labs' file.
- **Diffusion model:** int8, like the template. It runs about a third faster than the bf16 version.
- **Text encoder:** 4-bit, like the template. Apoclada first used Comfy-Org's int8 version (9.7 GB
  instead of 7.3 GB). Side by side, the images were just as good and peak VRAM was about 1 GB lower.
  Enhance prompt ran about twice as fast, because the smaller encoder fits beside the image model.
- **Turbo and Fast** are community distillations that ComfyUI's templates don't include.

**Kroma**

| Part | File | Source |
|---|---|---|
| Diffusion model | `kromaKrea2_opd` | lodestones, on Civitai (download by hand) |
| Text encoder (Qwen3-VL 4B) | `qwen3vl_4b_int8_convrot` | Comfy-Org/Krea-2 |
| VAE | `qwen_image_vae` | Comfy-Org/Krea-2 |

- **Diffusion model:** ComfyUI's templates run Krea 2 Turbo. Apoclada runs lodestones' Kroma
  fine-tune of it on the same nodes.
- **Text encoder:** the template uses `qwen3vl_4b_fp8_scaled`. Apoclada uses Comfy-Org's int8
  version, like its other models, which is slightly smaller (4.9 GB instead of 5.2 GB). The two
  haven't been compared in Apoclada.
- **VAE:** the same as the template.

**MiniMax H3**

| Part | File | Source |
|---|---|---|
| Diffusion model | `minimax_h3_fl2va_pruned_int8_convrot` | Comfy-Org/MiniMax-H3 |
| Text encoder (Qwen3-VL 32B) | `qwen3vl_32b_minimax_h3_nvfp4_awq` | Comfy-Org/MiniMax-H3 |
| Video VAE | `minimax_h3_lynnreal_light_vae_int8_convrot` | Kijai/MiniMax-H3-experimental |
| Audio VAE | `minimax_h3_audio_vae_fp32` | Comfy-Org/MiniMax-H3 |
| Turbo LoRA (8 steps) | `minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16` | Comfy-Org/MiniMax-H3 |
| Fast LoRA (4 steps) | `minimax_h3_DMAD_4step_full_lora_avg_rank_39_bf16` | Kijai/MiniMax-H3-experimental |
| References model and Turbo LoRA (4 steps) | `minimax_h3_ref2va_pruned_int8_convrot`, `minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16` | Comfy-Org/MiniMax-H3 |

- **Video VAE:** the template uses Comfy-Org's `minimax_h3_video_vae_int8_convrot`. LynnReal's
  light VAE keeps the same encoder but cuts the decoder from 36 to 26 blocks. Decoding is about
  35% faster, frames stay within about 40 dB of the full VAE with no color shift, and the sound
  is unchanged.
- **Fast LoRA:** ZhengmingYu's DMAD distillation, not part of ComfyUI's templates. It takes about a
  quarter less time than Turbo, but the picture is rougher and the sound a little quieter and duller.
- **Everything else** matches the template. The 4-bit text encoder (nvfp4) runs natively on newer
  NVIDIA cards; on AMD it's emulated but works.

## Making images

Choose a model, write a prompt and press **Generate**. Each model starts with an example prompt
written in the style its guide recommends; **Default prompts** brings it back.

**Settings** holds shape, size, steps, prompt strength (CFG), seed and the number of images.
Settings that don't apply to the current mode are grayed out.

MOSS-Image has three modes:

| Mode | Steps | Notes |
|---|---|---|
| Quality | 50 | Full model with CFG |
| Turbo | 8 | DMD distillation LoRA, no CFG |
| Fast | 4 | rapid-moss adapter, no CFG |

**Advanced** adds:

- **Enhance prompt:** the text encoder rewrites your prompt using the model's official template.
  The result is shown under Info. The text model is censored, so it doesn't work for NSFW prompts.
- **EasyCache:** skips steps where the image barely changes. Quality mode takes about a third less
  time; details can come out a little softer.
- Sigma shift, layer skip guidance, sampler and scheduler.

## Making videos

Switch to **Video**. H3 makes 2 to 15 seconds of video with sound at up to 0.98 MP, its native size.

- **Images:** add them from your device or the gallery, then tap one to set it as the start, end
  or a partway frame. In the viewer, **Animate** starts from an image; **Extend** continues a video.
- **References** (MiniMax H3 references pack): pictures, videos and voices the video follows. Name
  them in the prompt by their captions, like `<Picture 1>`. Turbo runs them in 4 steps.
- **Prompt:** H3 reads three fields: the shots, the ambient sound and the background music. Each
  shot can have camera moves, a cut time (`At 00:01.500`) and spoken lines in `<d>` tags. The
  example prompts show the format.

| Mode | Steps | Notes |
|---|---|---|
| Quality | 20 (adjustable) | Best detail |
| Turbo | 8 | Official Turbo LoRA |
| Fast | 4 | DMAD LoRA; rougher, fine for simple animations. Not available with references |

Before each video, Apoclada unloads ComfyUI's models. This works around a slowdown on AMD
(ComfyUI issue #16502) where a video made right after another job samples about 3 times slower.

## Gallery and viewer

The gallery shows every image and video in ComfyUI's output folder, newest first. In the viewer,
tap or click an image to hide or show the buttons. The button at the top right switches between
Fit Both, which scales images to fill the space, and Original, which shows them at their own size
unless that doesn't fit. Swipe between images, and pinch to zoom, which hides the buttons too.

- **Info** shows the prompt, the enhanced prompt, the model, the settings, how long the file took
  to generate and the file encoding. When a job finishes, Create also shows how long it took.
- **Reuse settings** loads that file's prompt and settings into Create.
- **Animate** starts over from the image; **Extend** continues a video, sound included.
- **Save** (videos) downloads the file. On iPhone or iPad, open the video in Files and use
  Share › Save Video to add it to Photos. Images save the browser's usual way, with a long press or
  right-click.
- **Show in folder** opens Explorer on the PC. It only appears in a browser on the PC itself.
- **Delete** removes the file from the PC.

## Setup options

- **Image files:** PNG, or JPEG XL (lossless or lossy, much smaller). Both keep the workflow, so
  Reuse settings works.
- **Video files:** H.264 (plays everywhere) or H.265 (smaller), encoded by an NVIDIA or AMD
  graphics card or by the CPU. Setup only lists the encoders that actually work on the PC.
- **Updates:** checks the git remote this folder came from, pulls new commits and restarts ComfyUI.
  It also warns when ComfyUI is older than Apoclada needs.

## Stopping a job

**Cancel** stops the current job, leaving the rest queued, the next time ComfyUI checks, which can take minutes during a long video.
If that's too slow, the button turns into **Force stop**. Force stop restarts ComfyUI with the same
command line. The current job is lost, and models load again on the next run.
