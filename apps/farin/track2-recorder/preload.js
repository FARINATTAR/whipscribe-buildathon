const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getRecordingsDir: () => ipcRenderer.invoke('fs:get-recordings-dir'),
  saveRecording: (filename, buffer) => ipcRenderer.invoke('fs:save-recording', filename, buffer),
  readRecording: (filename) => ipcRenderer.invoke('fs:read-recording', filename),
  deleteRecording: (filename) => ipcRenderer.invoke('fs:delete-recording', filename),
  listRecordings: () => ipcRenderer.invoke('fs:list-recordings'),
  saveTranscript: (audioFilename, payload) => ipcRenderer.invoke('fs:save-transcript', audioFilename, payload),
  saveTextDialog: (defaultName, text) => ipcRenderer.invoke('fs:save-text-dialog', defaultName, text),

  getDesktopSource: () => ipcRenderer.invoke('audio:desktop-source'),

  fetchICal: (url) => ipcRenderer.invoke('calendar:fetch-ical', url),

  startSession: (meta) => ipcRenderer.invoke('session:start', meta),
  appendChunk: (sessionId, buffer) => ipcRenderer.invoke('session:append-chunk', sessionId, buffer),
  finalizeSession: (sessionId) => ipcRenderer.invoke('session:finalize', sessionId),
  listOrphans: () => ipcRenderer.invoke('session:list-orphans'),
  recoverSession: (sessionId) => ipcRenderer.invoke('session:recover', sessionId),
  discardSession: (sessionId) => ipcRenderer.invoke('session:discard', sessionId),

  setEncrypted: (key, value) => ipcRenderer.invoke('store:set-encrypted', key, value),
  getEncrypted: (key) => ipcRenderer.invoke('store:get-encrypted', key),
  setStore: (key, value) => ipcRenderer.invoke('store:set', key, value),
  getStore: (key) => ipcRenderer.invoke('store:get', key),

  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),

  onTrayStartRecording: (callback) => ipcRenderer.on('tray:start-recording', callback),
  onTrayStopRecording: (callback) => ipcRenderer.on('tray:stop-recording', callback),
});
