const $ = (id) => document.getElementById(id);
const STORE_KEY = "music-studio:jobs";
const POLL_MS = 5000;
const MAX_POLL_MS = 15 * 60 * 1000;

const STATUS_TEXT = {
  SUBMITTING: "Sending request…",
  PENDING: "Queued — warming up the band…",
  TEXT_SUCCESS: "Lyrics written, composing music…",
  FIRST_SUCCESS: "First track ready, finishing the second…",
  SUCCESS: "Ready",
  CREATE_TASK_FAILED: "Failed to start",
  GENERATE_AUDIO_FAILED: "Audio generation failed",
  CALLBACK_EXCEPTION: "Generation error",
  SENSITIVE_WORD_ERROR: "Blocked: prompt contains restricted words",
  TIMEOUT: "Timed out — try refreshing later",
};

const IDEAS = [
  "A cozy lo-fi beat for studying on a rainy night",
  "An epic orchestral anthem for a hero's return",
  "A funky disco track about dancing until sunrise",
  "A heartfelt acoustic ballad about moving to a new city",
  "A hard-hitting trap song about chasing dreams",
];
const STYLES = ["pop", "lo-fi", "hip hop", "rock", "edm", "jazz", "r&b", "country", "cinematic", "synthwave", "acoustic", "afrobeats"];

let mode = "simple";
let jobs = load();
const timers = new Map();

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
    $("credits").textContent = `${Number(credits).toLocaleString()} credits`;
  } catch {
    $("credits").textContent = "credits unavailable";
  }
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

function bindRange(id, outId, fmt) {
  const update = () => ($(outId).textContent = fmt(Number($(id).value)));
  $(id).addEventListener("input", update);
  update();
}

function readForm() {
  const instrumental = $("instrumental").checked;
  const base = { customMode: mode === "custom", instrumental, model: $("model").value, style: $("style").value };
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
  if (payload.customMode) return payload.title || payload.style || "Custom song";
  return payload.prompt || payload.style || "New song";
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
  btn.querySelector(".btn-label").textContent = "Starting…";

  try {
    const { taskId } = await api("generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const job = {
      taskId,
      label: describe(payload).slice(0, 140),
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
    btn.querySelector(".btn-label").textContent = "Generate";
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
    // transient error: keep polling
    console.warn("poll failed", err);
  }
  if (isActive(job)) timers.set(job.taskId, setTimeout(() => poll(job), POLL_MS));
}

/* ---------- rendering ---------- */
function fmtTime(s) {
  if (!s && s !== 0) return "";
  s = Math.round(s);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function render() {
  const root = $("tracks");
  root.querySelectorAll(".job").forEach((n) => n.remove());
  $("empty").hidden = jobs.length > 0;
  $("clear").hidden = jobs.length === 0;

  for (const job of jobs) {
    const node = $("jobTpl").content.firstElementChild.cloneNode(true);
    node.classList.toggle("done", job.status === "SUCCESS");
    node.classList.toggle("failed", !!job.failed || job.status === "TIMEOUT");
    node.querySelector(".job-title").textContent = job.label;
    node.querySelector(".status-text").textContent =
      (job.failed && job.error) || STATUS_TEXT[job.status] || job.status;
    node.querySelector(".remove").addEventListener("click", () => {
      clearTimeout(timers.get(job.taskId));
      jobs = jobs.filter((j) => j !== job);
      save();
      render();
    });

    const list = node.querySelector(".job-tracks");
    const tracks = job.tracks.length ? job.tracks : isActive(job) ? [{}, {}] : [];
    for (const t of tracks) list.appendChild(renderTrack(t, job));
    root.appendChild(node);
  }
}

function renderTrack(t, job) {
  const node = $("trackTpl").content.firstElementChild.cloneNode(true);
  const src = t.audio || t.stream;
  const img = node.querySelector("img");
  if (t.image) img.src = t.image;
  node.querySelector(".track-title").textContent = t.title || (src ? "Untitled" : "Generating…");
  node.querySelector(".track-tags").textContent = t.tags || "";
  node.querySelector(".track-duration").textContent = fmtTime(t.duration);

  const dl = node.querySelector(".download");
  if (t.audio) {
    dl.href = t.audio;
    dl.setAttribute("download", `${(t.title || "track").replace(/[^\w\- ]+/g, "")}.mp3`);
  } else {
    dl.setAttribute("aria-disabled", "true");
    dl.textContent = src ? "Finalizing…" : "Download";
  }

  const lyricsBtn = node.querySelector(".lyrics-btn");
  const lyricsEl = node.querySelector(".track-lyrics");
  if (t.lyrics && !/^\s*$/.test(t.lyrics)) {
    lyricsEl.textContent = t.lyrics;
    lyricsBtn.addEventListener("click", () => (lyricsEl.hidden = !lyricsEl.hidden));
  } else {
    lyricsBtn.hidden = true;
  }

  if (!src) {
    node.classList.add("loading");
  } else {
    if ($("audio").dataset.id === t.id) node.classList.add("playing");
    node.querySelector(".art").addEventListener("click", () => play(t));
  }
  return node;
}

function play(t) {
  const audio = $("audio");
  const src = t.audio || t.stream;
  if (audio.dataset.id === t.id && !audio.paused) return audio.pause();
  if (audio.dataset.id !== t.id) {
    audio.src = src;
    audio.dataset.id = t.id;
  }
  $("player").hidden = false;
  if (t.image) $("playerArt").src = t.image;
  else $("playerArt").removeAttribute("src");
  $("playerTitle").textContent = t.title || "Untitled";
  $("playerTags").textContent = t.tags || "";
  audio.play().catch(() => {});
  document.querySelectorAll(".track.playing").forEach((n) => n.classList.remove("playing"));
  render();
}

/* ---------- init ---------- */
function chips(containerId, items, onPick) {
  const el = $(containerId);
  for (const text of items) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = text.length > 36 ? text.slice(0, 34) + "…" : text;
    b.title = text;
    b.addEventListener("click", () => onPick(text));
    el.appendChild(b);
  }
}

document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => setMode(t.dataset.mode)));
$("instrumental").addEventListener("change", syncInstrumental);
$("form").addEventListener("submit", onSubmit);
$("clear").addEventListener("click", () => {
  if (!confirm("Remove all tracks from your history?")) return;
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

bindRange("duration", "durationOut", (v) => (v < 10 ? "auto" : fmtTime(v)));
bindRange("styleWeight", "styleWeightOut", (v) => (v < 0 ? "default" : v.toFixed(2)));
bindRange("weirdness", "weirdnessOut", (v) => (v < 0 ? "default" : v.toFixed(2)));

setMode("simple");
syncInstrumental();
render();
jobs.filter(isActive).forEach(poll);
refreshCredits();
