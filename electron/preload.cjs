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
    separateStems: (filePath) => ipcRenderer.invoke("media:separate-stems", filePath),
    separateStemsFast: (filePath) => ipcRenderer.invoke("media:separate-stems-fast", filePath),
    stemsModelStatus: () => ipcRenderer.invoke("media:stems-model-status"),
    downloadStemsModel: () => ipcRenderer.invoke("media:download-stems-model"),
    separateStemsBuiltin: (filePath) => ipcRenderer.invoke("media:separate-stems-builtin", filePath),
    onModelProgress: (cb) => {
      const handler = (_event, data) => cb(data);
      ipcRenderer.on("model:download-progress", handler);
      return () => ipcRenderer.removeListener("model:download-progress", handler);
    },
    whisperStatus: () => ipcRenderer.invoke("media:whisper-status"),
    transcribeBuiltin: (fp, lang, ts, td, model) =>
      ipcRenderer.invoke("media:transcribe-builtin", fp, lang, ts, td, model),
    onWhisperStatus: (cb) => {
      const handler = (_event, data) => cb(data);
      ipcRenderer.on("whisper:status", handler);
      return () => ipcRenderer.removeListener("whisper:status", handler);
    },
    thumbnailStrip: (filePath, opts) => ipcRenderer.invoke("media:thumbnail-strip", filePath, opts),
    transcribe: (filePath, language, trimStart, trimDuration) => ipcRenderer.invoke("media:transcribe", filePath, language, trimStart, trimDuration),
    saveAudio: (srcPath, defaultName) => ipcRenderer.invoke("media:save-audio", srcPath, defaultName),
    detectSilence: (filePath, opts) => ipcRenderer.invoke("media:detect-silence", filePath, opts),
    detectRepeats: (filePath) => ipcRenderer.invoke("media:detect-repeats", filePath),
    removeWatermark: (filePath, region) => ipcRenderer.invoke("media:remove-watermark", filePath, region),
    onProgress: (cb) => {
      const handler = (_event, data) => cb(data);
      ipcRenderer.on("media:progress", handler);
      return () => ipcRenderer.removeListener("media:progress", handler);
    },
    registerProxy: (filePath) => ipcRenderer.invoke("media:register-proxy", filePath),
    listVoices: () => ipcRenderer.invoke("media:list-voices"),
    synthesizeVoice: (text, voice) => ipcRenderer.invoke("media:synthesize-voice", text, voice),
    lipsyncStatus: () => ipcRenderer.invoke("media:lipsync-status"),
    lipSync: (videoPath, audioPath, trimStart, trimDuration) =>
      ipcRenderer.invoke("media:lipsync", videoPath, audioPath, trimStart, trimDuration),
  },

  // ── Google Auth ───────────────────────────────────────────────────────────
  googleAuthConfigured: () => ipcRenderer.invoke("google-auth-configured"),
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
  loadProjectFile: (filePath) => ipcRenderer.invoke("load-project-file", filePath),

  // ── File Path from Drop ────────────────────────────────────────────────
  getPathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch { return null; }
  },

  // ── Export ────────────────────────────────────────────────────────────────
  exportVideo: (payload) => ipcRenderer.invoke("export-video", payload),
  exportAudio: (payload) => ipcRenderer.invoke("export-audio", payload),
  exportGif: (payload) => ipcRenderer.invoke("export-gif", payload),
  savePortableV4: (payload) => ipcRenderer.invoke("save-v4-portable", payload),
  onExportProgress: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on("export-progress", handler);
    return () => ipcRenderer.removeListener("export-progress", handler);
  },
});
