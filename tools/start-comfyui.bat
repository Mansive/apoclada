@echo off
rem Starts ComfyUI on an AMD card with ROCm and makes it reachable from other devices on the LAN.
rem Open http://<this PC's IP>:8188/studio from a phone or tablet.
rem It expects to be in ComfyUI\custom_nodes\apoclada_studio\tools, with ComfyUI's Python in ComfyUI\.venv.
cd /d "%~dp0..\..\.."
rem ComfyUI turns MIOpen off on RDNA3+, which makes VAE decodes slow and spill into shared memory.
rem FAST find mode skips MIOpen's slow kernel search. VAEs stay in ComfyUI's default bf16: with
rem MIOpen that's faster for Krea 2 and H3, and the only setup that stays steady after H3 videos.
set COMFYUI_ENABLE_MIOPEN=1
set MIOPEN_FIND_MODE=FAST
rem Comfy Kitchen's int8 attention: about 19% faster H3 steps and 6% faster Krea 2 steps.
".venv\Scripts\python.exe" main.py --listen 0.0.0.0 --port 8188 --use-ck-attention --preview-method latent2rgb %*