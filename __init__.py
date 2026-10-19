"""Apoclada Studio: a touch-friendly image and video front end served by ComfyUI at /studio.

Generation goes through ComfyUI's own /prompt, /ws, /view and /interrupt APIs;
this module only adds the page itself plus gallery listing, metadata and delete.
"""
import json
import os
import subprocess
import sys
from io import BytesIO

import av
from aiohttp import web
from PIL import Image

import folder_paths
from comfy.cli_args import args
from server import PromptServer

NODE_CLASS_MAPPINGS = {}

WEB_ROOT = os.path.join(os.path.dirname(__file__), "web")
IMAGE_EXTS = {".png", ".webp", ".jpg", ".jpeg"}
VIDEO_EXTS = {".mp4", ".webm", ".mov"}
MOSS_MODELS_DIR = os.path.join(folder_paths.models_dir, "moss-image")
# lodestones/MOSS-Image-SFT-8-steps-dmd: 8-step, CFG-free distillation LoRA for MOSS-Image-SFT.
FAST_LORA = "moss-image-sft-8step-dmd.safetensors"
# Krea 2 and its fine-tunes (e.g. lodestones' Kroma) run on ComfyUI's native nodes with the
# text encoder and VAE from Comfy-Org/Krea-2.
KREA2_CLIP = "qwen3vl_4b_int8_convrot.safetensors"
KREA2_VAE = "qwen_image_vae.safetensors"
# Comfy-Org/MiniMax-H3 files used by the official text/image-to-video template.
H3_FILES = {
    "unet": ("diffusion_models", "minimax_h3_fl2va_pruned_int8_convrot.safetensors"),
    "clip": ("text_encoders", "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"),
    "vae": ("vae", "minimax_h3_video_vae_int8_convrot.safetensors"),
    "audio_vae": ("vae", "minimax_h3_audio_vae_fp32.safetensors"),
    "lora": ("loras", "minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors"),
}

routes = PromptServer.instance.routes


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
    if os.path.isdir(MOSS_MODELS_DIR):
        for name in sorted(os.listdir(MOSS_MODELS_DIR)):
            path = os.path.join(MOSS_MODELS_DIR, name)
            if os.path.isdir(os.path.join(path, "transformer")):
                models.append({"name": name, "path": path})
    # INT8 single-file transformers run on ComfyUI's native loader and borrow the text encoder
    # and VAE from a full model folder, preferring the SFT one they were made from.
    if models:
        base = next((m for m in models if "sft" in m["name"].lower()), models[0])
        int8 = [f for f in folder_paths.get_filename_list("diffusion_models") if "moss" in f.lower() and "int8" in f.lower()]
        for unet in int8:
            name = f"{base['name']} · INT8" if len(int8) == 1 else f"{base['name']} · {os.path.splitext(unet)[0]}"
            models.append({"name": name, "path": base["path"], "unet": unet})
    if KREA2_CLIP in folder_paths.get_filename_list("text_encoders") and KREA2_VAE in folder_paths.get_filename_list("vae"):
        for unet in folder_paths.get_filename_list("diffusion_models"):
            if "krea2" in unet.lower() or "kroma" in unet.lower():
                models.append({"name": os.path.splitext(unet)[0], "unet": unet, "family": "krea2", "clip": KREA2_CLIP, "vae": KREA2_VAE})
    return web.json_response(models)


@routes.get("/studio/fast")
async def studio_fast(request):
    return web.json_response({"lora": FAST_LORA if FAST_LORA in folder_paths.get_filename_list("loras") else None})


# Video mode is offered only when every H3 file is present; the turbo LoRA is optional.
@routes.get("/studio/video")
async def studio_video(request):
    files = {key: name if name in folder_paths.get_filename_list(folder) else None for key, (folder, name) in H3_FILES.items()}
    if not all(files[k] for k in ("unet", "clip", "vae", "audio_vae")):
        return web.json_response(None)
    return web.json_response(files)


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
        img.convert("RGB").save(buffer, format="webp", quality=75)
    return web.Response(body=buffer.getvalue(), content_type="image/webp", headers={"Cache-Control": "max-age=86400"})


@routes.get("/studio/images/info")
async def studio_image_info(request):
    path = output_file(request.rel_url.query.get("subfolder", ""), request.rel_url.query.get("filename", ""))
    if is_video(path):
        with av.open(path) as container:
            prompt = container.metadata.get("prompt")
            stream = container.streams.video[0]
            width, height = stream.width, stream.height
    else:
        with Image.open(path) as img:
            prompt = img.info.get("prompt")
            width, height = img.size
    return web.json_response({"prompt": json.loads(prompt) if prompt else None, "width": width, "height": height})


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


@routes.post("/studio/restart")
async def studio_restart(request):
    subprocess.Popen([sys.executable, "-I", "-c", RESTART_HELPER, str(args.port), sys.executable, *sys.argv],
                     cwd=os.getcwd(), creationflags=subprocess.CREATE_NEW_CONSOLE)
    PromptServer.instance.loop.call_later(0.5, os._exit, 0)
    return web.json_response({"restarting": True})


@routes.post("/studio/images/delete")
async def studio_image_delete(request):
    data = await request.json()
    os.remove(output_file(data.get("subfolder", ""), data.get("filename", "")))
    return web.json_response({"deleted": data.get("filename")})
