const $ = (id) => document.getElementById(id);
const STORE_KEY = "music-studio:jobs";
const POLL_MS = 5000;
const MAX_POLL_MS = 15 * 60 * 1000;
const BARS = 72;

const STATUS_TEXT = {
  PENDING: "QUEUED",
  TEXT_SUCCESS: "WRITING ▸ COMPOSING",
  FIRST_SUCCESS: "CH1 READY ▸ RENDERING CH2",
  SUCCESS: "MASTERED",
  CREATE_TASK_FAILED: "FAILED TO START",
  GENERATE_AUDIO_FAILED: "RENDER FAILED",
  CALLBACK_EXCEPTION: "GENERATION ERROR",
  SENSITIVE_WORD_ERROR: "BLOCKED: RESTRICTED WORDS",
  TIMEOUT: "TIMED OUT",
};

const MODEL_HINT = {
  V6: "V6 — best quality, natural vocals",
  V6_WILD: "WILD — bolder, more experimental",
  V6_MINI: "MINI — fastest renders",
};

const IDEAS = [
  "cozy lo-fi beat for studying on a rainy night",
  "epic orchestral anthem for a hero's return",
  "funky disco track about dancing until sunrise",
  "heartfelt acoustic ballad about moving to a new city",
  "hard-hitting trap song about chasing dreams",
];
const STYLES = ["pop", "lo-fi", "hip hop", "rock", "edm", "jazz", "r&b", "country", "cinematic", "synthwave", "acoustic", "afrobeats"];

let mode = "simple";
let jobs = load();
let current = null; // track currently loaded in the transport
const timers = new Map();
const audio = $("audio");

/* ---------- storage ---------- */
function load() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || [];
  } catch {
    return [];
  }
}
function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify(jobs.slice(0, 50)));
}

/* ---------- API ---------- */
async function api(path, options) {
  const res = await fetch(`/api/${path}`, options);
  let data = {};
  try {
    data = await res.json();
  } catch {}
  if (!res.ok || data.error) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function refreshCredits() {
  try {
    const { credits } = await api("credits");
    $("credits").textContent = String(credits).padStart(4, "0");
  } catch {
    $("credits").textContent = "----";
  }
}

/* ---------- waveform ---------- */
function seeded(str) {
  let h = 2166136261;
  for (const c of String(str)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function buildWave(el, id) {
  const rnd = seeded(id || Math.random());
  const heights = [];
  let v = 0.5;
  for (let i = 0; i < BARS; i++) {
    v += (rnd() - 0.5) * 0.45;
    v = Math.min(1, Math.max(0.15, v));
    const env = Math.sin((Math.PI * (i + 1)) / (BARS + 1)) * 0.5 + 0.5;
    heights.push(Math.max(0.12, v * env));
  }
  const layer = (cls) => {
    const d = document.createElement("div");
    d.className = `bars ${cls}`;
    for (const h of heights) {
      const b = document.createElement("i");
      b.style.height = `${Math.round(h * 100)}%`;
      d.appendChild(b);
    }
    return d;
  };
  el.replaceChildren(layer("base"), layer("fill"));
}

/* ---------- form ---------- */
function setMode(next) {
  mode = next;
  document.querySelectorAll(".tab").forEach((t) => {
    const active = t.dataset.mode === mode;
    t.classList.toggle("active", active);
    t.setAttribute("aria-selected", active);
  });
  document.querySelectorAll(".simple-only").forEach((el) => (el.hidden = mode !== "simple"));
  document.querySelectorAll(".custom-only").forEach((el) => (el.hidden = mode !== "custom"));
}

function syncInstrumental() {
  const inst = $("instrumental").checked;
  document.querySelectorAll(".vocal-only").forEach((el) => (el.hidden = inst));
}

const selectedModel = () => document.querySelector('input[name="model"]:checked')?.value || "V6";
const syncModel = () => ($("modelHint").textContent = MODEL_HINT[selectedModel()]);

function bindRange(id, outId, fmt) {
  const update = () => ($(outId).textContent = fmt(Number($(id).value)));
  $(id).addEventListener("input", update);
  update();
}

function readForm() {
  const instrumental = $("instrumental").checked;
  const base = { customMode: mode === "custom", instrumental, model: selectedModel(), style: $("style").value };
  if (mode === "simple") return { ...base, prompt: $("prompt").value };
  const payload = {
    ...base,
    title: $("title").value,
    lyrics: instrumental ? "" : $("lyrics").value,
    negativeTags: $("negativeTags").value,
    variety: Number($("variety").value),
  };
  if (!instrumental && $("vocalGender").value) payload.vocalGender = $("vocalGender").value;
  const duration = Number($("duration").value);
  if (duration >= 10) payload.duration = duration;
  const sw = Number($("styleWeight").value);
  if (sw >= 0) payload.styleWeight = sw;
  const wd = Number($("weirdness").value);
  if (wd >= 0) payload.weirdnessConstraint = wd;
  return payload;
}

function describe(payload) {
  if (payload.customMode) return payload.title || payload.style || "Custom take";
  return payload.prompt || payload.style || "New take";
}

function showError(msg) {
  $("error").textContent = msg || "";
  $("error").hidden = !msg;
}

async function onSubmit(e) {
  e.preventDefault();
  showError("");
  const payload = readForm();

  if (payload.customMode) {
    if (!payload.style.trim() && !payload.lyrics?.trim() && !payload.negativeTags.trim()) {
      return showError("Add a style or some lyrics.");
    }
  } else if (!payload.prompt.trim() && !payload.style.trim()) {
    return showError("Describe the song you want.");
  }

  const btn = $("submit");
  btn.disabled = true;
  btn.querySelector(".btn-label").textContent = "ARMING…";

  try {
    const { taskId } = await api("generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const job = {
      taskId,
      label: describe(payload).slice(0, 140),
      model: payload.model,
      status: "PENDING",
      tracks: [],
      createdAt: Date.now(),
    };
    jobs.unshift(job);
    save();
    render();
    poll(job);
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.querySelector(".btn-label").textContent = "GENERATE";
  }
}

/* ---------- polling ---------- */
function isActive(job) {
  return !["SUCCESS", "TIMEOUT"].includes(job.status) && !job.failed;
}

async function poll(job) {
  clearTimeout(timers.get(job.taskId));
  if (!isActive(job)) return;
  if (Date.now() - job.createdAt > MAX_POLL_MS) {
    job.status = "TIMEOUT";
    save();
    return render();
  }
  try {
    const data = await api(`status?taskId=${encodeURIComponent(job.taskId)}`);
    job.status = data.status;
    job.failed = data.failed;
    job.error = data.error;
    if (data.tracks?.length) job.tracks = data.tracks;
    save();
    render();
    if (data.done) refreshCredits();
  } catch (err) {
    console.warn("poll failed", err); // transient: keep polling
  }
  if (isActive(job)) timers.set(job.taskId, setTimeout(() => poll(job), POLL_MS));
}

/* ---------- rendering ---------- */
function fmtTime(s) {
  if (!Number.isFinite(s)) return "0:00";
  s = Math.round(s);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function render() {
  const root = $("tracks");
  root.querySelectorAll(".take").forEach((n) => n.remove());
  $("empty").hidden = jobs.length > 0;
  $("clear").hidden = jobs.length === 0;
  $("takeCount").textContent = String(jobs.length).padStart(2, "0");
  $("rec").classList.toggle("on", jobs.some(isActive));

  jobs.forEach((job, i) => {
    const node = $("jobTpl").content.firstElementChild.cloneNode(true);
    const failed = !!job.failed || job.status === "TIMEOUT";
    node.classList.toggle("done", job.status === "SUCCESS");
    node.classList.toggle("failed", failed);
    node.querySelector(".take-no").textContent = `TAKE ${String(jobs.length - i).padStart(2, "0")}`;
    node.querySelector(".take-title").textContent = job.label;
    node.querySelector(".take-title").title = job.label;
    node.querySelector(".take-status").textContent =
      (failed && job.error) || STATUS_TEXT[job.status] || job.status;
    node.querySelector(".remove").addEventListener("click", () => {
      clearTimeout(timers.get(job.taskId));
      jobs = jobs.filter((j) => j !== job);
      save();
      render();
    });

    const list = node.querySelector(".take-tracks");
    const tracks = job.tracks.length ? job.tracks : isActive(job) ? [{}, {}] : [];
    tracks.forEach((t, n) => list.appendChild(renderTrack(t, n, job)));
    root.appendChild(node);
  });
  syncPlaying();
}

function renderTrack(t, n, job) {
  const node = $("trackTpl").content.firstElementChild.cloneNode(true);
  const src = t.audio || t.stream;
  node.dataset.id = t.id || "";
  if (t.image) node.querySelector("img").src = t.image;
  node.querySelector(".strip-ch").textContent = `CH${n + 1}`;
  node.querySelector(".strip-title").textContent = t.title || (src ? "Untitled" : "Rendering…");
  node.querySelector(".strip-dur").textContent = t.duration ? fmtTime(t.duration) : "--:--";
  node.querySelector(".strip-tags").textContent = t.tags || (src ? "" : job.label);

  const wave = node.querySelector(".wave");
  buildWave(wave, t.id || `${job.taskId}-${n}`);

  const dl = node.querySelector(".download");
  if (t.audio) {
    dl.href = t.audio;
    dl.setAttribute("download", `${(t.title || "track").replace(/[^\w\- ]+/g, "")}.mp3`);
  } else {
    dl.setAttribute("aria-disabled", "true");
    if (src) dl.textContent = "FINALIZING";
  }

  const lyricsBtn = node.querySelector(".lyrics-btn");
  const lyricsEl = node.querySelector(".strip-lyrics");
  if (t.lyrics && t.lyrics.trim()) {
    lyricsEl.textContent = t.lyrics;
    lyricsBtn.addEventListener("click", () => (lyricsEl.hidden = !lyricsEl.hidden));
  } else {
    lyricsBtn.hidden = true;
  }

  if (!src) {
    node.classList.add("loading");
    node.querySelector(".strip-icon").textContent = "◌";
  } else {
    node.querySelector(".strip-art").addEventListener("click", () => toggle(t));
    wave.addEventListener("click", (e) => {
      const ratio = (e.clientX - wave.getBoundingClientRect().left) / wave.clientWidth;
      if (current?.id !== t.id) loadTrack(t);
      seekTo(ratio);
      audio.play().catch(() => {});
    });
  }
  return node;
}

/* ---------- transport ---------- */
function loadTrack(t) {
  current = t;
  audio.src = t.audio || t.stream;
  $("player").hidden = false;
  if (t.image) $("playerArt").src = t.image;
  else $("playerArt").removeAttribute("src");
  $("playerTitle").textContent = t.title || "Untitled";
  $("playerTags").textContent = t.tags || "";
  buildWave($("tWave"), t.id);
  syncPlaying();
}

function toggle(t) {
  if (current?.id !== t.id) {
    loadTrack(t);
    return audio.play().catch(() => {});
  }
  audio.paused ? audio.play().catch(() => {}) : audio.pause();
}

function seekTo(ratio) {
  const go = () => {
    if (Number.isFinite(audio.duration)) audio.currentTime = Math.min(0.999, Math.max(0, ratio)) * audio.duration;
  };
  audio.readyState >= 1 ? go() : audio.addEventListener("loadedmetadata", go, { once: true });
}

function syncPlaying() {
  const playing = !!current && !audio.paused;
  document.querySelectorAll(".strip").forEach((s) => {
    const mine = !!current && s.dataset.id === current.id;
    s.classList.toggle("playing", mine);
    const icon = s.querySelector(".strip-icon");
    if (!s.classList.contains("loading")) icon.textContent = mine && playing ? "❚❚" : "▶";
  });
  $("tPlay").textContent = playing ? "❚❚" : "▶";
  $("vu").classList.toggle("live", playing);
  syncProgress();
}

function syncProgress() {
  const p = audio.duration ? `${(audio.currentTime / audio.duration) * 100}%` : "0%";
  $("tWave").style.setProperty("--p", p);
  $("tCur").textContent = fmtTime(audio.currentTime);
  $("tDur").textContent = fmtTime(audio.duration || current?.duration);
  document.querySelectorAll(".strip .wave").forEach((w) => {
    w.style.setProperty("--p", current && w.closest(".strip").dataset.id === current.id ? p : "0%");
  });
}

audio.addEventListener("timeupdate", syncProgress);
audio.addEventListener("loadedmetadata", syncProgress);
audio.addEventListener("play", syncPlaying);
audio.addEventListener("pause", syncPlaying);
audio.addEventListener("ended", syncPlaying);
$("tPlay").addEventListener("click", () => current && toggle(current));
$("tScrub").addEventListener("click", (e) => {
  const w = $("tScrub");
  seekTo((e.clientX - w.getBoundingClientRect().left) / w.clientWidth);
});
$("tVol").addEventListener("input", (e) => (audio.volume = Number(e.target.value)));
document.addEventListener("keydown", (e) => {
  if (e.code !== "Space" || !current || e.target.closest("input, textarea, select, button")) return;
  e.preventDefault();
  toggle(current);
});

/* ---------- init ---------- */
function chips(containerId, items, onPick) {
  const el = $(containerId);
  for (const text of items) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = text;
    b.title = text;
    b.addEventListener("click", () => onPick(text));
    el.appendChild(b);
  }
}

document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => setMode(t.dataset.mode)));
document.querySelectorAll('input[name="model"]').forEach((r) => r.addEventListener("change", syncModel));
$("instrumental").addEventListener("change", syncInstrumental);
$("form").addEventListener("submit", onSubmit);
$("clear").addEventListener("click", () => {
  if (!confirm("Remove all takes from your history?")) return;
  timers.forEach(clearTimeout);
  jobs = [];
  save();
  render();
});

chips("ideas", IDEAS, (text) => ($("prompt").value = text));
chips("styles", STYLES, (s) => {
  const cur = $("style").value.split(",").map((x) => x.trim()).filter(Boolean);
  if (!cur.includes(s)) cur.push(s);
  $("style").value = cur.join(", ");
});

bindRange("duration", "durationOut", (v) => (v < 10 ? "AUTO" : fmtTime(v)));
bindRange("styleWeight", "styleWeightOut", (v) => (v < 0 ? "DEF" : v.toFixed(2)));
bindRange("weirdness", "weirdnessOut", (v) => (v < 0 ? "DEF" : v.toFixed(2)));

setMode("simple");
syncInstrumental();
syncModel();
render();
jobs.filter(isActive).forEach(poll);
refreshCredits();
