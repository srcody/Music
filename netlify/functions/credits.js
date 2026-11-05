import { suno, json, errorMessage } from "../lib/suno.js";

export default async () => {
  try {
    const { ok, status, data } = await suno("/api/v1/generate/credit");
    if (!ok) return json({ error: errorMessage(data) }, status);
    return json({ credits: data.data });
  } catch (err) {
    return json({ error: `Could not reach Suno API: ${err.message}` }, 502);
  }
};
