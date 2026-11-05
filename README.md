# Music Studio

An AI music generator. Users describe a song (or write their own lyrics), and the app generates two original tracks they can play and download. Powered by the [Suno API](https://docs.sunoapi.org/) and deployed on Netlify.

## Features

- **Simple mode**: describe a song in plain words; lyrics are written for you.
- **Custom mode**: your own title, lyrics, style, styles to avoid, voice, length, style adherence, weirdness and variety.
- Instrumental toggle and a choice of models (V6, V6 Wild, V6 Mini).
- Live progress, with streaming playback as soon as the first track is ready.
- Built-in player, MP3 download and lyrics view.
- History saved in the browser. Suno keeps generated files for 14 days.
- Remaining API credits shown in the header.

## How it works

```
public/                 static frontend (HTML/CSS/JS, no build step)
netlify/functions/      serverless API; the Suno key stays on the server
  generate.js   POST /api/generate         -> Suno POST /api/v1/generate
  status.js     GET  /api/status?taskId=   -> Suno GET  /api/v1/generate/record-info
  credits.js    GET  /api/credits          -> Suno GET  /api/v1/generate/credit
  callback.js   POST /api/callback         (required by Suno; the app polls instead)
netlify/lib/suno.js     shared Suno client
```

## Deploy to Netlify

1. In Netlify, choose **Add new site > Import an existing project** and pick this repo. `netlify.toml` already sets the build settings, so you don't need to change anything.
2. Under **Site configuration > Environment variables**, add:
   - `SUNO_API_KEY`: your Suno API key (**required**)
   - `SUNO_API_BASE` (optional): the API host. Defaults to `https://api.sunoapi.org`.
3. Deploy, or trigger a redeploy after you add the variable.

## Run locally

```bash
npm i -g netlify-cli
cp .env.example .env   # then put your key in .env
netlify dev
```

Never commit your API key. `.env` is in `.gitignore`.
