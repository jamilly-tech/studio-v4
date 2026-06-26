const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("studioV4", {
  isElectron: true,

  // ── Media Ingest (novo pipeline universal) ────────────────────────────────
  media: {
    ingest: (filePath) => ipcRenderer.invoke("media:ingest", filePath),
    probe: (filePath) => ipcRenderer.invoke("media:probe", filePath),
    thumbnail: (filePath, opts) => ipcRenderer.invoke("media:thumbnail", filePath, opts),
    waveform: (filePath, numBars) => ipcRenderer.invoke("media:waveform", filePath, numBars),
    createProxy: (filePath, opts) => ipcRenderer.invoke("media:create-proxy", filePath, opts),
    convertAudio: (filePath, opts) => ipcRenderer.invoke("media:convert-audio", filePath, opts),
    extractWav: (filePath) => ipcRenderer.invoke("media:extract-wav", filePath),
    thumbnailStrip: (filePath, opts) => ipcRenderer.invoke("media:thumbnail-strip", filePath, opts),
    transcribe: (filePath, language) => ipcRenderer.invoke("media:transcribe", filePath, language),
    removeWatermark: (filePath, region) => ipcRenderer.invoke("media:remove-watermark", filePath, region),
    separateVocals: (filePath, opts) => ipcRenderer.invoke("media:separate-vocals", filePath, opts),
    onProgress: (cb) => {
      const handler = (_event, data) => cb(data);
      ipcRenderer.on("media:progress", handler);
      return () => ipcRenderer.removeListener("media:progress", handler);
    },
    registerProxy: (filePath) => ipcRenderer.invoke("media:register-proxy", filePath),
  },

  // ── Google Auth ───────────────────────────────────────────────────────────
  googleAuth: () => ipcRenderer.invoke("google-auth"),
  googleRefreshToken: (refreshToken) => ipcRenderer.invoke("google-refresh-token", refreshToken),

  // ── Persistence ───────────────────────────────────────────────────────────
  readRecentProjects: () => ipcRenderer.invoke("read-recent-projects"),
  writeRecentProjects: (data) => ipcRenderer.invoke("write-recent-projects", data),
  readConfig: () => ipcRenderer.invoke("read-config"),
  writeConfig: (data) => ipcRenderer.invoke("write-config", data),

  // ── File Dialogs ──────────────────────────────────────────────────────────
  openFileDialog: () => ipcRenderer.invoke("open-file-dialog"),
  showSaveDialog: (opts) => ipcRenderer.invoke("show-save-dialog", opts),
  saveProjectFile: (payload) => ipcRenderer.invoke("save-project-file", payload),
  openProjectFile: () => ipcRenderer.invoke("open-project-file"),

  // ── File Path from Drop ────────────────────────────────────────────────
  getPathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch { return null; }
  },

  // ── Export ────────────────────────────────────────────────────────────────
  exportVideo: (payload) => ipcRenderer.invoke("export-video", payload),
  onExportProgress: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on("export-progress", handler);
    return () => ipcRenderer.removeListener("export-progress", handler);
  },
});
