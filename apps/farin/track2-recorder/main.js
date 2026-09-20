const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, safeStorage, desktopCapturer, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let tray = null;
const isDev = process.argv.includes('--dev');

const recordingsDir = () => path.join(app.getPath('userData'), 'recordings');
const sessionsDir = () => path.join(app.getPath('userData'), 'sessions');
const storePath = () => path.join(app.getPath('userData'), 'config.json');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function safeName(name) {
  return path.basename(String(name || 'recording')).replace(/[^\w.\-]+/g, '_').slice(0, 120);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 580,
    title: 'Offstage — WhipScribe recorder',
    backgroundColor: '#0b0f14',
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function trayIcon() {
  // Tiny red-dot PNG so the tray exists without a binary asset.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVR4nGNgGAWjYBSMglEwCkbBKBicwPj////D+P///2E0GomJgYGBgYGBgYEBAQYAAP//AMcDBP0n2b8AAAAASUVORK5CYII=',
    'base64'
  );
  return nativeImage.createFromBuffer(png);
}

function createTray() {
  try {
    tray = new Tray(trayIcon());
    tray.setToolTip('Offstage — recording stays on this machine');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Offstage', click: () => mainWindow?.show() },
      { type: 'separator' },
      { label: 'Start recording', click: () => mainWindow?.webContents.send('tray:start-recording') },
      { label: 'Stop recording', click: () => mainWindow?.webContents.send('tray:stop-recording') },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]));
    tray.on('click', () => mainWindow?.show());
  } catch {
    /* tray is optional */
  }
}

function sessionPath(id) {
  return path.join(sessionsDir(), safeName(id));
}

ipcMain.handle('fs:get-recordings-dir', () => {
  ensureDir(recordingsDir());
  return recordingsDir();
});

ipcMain.handle('fs:save-recording', async (_, filename, arrayBuffer) => {
  ensureDir(recordingsDir());
  const filePath = path.join(recordingsDir(), safeName(filename));
  fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
  return filePath;
});

ipcMain.handle('fs:read-recording', async (_, filename) => {
  const filePath = path.join(recordingsDir(), safeName(filename));
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath);
});

ipcMain.handle('fs:delete-recording', async (_, filename) => {
  const base = safeName(filename);
  const filePath = path.join(recordingsDir(), base);
  const jsonPath = path.join(recordingsDir(), base.replace(/\.(webm|wav|mp3|m4a)$/i, '') + '.json');
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
  return true;
});

ipcMain.handle('fs:save-transcript', async (_, audioFilename, payload) => {
  ensureDir(recordingsDir());
  const base = safeName(audioFilename).replace(/\.(webm|wav|mp3|m4a)$/i, '');
  const filePath = path.join(recordingsDir(), `${base}.json`);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return filePath;
});

ipcMain.handle('fs:save-text-dialog', async (_, defaultName, text) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: safeName(defaultName),
    filters: [
      { name: 'Text', extensions: ['txt'] },
      { name: 'JSON', extensions: ['json'] },
    ],
  });
  if (result.canceled || !result.filePath) return null;
  fs.writeFileSync(result.filePath, text, 'utf8');
  return result.filePath;
});

ipcMain.handle('fs:list-recordings', () => {
  ensureDir(recordingsDir());
  const files = fs.readdirSync(recordingsDir());
  return files
    .filter((f) => /\.(wav|webm|mp3|m4a)$/i.test(f))
    .map((f) => {
      const filePath = path.join(recordingsDir(), f);
      const stat = fs.statSync(filePath);
      const jsonPath = path.join(recordingsDir(), f.replace(/\.(webm|wav|mp3|m4a)$/i, '') + '.json');
      let transcript = null;
      if (fs.existsSync(jsonPath)) {
        try { transcript = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch { transcript = { exists: true }; }
      }
      return {
        name: f,
        path: filePath,
        size: stat.size,
        created: stat.birthtime.toISOString(),
        hasTranscript: Boolean(transcript),
        transcript,
      };
    })
    .sort((a, b) => new Date(b.created) - new Date(a.created));
});

ipcMain.handle('audio:desktop-source', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 1, height: 1 },
  });
  return sources[0]?.id || null;
});

ipcMain.handle('calendar:fetch-ical', async (_, url) => {
  const trimmedUrl = String(url || '').trim();
  const validUrl = /^https?:\/\//i.test(trimmedUrl) ? trimmedUrl : `https://${trimmedUrl}`;
  const res = await fetch(validUrl, {
    headers: {
      'User-Agent': 'Offstage/0.2 WhipScribe-desktop',
      Accept: 'text/calendar, text/plain, */*',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText || 'Failed to fetch calendar'}`);
  return await res.text();
});

ipcMain.handle('session:start', async (_, meta) => {
  const id = safeName(meta.id || `sess_${Date.now()}`);
  const dir = sessionPath(id);
  ensureDir(path.join(dir, 'chunks'));
  const data = {
    id,
    startedAt: Date.now(),
    filename: safeName(meta.filename || `${id}.webm`),
    meetingTitle: meta.meetingTitle || null,
    source: meta.source || 'mic',
    status: 'recording',
    chunkCount: 0,
  };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(data, null, 2));
  return data;
});

ipcMain.handle('session:append-chunk', async (_, sessionId, arrayBuffer) => {
  const dir = sessionPath(sessionId);
  const metaPath = path.join(dir, 'meta.json');
  if (!fs.existsSync(metaPath)) throw new Error('No recording session on disk');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const index = String(meta.chunkCount).padStart(6, '0');
  fs.writeFileSync(path.join(dir, 'chunks', `${index}.webm`), Buffer.from(arrayBuffer));
  meta.chunkCount += 1;
  meta.lastChunkAt = Date.now();
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  return meta;
});

ipcMain.handle('session:finalize', async (_, sessionId) => {
  const dir = sessionPath(sessionId);
  const metaPath = path.join(dir, 'meta.json');
  if (!fs.existsSync(metaPath)) throw new Error('No recording session on disk');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  ensureDir(recordingsDir());
  const chunksDir = path.join(dir, 'chunks');
  const parts = fs.readdirSync(chunksDir).filter((f) => f.endsWith('.webm')).sort();
  const outPath = path.join(recordingsDir(), safeName(meta.filename));
  if (parts.length === 0) throw new Error('No audio chunks on disk');
  fs.writeFileSync(outPath, Buffer.concat(parts.map((part) => fs.readFileSync(path.join(chunksDir, part)))));
  meta.status = 'complete';
  meta.finalPath = outPath;
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  const stat = fs.statSync(outPath);
  return { path: outPath, size: stat.size, filename: meta.filename, meetingTitle: meta.meetingTitle };
});

ipcMain.handle('session:list-orphans', () => {
  ensureDir(sessionsDir());
  return fs.readdirSync(sessionsDir())
    .map((id) => {
      const metaPath = path.join(sessionsDir(), id, 'meta.json');
      if (!fs.existsSync(metaPath)) return null;
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        return meta.status === 'recording' ? meta : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
});

ipcMain.handle('session:discard', async (_, sessionId) => {
  const dir = sessionPath(sessionId);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  return true;
});

ipcMain.handle('store:set-encrypted', (_, key, value) => {
  const store = getStore();
  if (!safeStorage.isEncryptionAvailable()) {
    store[key] = value;
    saveStore(store);
    return true;
  }
  store[key] = safeStorage.encryptString(value).toString('base64');
  saveStore(store);
  return true;
});

ipcMain.handle('store:get-encrypted', (_, key) => {
  const store = getStore();
  const val = store[key];
  if (!val) return null;
  if (!safeStorage.isEncryptionAvailable()) return val;
  try {
    return safeStorage.decryptString(Buffer.from(val, 'base64'));
  } catch {
    return null;
  }
});

ipcMain.handle('store:set', (_, key, value) => {
  const store = getStore();
  store[key] = value;
  saveStore(store);
});

ipcMain.handle('store:get', (_, key) => {
  const store = getStore();
  return store[key] ?? null;
});

ipcMain.handle('shell:open-external', (_, url) => shell.openExternal(url));

function getStore() {
  try {
    if (fs.existsSync(storePath())) return JSON.parse(fs.readFileSync(storePath(), 'utf8'));
  } catch { /* ignore */ }
  return {};
}

function saveStore(data) {
  fs.writeFileSync(storePath(), JSON.stringify(data, null, 2), 'utf8');
}

ipcMain.handle('session:recover', async (_, sessionId) => {
  const dir = sessionPath(sessionId);
  const metaPath = path.join(dir, 'meta.json');
  if (!fs.existsSync(metaPath)) throw new Error('Nothing to recover');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  ensureDir(recordingsDir());
  const chunksDir = path.join(dir, 'chunks');
  const parts = fs.existsSync(chunksDir)
    ? fs.readdirSync(chunksDir).filter((f) => f.endsWith('.webm')).sort()
    : [];
  if (parts.length === 0) throw new Error('This interrupted recording has no audio on disk');
  const outPath = path.join(recordingsDir(), safeName(meta.filename || `${meta.id}.webm`));
  const buffers = parts.map((part) => fs.readFileSync(path.join(chunksDir, part)));
  fs.writeFileSync(outPath, Buffer.concat(buffers));
  meta.status = 'recovered';
  meta.finalPath = outPath;
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  const stat = fs.statSync(outPath);
  return { path: outPath, size: stat.size, filename: path.basename(outPath), meetingTitle: meta.meetingTitle };
});

app.whenReady().then(() => {
  ensureDir(recordingsDir());
  ensureDir(sessionsDir());
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (!mainWindow) createWindow();
});
