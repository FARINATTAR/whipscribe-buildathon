const WHIP = 'https://whipscribe.com/api/v1';

const navItems = document.querySelectorAll('.nav-item');
const views = document.querySelectorAll('.view');

function navigateTo(viewName) {
  views.forEach((v) => v.classList.remove('active'));
  navItems.forEach((n) => n.classList.remove('active'));
  document.getElementById(`view-${viewName}`)?.classList.add('active');
  document.querySelector(`[data-view="${viewName}"]`)?.classList.add('active');
  if (viewName === 'library') loadLibrary();
}

navItems.forEach((item) => {
  item.addEventListener('click', () => navigateTo(item.dataset.view));
});

document.getElementById('btn-quick-record')?.addEventListener('click', () => navigateTo('record'));
document.getElementById('btn-connect-calendar')?.addEventListener('click', () => navigateTo('calendar'));

function showToast(message, type = 'info', duration = 3200) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('out');
    toast.addEventListener('animationend', () => toast.remove());
  }, duration);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function formatTimeHMS(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatMMSS(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatMeetingTime(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatRelativeTime(date) {
  const diffMins = Math.round((date.getTime() - Date.now()) / 60000);
  if (diffMins <= 0) return 'Happening now';
  if (diffMins < 60) return `Starts in ${diffMins} min`;
  const hours = Math.floor(diffMins / 60);
  const rem = diffMins % 60;
  return `Starts in ${hours}h${rem ? ` ${rem}m` : ''}`;
}

const SOURCE_HINTS = {
  both: 'Mic plus what the computer plays (Meet, Zoom, Teams). No meeting bot.',
  mic: 'Your microphone only. Useful if loopback is blocked.',
  system: 'What the machine plays. You will not be on the tape.',
};

document.querySelectorAll('.source-option').forEach((opt) => {
  opt.addEventListener('click', () => {
    document.querySelectorAll('.source-option').forEach((o) => o.classList.remove('active'));
    opt.classList.add('active');
    opt.querySelector('input').checked = true;
    const value = opt.querySelector('input').value;
    document.getElementById('source-hint').textContent = SOURCE_HINTS[value] || '';
  });
});

const waveformCanvas = document.getElementById('waveform-canvas');
const waveCtx = waveformCanvas?.getContext('2d');
let waveformAnimFrame = null;

function drawIdleWaveform() {
  if (!waveCtx) return;
  const w = waveformCanvas.width;
  const h = waveformCanvas.height;
  waveCtx.clearRect(0, 0, w, h);
  const barCount = 56;
  const barWidth = 3;
  const gap = (w - barCount * barWidth) / (barCount + 1);
  for (let i = 0; i < barCount; i++) {
    const x = gap + i * (barWidth + gap);
    const barH = 3 + Math.abs(Math.sin(i / 4)) * 10;
    waveCtx.fillStyle = 'rgba(45, 212, 191, 0.18)';
    waveCtx.fillRect(x, (h - barH) / 2, barWidth, barH);
  }
}

function drawLiveWaveform(analyser) {
  if (!waveCtx || !analyser) return;
  const w = waveformCanvas.width;
  const h = waveformCanvas.height;
  const dataArray = new Uint8Array(analyser.frequencyBinCount);

  function draw() {
    waveformAnimFrame = requestAnimationFrame(draw);
    analyser.getByteFrequencyData(dataArray);
    waveCtx.clearRect(0, 0, w, h);
    const barCount = 56;
    const barWidth = 3;
    const gap = (w - barCount * barWidth) / (barCount + 1);
    const step = Math.floor(dataArray.length / barCount);
    for (let i = 0; i < barCount; i++) {
      const val = dataArray[i * step] / 255;
      const barH = Math.max(4, val * (h * 0.82));
      waveCtx.fillStyle = `rgba(45, 212, 191, ${0.35 + val * 0.65})`;
      waveCtx.beginPath();
      waveCtx.roundRect(gap + i * (barWidth + gap), (h - barH) / 2, barWidth, barH, 2);
      waveCtx.fill();
    }
  }
  draw();
}

drawIdleWaveform();

let mediaRecorder = null;
let audioChunks = [];
let recordingStartTime = null;
let pausedAccumulated = 0;
let pauseStartedAt = null;
let recordingTimerInterval = null;
let audioContext = null;
let analyserNode = null;
let isRecording = false;
let activeSession = null;
let armedMeeting = null;
let lastSavedFilename = null;
let currentPlaybackAudio = null;
let currentBlobUrl = null;
let lastTranscriptAudioName = null;
let libraryCache = [];
let currentMeetings = [];
let calendarMode = null;
let countdownInterval = null;

const btnStart = document.getElementById('btn-start-record');
const btnPause = document.getElementById('btn-pause-record');
const btnStop = document.getElementById('btn-stop-record');
const recTimeDisplay = document.getElementById('recorder-time');
const recFilename = document.getElementById('recorder-filename');
const recIndicator = document.getElementById('recording-indicator');
const recTimerSidebar = document.getElementById('rec-timer');
const postRecording = document.getElementById('post-recording');
const crashStatus = document.getElementById('crash-status');

function selectedSource() {
  return document.querySelector('input[name="source"]:checked')?.value || 'both';
}

function elapsedSeconds() {
  if (!recordingStartTime) return 0;
  const paused = pauseStartedAt ? Date.now() - pauseStartedAt : 0;
  return (Date.now() - recordingStartTime - pausedAccumulated - paused) / 1000;
}

function updateTimerDisplay() {
  const elapsed = elapsedSeconds();
  recTimeDisplay.textContent = formatTimeHMS(elapsed);
  if (recTimerSidebar) recTimerSidebar.textContent = formatMMSS(elapsed);
}

function stopCurrentPlayback() {
  if (currentPlaybackAudio) {
    try {
      currentPlaybackAudio.pause();
      currentPlaybackAudio.currentTime = 0;
    } catch { /* ignore */ }
    currentPlaybackAudio = null;
  }
  const btn = document.getElementById('btn-play-back');
  if (btn) {
    btn.textContent = 'Play';
    btn.classList.remove('btn-stop-active');
  }
  document.querySelectorAll('.btn-lib-play.playing').forEach((b) => {
    b.classList.remove('playing');
    b.textContent = 'Play';
  });
}

async function getMicStream() {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
    video: false,
  });
}

async function getLoopbackStream() {
  const sourceId = await window.api.getDesktopSource();
  if (!sourceId) throw new Error('No screen source for loopback');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
      },
    },
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
        maxWidth: 1,
        maxHeight: 1,
      },
    },
  });
  stream.getVideoTracks().forEach((t) => t.stop());
  if (stream.getAudioTracks().length === 0) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error('Loopback returned no audio track');
  }
  return stream;
}

async function getDisplayAudioStream() {
  const display = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
  display.getVideoTracks().forEach((t) => t.stop());
  if (display.getAudioTracks().length === 0) {
    display.getTracks().forEach((t) => t.stop());
    throw new Error('Share-audio had no audio track — tick “Share system audio” if Windows shows it');
  }
  return display;
}

function mixStreams(streams) {
  audioContext = new AudioContext();
  const dest = audioContext.createMediaStreamDestination();
  analyserNode = audioContext.createAnalyser();
  analyserNode.fftSize = 256;
  streams.forEach((stream) => {
    const src = audioContext.createMediaStreamSource(stream);
    src.connect(dest);
    src.connect(analyserNode);
  });
  return { mixed: dest.stream, raw: streams };
}

async function captureForSource(source) {
  const raw = [];
  if (source === 'mic' || source === 'both') raw.push(await getMicStream());
  if (source === 'system' || source === 'both') {
    try {
      raw.push(await getLoopbackStream());
    } catch (err) {
      if (source === 'system') {
        try {
          raw.push(await getDisplayAudioStream());
        } catch (fallbackErr) {
          throw new Error(`${err.message}. ${fallbackErr.message}`);
        }
      } else {
        showToast(`Loopback unavailable — microphone only. ${err.message}`, 'warning', 5000);
      }
    }
  }
  if (raw.length === 0) throw new Error('No audio source');
  const { mixed } = mixStreams(raw);
  return { mixed, raw };
}

function defaultFilename() {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toTimeString().slice(0, 5).replace(':', '-');
  if (armedMeeting) {
    const clean = armedMeeting.title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    return `${clean}_${dateStr}.webm`;
  }
  return `Recording_${dateStr}_${timeStr}.webm`;
}

async function startRecording() {
  if (isRecording) return;
  stopCurrentPlayback();
  const source = selectedSource();

  try {
    const { mixed, raw } = await captureForSource(source);
    const filename = recFilename.textContent?.endsWith('.webm')
      ? recFilename.textContent
      : defaultFilename();
    recFilename.textContent = filename;

    activeSession = await window.api.startSession({
      id: `sess_${Date.now()}`,
      filename,
      meetingTitle: armedMeeting?.title || null,
      source,
    });

    drawLiveWaveform(analyserNode);

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';
    mediaRecorder = new MediaRecorder(mixed, { mimeType });
    audioChunks = [];
    mediaRecorder._rawStreams = raw;

    mediaRecorder.ondataavailable = async (e) => {
      if (!e.data || e.data.size === 0) return;
      audioChunks.push(e.data);
      try {
        const buffer = await e.data.arrayBuffer();
        const meta = await window.api.appendChunk(activeSession.id, buffer);
        crashStatus.textContent = `Crash-safe: ${meta.chunkCount}s on disk`;
      } catch (err) {
        crashStatus.textContent = `Disk write failed: ${err.message}`;
      }
    };

    mediaRecorder.onstop = () => handleRecordingComplete();
    mediaRecorder.start(1000);

    isRecording = true;
    pausedAccumulated = 0;
    pauseStartedAt = null;
    recordingStartTime = Date.now();
    recordingTimerInterval = setInterval(updateTimerDisplay, 200);

    btnStart.classList.add('recording', 'hidden');
    btnPause.classList.remove('hidden');
    btnStop.classList.remove('hidden');
    recIndicator.classList.remove('hidden');
    recTimeDisplay.classList.add('recording');
    postRecording.classList.add('hidden');
    document.getElementById('job-progress')?.classList.add('hidden');

    showToast('Recording — chunks writing to disk every second', 'info');
  } catch (err) {
    console.error(err);
    if (err.name === 'NotAllowedError') {
      showToast('Microphone or screen-audio permission denied', 'error');
    } else {
      showToast(err.message || 'Could not start recording', 'error');
    }
  }
}

function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
  mediaRecorder.stop();
  mediaRecorder.stream.getTracks().forEach((t) => t.stop());
  (mediaRecorder._rawStreams || []).forEach((s) => s.getTracks().forEach((t) => t.stop()));
  isRecording = false;
  if (pauseStartedAt) {
    pausedAccumulated += Date.now() - pauseStartedAt;
    pauseStartedAt = null;
  }
  clearInterval(recordingTimerInterval);
  if (waveformAnimFrame) cancelAnimationFrame(waveformAnimFrame);
  btnStart.classList.remove('recording', 'hidden');
  btnPause.classList.add('hidden');
  btnStop.classList.add('hidden');
  recIndicator.classList.add('hidden');
  recTimeDisplay.classList.remove('recording');
  drawIdleWaveform();
}

function pauseRecording() {
  if (mediaRecorder?.state === 'recording') {
    mediaRecorder.pause();
    pauseStartedAt = Date.now();
    btnPause.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
    crashStatus.textContent = 'Paused — last second already on disk';
    showToast('Paused', 'info');
  } else if (mediaRecorder?.state === 'paused') {
    mediaRecorder.resume();
    if (pauseStartedAt) pausedAccumulated += Date.now() - pauseStartedAt;
    pauseStartedAt = null;
    btnPause.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>`;
    showToast('Resumed', 'info');
  }
}

async function handleRecordingComplete() {
  stopCurrentPlayback();
  const blob = new Blob(audioChunks, { type: 'audio/webm' });
  const elapsed = elapsedSeconds();
  const filename = recFilename.textContent || `recording_${Date.now()}.webm`;

  try {
    if (activeSession) {
      const saved = await window.api.finalizeSession(activeSession.id);
      lastSavedFilename = saved.filename;
      document.getElementById('post-size').textContent = formatFileSize(saved.size);
    } else {
      const buffer = await blob.arrayBuffer();
      await window.api.saveRecording(filename, buffer);
      lastSavedFilename = filename;
      document.getElementById('post-size').textContent = formatFileSize(blob.size);
    }
  } catch (err) {
    showToast(`Could not stitch file: ${err.message}`, 'error');
    lastSavedFilename = filename;
    document.getElementById('post-size').textContent = formatFileSize(blob.size);
  }

  if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
  currentBlobUrl = URL.createObjectURL(blob);

  postRecording.classList.remove('hidden');
  document.getElementById('post-filename').textContent = lastSavedFilename;
  document.getElementById('post-duration').textContent = formatTimeHMS(elapsed);
  crashStatus.textContent = 'Saved to library on this machine';

  const btnPlayBack = document.getElementById('btn-play-back');
  btnPlayBack.onclick = () => {
    if (currentPlaybackAudio && !currentPlaybackAudio.paused) {
      stopCurrentPlayback();
      return;
    }
    stopCurrentPlayback();
    currentPlaybackAudio = new Audio(currentBlobUrl);
    currentPlaybackAudio.onended = () => stopCurrentPlayback();
    currentPlaybackAudio.play().then(() => {
      btnPlayBack.textContent = 'Stop';
      btnPlayBack.classList.add('btn-stop-active');
    }).catch(() => showToast('Playback failed', 'error'));
  };

  document.getElementById('btn-discard').onclick = async () => {
    stopCurrentPlayback();
    if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = null;
    if (lastSavedFilename) await window.api.deleteRecording(lastSavedFilename);
    postRecording.classList.add('hidden');
    recTimeDisplay.textContent = '00:00:00';
    recFilename.textContent = 'Ready — file will be named when you start';
    crashStatus.textContent = 'Crash-safe: idle';
    lastSavedFilename = null;
    audioChunks = [];
    armedMeeting = null;
    showToast('Recording discarded from disk', 'info');
    loadLibrary();
  };

  showToast('File is on disk. Send it only if you want a transcript.', 'success');
  loadLibrary();

  const auto = document.getElementById('auto-transcribe')?.checked;
  if (auto) transcribeCurrent();
}

btnStart?.addEventListener('click', startRecording);
btnStop?.addEventListener('click', stopRecording);
btnPause?.addEventListener('click', pauseRecording);

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === 'r') {
    e.preventDefault();
    if (!isRecording) startRecording();
  }
  if (e.ctrlKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (isRecording) stopRecording();
  }
});

async function apiHeaders() {
  const key = await window.api.getEncrypted('whipscribe_api_key');
  return key ? { 'X-API-Key': key } : null;
}

async function readApiError(res) {
  const body = await res.json().catch(() => ({}));
  const code = body.code ? ` [${body.code}]` : '';
  return body.error ? `${body.error}${code}` : `HTTP ${res.status}${code}`;
}

async function checkApiStatus() {
  const statusEl = document.getElementById('api-status');
  const headers = await apiHeaders();
  if (!headers) {
    statusEl.innerHTML = `<div class="status-dot status-warning"></div><span>No API key — Settings</span>`;
    return;
  }
  try {
    statusEl.innerHTML = `<div class="spinner"></div><span>Checking…</span>`;
    const res = await fetch(`${WHIP}/me`, { headers });
    if (res.ok) {
      const data = await res.json();
      statusEl.innerHTML = `<div class="status-dot status-connected"></div><span>${escapeHtml(data.tier)} · ${data.retention_days}d audio retention</span>`;
    } else if (res.status === 401) {
      statusEl.innerHTML = `<div class="status-dot status-disconnected"></div><span>Invalid API key</span>`;
    } else {
      statusEl.innerHTML = `<div class="status-dot status-warning"></div><span>${escapeHtml(await readApiError(res))}</span>`;
    }
  } catch {
    statusEl.innerHTML = `<div class="status-dot status-disconnected"></div><span>Offline — cannot reach WhipScribe</span>`;
  }
}

document.getElementById('btn-toggle-key')?.addEventListener('click', () => {
  const input = document.getElementById('api-key-input');
  const btn = document.getElementById('btn-toggle-key');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.textContent = show ? 'Hide' : 'Show';
});

document.getElementById('btn-save-key')?.addEventListener('click', async () => {
  const key = document.getElementById('api-key-input').value.trim();
  if (!key) {
    showToast('Paste an API key first', 'error');
    return;
  }
  await window.api.setEncrypted('whipscribe_api_key', key);
  showToast('Key stored with OS encryption', 'success');
  checkApiStatus();
});

document.getElementById('link-api-keys')?.addEventListener('click', (e) => {
  e.preventDefault();
  window.api.openExternal('https://whipscribe.com/apis/keys');
});
document.getElementById('link-whipscribe')?.addEventListener('click', (e) => {
  e.preventDefault();
  window.api.openExternal('https://whipscribe.com');
});

document.getElementById('auto-transcribe')?.addEventListener('change', async (e) => {
  await window.api.setStore('auto_transcribe', e.target.checked);
});

document.getElementById('btn-transcribe')?.addEventListener('click', () => transcribeCurrent());

async function transcribeCurrent() {
  const headers = await apiHeaders();
  if (!headers) {
    showToast('Add a WhipScribe API key in Settings. Demo transcripts are not used.', 'error', 5000);
    navigateTo('settings');
    return;
  }
  if (audioChunks.length === 0 && !lastSavedFilename) {
    showToast('Nothing to send — record first', 'error');
    return;
  }

  const filename = lastSavedFilename || recFilename.textContent || 'recording.webm';
  let blob;
  if (audioChunks.length) {
    blob = new Blob(audioChunks, { type: 'audio/webm' });
  } else {
    const buffer = await window.api.readRecording(filename);
    blob = new Blob([buffer], { type: 'audio/webm' });
  }

  const progress = document.getElementById('job-progress');
  const fill = document.getElementById('job-progress-fill');
  const label = document.getElementById('job-progress-label');
  progress.classList.remove('hidden');
  fill.style.width = '4%';
  label.textContent = 'Uploading…';

  try {
    const formData = new FormData();
    formData.append('file', blob, filename);
    formData.append('source', 'recording');
    formData.append('diarize', 'true');
    formData.append('word_timestamps', 'true');

    const idempotency = `offstage-${filename}-${blob.size}`.replace(/\s/g, '_').slice(0, 255);
    const submitRes = await fetch(`${WHIP}/transcribe`, {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': idempotency },
      body: formData,
    });

    if (!submitRes.ok) {
      throw new Error(await readApiError(submitRes));
    }

    const submitData = await submitRes.json();
    const jobId = submitData.job_id;
    label.textContent = `Queued · ${jobId.slice(0, 8)}…`;
    showToast(`Job ${submitData.status}`, 'success');
    await pollTranscription(jobId, headers, filename);
  } catch (err) {
    label.textContent = err.message;
    showToast(err.message, 'error', 6000);
  }
}

async function pollTranscription(jobId, headers, filename) {
  const fill = document.getElementById('job-progress-fill');
  const label = document.getElementById('job-progress-label');
  const maxAttempts = 200;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(3000);
    const res = await fetch(`${WHIP}/jobs/${jobId}`, { headers });
    if (!res.ok) {
      label.textContent = await readApiError(res);
      continue;
    }
    const data = await res.json();
    const pct = typeof data.progress === 'number' ? Math.round(data.progress * 100) : null;
    fill.style.width = `${pct ?? Math.min(90, 8 + attempt * 2)}%`;
    label.textContent = pct != null
      ? `${data.status} · ${pct}%`
      : `${data.status}`;

    if (data.status === 'done') {
      if (data.locked) {
        showToast('Transcript locked — add credit at whipscribe.com', 'error', 6000);
        label.textContent = 'locked';
        return;
      }
      if (data.speech_detected === false) {
        showToast('No speech detected — WhipScribe VAD rejected this file', 'warning', 6000);
        label.textContent = 'No speech';
        return;
      }
      await fetchAndDisplayTranscript(jobId, headers, filename);
      return;
    }
    if (data.status === 'failed') {
      showToast(data.error || 'Transcription failed', 'error');
      return;
    }
  }
  showToast('Still processing — check the job on whipscribe.com', 'warning');
}

async function fetchAndDisplayTranscript(jobId, headers, filename) {
  const res = await fetch(`${WHIP}/jobs/${jobId}/result?format=json`, { headers });
  if (!res.ok) throw new Error(await readApiError(res));
  const transcript = await res.json();

  const payload = {
    jobId,
    filename,
    meetingTitle: armedMeeting?.title || null,
    savedAt: Date.now(),
    transcript,
  };
  await window.api.saveTranscript(filename, payload);
  lastTranscriptAudioName = filename;
  renderTranscript(payload);
  navigateTo('transcript');
  showToast('Transcript on disk — click a timestamp to hear that second', 'success', 4500);
  loadLibrary();
  loadMoments(jobId, headers);
}

function renderTranscript(payload) {
  const data = payload.transcript || payload;
  const container = document.getElementById('transcript-segments');
  const title = document.getElementById('transcript-title');
  const meta = document.getElementById('transcript-meta');
  container.innerHTML = '';
  title.textContent = payload.meetingTitle || payload.filename || 'Transcript';
  meta.textContent = data.language
    ? `language ${data.language}${payload.jobId ? ` · job ${payload.jobId}` : ''}`
    : (payload.jobId || '');

  attachTranscriptAudio(payload.filename);

  if (!data.segments || data.segments.length === 0) {
    container.innerHTML = `<p class="empty-copy">${escapeHtml(data.suggestion || 'No transcript segments.')}</p>`;
    return;
  }

  data.segments.forEach((seg) => {
    const div = document.createElement('div');
    div.className = 'transcript-segment';
    const speakerIdx = parseInt(String(seg.speaker || '0').replace(/\D/g, '') || '0', 10) % 4;
    const start = Number(seg.start) || 0;
    div.innerHTML = `
      <span class="segment-speaker speaker-${speakerIdx}">${escapeHtml(seg.speaker || 'Speaker')}</span>
      <span class="segment-text">${escapeHtml(seg.text || '')}</span>
      <button type="button" class="segment-time" data-start="${start}">${formatMMSS(start)}</button>
    `;
    div.querySelector('.segment-time').addEventListener('click', () => seekTranscript(start));
    container.appendChild(div);
  });
}

async function attachTranscriptAudio(filename) {
  const audio = document.getElementById('transcript-audio');
  if (!filename) {
    audio.removeAttribute('src');
    return;
  }
  const buffer = await window.api.readRecording(filename);
  if (!buffer) return;
  const url = URL.createObjectURL(new Blob([buffer], { type: 'audio/webm' }));
  audio.src = url;
}

function seekTranscript(seconds) {
  const audio = document.getElementById('transcript-audio');
  if (!audio.src) {
    showToast('No local audio for this transcript', 'warning');
    return;
  }
  audio.currentTime = seconds;
  audio.play().catch(() => {});
}

async function loadMoments(jobId, headers) {
  const panel = document.getElementById('moments-panel');
  panel.classList.remove('hidden');
  panel.innerHTML = `<p class="moments-status">Asking WhipScribe for clip candidates…</p>`;
  try {
    await fetch(`${WHIP}/jobs/${jobId}/clips/preprocess`, { method: 'POST', headers });
    let summary = null;
    for (let i = 0; i < 20; i++) {
      const sumRes = await fetch(`${WHIP}/jobs/${jobId}/clips/summary`, { headers });
      if (sumRes.status === 409) {
        await sleep(3000);
        continue;
      }
      if (sumRes.ok) summary = await sumRes.json();
      break;
    }
    const candRes = await fetch(`${WHIP}/jobs/${jobId}/clips/candidates?kind=hook&limit=5`, { headers });
    const candidates = candRes.ok ? await candRes.json() : null;
    const sentences = candidates?.sentences || [];
    const summaryBits = summary && typeof summary === 'object'
      ? Object.entries(summary)
        .filter(([, v]) => v != null && typeof v !== 'object')
        .slice(0, 8)
        .map(([k, v]) => `${k}: ${v}`)
        .join(' · ')
      : '';
    panel.innerHTML = `
      <div class="moments-head">Moments from WhipScribe clip analysis</div>
      ${summaryBits ? `<p class="moments-summary">${escapeHtml(summaryBits)}</p>` : ''}
      ${sentences.length ? sentences.map((s) => `
        <button type="button" class="moment-chip" data-start="${s.start_s}">
          ${formatMMSS(s.start_s)} · ${escapeHtml(s.text || '')}
        </button>
      `).join('') : '<p class="moments-status">No hook sentences yet — preprocess may still be running.</p>'}
    `;
    panel.querySelectorAll('.moment-chip').forEach((btn) => {
      btn.addEventListener('click', () => seekTranscript(Number(btn.dataset.start)));
    });
  } catch (err) {
    panel.innerHTML = `<p class="moments-status">Moments skipped: ${escapeHtml(err.message)}</p>`;
  }
}

function transcriptPlainText() {
  return Array.from(document.querySelectorAll('.transcript-segment')).map((s) => {
    const speaker = s.querySelector('.segment-speaker')?.textContent || '';
    const content = s.querySelector('.segment-text')?.textContent || '';
    const time = s.querySelector('.segment-time')?.textContent || '';
    return `[${time}] ${speaker}: ${content}`;
  }).join('\n');
}

document.getElementById('btn-copy-transcript')?.addEventListener('click', () => {
  navigator.clipboard.writeText(transcriptPlainText()).then(() => showToast('Copied', 'success'));
});

document.getElementById('btn-download-transcript')?.addEventListener('click', async () => {
  const pathSaved = await window.api.saveTextDialog(
    `${(lastTranscriptAudioName || 'transcript').replace(/\.\w+$/, '')}.txt`,
    transcriptPlainText()
  );
  if (pathSaved) showToast('Saved', 'success');
});

document.getElementById('btn-back-to-library')?.addEventListener('click', () => navigateTo('library'));

function searchableText(rec) {
  const t = rec.transcript?.transcript || rec.transcript || {};
  const segs = (t.segments || []).map((s) => s.text).join(' ');
  return `${rec.name} ${t.text || ''} ${segs}`.toLowerCase();
}

async function loadLibrary(filter = '') {
  const list = document.getElementById('library-list');
  const emptyState = document.getElementById('library-no-files');
  const recentEmpty = document.getElementById('library-empty');
  const recentList = document.getElementById('recent-recordings-list');

  try {
    libraryCache = await window.api.listRecordings();
    const q = filter.trim().toLowerCase();
    const recordings = q ? libraryCache.filter((r) => searchableText(r).includes(q)) : libraryCache;

    if (libraryCache.length === 0) {
      emptyState?.classList.remove('hidden');
      recentEmpty?.classList.remove('hidden');
      recentList?.classList.add('hidden');
      list.querySelectorAll('.library-item').forEach((i) => i.remove());
      return;
    }

    emptyState?.classList.add('hidden');
    recentEmpty?.classList.add('hidden');
    recentList?.classList.remove('hidden');
    recentList.innerHTML = libraryCache.slice(0, 3).map((rec) => (
      `<button class="recent-row" data-name="${escapeHtml(rec.name)}">${escapeHtml(rec.name.replace(/\.webm$/i, ''))}${rec.hasTranscript ? ' · transcript' : ''}</button>`
    )).join('');
    recentList.querySelectorAll('.recent-row').forEach((btn) => {
      btn.addEventListener('click', () => openLibraryItem(btn.dataset.name));
    });

    list.querySelectorAll('.library-item').forEach((i) => i.remove());
    if (recordings.length === 0) {
      const none = document.createElement('p');
      none.className = 'empty-copy';
      none.textContent = 'No matches in titles or transcript text.';
      list.appendChild(none);
      return;
    }

    recordings.forEach((rec) => {
      const item = document.createElement('div');
      item.className = 'library-item';
      const snippet = (rec.transcript?.transcript?.text || rec.transcript?.text || '').slice(0, 90);
      item.innerHTML = `
        <div class="library-item-icon" aria-hidden="true"></div>
        <div class="library-item-info">
          <div class="library-item-name">${escapeHtml(rec.name)}</div>
          <div class="library-item-meta">
            <span>${formatFileSize(rec.size)}</span>
            <span>${new Date(rec.created).toLocaleString()}</span>
            <span>${rec.hasTranscript ? 'Transcript ready' : 'Audio only'}</span>
          </div>
          ${snippet ? `<div class="library-snippet">${escapeHtml(snippet)}…</div>` : ''}
        </div>
        <div class="library-item-actions">
          <button class="btn btn-sm btn-outline btn-lib-play">Play</button>
          ${rec.hasTranscript ? '<button class="btn btn-sm btn-primary btn-lib-open">Open</button>' : ''}
        </div>
      `;
      item.querySelector('.btn-lib-play')?.addEventListener('click', (e) => {
        e.stopPropagation();
        playLibraryFile(rec, item.querySelector('.btn-lib-play'));
      });
      item.querySelector('.btn-lib-open')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openLibraryItem(rec.name);
      });
      list.appendChild(item);
    });
  } catch (err) {
    console.error(err);
  }
}

async function playLibraryFile(rec, playBtn) {
  if (playBtn.classList.contains('playing')) {
    stopCurrentPlayback();
    return;
  }
  stopCurrentPlayback();
  const buffer = await window.api.readRecording(rec.name);
  if (!buffer) {
    showToast('Could not load file', 'error');
    return;
  }
  const url = URL.createObjectURL(new Blob([buffer], { type: 'audio/webm' }));
  currentPlaybackAudio = new Audio(url);
  currentPlaybackAudio.onended = () => {
    stopCurrentPlayback();
    URL.revokeObjectURL(url);
  };
  await currentPlaybackAudio.play();
  playBtn.classList.add('playing', 'btn-stop-active');
  playBtn.textContent = 'Stop';
}

function openLibraryItem(name) {
  const rec = libraryCache.find((r) => r.name === name);
  if (!rec) return;
  if (rec.hasTranscript && rec.transcript) {
    lastTranscriptAudioName = rec.name;
    renderTranscript({
      filename: rec.name,
      meetingTitle: rec.transcript.meetingTitle,
      jobId: rec.transcript.jobId,
      transcript: rec.transcript.transcript || rec.transcript,
    });
    navigateTo('transcript');
  } else {
    lastSavedFilename = rec.name;
    recFilename.textContent = rec.name;
    navigateTo('record');
    showToast('Audio only — send to WhipScribe when you want speakers', 'info');
  }
}

document.getElementById('library-search')?.addEventListener('input', (e) => {
  loadLibrary(e.target.value);
});

function getSampleMeetings() {
  const now = Date.now();
  return [
    {
      id: 'meet-1',
      title: 'Weekly standup',
      start: new Date(now + 15 * 60 * 1000),
      end: new Date(now + 45 * 60 * 1000),
      platform: 'meet',
      platformName: 'Google Meet',
      attendees: 'You',
    },
    {
      id: 'meet-2',
      title: 'Architecture sync',
      start: new Date(now + 75 * 60 * 1000),
      end: new Date(now + 120 * 60 * 1000),
      platform: 'zoom',
      platformName: 'Zoom',
      attendees: 'Engineering',
    },
    {
      id: 'meet-3',
      title: 'Client feedback',
      start: new Date(now + 180 * 60 * 1000),
      end: new Date(now + 240 * 60 * 1000),
      platform: 'meet',
      platformName: 'Google Meet',
      attendees: 'Stakeholders',
    },
  ];
}

function renderCalendar(meetings, mode) {
  currentMeetings = meetings || [];
  calendarMode = mode || calendarMode;
  const notConnected = document.getElementById('calendar-not-connected');
  const connectedView = document.getElementById('calendar-connected-view');
  const list = document.getElementById('meetings-list');
  const statusText = document.getElementById('calendar-status-text');

  if (!meetings || meetings.length === 0) {
    notConnected?.classList.remove('hidden');
    connectedView?.classList.add('hidden');
    updateDashboardMeeting(null);
    updateSettingsCalendarStatus([]);
    return;
  }

  notConnected?.classList.add('hidden');
  connectedView?.classList.remove('hidden');
  if (statusText) {
    statusText.textContent = calendarMode === 'demo'
      ? `${meetings.length} sample meetings (not your real calendar)`
      : `${meetings.length} upcoming events`;
  }

  list.innerHTML = '';
  meetings.forEach((m) => {
    const soon = Math.abs(m.start.getTime() - Date.now()) < 30 * 60 * 1000;
    const card = document.createElement('div');
    card.className = `meeting-card ${soon ? 'meeting-now' : ''}`;
    card.innerHTML = `
      <div class="meeting-info">
        <div class="meeting-header-row">
          <span class="meeting-name">${escapeHtml(m.title)}</span>
          <span class="meeting-badge-platform platform-${m.platform}">${escapeHtml(m.platformName)}</span>
        </div>
        <div class="meeting-timing">
          <span><strong>${formatMeetingTime(m.start)} – ${formatMeetingTime(m.end)}</strong></span>
          <span class="meeting-starts-in">${formatRelativeTime(m.start)}</span>
          ${m.attendees ? `<span>${escapeHtml(m.attendees)}</span>` : ''}
        </div>
      </div>
      <button class="meeting-btn-record">Record this — no bot</button>
    `;
    card.querySelector('.meeting-btn-record').addEventListener('click', () => startMeetingRecording(m));
    list.appendChild(card);
  });

  updateDashboardMeeting(meetings[0]);
  updateSettingsCalendarStatus(meetings);
}

function updateSettingsCalendarStatus(meetings) {
  const statusContainer = document.getElementById('calendar-connection-status');
  if (!statusContainer) return;
  if (meetings?.length) {
    statusContainer.innerHTML = `
      <div class="status-dot status-connected"></div>
      <span>${calendarMode === 'demo' ? 'Sample calendar' : 'iCal synced'}</span>
      <button class="btn btn-sm btn-outline" id="btn-settings-view-calendar">View</button>
    `;
    statusContainer.querySelector('#btn-settings-view-calendar')?.addEventListener('click', () => navigateTo('calendar'));
  } else {
    statusContainer.innerHTML = `
      <div class="status-dot status-disconnected"></div>
      <span>Not connected</span>
      <button class="btn btn-sm btn-outline" id="btn-settings-connect-calendar">Connect</button>
    `;
    statusContainer.querySelector('#btn-settings-connect-calendar')?.addEventListener('click', () => navigateTo('calendar'));
  }
}

function startMeetingRecording(meeting) {
  armedMeeting = meeting;
  recFilename.textContent = defaultFilename();
  navigateTo('record');
  startRecording();
}

function updateDashboardMeeting(meeting) {
  const emptyEl = document.getElementById('calendar-empty');
  const infoEl = document.getElementById('next-meeting-info');
  clearInterval(countdownInterval);

  if (!meeting) {
    emptyEl?.classList.remove('hidden');
    infoEl?.classList.add('hidden');
    return;
  }

  emptyEl?.classList.add('hidden');
  infoEl?.classList.remove('hidden');

  const paint = () => {
    infoEl.innerHTML = `
      <p class="eyebrow">Next meeting</p>
      <h2>${escapeHtml(meeting.title)}</h2>
      <p class="hero-when">${formatMeetingTime(meeting.start)} – ${formatMeetingTime(meeting.end)} · ${formatRelativeTime(meeting.start)}</p>
      <p class="hero-note">Offstage will not join ${escapeHtml(meeting.platformName)}. It records this PC.</p>
      <button class="btn btn-primary" id="btn-dash-record-meeting"><span class="btn-dot"></span> Record this call</button>
    `;
    infoEl.querySelector('#btn-dash-record-meeting')?.addEventListener('click', () => startMeetingRecording(meeting));
  };
  paint();
  countdownInterval = setInterval(paint, 30000);
}

document.getElementById('btn-load-demo-calendar')?.addEventListener('click', async () => {
  const sample = getSampleMeetings();
  renderCalendar(sample, 'demo');
  await window.api.setStore('calendar_mode', 'demo');
  showToast('Sample meetings only — not fetched from Google', 'success');
});

document.getElementById('btn-disconnect-calendar')?.addEventListener('click', async () => {
  renderCalendar([]);
  await window.api.setStore('calendar_mode', null);
  await window.api.setStore('ical_url', null);
  showToast('Calendar cleared', 'info');
});

document.getElementById('btn-refresh-calendar')?.addEventListener('click', async () => {
  if (calendarMode === 'demo') {
    renderCalendar(getSampleMeetings(), 'demo');
    return;
  }
  const url = await window.api.getStore('ical_url');
  if (url) syncIcal(url);
});

document.getElementById('btn-sync-ical')?.addEventListener('click', async () => {
  const url = document.getElementById('input-ical-url')?.value.trim();
  if (!url) {
    showToast('Paste a secret iCal URL', 'error');
    return;
  }
  await syncIcal(url);
});

async function syncIcal(url) {
  showToast('Fetching calendar…', 'info');
  try {
    const icsText = await window.api.fetchICal(url);
    const meetings = parseICal(icsText);
    if (meetings.length === 0) {
      showToast('No upcoming events in this feed', 'warning');
      return;
    }
    await window.api.setStore('ical_url', url);
    await window.api.setStore('calendar_mode', 'ical');
    renderCalendar(meetings, 'ical');
    showToast(`Synced ${meetings.length} events`, 'success');
  } catch (err) {
    showToast(`Sync failed: ${err.message}`, 'error', 6000);
  }
}

function parseICal(icsText) {
  const events = [];
  const unfolded = icsText.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  const lines = unfolded.split(/\r\n|\n|\r/);
  let inEvent = false;
  let currentEvent = {};

  for (const line of lines) {
    if (line.startsWith('BEGIN:VEVENT')) {
      inEvent = true;
      currentEvent = {};
    } else if (line.startsWith('END:VEVENT')) {
      inEvent = false;
      if (currentEvent.title && currentEvent.start) events.push(currentEvent);
    } else if (inEvent) {
      if (line.startsWith('SUMMARY:')) currentEvent.title = line.substring(8).replace(/\\,/g, ',').replace(/\\;/g, ';');
      else if (line.startsWith('DTSTART')) currentEvent.start = parseICalDate(line.split(':').pop());
      else if (line.startsWith('DTEND')) currentEvent.end = parseICalDate(line.split(':').pop());
      else if (line.startsWith('LOCATION:')) currentEvent.location = line.substring(9).replace(/\\,/g, ',');
      else if (line.startsWith('DESCRIPTION:')) currentEvent.description = line.substring(12);
    }
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const upcoming = events.filter((e) => (e.end || e.start) >= startOfDay).sort((a, b) => a.start - b.start);
  const displayList = upcoming.length > 0 ? upcoming.slice(0, 12) : events.slice(0, 10);

  return displayList.map((e, idx) => {
    const rawText = `${e.title || ''} ${e.location || ''} ${e.description || ''}`.toLowerCase();
    let platform = 'meet';
    let platformName = 'Meeting';
    if (rawText.includes('zoom')) { platform = 'zoom'; platformName = 'Zoom'; }
    else if (rawText.includes('teams.microsoft') || rawText.includes('teams')) { platform = 'teams'; platformName = 'Teams'; }
    else if (rawText.includes('meet.google') || rawText.includes('google meet')) { platform = 'meet'; platformName = 'Google Meet'; }
    return {
      id: `ical-${idx}`,
      title: e.title || 'Untitled',
      start: e.start || new Date(),
      end: e.end || new Date((e.start ? e.start.getTime() : Date.now()) + 30 * 60000),
      platform,
      platformName,
      attendees: e.location ? e.location.slice(0, 40) : '',
    };
  });
}

function parseICalDate(str) {
  if (!str) return new Date();
  const clean = str.replace(/[^0-9TZ]/g, '');
  const y = parseInt(clean.substring(0, 4), 10);
  const m = parseInt(clean.substring(4, 6), 10) - 1;
  const d = parseInt(clean.substring(6, 8), 10);
  if (clean.length === 8) return new Date(y, m, d);
  const h = parseInt(clean.substring(9, 11), 10) || 0;
  const min = parseInt(clean.substring(11, 13), 10) || 0;
  const s = parseInt(clean.substring(13, 15), 10) || 0;
  if (clean.endsWith('Z')) return new Date(Date.UTC(y, m, d, h, min, s));
  return new Date(y, m, d, h, min, s);
}

async function checkOrphans() {
  const banner = document.getElementById('recovery-banner');
  const orphans = await window.api.listOrphans();
  if (!orphans.length) {
    banner.classList.add('hidden');
    banner.innerHTML = '';
    return;
  }
  const o = orphans[0];
  banner.classList.remove('hidden');
  banner.innerHTML = `
    <strong>Interrupted recording</strong>
    <span>${escapeHtml(o.filename || o.id)} · ${o.chunkCount || 0} seconds on disk</span>
    <button class="btn btn-sm btn-primary" id="btn-recover">Salvage</button>
    <button class="btn btn-sm btn-ghost" id="btn-drop-orphan">Discard</button>
  `;
  banner.querySelector('#btn-recover').addEventListener('click', async () => {
    try {
      const saved = await window.api.recoverSession(o.id);
      showToast(`Recovered ${saved.filename}`, 'success');
      checkOrphans();
      loadLibrary();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
  banner.querySelector('#btn-drop-orphan').addEventListener('click', async () => {
    await window.api.discardSession(o.id);
    checkOrphans();
  });
}

window.api.onTrayStartRecording?.(() => {
  navigateTo('record');
  if (!isRecording) startRecording();
});
window.api.onTrayStopRecording?.(() => {
  if (isRecording) stopRecording();
});

(async () => {
  const savedKey = await window.api.getEncrypted('whipscribe_api_key');
  if (savedKey) document.getElementById('api-key-input').value = savedKey;
  const auto = await window.api.getStore('auto_transcribe');
  if (auto) document.getElementById('auto-transcribe').checked = true;
  const ical = await window.api.getStore('ical_url');
  const mode = await window.api.getStore('calendar_mode');
  if (ical) {
    document.getElementById('input-ical-url').value = ical;
    syncIcal(ical);
  } else if (mode === 'demo') {
    renderCalendar(getSampleMeetings(), 'demo');
  }
  checkApiStatus();
  loadLibrary();
  checkOrphans();
  document.getElementById('btn-settings-connect-calendar')?.addEventListener('click', () => navigateTo('calendar'));
})();
