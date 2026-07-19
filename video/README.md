# Weekly episode pipeline

Turns the tracker's live data into a narrated YouTube episode: portfolio update,
dividends, FIRE progress, market backdrop.

```
npm run episode              # snapshot -> script -> voice -> subtitles -> render
npm run episode -- --upload  # + upload to YouTube as an UNLISTED draft
npm run episode -- --only voice   # re-run one stage
npm run studio               # open Remotion Studio to preview/tweak scenes
```

Output per week in `episodes/<YYYY-Www>/`: `data.json` (all numbers), `script.json`
(narration + metadata), `audio/`, `episode.srt`, `episode.mp4`, `upload.json`.

## Requirements

- The app's dev server running on `localhost:3000` (the pipeline reads its APIs).
- `ANTHROPIC_API_KEY` in the app's `.env.local` (script writing) — already set up.
- `OPENAI_API_KEY` in `.env.local` for the real voice (`gpt-4o-mini-tts`, ~0.10 €/episode).
  Without it the pipeline falls back to the macOS `say` voice so you can test.

## YouTube draft upload (one-time setup)

1. console.cloud.google.com → new project → enable **YouTube Data API v3**
2. OAuth consent screen → External → add yourself as test user
3. Credentials → **OAuth client ID** → Desktop app → download the JSON
   → save as `video/secrets/client_secret.json`
4. `npm run episode -- --upload` → first run prints an auth URL, paste the code once.

Uploads are always **unlisted** — you review in YouTube Studio and publish manually.

## Weekly automation

```
cp video/com.dividendtracker.episode.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.dividendtracker.episode.plist
```

Runs Sundays 18:00 (edit the plist to change). It only renders — uploading stays
a manual decision unless you add `--upload` to the plist arguments.

## Tuning

- `config.json` — channel name, language, target minutes, voice, resolution,
  macro indices, privacy mode.
- `remotion/scenes.tsx` — the visual design of every scene.
- `pipeline/script.ts` SYSTEM prompt — the narrator's voice and episode structure.
