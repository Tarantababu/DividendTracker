# Weekly episode pipeline

Turns the tracker's live data into a narrated YouTube episode: portfolio update,
dividends, FIRE progress, market backdrop.

```
npm run episode              # snapshot -> script -> voice -> subtitles -> render
npm run episode -- --upload  # + upload to YouTube as an UNLISTED draft
npm run episode -- --only voice   # re-run one stage
npm run studio               # open Remotion Studio to preview/tweak scenes
```

You can also generate an episode from the app: open **/videos** and click
**"Generate this week's episode"** — it runs this same pipeline locally and shows
live progress. (Local only; the deployed site is a viewer.)

Output per week in `episodes/<YYYY-Www>/`: `data.json` (all numbers), `script.json`
(narration + metadata), `audio/`, `episode.srt`, `episode.mp4`, `upload.json`.

## Requirements

- The app's dev server running on `localhost:3000` (the pipeline reads its APIs).
- `ANTHROPIC_API_KEY` in the app's `.env.local` (script writing) — already set up.
- **Voice** — the default is **hosted Dia** (real `nari-labs/dia` on Replicate,
  `zsxkib/dia`, ~$0.025/segment). Add `REPLICATE_API_TOKEN=...` to `.env.local`
  (get one at replicate.com/account/api-tokens). The voice stage falls back in
  order **dia-remote → openai → say**, so:
  - no `REPLICATE_API_TOKEN` → uses `OPENAI_API_KEY` (`gpt-4o-mini-tts`) if present,
  - neither key → the free macOS `say` voice, so you can still test end-to-end.
  Set `voice.provider` in `config.json` to `openai`, `say`, or local `dia` to override.

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

## Running against a different port

The pipeline reads the app's APIs from `config.json` → `baseUrl` (default
`http://localhost:3000`). If your dev server is on another port, override it:

```
APP_BASE_URL=http://localhost:3212 npm run episode
```
