import { suno, json, errorMessage } from "../lib/suno.js";

const MODELS = ["V6", "V6_WILD", "V6_MINI"];
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let input;
  try {
    input = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const customMode = !!input.customMode;
  const instrumental = !!input.instrumental;
  const model = MODELS.includes(input.model) ? input.model : "V6";
  const siteUrl = process.env.URL || new URL(req.url).origin;

  const body = {
    customMode,
    instrumental,
    model,
    callBackUrl: `${siteUrl}/api/callback`,
  };

  if (customMode) {
    const title = str(input.title, 80);
    const style = str(input.style, 1000);
    const lyrics = instrumental ? "" : str(input.lyrics, 5000);
    const negativeTags = str(input.negativeTags, 1000);
    if (!style && !lyrics && !negativeTags) {
      return json({ error: "Custom mode needs at least a style, lyrics, or tags to avoid." }, 400);
    }
    if (title) body.title = title;
    if (style) body.style = style;
    if (lyrics) body.lyrics = lyrics;
    if (negativeTags) body.negativeTags = negativeTags;
    if (input.vocalGender === "m" || input.vocalGender === "f") body.vocalGender = input.vocalGender;
    const duration = Number(input.duration);
    if (Number.isFinite(duration) && duration >= 10 && duration <= 360) body.duration = Math.round(duration);
    for (const k of ["styleWeight", "weirdnessConstraint"]) {
      const n = Number(input[k]);
      if (input[k] !== undefined && input[k] !== "" && Number.isFinite(n) && n >= 0 && n <= 1) {
        body[k] = Math.round(n * 100) / 100;
      }
    }
    const variety = Number(input.variety);
    if (Number.isInteger(variety) && variety >= 0 && variety <= 4) body.variety = variety;
  } else {
    const prompt = str(input.prompt, 3000);
    const style = str(input.style, 1000);
    if (!prompt && !style) return json({ error: "Describe the song you want." }, 400);
    if (prompt) body.prompt = prompt;
    if (style) body.style = style;
  }

  try {
    const { ok, status, data } = await suno("/api/v1/generate", { method: "POST", body });
    if (!ok) return json({ error: errorMessage(data), code: data?.code }, status);
    return json({ taskId: data.data.taskId });
  } catch (err) {
    return json({ error: `Could not reach Suno API: ${err.message}` }, 502);
  }
};
