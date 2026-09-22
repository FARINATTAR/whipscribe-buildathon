# Offstage — Bot-free Desktop Meeting Recorder

**Track 2 submission by Farin Attar**

> The meeting recorder that never joins the meeting.

Offstage captures both sides of a call (your mic + system/meeting audio) entirely on your machine. No bot enters Zoom, Google Meet, Teams, or Slack. Recordings are written to disk every second so a crash never loses the call. When the meeting ends, Offstage sends the file to WhipScribe and gives you a clickable, speaker-labelled transcript with jump-to-second audio seeking.

---

## The Problem

1. **Bot invasion** — Tools like Otter, Fireflies and Read.ai join as visible third-party bots. Clients, candidates, and executives frequently refuse them. Confidential calls become impossible.
2. **Crash = total loss** — Most web recorders buffer multi-hour calls in RAM. One Windows freeze, Zoom crash or battery death and the entire recording is lost.
3. **Messy files** — Recordings end up as generic `meeting_final_v3.wav` files detached from calendar context.

Offstage solves all three.

---

## What is built

| Feature | Status | Notes |
|---------|--------|-------|
| Bot-free dual-stream capture (mic + system loopback) | ✅ | Windows WASAPI loopback + Web Audio |
| 1-second crash-safe chunking to disk | ✅ | Flushes to disk every second; survives force-quit or OS crash |
| Pre-call dual-track soundcheck meters | ✅ | 5-second test with live Mic & Room audio meters before recording |
| Calendar arming + auto file naming | ✅ | iCal private feed → automatic naming like `Interview_Alex_2026-09-22.webm` |
| Focus HUD (floating mini-pill while recording) | ✅ | Minimal distraction top status bar during active calls |
| WhipScribe transcription + diarization | ✅ | Real API integration, diarized speaker labels, word timestamps |
| Jump-to-the-second playback | ✅ | Click any transcript moment chip → audio seeks instantly |
| Local searchable library | ✅ | Fast fuzzy search across filenames and full transcript text |
| Secure API key storage | ✅ | Electron `safeStorage` (Windows DPAPI hardware encryption) |

---

## Tech Stack

- **Runtime**: Electron (Windows-first)
- **Audio Capture**: WASAPI loopback (system) + Web Audio API / MediaRecorder (mic)
- **Mixing**: Web Audio `AudioContext` + `ChannelMergerNode` → 16 kHz mono WebM/Opus
- **Persistence**: Node `fs.createWriteStream` via IPC (1-second disk flushes)
- **Calendar**: iCal feed (Google Calendar / Outlook / Apple Calendar) + sample meetings
- **Transcription**: WhipScribe API (`POST /api/v1/transcribe` → poll → fetch JSON)
- **UI**: Custom ink & teal dark glassmorphism (vanilla CSS, zero framework bloat)

---

## How to run

```bash
cd apps/farin/track2-recorder
npm install
npm start
```

1. Set your WhipScribe API key (via `.env` or the in-app secure DPAPI store).
2. (Optional) Paste your Google/Outlook private iCal URL in Calendar Settings, or use built-in samples.
3. Click **Arm** on an upcoming meeting (or click **Record** for an ad-hoc session).
4. Run the 5-second dual-track Soundcheck.
5. When the call ends, click **Stop & Transcribe** → Offstage uploads to WhipScribe and displays the interactive transcript.

---

## Visual Walkthrough

### 1. Calendar Arming & Pre-Call Soundcheck
*Arm upcoming calendar meetings with live countdowns and verify mic & room audio levels before entering the call.*
<img width="1535" alt="Pre-call Soundcheck and Calendar Arming" src="https://github.com/user-attachments/assets/e779251b-4721-4d18-839b-98f044921731" />

### 2. Focus HUD & Active Capture
*Minimal floating status bar displaying real-time recording timer and controls without cluttering your meeting view.*
<img width="1535" alt="Focus HUD Recording State" src="https://github.com/user-attachments/assets/f7fdda90-679b-4394-9941-98ecf678a80d" />

### 3. WhipScribe Transcript & Jump-to-Second Playback
*Speaker-diarized transcript with timestamped moment chips. Click any sentence to jump the audio player to that exact second.*
<img width="1535" alt="Transcript and Jump to Second Player" src="https://github.com/user-attachments/assets/5ca893b9-6fcc-4a74-a5a7-ec62c3542ccb" />

### 4. Local Searchable Library
*Search and filter past sessions by meeting title or dialogue keyword across all recorded transcripts.*
<img width="1535" alt="Local Searchable Library" src="https://github.com/user-attachments/assets/f34227d1-2620-4969-8ff2-a03c8642cbd9" />

---

## What I deliberately left unfinished (and why)

- **macOS system-audio path (ScreenCaptureKit)**: Windows-first was the priority for Track 2. One platform done solidly beats two done poorly.
- **Multi-monitor Focus HUD auto-docking**: Works on primary display; multi-screen snapping left for next iteration.
- **Automatic cloud folder synchronization**: Transcripts and recordings remain local-first by default for maximum data privacy.

---

## Architecture decisions worth noting

- **Why 1-second chunks on disk?**
  RAM buffers lose everything on crash. Streaming directly to an open file descriptor ensures that minute 42 of an interview is safe even if the OS or process dies.
- **Why bot-free?**
  High-stakes conversations (recruiting, sales, executive 1-on-1s) often forbid bots. Local OS loopback removes the policy friction entirely.
- **Why local-first library?**
  Recordings and sensitive audio stay strictly on the user’s machine. WhipScribe is leveraged for AI transcription, diarization, and timestamps, rather than long-term audio custody.

---

## What We Learned & The Production Roadmap: The Zero-Bot Ecosystem

### Core Engineering Learnings
Building Offstage revealed why meeting bots are a fundamentally flawed architecture:
1. **The guest list is political**: In confidential board calls, sales pitches, and technical screens, admitting an uninvited bot creates friction. Capturing cleanly from the OS loopback is the only path that respects client privacy.
2. **RAM buffers are fragile**: Streaming 1-second audio chunks directly to an open disk descriptor is the difference between a resilient professional tool and a toy that loses a 2-hour call during a browser tab crash.

### Evolution & Next Milestones
- **Native macOS Audio Tap (ScreenCaptureKit)**: Windows-first loopback is solid; bringing the same zero-bot architecture to macOS via ScreenCaptureKit.
- **Direct CandidateSync & ATS Integration**: Automatic one-click export into candidate scorecards, Linear tickets, or Notion notes the second the call disconnects.
- **Zero-Knowledge Encrypted Vault**: Optional end-to-end encrypted cloud backup where only the user holds the decryption keys.
- **Enterprise Redaction Shields**: Real-time on-device regex & PII masking for credit card numbers, passwords, and sensitive client credentials.

---

## Track record link
See [Track 0 PR #28](https://github.com/neugence/whipscribe-buildathon/pull/28) and `apps/farin/README.md` for prior shipped work ([VideoVCS](https://vvcs.tech), VoiceMed team lead, hackathon awards).
