# Offstage

A Windows-first desktop recorder that **never joins the call**. It captures this machine (mic and, when Windows allows it, system audio), names the file from the next calendar event, writes audio to disk every second, and sends a file to the WhipScribe API only when you ask.

That is the product, not a generic “dashboard + purple glass” clone of Otter.

## Why this instead of a meeting bot

| App | What it gets right | Where it is the wrong shape |
|---|---|---|
| Otter / Fireflies | Live notes, CRM | A bot sits in the room. Guests see it. Some orgs ban it. |
| Krisp | Local capture, no bot | No calendar arming, no transcript library with jump-to-second |
| **Offstage** | Stays off the guest list. Calendar names the tape. Crash-safe chunks. WhipScribe speakers + timestamps on this PC | System audio still depends on Windows loopback / share-audio |

## Install and run

```bash
cd apps/farin/track2-recorder
npm install
npm start
```

DevTools:

```bash
npm run dev
```

## Connect WhipScribe

1. Create a key at [whipscribe.com/apis/keys](https://whipscribe.com/apis/keys) (docs: the API has no free tier; a key needs a positive balance).
2. Settings → paste the key → Save. It is stored with Electron `safeStorage` (Windows DPAPI).
3. Record something of your own → **Send to WhipScribe**.

There is **no fake transcript**. If the key is missing, the app says so.

Submit uses `POST /api/v1/transcribe` with `source=recording`, `diarize=true`, `word_timestamps=true`, and an `Idempotency-Key`. Status is polled from `GET /api/v1/jobs/{id}` (including `progress`, `locked`, `speech_detected`) then `GET …/result?format=json`. After that, clip preprocess / summary / hook candidates are requested from the documented clip endpoints — if they 409, we wait; we do not invent sentences.

## Connect a calendar

- **iCal**: Calendar settings → secret address in iCal format → paste in Offstage. URL is stored locally and re-fetched on launch.
- **Sample meetings**: UI-only, clearly labelled. Not Google.

**Record this — no bot** names the WebM from the event title and starts capture immediately.

## What works

- [x] Distinct product: Offstage (bot-free), WhipScribe is the transcription engine
- [x] Today view centred on the next meeting, not a four-card admin dashboard
- [x] Calendar arming (iCal or labelled samples) with live “starts in…” copy
- [x] Pre-call dual-track soundcheck: 5s test with live Mic & Room audio meters and verdict (never tape silence)
- [x] Focus HUD: Compact top status widget with pulsing indicator, timer, and quick controls while recording
- [x] Microphone recording; Mic+room / system attempts Windows loopback via `desktopCapturer`, then getDisplayMedia share-audio if loopback is empty
- [x] Crash-safe 1-second chunks written to `userData/sessions/` as they arrive
- [x] Recover interrupted sessions on next launch
- [x] Pause freezes the timer; discard deletes the file
- [x] Real WhipScribe upload / poll / JSON transcript (own account only)
- [x] Recap Theater: Local tape receipt card + clickable moment seek chips that jump audio playback to exact second
- [x] Library search over filenames **and** transcript text
- [x] Clear back navigation across all views
- [x] Encrypted API key (Windows DPAPI via Electron safeStorage), keyboard shortcuts (`Ctrl+R` / `Ctrl+S`), tray start/stop

## What does not work yet

- [ ] Silent WASAPI via `native-recorder-nodejs` — Electron loopback is used instead; it can fail or prompt to share a screen
- [ ] Google OAuth (Calendar API) — iCal secret URL is the path that ships
- [ ] Auto-start at event time without a click
- [ ] WhipScribe MCP library folders / rename / delete in the cloud
- [ ] macOS ScreenCaptureKit permissions (Windows first)

## Architecture

```
main.js        window, tray, desktopCapturer, session chunks, recordings dir, encrypted store
preload.js     contextBridge only
src/index.html shell
src/styles.css ink + teal (not generic violet glass)
src/renderer.js capture mix, calendar, WhipScribe client, library search
```

Recordings live in Electron `userData/recordings/`, not in the git repo.

## Built by

Farin Attar — [github.com/FARINATTAR](https://github.com/FARINATTAR)
