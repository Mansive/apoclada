import { $, el, getJson, post, toast, loadModels } from "./app.js";

// Setup's file format, shared by every device through the PC; generate() refreshes it before each image.
export let prefs = { image_format: "png", jxl_lossless: true, jxl_available: false, video_codec: "h264", video_encoder: null, video_encoders: { h264: [], hevc: [] }, video_jxl: false, video_jxl_available: false };
export async function refreshPrefs() { prefs = await getJson("/studio/prefs", prefs); }

let setupTimer = null;
let downloading = false;

function gb(bytes) { return `${(bytes / 1e9).toFixed(1)} GB`; }

// Polls while a download runs, on any tab, so new models show up in Create as soon as they land.
export async function loadSetup() {
  const setup = await getJson("/studio/setup");
  // Cleared after the wait, so overlapping calls leave one poll running rather than one each.
  clearTimeout(setupTimer);
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
    : [p.missing && `${gb(p.missing)} to download`, p.manual && !p.manual.found && "Civitai model needed"].filter(Boolean).join(" · ");
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
  const res = await post(`/studio/setup/${action}`, { pack }).catch(() => null);
  if (!res) toast("Can't reach the PC");
  else if (!res.ok) toast((await res.json().catch(() => ({}))).error || "That didn't work");
  if (res?.ok && action === "download") downloading = true;
  loadSetup();
}

// Sizes are from a 1 MP MOSS image: PNG 1.4 MB, lossless JPEG XL 0.9 MB, lossy (quality 95) 0.23 MB.
export async function loadPrefs(change) {
  const p = await (change ? post("/studio/prefs", change) : fetch("/studio/prefs")).then((r) => r.json()).catch(() => null);
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
  const jxl = p.image_format === "jxl";
  $("image-format").replaceChildren(...[
    group(
      radio("PNG", "Works everywhere", !jxl, { image_format: "png" }),
      radio("JPEG XL", "Smaller files", jxl, { image_format: "jxl" }, !p.jxl_available)),
    jxl && group(
      radio("Lossless", "About 65% of PNG", p.jxl_lossless, { jxl_lossless: true }),
      radio("Lossy", "About 15% of PNG", !p.jxl_lossless, { jxl_lossless: false })),
    el("span", { className: "note", textContent: !jxl
      ? "PNG opens in every app and browser. A 1 MP image is about 1.4 MB."
      : p.jxl_lossless
        ? "Lossless keeps every pixel exactly as PNG would."
        : "Lossy looks the same as PNG at normal viewing, but isn't pixel-identical: very fine detail shifts slightly." }),
    jxl && el("span", { className: "note", textContent: "Safari and Chrome 155 or newer show JPEG XL; other browsers here see a PNG copy. Many apps outside the browser can't open .jxl files yet." }),
    el("span", { className: "note", textContent: "Applies to new images from every device. Existing images keep their format." }),
    !p.jxl_available && el("span", { className: "note", textContent: "JPEG XL needs the pillow-jxl-plugin Python package on the PC." }),
    !p.jxl_available && el("div", { className: "actions-row" },
      el("button", { type: "button", className: "ghost", textContent: "Install and restart", onclick: installRequirements })),
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
    p.video_jxl_available && group(
      radio("MP4 only", "Smallest", !p.video_jxl, { video_jxl: false }),
      radio("Lossless copy", "Plus JPEG XL", p.video_jxl, { video_jxl: true })),
    p.video_jxl && el("span", { className: "note", textContent: "Each video also gets every frame exactly as decoded, in an animated JPEG XL beside the MP4 and many times its size. The gallery shows only the MP4, and deleting it deletes the copy too." }),
    el("span", { className: "note", textContent: "Applies to new videos from every device. Existing videos keep their format." }),
  ].filter(Boolean));
}

export async function loadUpdates(check) {
  const u = await getJson(`/studio/update${check ? "?check=1" : ""}`);
  if (!u) return;
  document.querySelector(".tabs [data-tab=setup]").classList.toggle("badge", u.behind > 0 || !u.comfyui_ok);
  const status = !u.source
    ? "Updates aren't set up: this copy has no git source to update from."
    : u.behind ? `An update is available (${u.behind} change${u.behind === 1 ? "" : "s"}).` : "Up to date.";
  const button = u.source && (u.behind
    ? el("button", { type: "button", className: "ghost", textContent: "Update and restart", onclick: runUpdate })
    : el("button", { type: "button", className: "ghost", textContent: "Check now", onclick: () => loadUpdates(true) }));
  $("updates").replaceChildren(...[
    el("span", {}, `Apoclada ${u.version || ""}`.trim(), el("br"), el("span", { className: "note", textContent: status })),
    el("span", {}, `ComfyUI ${u.comfyui}`),
    !u.comfyui_ok && el("span", { className: "warn", textContent: `Apoclada needs ComfyUI ${u.comfyui_min} or newer. Update ComfyUI before generating.` }),
    button && el("div", { className: "actions-row" }, button),
  ].filter(Boolean));
}

function runUpdate() {
  if (confirm("Updating restarts ComfyUI on the PC. Anything generating now is lost.")) restartWith("/studio/update", "Updated", "The update failed");
}

async function installRequirements(e) {
  if (!confirm("Installing restarts ComfyUI on the PC. Anything generating now is lost.")) return;
  const button = e.currentTarget;
  button.disabled = true;
  button.textContent = "Installing…";
  if (!(await restartWith("/studio/requirements", "Installed", "The install failed"))) {
    button.disabled = false;
    button.textContent = "Install and restart";
  }
}

// The page reloads once the restarted server answers, picking up what changed.
async function restartWith(url, done, failed) {
  const res = await fetch(url, { method: "POST" }).catch(() => null);
  if (!res) { toast("Can't reach the PC"); return false; }
  if (!res.ok) { toast(((await res.json().catch(() => ({}))).error || failed).split("\n")[0]); return false; }
  toast(`${done}. Restarting ComfyUI…`);
  await new Promise((r) => setTimeout(r, 4000));
  while (!(await fetch("/queue").then((r) => r.ok).catch(() => false))) await new Promise((r) => setTimeout(r, 2000));
  location.reload();
  return true;
}
