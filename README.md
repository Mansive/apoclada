# Apoclada Studio

A touch-friendly image and video app for ComfyUI. It runs inside ComfyUI at `/studio`, so you can
generate from a phone or tablet while the PC does the work. There are no node graphs to wire up:
pick a model, write a prompt and press Generate.

Generation goes through ComfyUI's own API. Studio adds the page, a gallery, model downloads and
one-tap updates.

## Features

- **Images** with MOSS-Image or Kroma (lodestones' Krea 2 fine-tune), with optional prompt enhancement
  that follows each model's official template.
- **Videos with sound** with MiniMax H3, from a prompt or from a start image.
- **Gallery** of everything in ComfyUI's output folder, with a full-screen viewer, the settings
  each file was made with, and Reuse settings.
- **Setup** that downloads the models, picks image and video file formats, and updates Studio.
- Live previews while generating, and a progress bar for each job.
- Works as a home-screen app on iPhone and iPad.

## Requirements

- ComfyUI 0.41.0 or newer. Studio uses ComfyUI's native MOSS-Image, Krea 2 and MiniMax H3 nodes.
- Windows. Show in folder, Force stop and the restart after an update use Windows-only calls.
- Git, if you want Studio to update itself.
- A graphics card with plenty of VRAM. Studio was built and tested on an AMD RX 9070 (16 GB),
  including video. NVIDIA cards should work but haven't been tested.
- Disk space for the models you choose (see [Models](#models)).

## Install

1. Put this folder in `ComfyUI/custom_nodes/apoclada_studio`. Cloning it with git lets Setup
   update it later.
2. Install its one extra package, using the Python that runs ComfyUI:

   ```bash
   python -m pip install -r custom_nodes/apoclada_studio/requirements.txt
   ```

   This adds JPEG XL support. Without it Studio still works and saves PNG.
3. Start ComfyUI and open <http://localhost:8188/studio>.

To use Studio from another device on your network, start ComfyUI with `--listen` and open
`http://<PC's IP address>:8188/studio`. On iPhone or iPad, Share › Add to Home Screen opens it
full-screen like an app.

## Models

Open the **Setup** tab and download the packs you want. Files go into ComfyUI's `models` folder.
Downloads keep running if you close the page, and a stopped download resumes where it left off.

| Pack | What it makes | Download size |
|---|---|---|
| MOSS-Image | Images in Quality, Turbo and Rapid modes | 17.8 GB |
| Kroma | Images in 8 steps | 5.1 GB, plus the model itself |
| MiniMax H3 | Videos with sound | 41.7 GB |

- **Kroma** is hosted on Civitai, which only lets signed-in accounts download. Setup links to it.
  Download `kromaKrea2_opd.safetensors` yourself and put it in `models/diffusion_models`. Setup
  downloads its text encoder and VAE.
- **Rapid mode** for MOSS also needs the
  [rapid-moss custom node](https://huggingface.co/darask0/MOSS-Image_4-step_adapter_lora/tree/main/comfyui/rapid-moss),
  which runs darask0's 4-step adapter. Copy its `rapid-moss` folder into `ComfyUI/custom_nodes` and
  restart ComfyUI. Setup downloads the adapter files. Until the node is installed, Rapid stays
  grayed out.

Model sources: Comfy-Org (MOSS-Image, Krea 2 and MiniMax H3 repackages), Black Forest Labs (FLUX.2
small decoder for MOSS), lodestones (MOSS 8-step DMD LoRA and Kroma), darask0 (rapid-moss adapter),
and Kijai/MiniMax-H3-experimental (LynnReal's light video VAE and ZhengmingYu's DMAD 4-step LoRA).

## Making images

Choose a model, write a prompt and press **Generate**. Each model starts with an example prompt
written in the style its guide recommends; **Default prompts** brings it back.

**Settings** holds shape, size, steps, prompt strength (CFG), seed and the number of images.

MOSS-Image has three modes:

| Mode | Steps | Notes |
|---|---|---|
| Quality | 50 | Full model with CFG |
| Turbo | 8 | DMD distillation LoRA, no CFG |
| Rapid | 4 | rapid-moss adapter, no CFG |

**Advanced** adds:

- **Enhance prompt:** the text encoder rewrites your prompt using the model's official template.
  The result is shown under Info. The text model is censored, so it doesn't work for NSFW prompts.
- **EasyCache:** skips steps where the image barely changes. Quality mode takes about a third less
  time; details can come out a little softer.
- Sigma shift, layer skip guidance, sampler and scheduler.

Settings that don't apply to the current mode are grayed out.

## Making videos

Switch to **Video**. H3 makes 2 to 15 seconds of video with sound at up to 0.98 MP, its native size.

- **Start image:** pick one from your device or the gallery, and the video starts from that
  picture. You can also press **Animate** in the viewer on any image.
- **Prompt:** H3 reads three fields: the shots, the ambient sound and the background music. Each
  shot can have camera moves, a cut time (`At 00:01.500`) and spoken lines in `<d>` tags. The
  example prompts show the format.

| Mode | Steps | Notes |
|---|---|---|
| Quality | 20 (adjustable) | Best detail |
| Turbo | 8 | Official Turbo LoRA |
| Fast | 4 | DMAD LoRA; rougher, fine for simple animations |

Before each video, Studio unloads ComfyUI's models. This works around a slowdown on AMD
(ComfyUI issue #16502) where a video made right after another job samples about 3 times slower.

## Gallery and viewer

The gallery shows every image and video in ComfyUI's output folder, newest first. In the viewer:

- **Info** shows the prompt, the enhanced prompt, the model, the settings and the file encoding.
- **Reuse settings** loads that file's prompt and settings into Create.
- **Animate** uses the image as a video's start image.
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
  It also warns when ComfyUI is older than Studio needs.

## Stopping a job

**Cancel** stops the job the next time ComfyUI checks, which can take minutes during a long video.
If that's too slow, the button turns into **Force stop**. Force stop restarts ComfyUI with the same
command line. The current job is lost, and models load again on the next run.
