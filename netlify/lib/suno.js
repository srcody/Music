const BASE = (process.env.SUNO_API_BASE || "https://api.sunoapi.org").replace(/\/$/, "");

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export async function suno(path, { method = "GET", body } = {}) {
  const key = process.env.SUNO_API_KEY;
  if (!key) {
    return { ok: false, status: 500, data: { code: 500, msg: "SUNO_API_KEY is not configured on the server." } };
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  try {
    data = await res.json();
  } catch {
    data = { code: res.status, msg: `Unexpected response from Suno API (${res.status})` };
  }
  const ok = res.ok && data && data.code === 200;
  return { ok, status: ok ? 200 : data?.code && data.code >= 400 ? data.code : res.status || 502, data };
}

const ERRORS = {
  400: "Invalid parameters.",
  401: "Unauthorized — check the API key.",
  405: "Rate limit exceeded. Try again shortly.",
  413: "Prompt or style is too long.",
  429: "Out of credits.",
  430: "Too many requests. Please slow down.",
  455: "Suno is under maintenance. Try again later.",
  500: "Suno server error.",
};

export const errorMessage = (data) => data?.msg || ERRORS[data?.code] || "Request failed.";
