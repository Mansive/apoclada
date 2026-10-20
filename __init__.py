"""Apoclada Studio: a touch-friendly image and video front end served by ComfyUI at /studio.

Generation goes through ComfyUI's own /prompt, /ws, /view and /interrupt APIs; this module adds
the page itself, gallery listing, metadata and delete, model downloads and self-updates.
"""
import asyncio
import json
import math
import mimetypes
import os
import socket
import subprocess
import sys
import time
from fractions import Fraction
from io import BytesIO

import aiohttp
import av
import numpy as np
from aiohttp import web
from PIL import Image

import folder_paths
from comfy.cli_args import args
from comfy_api.latest._input_impl.video_types import BT709_NCL, set_video_color_properties
from comfyui_version import __version__ as COMFYUI_VERSION
from nodes import NODE_CLASS_MAPPINGS as NODE_CLASSES, SaveImage
from server import PromptServer

# JPEG XL needs pillow-jxl-plugin (requirements.txt). Importing it teaches Pillow, and with it the
# gallery, Reuse and ComfyUI's own loaders, to read .jxl. Updates only git pull, so a copy that
# hasn't installed it yet keeps working with PNG and Setup says what's missing.
try:
    import pillow_jxl
except ImportError:
    pillow_jxl = None
# /view picks the Content-Type from mimetypes, which only knows .jxl where Windows has a JPEG XL codec.
mimetypes.add_type("image/jxl", ".jxl")

PLUGIN_DIR = os.path.dirname(__file__)
WEB_ROOT = os.path.join(PLUGIN_DIR, "web")
IMAGE_EXTS = {".png", ".webp", ".jpg", ".jpeg", ".jxl"}
VIDEO_EXTS = {".mp4", ".webm", ".mov"}
# Krea 2 support and the native MOSS-Image and MiniMax H3 nodes arrived in ComfyUI 0.41.
COMFYUI_MIN = "0.41.0"

HF = "https://huggingface.co"
# The rapid-moss node reads adapters from models/rapid_moss/<name>/. It registers that folder too, but
# Setup has to download into it whether or not the node is installed yet.
RAPID_ADAPTER = "rapid-moss-4step"
folder_paths.add_model_folder_path("rapid_moss", os.path.join(folder_paths.models_dir, "rapid_moss"))
# Every file Apoclada can download: name -> (models folder, source, size in bytes).
FILES = {
    "moss_image_sft_int8_convrot.safetensors": ("diffusion_models", f"{HF}/Comfy-Org/MOSS-Image/resolve/main/diffusion_models/moss_image_sft_int8_convrot.safetensors", 5413698958),
    "qwen3.5_9b_int8_convrot.safetensors": ("text_encoders", f"{HF}/Comfy-Org/MOSS-Image/resolve/main/text_encoders/qwen3.5_9b_int8_convrot.safetensors", 9748121532),
    # MOSS-Image's own release decodes with FLUX.2's small decoder, which the MOSS team says avoids
    # odd spots and artifacts. It also decodes about 40% faster here than Comfy-Org's full flux2-vae.
    "full_encoder_small_decoder.safetensors": ("vae", f"{HF}/black-forest-labs/FLUX.2-small-decoder/resolve/main/full_encoder_small_decoder.safetensors", 249519092),
    # lodestones/MOSS-Image-SFT-8-steps-dmd: 8-step, CFG-free distillation LoRA for MOSS-Image-SFT.
    "moss-image-sft-8step-dmd.safetensors": ("loras", f"{HF}/lodestones/MOSS-Image-SFT-8-steps-dmd/resolve/main/lora.safetensors", 1189176800),
    # darask0/MOSS-Image_4-step_adapter_lora (rapid-moss): 4-step adapter, run by its own custom node.
    **{f"{RAPID_ADAPTER}/{name}": ("rapid_moss", f"{HF}/darask0/MOSS-Image_4-step_adapter_lora/resolve/main/{name}", size)
       for name, size in (("lora.safetensors", 1189176832), ("time_embedding.safetensors", 41017896), ("dataspace.safetensors", 65784))},
    "qwen3vl_4b_int8_convrot.safetensors": ("text_encoders", f"{HF}/Comfy-Org/Krea-2/resolve/main/text_encoders/qwen3vl_4b_int8_convrot.safetensors", 4858559240),
    "qwen_image_vae.safetensors": ("vae", f"{HF}/Comfy-Org/Krea-2/resolve/main/vae/qwen_image_vae.safetensors", 253806246),
    "minimax_h3_fl2va_pruned_int8_convrot.safetensors": ("diffusion_models", f"{HF}/Comfy-Org/MiniMax-H3/resolve/main/diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors", 20970379616),
    "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors": ("text_encoders", f"{HF}/Comfy-Org/MiniMax-H3/resolve/main/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", 15687142551),
    "minimax_h3_video_vae_int8_convrot.safetensors": ("vae", f"{HF}/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_video_vae_int8_convrot.safetensors", 2811065184),
    "minimax_h3_audio_vae_fp32.safetensors": ("vae", f"{HF}/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_audio_vae_fp32.safetensors", 605254808),
    "minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors": ("loras", f"{HF}/Comfy-Org/MiniMax-H3/resolve/main/loras/minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors", 1956193000),
}
MOSS = {"unet": "moss_image_sft_int8_convrot.safetensors", "clip": "qwen3.5_9b_int8_convrot.safetensors", "vae": "full_encoder_small_decoder.safetensors"}
TURBO_LORA = "moss-image-sft-8step-dmd.safetensors"
RAPID_FILES = [name for name in FILES if name.startswith(f"{RAPID_ADAPTER}/")]
# Krea 2 and its fine-tunes (e.g. lodestones' Kroma) run on ComfyUI's native nodes with the
# text encoder and VAE from Comfy-Org/Krea-2.
KREA2 = {"clip": "qwen3vl_4b_int8_convrot.safetensors", "vae": "qwen_image_vae.safetensors"}
# Comfy-Org/MiniMax-H3 files used by the official text/image-to-video template.
H3 = {
    "unet": "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
    "clip": "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
    "vae": "minimax_h3_video_vae_int8_convrot.safetensors",
    "audio_vae": "minimax_h3_audio_vae_fp32.safetensors",
    "lora": "minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors",
}
# What the Setup screen offers. Kroma is on Civitai, which only lets signed-in accounts download,
# so it's fetched by hand and only its text encoder and VAE come from here.
PACKS = [
    {"id": "moss", "name": "MOSS-Image", "about": "Images, with Quality, Turbo and Rapid modes. Rapid also needs the rapid-moss custom node.",
     "files": [*MOSS.values(), TURBO_LORA, *RAPID_FILES]},
    {"id": "krea2", "name": "Kroma", "about": "Images from lodestones' Krea 2 fine-tune, in 8 steps.", "files": list(KREA2.values()),
     "manual": {"url": "https://civitai.com/models/2997793", "file": "kromaKrea2_opd.safetensors", "folder": "models/diffusion_models"}},
    {"id": "video", "name": "MiniMax H3", "about": "Videos with sound, from a prompt or a start image.", "files": list(H3.values())},
]

routes = PromptServer.instance.routes


def jxl_box(kind, payload):
    return (len(payload) + 8).to_bytes(4, "big") + kind + payload


# SaveImage that also stores the prompt Enhance prompt wrote, as an extra_pnginfo entry next to the
# workflow, so the viewer's Info can show it. The workflow alone only holds the prompt that was typed.
class SaveImageEnhanced(SaveImage):
    DESCRIPTION = "Saves the input images to your ComfyUI output directory, with the enhanced prompt in the metadata."

    @classmethod
    def INPUT_TYPES(s):
        types = SaveImage.INPUT_TYPES()
        types["optional"] = {"enhanced_prompt": ("STRING", {"forceInput": True})}
        return types

    def save_images(self, images, filename_prefix="ComfyUI", prompt=None, extra_pnginfo=None, enhanced_prompt=None):
        return super().save_images(images, filename_prefix, prompt, with_enhanced(extra_pnginfo, enhanced_prompt))


def with_enhanced(extra_pnginfo, enhanced_prompt):
    return {**(extra_pnginfo or {}), "enhanced_prompt": enhanced_prompt} if enhanced_prompt else extra_pnginfo


# SaveImage's twin for JPEG XL. The workflow goes into Exif the way ComfyUI writes WebP ("prompt:"
# in the Model tag, other extra_pnginfo keys counting down from Make) so Reuse settings can read it.
class SaveImageJXL(SaveImage):
    DESCRIPTION = "Saves the input images to your ComfyUI output directory as JPEG XL."

    @classmethod
    def INPUT_TYPES(s):
        types = SaveImageEnhanced.INPUT_TYPES()
        types["required"]["lossless"] = ("BOOLEAN", {"default": True})
        return types

    def save_images(self, images, filename_prefix="ComfyUI", lossless=True, prompt=None, extra_pnginfo=None, enhanced_prompt=None):
        extra_pnginfo = with_enhanced(extra_pnginfo, enhanced_prompt)
        full_output_folder, filename, counter, subfolder, filename_prefix = folder_paths.get_save_image_path(filename_prefix, self.output_dir, images[0].shape[1], images[0].shape[0])
        exif = Image.Exif()
        if not args.disable_metadata:
            if prompt is not None:
                exif[0x0110] = "prompt:" + json.dumps(prompt)
            for tag, key in zip(range(0x010F, 0, -1), extra_pnginfo or {}):
                exif[tag] = f"{key}:{json.dumps(extra_pnginfo[key])}"
        results = []
        for batch_number, image in enumerate(images):
            img = Image.fromarray(np.clip(255. * image.cpu().numpy(), 0, 255).astype(np.uint8))
            file = f"{filename.replace('%batch_num%', str(batch_number))}_{counter:05}_.jxl"
            # Quality 90 is libjxl's distance 1, its "visually lossless" target.
            buf = BytesIO()
            img.save(buf, "JXL", lossless=lossless, quality=90, effort=7)
            data = buf.getvalue()
            # libjxl splits the codestream into jxlp boxes around metadata, which Safari can't decode,
            # so the container is built here with Exif ahead of one jxlc box.
            if exif:
                data = b"".join(jxl_box(t, p) for t, p in ((b"JXL ", b"\r\n\x87\n"), (b"ftyp", b"jxl \0\0\0\0jxl "),
                                                         (b"Exif", b"\0\0\0\0" + exif.tobytes()[6:]), (b"jxlc", data)))
            with open(os.path.join(full_output_folder, file), "wb") as f:
                f.write(data)
            results.append({"filename": file, "subfolder": subfolder, "type": self.type})
            counter += 1
        return {"ui": {"images": results}, "result": (images,)}


# Video encoders: the graphics card's own (NVIDIA NVENC, AMD AMF) or x264/x265 on the CPU. The GPU
# ones run at constant quality near the CPU encoder's CRF; the CPU's files come out smallest.
# x264 at CRF 18 is what ComfyUI's SaveVideo uses.
VIDEO_ENCODERS = {
    "h264": {
        "nvidia": ("h264_nvenc", {"preset": "p5", "tune": "hq", "rc": "vbr", "cq": "19", "b": "0"}),
        "amd": ("h264_amf", {"usage": "transcoding", "quality": "quality", "rc": "cqp", "qp_i": "18", "qp_p": "20"}),
        "software": ("libx264", {"crf": "18", "preset": "medium"}),
    },
    "hevc": {
        "nvidia": ("hevc_nvenc", {"preset": "p5", "tune": "hq", "rc": "vbr", "cq": "22", "b": "0"}),
        "amd": ("hevc_amf", {"usage": "transcoding", "quality": "quality", "rc": "cqp", "qp_i": "20", "qp_p": "22"}),
        "software": ("libx265", {"crf": "20", "preset": "medium", "x265-params": "log-level=error"}),
    },
}
working_encoders = None


def encoder_opens(codec, encoder, width, height):
    name, options = VIDEO_ENCODERS[codec][encoder]
    try:
        ctx = av.CodecContext.create(name, "w")
        ctx.width, ctx.height, ctx.pix_fmt, ctx.time_base, ctx.framerate = width, height, "yuv420p", Fraction(1, 24), Fraction(24)
        ctx.options = options
        ctx.open()
        return True
    except av.FFmpegError:
        return False


# FFmpeg builds list the NVENC and AMF encoders whatever the graphics card, so each encoder is tried
# once to see which ones this PC can actually run.
def working_video_encoders():
    global working_encoders
    if working_encoders is None:
        working_encoders = {codec: [e for e in encoders if encoder_opens(codec, e, 1024, 576)] for codec, encoders in VIDEO_ENCODERS.items()}
    return working_encoders


# SaveVideo's twin with a choice of encoder. H.265 is tagged hvc1 so Safari plays it. Audio,
# metadata and color tags are written the way SaveVideo writes them.
class SaveVideoMP4:
    DESCRIPTION = "Saves the input video to your ComfyUI output directory as H.264 or H.265 (MP4), encoded on the graphics card or the CPU."
    RETURN_TYPES = ()
    FUNCTION = "save_video"
    OUTPUT_NODE = True
    CATEGORY = "image/video"

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {"video": ("VIDEO",), "filename_prefix": ("STRING", {"default": "video/ComfyUI"}), "codec": (list(VIDEO_ENCODERS),), "encoder": (["nvidia", "amd", "software"],)},
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    def save_video(self, video, filename_prefix, codec, encoder, prompt=None, extra_pnginfo=None):
        c = video.get_components()
        height, width = c.images.shape[1:3]
        # AMD's H.265 encoder won't open below 384 px wide (Studio's smallest portrait videos), so
        # those go to the CPU instead.
        if not encoder_opens(codec, encoder, width, height):
            encoder = "software"
        name, options = VIDEO_ENCODERS[codec][encoder]
        full_output_folder, filename, counter, subfolder, _ = folder_paths.get_save_image_path(filename_prefix, folder_paths.get_output_directory(), width, height)
        file = f"{filename}_{counter:05}_.mp4"
        with av.open(os.path.join(full_output_folder, file), "w", format="mp4", options={"movflags": "use_metadata_tags+faststart"}) as out:
            if not args.disable_metadata:
                for key, value in {**(extra_pnginfo or {}), **({"prompt": prompt} if prompt is not None else {})}.items():
                    out.metadata[key] = json.dumps(value)
            # Info shows the encoder that actually ran, which can differ from the one asked for.
            out.metadata["video_encoder"] = name
            frame_rate = Fraction(round(c.frame_rate * 1000), 1000)
            stream = out.add_stream(name, rate=frame_rate)
            stream.width, stream.height, stream.pix_fmt = width, height, "yuv420p"
            stream.options = options
            if codec == "hevc":
                stream.codec_context.codec_tag = "hvc1"
            set_video_color_properties(stream.codec_context, "sRGB")
            if c.audio:
                sample_rate = int(c.audio["sample_rate"])
                waveform = c.audio["waveform"][0, :, :math.ceil(sample_rate / frame_rate * c.images.shape[0])]
                layout = {1: "mono", 2: "stereo", 6: "5.1"}.get(waveform.shape[0], "stereo")
                audio = out.add_stream("aac", rate=sample_rate, layout=layout)
            for image in c.images:
                frame = av.VideoFrame.from_ndarray((image * 255).clamp(0, 255).byte().cpu().numpy(), format="rgb24")
                frame = frame.reformat(format="yuv420p", dst_colorspace=BT709_NCL)
                set_video_color_properties(frame, "sRGB")
                out.mux(stream.encode(frame))
            out.mux(stream.encode(None))
            if c.audio:
                frame = av.AudioFrame.from_ndarray(waveform.float().cpu().contiguous().numpy(), format="fltp", layout=layout)
                frame.sample_rate, frame.pts = sample_rate, 0
                out.mux(audio.encode(frame))
                out.mux(audio.encode(None))
        return {"ui": {"images": [{"filename": file, "subfolder": subfolder, "type": "output"}], "animated": (True,)}}


NODE_CLASS_MAPPINGS = {"ApocladaSaveImage": SaveImageEnhanced, "ApocladaSaveVideo": SaveVideoMP4, **({"ApocladaSaveImageJXL": SaveImageJXL} if pillow_jxl else {})}
NODE_DISPLAY_NAME_MAPPINGS = {"ApocladaSaveImage": "Save Image (with enhanced prompt)", "ApocladaSaveImageJXL": "Save Image (JPEG XL)", "ApocladaSaveVideo": "Save Video (GPU or CPU)"}

# Studio-wide choices from the Setup screen, kept in ComfyUI's user folder so every device shares them.
PREFS_FILE = os.path.join(folder_paths.get_user_directory(), "apoclada_studio.json")
PREF_DEFAULTS = {"image_format": "png", "jxl_lossless": True, "video_codec": "h264", "video_encoder": None}


def load_prefs():
    try:
        with open(PREFS_FILE, encoding="utf-8") as f:
            saved = json.load(f)
    except FileNotFoundError:
        saved = {}
    return {key: saved.get(key, default) for key, default in PREF_DEFAULTS.items()}


# Besides the saved choices, the page gets what this PC can do. The encoder falls back to the first
# one that works for the codec (the GPU's, if any) when none was picked or the picked one can't run.
async def prefs_response(prefs):
    encoders = await asyncio.to_thread(working_video_encoders)
    codec_encoders = encoders[prefs["video_codec"]]
    encoder = prefs["video_encoder"] if prefs["video_encoder"] in codec_encoders else next(iter(codec_encoders), None)
    return web.json_response({**prefs, "video_encoder": encoder, "jxl_available": pillow_jxl is not None, "video_encoders": encoders})


@routes.get("/studio/prefs")
async def studio_prefs(request):
    return await prefs_response(load_prefs())


@routes.post("/studio/prefs")
async def studio_prefs_save(request):
    data = await request.json()
    prefs = load_prefs()
    if data.get("image_format") in ("png", "jxl"):
        prefs["image_format"] = data["image_format"]
    if isinstance(data.get("jxl_lossless"), bool):
        prefs["jxl_lossless"] = data["jxl_lossless"]
    if data.get("video_codec") in VIDEO_ENCODERS:
        prefs["video_codec"] = data["video_codec"]
    if data.get("video_encoder") in VIDEO_ENCODERS["h264"]:
        prefs["video_encoder"] = data["video_encoder"]
    with open(PREFS_FILE, "w", encoding="utf-8") as f:
        json.dump(prefs, f)
    return await prefs_response(prefs)


def have(name):
    return os.path.normpath(name) in folder_paths.get_filename_list(FILES[name][0])


def krea2_models():
    return [f for f in folder_paths.get_filename_list("diffusion_models") if "krea2" in f.lower() or "kroma" in f.lower()]


# Windows' proactor loop logs a full traceback whenever a client drops a connection without
# closing it, which Safari does constantly when the iPad sleeps or the tab is backgrounded.
def ignore_client_resets(loop, context):
    if not isinstance(context.get("exception"), ConnectionResetError):
        loop.default_exception_handler(context)


PromptServer.instance.loop.set_exception_handler(ignore_client_resets)


# ComfyUI sends a job's progress, previews and results only to the browser that queued it. Copying
# them to every other Apoclada Studio page (client ids starting "moss-") lets the iPad follow a job
# started on the PC, and the other way round. ComfyUI's own editor tabs get nothing extra.
STUDIO_CLIENT_PREFIX = "moss-"


def copy_to_studio_clients(send):
    async def send_and_copy(event, data, sid=None):
        await send(event, data, sid)
        if sid is not None:
            for other in [s for s in PromptServer.instance.sockets if s != sid and s.startswith(STUDIO_CLIENT_PREFIX)]:
                await send(event, data, other)
    return send_and_copy


PromptServer.instance.send_json = copy_to_studio_clients(PromptServer.instance.send_json)
PromptServer.instance.send_bytes = copy_to_studio_clients(PromptServer.instance.send_bytes)


def output_file(subfolder, filename):
    output_dir = os.path.abspath(folder_paths.get_output_directory())
    path = os.path.abspath(os.path.join(output_dir, subfolder, filename))
    if os.path.commonpath((path, output_dir)) != output_dir or os.path.splitext(path)[1].lower() not in IMAGE_EXTS | VIDEO_EXTS:
        raise web.HTTPForbidden()
    if not os.path.isfile(path):
        raise web.HTTPNotFound()
    return path


@routes.get("/studio")
async def studio_index(request):
    return web.FileResponse(os.path.join(WEB_ROOT, "index.html"), headers={"Cache-Control": "no-cache"})


routes.static("/studio/assets", WEB_ROOT)


@routes.get("/studio/models")
async def studio_models(request):
    models = []
    if all(have(f) for f in MOSS.values()):
        models.append({"name": os.path.splitext(MOSS["unet"])[0], "family": "moss", **MOSS})
    if all(have(f) for f in KREA2.values()):
        models += [{"name": os.path.splitext(unet)[0], "family": "krea2", "unet": unet, **KREA2} for unet in krea2_models()]
    return web.json_response(models)


# Rapid mode needs the rapid-moss custom node as well as its adapter files.
@routes.get("/studio/turbo")
async def studio_turbo(request):
    rapid = "RapidMOSSAdapter" in NODE_CLASSES and all(have(f) for f in RAPID_FILES)
    return web.json_response({"lora": TURBO_LORA if have(TURBO_LORA) else None, "rapid": RAPID_ADAPTER if rapid else None})


# Video mode is offered only when every H3 file is present; the turbo LoRA is optional.
@routes.get("/studio/video")
async def studio_video(request):
    files = {key: name if have(name) else None for key, name in H3.items()}
    if not all(files[k] for k in ("unet", "clip", "vae", "audio_vae")):
        return web.json_response(None)
    return web.json_response(files)


# One pack downloads at a time, file by file, into a .part file next to its final name. A stopped
# or failed download resumes where it left off when it's started again.
download = None


def pack_status(pack):
    missing = [f for f in pack["files"] if not have(f)]
    manual = pack.get("manual")
    return {
        "id": pack["id"], "name": pack["name"], "about": pack["about"],
        "manual": manual and {**manual, "found": bool(krea2_models())},
        "size": sum(FILES[f][2] for f in pack["files"]),
        "missing": sum(FILES[f][2] for f in missing),
        "installed": not missing and (not manual or bool(krea2_models())),
    }


def model_path(name):
    folder = FILES[name][0]
    paths = folder_paths.get_folder_paths(folder)
    return os.path.join(next((p for p in paths if os.path.basename(p) == folder), paths[0]), name)


async def download_pack(pack):
    names = [f for f in pack["files"] if not have(f)]
    download.update(total=sum(FILES[f][2] for f in names), done=0)
    finished = 0
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(sock_connect=30, sock_read=60)) as session:
        for name in names:
            _, url, size = FILES[name]
            path = model_path(name)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            part = path + ".part"
            start = os.path.getsize(part) if os.path.exists(part) else 0
            download.update(file=name, done=finished + start)
            if start < size:
                async with session.get(url, headers={"Range": f"bytes={start}-"} if start else {}) as res:
                    res.raise_for_status()
                    with open(part, "ab" if res.status == 206 else "wb") as f:
                        async for chunk in res.content.iter_chunked(1 << 22):
                            f.write(chunk)
                            download["done"] = finished + f.tell()
            if os.path.getsize(part) != size:
                raise RuntimeError(f"{name} came out at the wrong size; try again")
            os.replace(part, path)
            finished += size


async def run_download(pack):
    global download
    try:
        await download_pack(pack)
        download = None
    except asyncio.CancelledError:
        download = None
    except Exception as e:
        download.update(error=str(e) or type(e).__name__, task=None)


@routes.get("/studio/setup")
async def studio_setup(request):
    state = download and {k: v for k, v in download.items() if k != "task"}
    return web.json_response({"packs": [pack_status(p) for p in PACKS], "download": state})


@routes.post("/studio/setup/download")
async def studio_setup_download(request):
    global download
    if download and download.get("task"):
        return web.json_response({"error": "Another download is running"}, status=409)
    pack_id = (await request.json()).get("pack")
    pack = next((p for p in PACKS if p["id"] == pack_id), None)
    if not pack:
        raise web.HTTPNotFound()
    download = {"pack": pack["id"], "file": None, "done": 0, "total": 0, "error": None}
    download["task"] = asyncio.create_task(run_download(pack))
    return web.json_response({"started": pack["id"]})


@routes.post("/studio/setup/cancel")
async def studio_setup_cancel(request):
    global download
    if download and download.get("task"):
        download["task"].cancel()
    download = None
    return web.json_response({"cancelled": True})


# Updates come from the git remote this folder was cloned from. The fetch result is kept for an
# hour so opening the page doesn't hit the network every time.
update_check = {"time": 0, "behind": 0}


async def git(*command):
    try:
        proc = await asyncio.create_subprocess_exec("git", *command, cwd=PLUGIN_DIR, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    except FileNotFoundError:
        return 1, "Git isn't installed"
    out, _ = await proc.communicate()
    return proc.returncode, out.decode(errors="replace").strip()


def version_tuple(version):
    return tuple(int(p) for p in version.split(".")[:3] if p.isdigit())


@routes.get("/studio/update")
async def studio_update_check(request):
    _, version = await git("log", "-1", "--format=%h · %cs")
    code, upstream = await git("rev-parse", "--abbrev-ref", "@{upstream}")
    if code == 0 and (request.rel_url.query.get("check") or time.time() - update_check["time"] > 3600):
        if (await git("fetch", "--quiet"))[0] == 0:
            _, behind = await git("rev-list", "--count", "HEAD..@{upstream}")
            update_check.update(time=time.time(), behind=int(behind or 0))
    return web.json_response({
        "version": version if version and "fatal" not in version else None,
        "source": upstream if code == 0 else None,
        "behind": update_check["behind"] if code == 0 else 0,
        "comfyui": COMFYUI_VERSION, "comfyui_min": COMFYUI_MIN,
        "comfyui_ok": version_tuple(COMFYUI_VERSION) >= version_tuple(COMFYUI_MIN),
    })


@routes.post("/studio/update")
async def studio_update(request):
    code, out = await git("pull", "--ff-only")
    if code != 0:
        return web.json_response({"error": out}, status=500)
    update_check["behind"] = 0
    restart()
    return web.json_response({"updated": out})


def is_video(path):
    return os.path.splitext(path)[1].lower() in VIDEO_EXTS


@routes.get("/studio/images")
async def studio_images(request):
    output_dir = folder_paths.get_output_directory()
    images = []
    for dirpath, _, files in os.walk(output_dir):
        subfolder = os.path.relpath(dirpath, output_dir).replace(os.sep, "/")
        for filename in files:
            if os.path.splitext(filename)[1].lower() in IMAGE_EXTS | VIDEO_EXTS:
                images.append({
                    "filename": filename,
                    "subfolder": "" if subfolder == "." else subfolder,
                    "mtime": os.path.getmtime(os.path.join(dirpath, filename)),
                    "video": is_video(filename),
                })
    images.sort(key=lambda i: i["mtime"], reverse=True)
    return web.json_response(images)


def first_frame(path):
    with av.open(path) as container:
        return next(container.decode(video=0)).to_image()


@routes.get("/studio/images/thumb")
async def studio_image_thumb(request):
    path = output_file(request.rel_url.query.get("subfolder", ""), request.rel_url.query.get("filename", ""))
    with (first_frame(path) if is_video(path) else Image.open(path)) as img:
        img.thumbnail((384, 384))
        buffer = BytesIO()
        img.convert("RGB").save(buffer, format="webp", quality=60)
    return web.Response(body=buffer.getvalue(), content_type="image/webp", headers={"Cache-Control": "max-age=86400"})


# A PNG copy of a saved image, for browsers that can't show JPEG XL and for Animate, whose start
# image has to load in the browser and in ComfyUI's LoadImage.
@routes.get("/studio/images/png")
async def studio_image_png(request):
    path = output_file(request.rel_url.query.get("subfolder", ""), request.rel_url.query.get("filename", ""))
    with Image.open(path) as img:
        buffer = BytesIO()
        img.save(buffer, format="png", compress_level=1)
    return web.Response(body=buffer.getvalue(), content_type="image/png", headers={"Cache-Control": "max-age=86400"})


@routes.get("/studio/images/info")
async def studio_image_info(request):
    path = output_file(request.rel_url.query.get("subfolder", ""), request.rel_url.query.get("filename", ""))
    if is_video(path):
        with av.open(path) as container:
            prompt = container.metadata.get("prompt")
            stream = container.streams.video[0]
            width, height = stream.width, stream.height
            audio = container.streams.audio[0].codec_context if container.streams.audio else None
            encoding = {"format": stream.codec_context.name, "encoder": container.metadata.get("video_encoder"),
                        "audio": audio and {"format": audio.name, "sample_rate": audio.sample_rate, "channels": audio.layout.nb_channels}}
        enhanced = None
    else:
        with Image.open(path) as img:
            prompt = img.info.get("prompt")
            enhanced = img.info.get("enhanced_prompt")
            width, height = img.size
            encoding = {"format": img.format}
            if prompt is None:
                # JPEG XL keeps them in Exif: the workflow in Model, extra_pnginfo counting down from Make.
                exif = img.getexif()
                tags = {v.split(":", 1)[0]: v.split(":", 1)[1] for t in range(0x0110, 0, -1) if isinstance(v := exif.get(t), str) and ":" in v}
                prompt, enhanced = tags.get("prompt"), tags.get("enhanced_prompt")
    return web.json_response({"prompt": json.loads(prompt) if prompt else None, "enhanced_prompt": json.loads(enhanced) if enhanced else None,
                              "width": width, "height": height, "encoding": encoding, "bytes": os.path.getsize(path)})


# "Show in folder" opens Explorer on the PC, so it's only offered to a browser on the PC itself,
# whether it opened the site through localhost or one of the PC's network addresses.
@routes.get("/studio/host")
async def studio_host(request):
    addresses = {"127.0.0.1", "::1", *(info[4][0] for info in socket.getaddrinfo(socket.gethostname(), None))}
    return web.json_response({"host": request.remote in addresses})


# Opens an Explorer window on the PC (not on the device asking) with the file selected.
@routes.post("/studio/images/reveal")
async def studio_image_reveal(request):
    data = await request.json()
    path = output_file(data.get("subfolder", ""), data.get("filename", ""))
    subprocess.Popen(["explorer", f"/select,{path}"])
    return web.json_response({"revealed": data.get("filename")})


# Force stop: /interrupt is only checked between GPU operations, and on a large video a single
# operation can run for minutes. Exiting the process stops the GPU at once. A small helper in a new
# console waits for the port to free up, then starts ComfyUI again with the same command line.
RESTART_HELPER = """
import socket, subprocess, sys, time
while True:
    try:
        socket.create_connection(("127.0.0.1", int(sys.argv[1])), 1).close()
        time.sleep(0.5)
    except OSError:
        break
subprocess.call(sys.argv[2:])
"""


def restart():
    subprocess.Popen([sys.executable, "-I", "-c", RESTART_HELPER, str(args.port), sys.executable, *sys.argv],
                     cwd=os.getcwd(), creationflags=subprocess.CREATE_NEW_CONSOLE)
    PromptServer.instance.loop.call_later(0.5, os._exit, 0)


@routes.post("/studio/restart")
async def studio_restart(request):
    restart()
    return web.json_response({"restarting": True})


@routes.post("/studio/images/delete")
async def studio_image_delete(request):
    data = await request.json()
    os.remove(output_file(data.get("subfolder", ""), data.get("filename", "")))
    return web.json_response({"deleted": data.get("filename")})
