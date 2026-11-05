import { suno, json, errorMessage } from "../lib/suno.js";

const FAILED = ["CREATE_TASK_FAILED", "GENERATE_AUDIO_FAILED", "CALLBACK_EXCEPTION", "SENSITIVE_WORD_ERROR"];

export default async (req) => {
  const taskId = new URL(req.url).searchParams.get("taskId");
  if (!taskId || !/^[\w-]{1,100}$/.test(taskId)) return json({ error: "Missing or invalid taskId" }, 400);

  try {
    const { ok, status, data } = await suno(`/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`);
    if (!ok) return json({ error: errorMessage(data), code: data?.code }, status);

    const d = data.data || {};
    const tracks = (d.response?.sunoData || []).map((t) => ({
      id: t.id,
      title: t.title,
      tags: t.tags,
      lyrics: t.prompt,
      duration: t.duration,
      image: t.image_url || t.imageUrl || t.source_image_url,
      audio: t.audio_url || t.audioUrl || t.source_audio_url,
      stream: t.stream_audio_url || t.streamAudioUrl || t.source_stream_audio_url,
      createdAt: t.createTime,
    }));

    return json({
      taskId,
      status: d.status || "PENDING",
      failed: FAILED.includes(d.status),
      done: d.status === "SUCCESS",
      error: d.errorMessage || null,
      tracks,
    });
  } catch (err) {
    return json({ error: `Could not reach Suno API: ${err.message}` }, 502);
  }
};
