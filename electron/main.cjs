// Carrega .env de multiplos locais possiveis
(function loadEnv() {
  const fs = require("node:fs");
  const path = require("node:path");
  const candidates = [
    path.join(__dirname, "..", ".env"),
    path.join(__dirname, ".env"),
    path.join(process.resourcesPath || "", ".env"),
  ];
  for (const envPath of candidates) {
    try {
      const lines = fs.readFileSync(envPath, "utf-8").split("\n");
      for (const line of lines) {
        const match = line.match(/^([^#=]+)=(.*)$/);
        if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim();
      }
      break;
    } catch {}
  }
})();

const { app, BrowserWindow, shell, ipcMain, screen, dialog } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const archiver = require("archiver");
const AdmZip = require("adm-zip");

// ── Separação vocal built-in (ONNX — sem Python) ─────────────────────────────
const stemsEngine = require("./stems-engine.cjs");

const STEMS_MODEL_NAME = "Kim_Vocal_2.onnx";
const STEMS_MODEL_URL  = "https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/Kim_Vocal_2.onnx";

function stemsModelDir()  { return path.join(app.getPath("userData"), "models"); }
function stemsModelPath() { return path.join(stemsModelDir(), STEMS_MODEL_NAME); }

function downloadWithRedirects(url, destPath, onProgress, redirectCount) {
  return new Promise((resolve, reject) => {
    if ((redirectCount||0) > 8) return reject(new Error("Muitos redirects"));
    const isHttps = url.startsWith("https");
    const mod = isHttps ? https : http;
    mod.get(url, { headers: { "User-Agent": "StudioV4/1.0" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return downloadWithRedirects(res.headers.location, destPath, onProgress, (redirectCount||0)+1)
          .then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const total = parseInt(res.headers["content-length"]||"0", 10);
      let done = 0;
      const file = fs.createWriteStream(destPath);
      res.on("data", chunk => {
        file.write(chunk);
        done += chunk.length;
        if (total > 0) onProgress?.(Math.round(done/total*100), done, total);
      });
      res.on("end", () => { file.end(() => resolve()); });
      res.on("error", err => { file.destroy(); reject(err); });
    }).on("error", reject);
  });
}

async function ensureModelDownloaded() {
  const mp = stemsModelPath();
  if (fs.existsSync(mp) && fs.statSync(mp).size > 10_000_000) return; // já existe
  fs.mkdirSync(stemsModelDir(), { recursive: true });
  const tmp = mp + ".download";
  try {
    await downloadWithRedirects(STEMS_MODEL_URL, tmp, (pct, done, total) => {
      sendProgress("model:download-progress", { percent: pct, done, total, name: STEMS_MODEL_NAME });
    });
    fs.renameSync(tmp, mp);
    sendProgress("model:download-progress", { percent: 100, done: 0, total: 0, ready: true });
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch {}
    sendProgress("model:download-progress", { error: String(err?.message||err) });
  }
}

// ── Whisper.cpp nativo (sem Python) ──────────────────────────────────────────

const WHISPER_ZIP_URL   = "https://github.com/ggerganov/whisper.cpp/releases/download/v1.7.4/whisper-blas-bin-x64.zip";
const WHISPER_MODEL_URLS = {
  tiny:  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
  small: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
};

function whisperDir()          { return path.join(app.getPath("userData"), "whisper"); }
function whisperExePath()      { return path.join(whisperDir(), "whisper-cli.exe"); }
function whisperModelPath(m)   { return path.join(whisperDir(), `ggml-${m}.bin`); }
function whisperModelReady(m)  {
  const p = whisperModelPath(m);
  const minSize = m === "tiny" ? 50_000_000 : 100_000_000;
  return fs.existsSync(p) && fs.statSync(p).size > minSize;
}

async function ensureWhisperReady() {
  const dir = whisperDir();
  fs.mkdirSync(dir, { recursive: true });

  // Baixa e extrai binário Whisper.cpp se necessário
  if (!fs.existsSync(whisperExePath())) {
    const zipTmp = path.join(dir, "_whisper.zip");
    try {
      await downloadWithRedirects(WHISPER_ZIP_URL, zipTmp, (pct) => {
        sendProgress("whisper:status", { stage: "exe", percent: pct });
      });
      const ZipCtor = require("adm-zip");
      const zip = new ZipCtor(zipTmp);
      zip.extractAllTo(dir, true);
      // Normaliza nome do executável (muda entre versões)
      for (const name of ["whisper-cli.exe", "main.exe"]) {
        const p = path.join(dir, name);
        if (fs.existsSync(p) && p !== whisperExePath()) { fs.renameSync(p, whisperExePath()); break; }
        if (fs.existsSync(p)) break;
      }
      try { fs.unlinkSync(zipTmp); } catch {}
      sendProgress("whisper:status", { stage: "exe", percent: 100, ready: true });
    } catch (err) {
      try { fs.unlinkSync(zipTmp); } catch {}
      sendProgress("whisper:status", { stage: "exe", error: String(err?.message||err) });
    }
  }

  // Baixa modelo tiny (~75 MB)
  if (!whisperModelReady("tiny")) {
    const tmp = whisperModelPath("tiny") + ".dl";
    try {
      await downloadWithRedirects(WHISPER_MODEL_URLS.tiny, tmp, (pct, done, total) => {
        sendProgress("whisper:status", { stage: "model-tiny", percent: pct, done, total });
      });
      fs.renameSync(tmp, whisperModelPath("tiny"));
      sendProgress("whisper:status", { stage: "model-tiny", percent: 100, ready: true });
    } catch (err) {
      try { fs.unlinkSync(tmp); } catch {}
      sendProgress("whisper:status", { stage: "model-tiny", error: String(err?.message||err) });
    }
  }
}

ipcMain.handle("media:whisper-status", () => ({
  exeReady:   fs.existsSync(whisperExePath()),
  tinyReady:  whisperModelReady("tiny"),
  smallReady: whisperModelReady("small"),
}));

ipcMain.handle("media:transcribe-builtin", async (_event, filePath, language, trimStart, trimDuration, modelSize) => {
  const model     = (modelSize === "small" && whisperModelReady("small")) ? "small" : "tiny";
  const modelPath = whisperModelPath(model);
  const exePath   = whisperExePath();

  if (!fs.existsSync(exePath))   return { segments: [], error: "Whisper.cpp não instalado" };
  if (!whisperModelReady(model)) return { segments: [], error: `Modelo "${model}" não encontrado` };

  const ts = typeof trimStart    === "number" && trimStart    > 0 ? trimStart    : 0;
  const td = typeof trimDuration === "number" && trimDuration > 0 ? trimDuration : null;
  const baseName = safeBaseName(filePath);
  const wavPath  = path.join(projectTmpDir, `wspp_${Date.now()}_${baseName}.wav`);
  const outPfx   = path.join(projectTmpDir, `wspp_out_${Date.now()}`);

  const ffArgs = ["-y"];
  if (ts > 0) ffArgs.push("-ss", String(ts));
  if (td !== null) ffArgs.push("-t", String(td));
  ffArgs.push("-i", filePath, "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", wavPath);

  const { code: wc } = await runProcess(ffmpegPath, ffArgs);
  if (wc !== 0 || !fs.existsSync(wavPath)) return { segments: [], error: "Falha ao extrair áudio" };

  // Duração real do trecho (para ETA preciso)
  let audioDuration = td || 30;
  try {
    const pr = await runProcess(ffprobePath, ["-v","quiet","-show_entries","format=duration","-of","csv=p=0",wavPath]);
    const d = parseFloat(pr.stdout); if (d > 0) audioDuration = d;
  } catch {}

  sendProgress("media:progress", { filePath, stage: "transcribe", percent: 2, audioDuration });

  const lang = language === "auto" ? null : (language || "pt");
  const args = [
    "-m", modelPath, "-f", wavPath,
    ...(lang ? ["-l", lang] : []),
    "-oj", "-of", outPfx,
    "--print-progress",
  ];

  return new Promise(resolve => {
    const t0 = Date.now();
    const proc = spawn(exePath, args, { stdio: ["ignore","pipe","pipe"], windowsHide: true });
    let errBuf = "";

    proc.stderr.on("data", chunk => {
      errBuf += chunk.toString();
      const matches = [...errBuf.matchAll(/progress\s*=\s*(\d+)%/g)];
      if (matches.length) {
        const pct = parseInt(matches[matches.length-1][1]);
        const elapsed = (Date.now() - t0) / 1000;
        const eta = pct > 3 ? Math.max(0, Math.round((elapsed / pct) * (100 - pct))) : null;
        sendProgress("media:progress", { filePath, stage: "transcribe", percent: pct, eta, audioDuration });
      }
    });
    proc.stdout.on("data", () => {});

    proc.on("close", code => {
      try { fs.unlinkSync(wavPath); } catch {}
      const jsonFile = outPfx + ".json";
      if (code === 0 && fs.existsSync(jsonFile)) {
        try {
          const raw = JSON.parse(fs.readFileSync(jsonFile, "utf-8"));
          const segments = (raw.transcription || [])
            .map(s => ({
              start: (s.offsets?.from ?? 0) / 1000,
              end:   (s.offsets?.to   ?? 0) / 1000,
              text:  (s.text || "").trim(),
            }))
            .filter(s => s.text);
          try { fs.unlinkSync(jsonFile); } catch {}
          sendProgress("media:progress", { filePath, stage: "transcribe", percent: 100, audioDuration });
          resolve({ segments, language: lang || "pt" });
        } catch (e) {
          resolve({ segments: [], error: `JSON inválido: ${String(e?.message||e)}` });
        }
      } else {
        resolve({ segments: [], error: `Whisper falhou (${code}):\n${errBuf.slice(-300)}` });
      }
    });
    proc.on("error", err => resolve({ segments: [], error: String(err?.message||err) }));
  });
});

// ── Auto-Updater ────────────────────────────────────────────────────────────
let autoUpdater;
if (app.isPackaged) {
  try {
    autoUpdater = require("electron-updater").autoUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
  } catch {}
}

// ── FFmpeg + FFprobe Paths ──────────────────────────────────────────────────

const ffmpegPath = app.isPackaged
  ? path.join(process.resourcesPath, "ffmpeg.exe")
  : require("ffmpeg-static");

// ffprobe: resourcesPath (packed) → ffprobe-static (dev) → fallback PATH
const ffprobePath = (() => {
  let staticPath = null;
  if (!app.isPackaged) {
    try { staticPath = require("ffprobe-static").path; } catch {}
  }
  const candidates = [
    app.isPackaged ? path.join(process.resourcesPath, "ffprobe.exe") : null,
    staticPath,
    path.join(path.dirname(ffmpegPath || ""), "ffprobe.exe"),
  ].filter(Boolean);
  for (const p of candidates) { try { if (fs.existsSync(p)) return p; } catch {} }
  return "ffprobe"; // ultimo recurso: PATH do sistema
})();

let server;
let mainWindow;
const preferredPort = 4184;
let pendingOAuth = null;
const proxyPaths = new Set();
const projectTmpDir = path.join(os.tmpdir(), "studio-v4-media");

if (!fs.existsSync(projectTmpDir)) fs.mkdirSync(projectTmpDir, { recursive: true });

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".webmanifest": "application/manifest+json",
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function runProcess(bin, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { windowsHide: true, ...opts });
    let stdout = "";
    let stderr = "";
    if (proc.stdout) proc.stdout.on("data", (d) => { stdout += d.toString(); });
    if (proc.stderr) proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("close", (code) => resolve({ code, stdout, stderr }));
    proc.on("error", reject);
  });
}

function sendProgress(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function hexToLibass(hex) {
  const r = parseInt((hex || "#ffffff").slice(1, 3), 16) || 255;
  const g = parseInt((hex || "#ffffff").slice(3, 5), 16) || 255;
  const b = parseInt((hex || "#ffffff").slice(5, 7), 16) || 255;
  return `&H00${b.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${r.toString(16).padStart(2,"0")}`.toUpperCase();
}

function safeBaseName(filePath) {
  return path.basename(filePath, path.extname(filePath)).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
}

// Gera filtro atempo encadeado para suportar 0.25x–4x (FFmpeg limita cada atempo a 0.5–2.0)
function buildAtempoFilter(speed) {
  if (Math.abs(speed - 1) < 0.001) return null;
  const parts = [];
  let s = speed;
  while (s > 2.0 + 1e-9) { parts.push("atempo=2.0"); s /= 2.0; }
  while (s < 0.5 - 1e-9) { parts.push("atempo=0.5"); s *= 2.0; }
  parts.push(`atempo=${s.toFixed(4)}`);
  return parts.join(",");
}

// ══════════════════════════════════════════════════════════════════════════════
// MEDIA-INGEST: O coração da importação universal
// ══════════════════════════════════════════════════════════════════════════════

// ── 1. Probe: extrai metadados completos via ffprobe ────────────────────────

ipcMain.handle("media:probe", async (_event, filePath) => {
  if (!fs.existsSync(filePath)) return { error: "Arquivo nao encontrado" };

  const args = [
    "-v", "quiet",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    filePath,
  ];

  const { code, stdout, stderr } = await runProcess(ffprobePath, args);
  if (code !== 0) return { error: `ffprobe falhou: ${stderr.slice(0, 200)}` };

  try {
    const data = JSON.parse(stdout);
    const format = data.format || {};
    const streams = data.streams || [];

    const videoStream = streams.find((s) => s.codec_type === "video" && s.disposition?.attached_pic !== 1);
    const audioStream = streams.find((s) => s.codec_type === "audio");

    const result = {
      filePath,
      fileName: path.basename(filePath),
      fileSize: parseInt(format.size || "0", 10),
      duration: parseFloat(format.duration || "0"),
      bitrate: parseInt(format.bit_rate || "0", 10),
      formatName: format.format_name || "",
      formatLongName: format.format_long_name || "",
      hasVideo: !!videoStream,
      hasAudio: !!audioStream,
      video: videoStream ? {
        codec: videoStream.codec_name,
        codecLong: videoStream.codec_long_name,
        width: videoStream.width,
        height: videoStream.height,
        fps: (([n, d]) => d ? parseFloat(n) / parseFloat(d) : parseFloat(n) || 0)((videoStream.r_frame_rate || "0").split("/")),
        bitrate: parseInt(videoStream.bit_rate || "0", 10),
        pixelFormat: videoStream.pix_fmt,
        profile: videoStream.profile,
      } : null,
      audio: audioStream ? {
        codec: audioStream.codec_name,
        codecLong: audioStream.codec_long_name,
        sampleRate: parseInt(audioStream.sample_rate || "0", 10),
        channels: audioStream.channels,
        channelLayout: audioStream.channel_layout,
        bitrate: parseInt(audioStream.bit_rate || "0", 10),
      } : null,
    };

    return result;
  } catch (e) {
    return { error: `Parse error: ${e.message}` };
  }
});

// ── 2. Thumbnail: captura frame do vídeo ────────────────────────────────────

ipcMain.handle("media:thumbnail", async (_event, filePath, opts = {}) => {
  const timestamp = opts.timestamp || "00:00:01";
  const width = opts.width || 320;
  const baseName = safeBaseName(filePath);
  const outputPath = path.join(projectTmpDir, `thumb_${Date.now()}_${baseName}.jpg`);

  const args = [
    "-ss", timestamp,
    "-i", filePath,
    "-vframes", "1",
    "-vf", `scale=${width}:-2`,
    "-q:v", "3",
    "-y", outputPath,
  ];

  const { code } = await runProcess(ffmpegPath, args);
  if (code === 0 && fs.existsSync(outputPath)) {
    proxyPaths.add(outputPath);
    const port = server?.address()?.port ?? preferredPort;
    return { url: `http://127.0.0.1:${port}/proxy?f=${encodeURIComponent(outputPath)}`, path: outputPath };
  }
  return { error: "Falha ao gerar thumbnail" };
});

// ── 3. Waveform: gera array de picos de áudio ──────────────────────────────

ipcMain.handle("media:waveform", async (_event, filePath, numBars = 100) => {
  const args = [
    "-i", filePath,
    "-vn",
    "-af", "aresample=8000",
    "-f", "s16le",
    "-ac", "1",
    "pipe:1",
  ];

  return new Promise((resolve) => {
    const chunks = [];
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    proc.stdout.on("data", (chunk) => chunks.push(chunk));
    const kill = setTimeout(() => { try { proc.kill(); } catch {} }, 90000);

    proc.on("close", (code) => {
      clearTimeout(kill);
      if (code !== 0 || chunks.length === 0) { resolve({ peaks: [] }); return; }

      const buf = Buffer.concat(chunks);
      const numSamples = Math.floor(buf.length / 2);
      if (numSamples === 0) { resolve({ peaks: [] }); return; }

      const samplesPerBar = Math.max(1, Math.floor(numSamples / numBars));
      const peaks = [];
      for (let i = 0; i < numBars; i++) {
        let max = 0;
        const start = i * samplesPerBar * 2;
        const end = Math.min(start + samplesPerBar * 2, buf.length - 1);
        for (let j = start; j < end; j += 2) {
          const sample = Math.abs(buf.readInt16LE(j));
          if (sample > max) max = sample;
        }
        peaks.push(max / 32768);
      }

      const peakMax = Math.max(...peaks, 0.01);
      resolve({ peaks: peaks.map((p) => p / peakMax) });
    });
    proc.on("error", () => { clearTimeout(kill); resolve({ peaks: [] }); });
  });
});

// ── 3b. Detect Silence: usa FFmpeg silencedetect (substitui captureStream) ───

ipcMain.handle("media:detect-silence", async (_event, filePath, opts = {}) => {
  if (!fs.existsSync(filePath)) return { error: "Arquivo nao encontrado", intervals: [] };

  const noiseDb  = opts.noiseDb  ?? -35;   // dBFS — abaixo = silêncio
  const minDur   = opts.minDur   ?? 0.3;   // segundos — duração mínima de silêncio
  const minPause = opts.minPause ?? 0.15;  // não cortar pausas menores que isso

  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, [
      "-i", filePath,
      "-af", `silencedetect=noise=${noiseDb}dB:d=${minDur}`,
      "-f", "null", "-",
    ], { windowsHide: true });

    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); });

    proc.on("close", () => {
      const intervals = [];
      const startRe  = /silence_start: ([\d.]+)/g;
      const endRe    = /silence_end: ([\d.]+)/g;
      const starts = [...stderr.matchAll(startRe)].map((m) => parseFloat(m[1]));
      const ends   = [...stderr.matchAll(endRe)].map((m) => parseFloat(m[1]));

      // Duração total via ffprobe para calcular fim do último silêncio
      const durationMatch = stderr.match(/Duration:\s+([\d:]+\.[\d]+)/);
      let totalDuration = 0;
      if (durationMatch) {
        const parts = durationMatch[1].split(":").map(Number);
        totalDuration = parts[0] * 3600 + parts[1] * 60 + parts[2];
      }

      for (let i = 0; i < starts.length; i++) {
        const s = starts[i];
        const e = ends[i] ?? totalDuration;
        const dur = e - s;
        if (dur >= minPause) intervals.push({ start: s, end: e, duration: dur });
      }

      resolve({ intervals, totalDuration });
    });
    proc.on("error", () => resolve({ error: "FFmpeg nao encontrado", intervals: [] }));
  });
});

// ── 3c. Detect Repeats: compara takes pelo fingerprint de áudio ──────────────
ipcMain.handle("media:detect-repeats", async (_event, filePath) => {
  if (!fs.existsSync(filePath)) return { error: "Arquivo nao encontrado", groups: [] };

  // 1. Duração total via ffprobe
  const probe = await runProcess(ffprobePath, [
    "-v", "quiet", "-print_format", "json", "-show_format", filePath,
  ]);
  let totalDuration = 0;
  try { totalDuration = parseFloat(JSON.parse(probe.stdout).format.duration || "0"); } catch {}
  if (totalDuration < 4) return { groups: [], totalDuration, takesFound: 0 };

  // 2. Detectar silêncios para segmentar takes
  const silR = await runProcess(ffmpegPath, [
    "-i", filePath, "-af", "silencedetect=noise=-33dB:d=0.4", "-f", "null", "-",
  ]);
  const starts = [...silR.stderr.matchAll(/silence_start: ([\d.]+)/g)].map(m => parseFloat(m[1]));
  const ends   = [...silR.stderr.matchAll(/silence_end: ([\d.]+)/g)].map(m => parseFloat(m[1]));

  // 3. Montar segmentos de fala (takes)
  const takes = [];
  let cursor = 0;
  for (let i = 0; i < starts.length; i++) {
    if (starts[i] - cursor > 1.0) takes.push({ start: cursor, end: starts[i], duration: starts[i] - cursor });
    cursor = ends[i] ?? totalDuration;
  }
  if (totalDuration - cursor > 1.0) takes.push({ start: cursor, end: totalDuration, duration: totalDuration - cursor });
  if (takes.length < 2) return { groups: [], totalDuration, takesFound: takes.length };

  // 4. Fingerprint de cada take: volumedetect → mean_volume + max_volume
  const fingerprints = await Promise.all(takes.map(async (take, idx) => {
    const r = await runProcess(ffmpegPath, [
      "-ss", take.start.toFixed(3), "-t", Math.min(take.duration, 30).toFixed(3),
      "-i", filePath, "-vn", "-af", "volumedetect", "-f", "null", "-",
    ]);
    const meanM = r.stderr.match(/mean_volume:\s*([-\d.]+)\s*dBFS/);
    const maxM  = r.stderr.match(/max_volume:\s*([-\d.]+)\s*dBFS/);
    return {
      idx, start: take.start, end: take.end, duration: take.duration,
      meanVol: meanM ? parseFloat(meanM[1]) : -99,
      maxVol:  maxM  ? parseFloat(maxM[1])  : -99,
    };
  }));

  // 5. Agrupar takes similares (duração ±35% E volume ±6dB)
  const groups = [];
  const used = new Set();
  for (let i = 0; i < fingerprints.length; i++) {
    if (used.has(i)) continue;
    const group = [fingerprints[i]];
    for (let j = i + 1; j < fingerprints.length; j++) {
      if (used.has(j)) continue;
      const a = fingerprints[i], b = fingerprints[j];
      const durRatio = Math.min(a.duration, b.duration) / Math.max(a.duration, b.duration);
      const volDiff  = Math.abs(a.meanVol - b.meanVol);
      if (durRatio > 0.60 && volDiff < 7 && a.meanVol > -60 && b.meanVol > -60) {
        group.push(b);
        used.add(j);
      }
    }
    if (group.length > 1) { used.add(i); groups.push(group); }
  }

  return { groups, totalDuration, takesFound: takes.length };
});

// ── 4. Proxy: cria versão leve para preview ─────────────────────────────────

ipcMain.handle("media:create-proxy", async (_event, filePath, opts = {}) => {
  const baseName = safeBaseName(filePath);
  const proxyId = `proxy_${Date.now()}_${baseName}`;
  const outputPath = path.join(projectTmpDir, `${proxyId}.mp4`);
  const maxHeight = opts.maxHeight || 480;

  const args = [
    "-i", filePath,
    "-vf", `scale=-2:'min(${maxHeight},ih)'`,
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
    "-c:a", "aac", "-b:a", "64k",
    "-movflags", "+faststart",
    "-progress", "pipe:1", "-nostats",
    "-y", outputPath,
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    let durationSec = 0;
    let progressBuf = "";

    proc.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      const m = text.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
      if (m && !durationSec) {
        durationSec = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
      }
    });

    proc.stdout.on("data", (chunk) => {
      progressBuf += chunk.toString();
      const lines = progressBuf.split("\n");
      progressBuf = lines.pop() ?? "";
      let outTimeSec = -1;
      for (const line of lines) {
        const m2 = line.match(/^out_time_ms=(\d+)/);
        if (m2) outTimeSec = parseInt(m2[1]) / 1_000_000;
      }
      if (outTimeSec >= 0 && durationSec > 0) {
        const pct = Math.min(99, Math.round((outTimeSec / durationSec) * 100));
        sendProgress("media:progress", { filePath, stage: "proxy", percent: pct });
      }
    });

    proc.on("close", (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        proxyPaths.add(outputPath);
        const port = server?.address()?.port ?? preferredPort;
        const proxyUrl = `http://127.0.0.1:${port}/proxy?f=${encodeURIComponent(outputPath)}`;
        sendProgress("media:progress", { filePath, stage: "proxy", percent: 100 });
        resolve({ proxyUrl, proxyPath: outputPath });
      } else {
        reject(new Error(`Proxy falhou com codigo ${code}`));
      }
    });
    proc.on("error", reject);
  });
});

// ── 5. Convert Audio: converte .ogg/.opus/etc para formato compatível ───────

ipcMain.handle("media:convert-audio", async (_event, filePath, opts = {}) => {
  const baseName = safeBaseName(filePath);
  const outputFormat = opts.format || "m4a";
  const outputPath = path.join(projectTmpDir, `audio_${Date.now()}_${baseName}.${outputFormat}`);

  const args = outputFormat === "wav"
    ? ["-i", filePath, "-vn", "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "2", "-y", outputPath]
    : ["-i", filePath, "-vn", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-y", outputPath];

  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    let durationSec = 0;

    proc.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      const m = text.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
      if (m && !durationSec) durationSec = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
    });

    proc.on("close", (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        proxyPaths.add(outputPath);
        const port = server?.address()?.port ?? preferredPort;
        const url = `http://127.0.0.1:${port}/proxy?f=${encodeURIComponent(outputPath)}`;
        sendProgress("media:progress", { filePath, stage: "convert", percent: 100 });
        resolve({ url, path: outputPath, format: outputFormat });
      } else {
        reject(new Error(`Conversao audio falhou com codigo ${code}`));
      }
    });
    proc.on("error", reject);
  });
});

// ── 6. Extract Audio WAV (para transcrição futura) ──────────────────────────

ipcMain.handle("media:extract-wav", async (_event, filePath) => {
  const baseName = safeBaseName(filePath);
  const outputPath = path.join(projectTmpDir, `wav_${Date.now()}_${baseName}.wav`);

  const args = ["-y", "-i", filePath, "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", outputPath];
  const { code } = await runProcess(ffmpegPath, args);

  if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
    proxyPaths.add(outputPath);
    return { path: outputPath };
  }
  return { error: "Falha ao extrair WAV" };
});

// ── 6b-extra. Separate Stems via Demucs ────────────────────────────────────

ipcMain.handle("media:separate-stems", async (_event, filePath) => {
  const baseName = safeBaseName(filePath);
  const outputDir = path.join(projectTmpDir, `stems_${Date.now()}_${baseName}`);
  fs.mkdirSync(outputDir, { recursive: true });

  // Resolve python command
  const { execSync } = require("child_process");
  let pythonCmd = null;
  for (const cmd of ["python", "python3", "py"]) {
    try { execSync(`${cmd} -c "import demucs"`, { stdio: "pipe" }); pythonCmd = cmd; break; } catch {}
  }
  if (!pythonCmd) {
    return { error: "Demucs não encontrado.\n\nInstale com Python 3.10–3.12 (não 3.13+):\n  pip install demucs\n\nRequer PyTorch — instale antes se necessário:\n  pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu\n\nApós instalar, reinicie o Studio V4." };
  }

  sendProgress("media:progress", { filePath, stage: "stems", percent: 5 });

  // Pre-converte para WAV 44100Hz para evitar dependência do TorchCodec no Demucs
  const wavInput = path.join(outputDir, "input.wav");
  const wavConvert = await runProcess(ffmpegPath, [
    "-y", "-i", filePath, "-vn", "-ar", "44100", "-ac", "2", "-acodec", "pcm_s16le", wavInput
  ]);
  if (wavConvert.code !== 0 || !fs.existsSync(wavInput)) {
    return { error: "Falha ao converter audio para WAV antes do Demucs" };
  }

  sendProgress("media:progress", { filePath, stage: "stems", percent: 15 });

  const args = ["-m", "demucs", "--two-stems=vocals", "-o", outputDir, wavInput];
  const { code, stderr } = await runProcess(pythonCmd, args);

  if (code !== 0) {
    return { error: `Demucs falhou: ${stderr.slice(-300)}` };
  }

  // Demucs outputs to: outputDir/htdemucs/input/vocals.wav + no_vocals.wav
  const modelDir = path.join(outputDir, "htdemucs", "input");
  const vocalsPath = path.join(modelDir, "vocals.wav");
  const instrumentalsPath = path.join(modelDir, "no_vocals.wav");

  const result = {};
  if (fs.existsSync(vocalsPath)) {
    proxyPaths.add(vocalsPath);
    result.vocalsPath = vocalsPath;
    const port = server?.address()?.port ?? preferredPort;
    result.vocalsUrl = `http://127.0.0.1:${port}/proxy?f=${encodeURIComponent(vocalsPath)}`;
  }
  if (fs.existsSync(instrumentalsPath)) {
    proxyPaths.add(instrumentalsPath);
    result.instrumentalsPath = instrumentalsPath;
    const port = server?.address()?.port ?? preferredPort;
    result.instrumentalsUrl = `http://127.0.0.1:${port}/proxy?f=${encodeURIComponent(instrumentalsPath)}`;
  }

  sendProgress("media:progress", { filePath, stage: "stems-done", percent: 100 });
  return Object.keys(result).length > 0 ? result : { error: "Arquivos de stems nao encontrados" };
});

// ── 6b-extra3. Separate Stems Fast — karaoke FFmpeg (sem Python, instantâneo) ─
ipcMain.handle("media:separate-stems-fast", async (_event, filePath) => {
  const baseName = safeBaseName(filePath);
  const outputDir = path.join(projectTmpDir, `stems_fast_${Date.now()}_${baseName}`);
  fs.mkdirSync(outputDir, { recursive: true });

  const vocalsPath = path.join(outputDir, "vocals_fast.wav");
  const instrPath  = path.join(outputDir, "instrumentals_fast.wav");

  // Vocais: soma L+R → canal central (onde a voz costuma estar)
  const vR = await runProcess(ffmpegPath, [
    "-y", "-i", filePath, "-vn",
    "-af", "pan=stereo|c0=0.5*c0+0.5*c1|c1=0.5*c0+0.5*c1",
    "-ar", "44100", "-acodec", "pcm_s16le", vocalsPath,
  ]);
  // Instrumental: L-R → remove canal central (karaoke clássico)
  const iR = await runProcess(ffmpegPath, [
    "-y", "-i", filePath, "-vn",
    "-af", "pan=stereo|c0=c0-c1|c1=c1-c0",
    "-ar", "44100", "-acodec", "pcm_s16le", instrPath,
  ]);

  const result = {};
  const port = server?.address()?.port ?? preferredPort;
  if (vR.code === 0 && fs.existsSync(vocalsPath)) {
    proxyPaths.add(vocalsPath);
    result.vocalsPath = vocalsPath;
    result.vocalsUrl = `http://127.0.0.1:${port}/proxy?f=${encodeURIComponent(vocalsPath)}`;
  }
  if (iR.code === 0 && fs.existsSync(instrPath)) {
    proxyPaths.add(instrPath);
    result.instrumentalsPath = instrPath;
    result.instrumentalsUrl = `http://127.0.0.1:${port}/proxy?f=${encodeURIComponent(instrPath)}`;
  }
  return Object.keys(result).length > 0 ? result : { error: "Falha na separação rápida" };
});

// ── 6b-extra4. Built-in ONNX stems — sem Python ────────────────────────────

ipcMain.handle("media:stems-model-status", () => {
  const mp = stemsModelPath();
  const ready = fs.existsSync(mp) && fs.statSync(mp).size > 10_000_000;
  return { ready, path: ready ? mp : null };
});

ipcMain.handle("media:download-stems-model", async () => {
  await ensureModelDownloaded();
  return { ready: fs.existsSync(stemsModelPath()) };
});

ipcMain.handle("media:separate-stems-builtin", async (_event, filePath) => {
  const mp = stemsModelPath();
  if (!fs.existsSync(mp)) return { error: "Modelo não encontrado. Verifique a conexão e tente novamente." };

  const baseName = safeBaseName(filePath);
  const outputDir = path.join(projectTmpDir, `stems_onnx_${Date.now()}_${baseName}`);

  try {
    const result = await stemsEngine.separateStems(mp, ffmpegPath, filePath, outputDir, pct => {
      sendProgress("media:progress", { filePath, stage: "stems", percent: pct });
    });

    const port = server?.address()?.port ?? preferredPort;
    const r = {};
    if (result.vocalsPath && fs.existsSync(result.vocalsPath)) {
      proxyPaths.add(result.vocalsPath);
      r.vocalsPath = result.vocalsPath;
      r.vocalsUrl  = `http://127.0.0.1:${port}/proxy?f=${encodeURIComponent(result.vocalsPath)}`;
    }
    if (result.instrumentalsPath && fs.existsSync(result.instrumentalsPath)) {
      proxyPaths.add(result.instrumentalsPath);
      r.instrumentalsPath = result.instrumentalsPath;
      r.instrumentalsUrl  = `http://127.0.0.1:${port}/proxy?f=${encodeURIComponent(result.instrumentalsPath)}`;
    }
    sendProgress("media:progress", { filePath, stage: "stems-done", percent: 100 });
    return Object.keys(r).length > 0 ? r : { error: "Arquivos de stems não gerados" };
  } catch (err) {
    return { error: String(err?.message || err) };
  }
});

// ── 6b-extra2. Save Audio — copia arquivo de áudio para local escolhido ─────

ipcMain.handle("media:save-audio", async (_event, srcPath, defaultName) => {
  if (!fs.existsSync(srcPath)) return { error: "Arquivo nao encontrado" };
  const ext = path.extname(srcPath) || ".wav";
  const { filePath: destPath, canceled } = await dialog.showSaveDialog(mainWindow, {
    title: "Salvar áudio",
    defaultPath: defaultName || path.basename(srcPath),
    filters: [
      { name: "WAV", extensions: ["wav"] },
      { name: "MP3", extensions: ["mp3"] },
      { name: "M4A", extensions: ["m4a"] },
    ],
  });
  if (canceled || !destPath) return { canceled: true };
  const destExt = path.extname(destPath).toLowerCase();
  if (!destExt || destExt === ext) {
    fs.copyFileSync(srcPath, destPath);
    return { savedPath: destPath };
  }
  // Converte formato se necessário
  const fmt = destExt === ".mp3" ? "mp3" : destExt === ".m4a" ? "m4a" : "wav";
  const { code } = await runProcess(ffmpegPath, ["-y", "-i", srcPath, destPath]);
  if (code !== 0) return { error: "Falha ao converter formato" };
  return { savedPath: destPath };
});

// ── 6c. Transcribe via faster-whisper (local, offline) ──────────────────────

ipcMain.handle("media:transcribe", async (_event, filePath, language, trimStart, trimDuration) => {
  const lang = language || "pt";
  const tStart = typeof trimStart === "number" && trimStart > 0 ? trimStart : 0;
  const tDuration = typeof trimDuration === "number" && trimDuration > 0 ? trimDuration : null;

  // 1. Verificar se Python + faster-whisper estão disponíveis
  let pythonCmd = null;
  for (const cmd of ["python", "python3", "py"]) {
    const check = await runProcess(cmd, ["-c", "import faster_whisper; print('ok')"]);
    if (check.code === 0 && check.stdout.includes("ok")) { pythonCmd = cmd; break; }
  }
  if (!pythonCmd) {
    return {
      segments: [],
      error: "faster-whisper não encontrado.\n\nInstale com:\n  pip install faster-whisper\n\nPython precisa estar no PATH do sistema.",
    };
  }

  // 2. Extrair WAV 16kHz mono (com trim opcional)
  const baseName = safeBaseName(filePath);
  const wavPath = path.join(projectTmpDir, `transcribe_${Date.now()}_${baseName}.wav`);
  const ffArgs = ["-y"];
  if (tStart > 0) ffArgs.push("-ss", String(tStart));
  if (tDuration !== null) ffArgs.push("-t", String(tDuration));
  ffArgs.push("-i", filePath, "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", wavPath);

  const extractResult = await runProcess(ffmpegPath, ffArgs);
  if (extractResult.code !== 0 || !fs.existsSync(wavPath)) {
    return { segments: [], error: "Falha ao extrair áudio para transcrição" };
  }

  sendProgress("media:progress", { filePath, stage: "transcribe", percent: 15 });

  // 3. Modelo configurado pelo usuário (padrão: small)
  let model = "small";
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath(), "utf-8"));
    if (cfg.whisperModel) model = cfg.whisperModel;
  } catch {}

  // 4. Script Python escrito em temp e executado
  const pyScript = [
    "import sys, json",
    "from faster_whisper import WhisperModel",
    "model = WhisperModel(sys.argv[1], device='cpu', compute_type='int8')",
    "segs, info = model.transcribe(",
    "    sys.argv[2],",
    "    language=None if sys.argv[3]=='auto' else sys.argv[3],",
    "    vad_filter=True,",
    "    vad_parameters={'min_silence_duration_ms': 300}",
    ")",
    "result = [{'start': round(s.start,3), 'end': round(s.end,3), 'text': s.text.strip()} for s in segs]",
    "print(json.dumps({'segments': result, 'language': info.language}))",
  ].join("\n");

  const scriptPath = path.join(projectTmpDir, "sv4_whisper.py");
  fs.writeFileSync(scriptPath, pyScript, "utf-8");

  const { code, stdout, stderr } = await runProcess(pythonCmd, [scriptPath, model, wavPath, lang]);
  try { fs.unlinkSync(wavPath); } catch {}
  try { fs.unlinkSync(scriptPath); } catch {}

  sendProgress("media:progress", { filePath, stage: "transcribe", percent: 100 });

  if (code !== 0) {
    return { segments: [], error: `Whisper falhou:\n${(stderr || "").slice(-400)}` };
  }

  try {
    return JSON.parse(stdout.trim());
  } catch {
    return { segments: [], error: "Erro ao interpretar resultado do Whisper" };
  }
});

// ── 6c. Remove Watermark — temporal median inpainting ───────────────────────
//
// Tecnica: para cada pixel da regiao da marca dagua, calcula a mediana
// temporal de N frames vizinhos. Como a logo e estatica mas o conteudo
// muda, a mediana revela o que esta por tras.
//
// Fluxo: extrair frames → inpainting por mediana → recompor video

ipcMain.handle("media:remove-watermark", async (_event, filePath, region) => {
  // region = { x, y, w, h } em % do video (0-100)
  if (!fs.existsSync(filePath)) return { error: "Arquivo nao encontrado" };

  const baseName = safeBaseName(filePath);
  const outputPath = path.join(projectTmpDir, `nowm_${Date.now()}_${baseName}.mp4`);

  // Pegar dimensoes do video
  const probeArgs = ["-v", "quiet", "-print_format", "json", "-show_streams", filePath];
  const probeResult = await runProcess(ffprobePath, probeArgs);
  let videoWidth = 1920, videoHeight = 1080;
  try {
    const streams = JSON.parse(probeResult.stdout).streams || [];
    const vs = streams.find(s => s.codec_type === "video");
    if (vs) { videoWidth = vs.width; videoHeight = vs.height; }
  } catch {}

  // Converter % para pixels
  const rx = Math.round(region.x / 100 * videoWidth);
  const ry = Math.round(region.y / 100 * videoHeight);
  const rw = Math.round(region.w / 100 * videoWidth);
  const rh = Math.round(region.h / 100 * videoHeight);

  // FFmpeg filter chain:
  // 1. tmix=frames=7 — media temporal de 7 frames (gera frame "limpo" da regiao)
  // 2. crop — recorta so a regiao da marca
  // 3. overlay — cola a regiao limpa sobre o video original
  //
  // Resultado: a logo desaparece porque a mediana temporal a elimina,
  // enquanto o conteudo movel se reconstroi pelos frames vizinhos.

  const filterComplex = [
    `[0:v]split[orig][forclean]`,
    `[forclean]tmix=frames=9:weights=1 1 1 1 1 1 1 1 1,crop=${rw}:${rh}:${rx}:${ry}[cleanpatch]`,
    `[orig][cleanpatch]overlay=${rx}:${ry}[outv]`,
  ].join(";");

  const args = [
    "-i", filePath,
    "-filter_complex", filterComplex,
    "-map", "[outv]", "-map", "0:a?",
    "-c:v", "libx264", "-preset", "fast", "-crf", "20",
    "-c:a", "copy",
    "-movflags", "+faststart",
    "-progress", "pipe:1", "-nostats",
    "-y", outputPath,
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    let durationSec = 0;
    let progressBuf = "";

    proc.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      const m = text.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
      if (m && !durationSec) durationSec = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
    });

    proc.stdout.on("data", (chunk) => {
      progressBuf += chunk.toString();
      const lines = progressBuf.split("\n");
      progressBuf = lines.pop() ?? "";
      for (const line of lines) {
        const m2 = line.match(/^out_time_ms=(\d+)/);
        if (m2 && durationSec > 0) {
          const pct = Math.min(99, Math.round((parseInt(m2[1]) / 1_000_000 / durationSec) * 100));
          sendProgress("media:progress", { filePath, stage: "remove-watermark", percent: pct });
        }
      }
    });

    proc.on("close", (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        proxyPaths.add(outputPath);
        const port = server?.address()?.port ?? preferredPort;
        const url = `http://127.0.0.1:${port}/proxy?f=${encodeURIComponent(outputPath)}`;
        sendProgress("media:progress", { filePath, stage: "remove-watermark", percent: 100 });
        resolve({ outputPath, proxyUrl: url });
      } else {
        reject(new Error(`Watermark removal falhou com codigo ${code}`));
      }
    });
    proc.on("error", reject);
  });
});

// ── 7. Video Thumbnails Strip (para timeline) ───────────────────────────────

ipcMain.handle("media:thumbnail-strip", async (_event, filePath, opts = {}) => {
  const count = opts.count || 10;
  const width = opts.width || 160;
  const height = opts.height || 90;
  const baseName = safeBaseName(filePath);

  // Primeiro pega a duração
  const probeArgs = ["-v", "quiet", "-print_format", "json", "-show_format", filePath];
  const { stdout } = await runProcess(ffprobePath, probeArgs);
  let duration = 10;
  try { duration = parseFloat(JSON.parse(stdout).format.duration) || 10; } catch {}

  const thumbnails = [];
  const interval = duration / count;

  for (let i = 0; i < count; i++) {
    const timestamp = (interval * i + interval / 2).toFixed(2);
    const outPath = path.join(projectTmpDir, `strip_${baseName}_${i}_${Date.now()}.jpg`);

    const args = [
      "-ss", timestamp,
      "-i", filePath,
      "-vframes", "1",
      "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
      "-q:v", "5",
      "-y", outPath,
    ];

    const { code } = await runProcess(ffmpegPath, args);
    if (code === 0 && fs.existsSync(outPath)) {
      proxyPaths.add(outPath);
      const port = server?.address()?.port ?? preferredPort;
      thumbnails.push(`http://127.0.0.1:${port}/proxy?f=${encodeURIComponent(outPath)}`);
    }
  }

  return { thumbnails, duration };
});

// ── 8. Full Ingest Pipeline ─────────────────────────────────────────────────
// Retorna rapido (<2s): probe + 1 thumbnail + URL direta.
// Proxy/waveform/strip rodam em background via setImmediate.

ipcMain.handle("media:ingest", async (_event, filePath) => {
  if (!fs.existsSync(filePath)) return { error: "Arquivo nao encontrado" };

  const ext = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath);

  sendProgress("media:progress", { filePath, stage: "probe", percent: 10 });

  // 1. Probe
  const probeArgs = ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath];
  const probeResult = await runProcess(ffprobePath, probeArgs);
  if (probeResult.code !== 0) return { error: `Arquivo invalido: ${probeResult.stderr.slice(0, 100)}` };

  let probeData;
  try { probeData = JSON.parse(probeResult.stdout); } catch { return { error: "Nao foi possivel ler metadados" }; }

  const format = probeData.format || {};
  const streams = probeData.streams || [];
  const videoStream = streams.find((s) => s.codec_type === "video" && s.disposition?.attached_pic !== 1);
  const audioStream = streams.find((s) => s.codec_type === "audio");

  const duration = parseFloat(format.duration || "0");
  const fileSize = parseInt(format.size || "0", 10);

  const metadata = {
    duration,
    fileSize,
    formatName: format.format_name,
    video: videoStream ? {
      codec: videoStream.codec_name,
      width: videoStream.width,
      height: videoStream.height,
      fps: Math.round((([n, d]) => d ? parseFloat(n) / parseFloat(d) : parseFloat(n) || 0)((videoStream.r_frame_rate || "0").split("/")) * 100) / 100,
      bitrate: parseInt(videoStream.bit_rate || "0", 10),
    } : null,
    audio: audioStream ? {
      codec: audioStream.codec_name,
      sampleRate: parseInt(audioStream.sample_rate || "0", 10),
      channels: audioStream.channels,
      bitrate: parseInt(audioStream.bit_rate || "0", 10),
    } : null,
  };

  sendProgress("media:progress", { filePath, stage: "probe", percent: 30 });

  // 2. Classificar tipo de mídia
  const videoExts = new Set([".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v", ".wmv", ".flv", ".ts", ".mts"]);
  const audioExts = new Set([".mp3", ".wav", ".aac", ".m4a", ".flac", ".ogg", ".opus", ".oga", ".wma", ".aif", ".aiff"]);
  const imageExts = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".heic", ".heif", ".avif", ".tiff", ".svg"]);

  let kind = "file";
  if (videoStream && videoExts.has(ext)) kind = "video";
  else if (videoStream && !audioExts.has(ext) && !imageExts.has(ext)) kind = "video";
  else if (audioStream && audioExts.has(ext)) kind = "audio";
  else if (audioStream && !videoStream) kind = "audio";
  else if (imageExts.has(ext)) kind = "image";

  const result = {
    filePath,
    fileName,
    kind,
    metadata,
    thumbnailUrl: null,
    thumbnailStrip: null,
    waveformPeaks: null,
    proxyUrl: null,
    convertedUrl: null,
    needsProxy: false,
    needsConvert: false,
  };

  // 3. Thumbnail rapida (unica — nao bloqueia)
  if (kind === "video" || kind === "image") {
    sendProgress("media:progress", { filePath, stage: "thumbnail", percent: 50 });
    const ts = kind === "video" ? Math.min(1, duration / 4).toFixed(2) : "0";
    const thumbOut = path.join(projectTmpDir, `thumb_${Date.now()}_${safeBaseName(filePath)}.jpg`);
    const thumbArgs = ["-ss", ts, "-i", filePath, "-vframes", "1", "-vf", "scale=320:-2", "-q:v", "3", "-y", thumbOut];
    const thumbResult = await runProcess(ffmpegPath, thumbArgs);
    if (thumbResult.code === 0 && fs.existsSync(thumbOut)) {
      proxyPaths.add(thumbOut);
      const port = server?.address()?.port ?? preferredPort;
      result.thumbnailUrl = `http://127.0.0.1:${port}/proxy?f=${encodeURIComponent(thumbOut)}`;
    }
  }

  // 4. URL imediata — serve o arquivo original enquanto proxy processa em background
  const codecsNativosVideo = new Set(["h264", "vp8", "vp9", "av1"]);
  const codecsNativosAudio = new Set(["aac", "mp3", "vorbis", "opus", "flac", "pcm_s16le", "pcm_f32le"]);
  const port = server?.address()?.port ?? preferredPort;

  proxyPaths.add(filePath);
  const directUrl = `http://127.0.0.1:${port}/proxy?f=${encodeURIComponent(filePath)}`;

  if (kind === "video") {
    result.proxyUrl = directUrl;
    const videoCodec = videoStream?.codec_name || "";
    const needsProxy = !codecsNativosVideo.has(videoCodec) || [".mov", ".mkv", ".avi", ".wmv", ".flv", ".ts", ".mts"].includes(ext);
    if (needsProxy) {
      result.needsProxy = true;
      // Transcodifica em background — envia evento quando pronto
      setImmediate(async () => {
        try {
          sendProgress("media:progress", { filePath, stage: "proxy", percent: 10 });
          const proxyOut = path.join(projectTmpDir, `proxy_${Date.now()}_${safeBaseName(filePath)}.mp4`);
          const proxyArgs = [
            "-i", filePath,
            "-vf", "scale=-2:'min(480,ih)'",
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
            "-c:a", "aac", "-b:a", "64k",
            "-movflags", "+faststart",
            "-y", proxyOut,
          ];
          const pr = await runProcess(ffmpegPath, proxyArgs);
          if (pr.code === 0 && fs.existsSync(proxyOut)) {
            proxyPaths.add(proxyOut);
            const newUrl = `http://127.0.0.1:${port}/proxy?f=${encodeURIComponent(proxyOut)}`;
            sendProgress("media:progress", { filePath, stage: "proxy-done", percent: 100, proxyUrl: newUrl });
          } else {
            sendProgress("media:progress", { filePath, stage: "proxy-error", percent: 0, error: `Proxy falhou (FFmpeg código ${pr.code}). O arquivo original será usado.` });
          }
        } catch (e) {
          sendProgress("media:progress", { filePath, stage: "proxy-error", percent: 0, error: `Proxy falhou: ${e.message}` });
        }
      });
    }
  } else if (kind === "audio") {
    const audioCodec = audioStream?.codec_name || "";
    const needsConvert = !codecsNativosAudio.has(audioCodec) || [".ogg", ".opus", ".wma", ".aif", ".aiff"].includes(ext);
    if (!needsConvert) {
      result.convertedUrl = directUrl;
      result.proxyUrl = directUrl;
    } else {
      result.convertedUrl = directUrl;
      result.proxyUrl = directUrl;
      result.needsConvert = true;
      setImmediate(async () => {
        try {
          const convOut = path.join(projectTmpDir, `conv_${Date.now()}_${safeBaseName(filePath)}.m4a`);
          const cr = await runProcess(ffmpegPath, ["-i", filePath, "-vn", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-y", convOut]);
          if (cr.code === 0 && fs.existsSync(convOut)) {
            proxyPaths.add(convOut);
            const newUrl = `http://127.0.0.1:${port}/proxy?f=${encodeURIComponent(convOut)}`;
            sendProgress("media:progress", { filePath, stage: "proxy-done", percent: 100, proxyUrl: newUrl });
          } else {
            sendProgress("media:progress", { filePath, stage: "proxy-error", percent: 0, error: "Falha ao converter áudio. O arquivo original será usado diretamente." });
          }
        } catch (e) {
          sendProgress("media:progress", { filePath, stage: "proxy-error", percent: 0, error: `Conversão falhou: ${e.message}` });
        }
      });
    }
  } else if (kind === "image") {
    result.proxyUrl = directUrl;
  }

  // Waveform em background (audio e video com faixa de audio)
  if (kind === "audio" || (kind === "video" && metadata.audio)) {
    setImmediate(async () => {
      try {
        const waveArgs = ["-i", filePath, "-vn", "-af", "aresample=8000", "-f", "s16le", "-ac", "1", "pipe:1"];
        const chunks = [];
        const wProc = spawn(ffmpegPath, waveArgs, { windowsHide: true });
        wProc.stdout.on("data", (c) => chunks.push(c));
        await new Promise((res) => wProc.on("close", res));
        if (chunks.length > 0) {
          const buf = Buffer.concat(chunks);
          const numSamples = Math.floor(buf.length / 2);
          const numBars = 100;
          const sPerBar = Math.max(1, Math.floor(numSamples / numBars));
          const peaks = [];
          for (let i = 0; i < numBars; i++) {
            let max = 0;
            const s = i * sPerBar * 2, e = Math.min(s + sPerBar * 2, buf.length - 1);
            for (let j = s; j < e; j += 2) { const v = Math.abs(buf.readInt16LE(j)); if (v > max) max = v; }
            peaks.push(max / 32768);
          }
          const peakMax = Math.max(...peaks, 0.01);
          sendProgress("media:progress", { filePath, stage: "waveform-done", percent: 100, waveformPeaks: peaks.map(p => p / peakMax) });
        } else {
          // Sem dados de áudio — envia peaks vazio para UI saber que terminou
          sendProgress("media:progress", { filePath, stage: "waveform-done", percent: 100, waveformPeaks: [] });
        }
      } catch (e) {
        // Waveform não é crítico — envia peaks vazio silenciosamente
        sendProgress("media:progress", { filePath, stage: "waveform-done", percent: 100, waveformPeaks: [] });
      }
    });
  }

  sendProgress("media:progress", { filePath, stage: "done", percent: 100 });
  return result;
});

// ══════════════════════════════════════════════════════════════════════════════
// LOCAL SERVER (proxy de arquivos + SPA)
// ══════════════════════════════════════════════════════════════════════════════

async function createLocalServer() {
  const root = path.join(__dirname, "..");
  const distClient = path.join(root, "dist", "client");

  return new Promise((resolve, reject) => {
    server = http.createServer(async (request, response) => {
      try {
        const currentPort = server.address().port;
        const requestUrl = new URL(request.url, `http://127.0.0.1:${currentPort}`);

        if (requestUrl.pathname === "/proxy") {
          handleProxy(requestUrl, request, response);
          return;
        }

        if (requestUrl.pathname === "/__oauth") {
          handleOAuthCallback(requestUrl, response);
          return;
        }

        const staticFile = path.join(
          distClient,
          decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname),
        );

        if (staticFile.startsWith(distClient) && fs.existsSync(staticFile) && fs.statSync(staticFile).isFile()) {
          response.writeHead(200, {
            "Content-Type": mimeTypes[path.extname(staticFile)] || "application/octet-stream",
          });
          fs.createReadStream(staticFile).pipe(response);
          return;
        }

        const spaIndex = path.join(distClient, "index.html");
        if (fs.existsSync(spaIndex)) {
          response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          fs.createReadStream(spaIndex).pipe(response);
          return;
        }

        response.writeHead(404, { "Content-Type": "text/plain" });
        response.end("Not found. Run npm run build.");
      } catch (error) {
        response.writeHead(500, { "Content-Type": "text/plain" });
        response.end(error instanceof Error ? error.stack : String(error));
      }
    });

    server.once("error", (error) => {
      if (error.code !== "EADDRINUSE") { reject(error); return; }
      server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}/`));
    });
    server.listen(preferredPort, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}/`));
  });
}

function handleProxy(requestUrl, request, response) {
  const filePath = requestUrl.searchParams.get("f");
  if (!filePath || !proxyPaths.has(filePath) || !fs.existsSync(filePath)) {
    response.writeHead(403, { "Content-Type": "text/plain" });
    response.end("Forbidden");
    return;
  }

  const stat = fs.statSync(filePath);
  const extMime = {
    ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/mp4",
    ".mkv": "video/x-matroska", ".avi": "video/x-msvideo",
    ".webm": "video/webm", ".m4a": "audio/mp4",
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".aac": "audio/aac",
    ".flac": "audio/flac", ".ogg": "audio/ogg",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
    ".svg": "image/svg+xml", ".heic": "image/heic",
  };
  const mime = extMime[path.extname(filePath).toLowerCase()] || "application/octet-stream";
  const range = request.headers.range;

  if (range) {
    const [s, e] = range.replace(/bytes=/, "").split("-");
    const start = parseInt(s, 10);
    const end = e ? parseInt(e, 10) : stat.size - 1;
    response.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
      "Content-Type": mime,
    });
    fs.createReadStream(filePath, { start, end }).pipe(response);
  } else {
    response.writeHead(200, {
      "Content-Type": mime,
      "Content-Length": stat.size,
      "Accept-Ranges": "bytes",
    });
    fs.createReadStream(filePath).pipe(response);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// OAUTH
// ══════════════════════════════════════════════════════════════════════════════

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const GOOGLE_SCOPE = "openid email profile https://www.googleapis.com/auth/drive";

function handleOAuthCallback(requestUrl, response) {
  const code = requestUrl.searchParams.get("code");
  if (code && pendingOAuth) {
    const { resolve, reject, codeVerifier, redirectUri } = pendingOAuth;
    pendingOAuth = null;

    fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri, grant_type: "authorization_code", code_verifier: codeVerifier,
      }).toString(),
    }).then((r) => r.json()).then((data) => {
      if (data.access_token) resolve({ accessToken: data.access_token, refreshToken: data.refresh_token ?? null, expiresIn: data.expires_in ?? 3600 });
      else reject(new Error(data.error_description ?? "sem token"));
    }).catch(reject);
  }

  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end('<!DOCTYPE html><html><body style="font-family:sans-serif;background:#111;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><p>Autenticado. Volte ao Studio V4.</p></body></html>');
}

ipcMain.handle("google-auth-configured", () => ({
  configured: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET),
}));

ipcMain.handle("google-auth", async () => {
  if (pendingOAuth) { pendingOAuth.reject(new Error("cancelled")); pendingOAuth = null; }

  const port = server?.address()?.port ?? preferredPort;
  const redirectUri = `http://127.0.0.1:${port}/__oauth`;
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", GOOGLE_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", GOOGLE_SCOPE);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "select_account consent");

  return new Promise((resolve, reject) => {
    pendingOAuth = { resolve, reject, codeVerifier, redirectUri };
    shell.openExternal(authUrl.toString());

    const timer = setTimeout(() => {
      if (pendingOAuth) {
        pendingOAuth.reject(new Error("Login expirou. A janela do navegador ficou aberta por mais de 10 minutos sem autenticação. Feche-a e tente novamente."));
        pendingOAuth = null;
      }
    }, 600_000);

    const origResolve = resolve;
    const origReject = reject;
    pendingOAuth.resolve = (t) => { clearTimeout(timer); origResolve(t); };
    pendingOAuth.reject = (e) => { clearTimeout(timer); origReject(e); };
  });
});

ipcMain.handle("google-refresh-token", async (_event, refreshToken) => {
  if (!refreshToken) throw new Error("refresh_token ausente");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken, grant_type: "refresh_token",
    }).toString(),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(data.error_description ?? "falha ao renovar token");
  return { accessToken: data.access_token, expiresIn: data.expires_in ?? 3600 };
});

// ══════════════════════════════════════════════════════════════════════════════
// PERSISTENCE & FILE DIALOGS
// ══════════════════════════════════════════════════════════════════════════════

const recentProjectsPath = () => path.join(app.getPath("userData"), "recent-projects.json");
const configPath = () => path.join(app.getPath("userData"), "sv4-config.json");

ipcMain.handle("read-recent-projects", () => {
  try { return JSON.parse(fs.readFileSync(recentProjectsPath(), "utf-8")); } catch { return []; }
});
ipcMain.handle("write-recent-projects", (_event, data) => {
  try { fs.writeFileSync(recentProjectsPath(), JSON.stringify(data)); } catch {}
});
ipcMain.handle("read-config", () => {
  try { return JSON.parse(fs.readFileSync(configPath(), "utf-8")); } catch { return {}; }
});
ipcMain.handle("write-config", (_event, data) => {
  try {
    const current = (() => { try { return JSON.parse(fs.readFileSync(configPath(), "utf-8")); } catch { return {}; } })();
    fs.writeFileSync(configPath(), JSON.stringify({ ...current, ...data }, null, 2));
    return true;
  } catch { return false; }
});

// Registra caminho no proxy sem re-ingerir (para restaurar projetos salvos)
// Apenas paths dentro de diretórios conhecidos são permitidos — evita path traversal
const PROXY_ALLOWED_ROOTS = [
  projectTmpDir,
  app.getPath("userData"),
  app.getPath("downloads"),
  app.getPath("documents"),
  os.homedir(),
];
function isPathAllowed(p) {
  if (typeof p !== "string") return false;
  const norm = path.normalize(p);
  return PROXY_ALLOWED_ROOTS.some(root => norm.startsWith(path.normalize(root) + path.sep) || norm === path.normalize(root));
}

ipcMain.handle("media:register-proxy", (_event, filePath) => {
  if (!isPathAllowed(filePath)) return { error: "Path não autorizado" };
  if (filePath && fs.existsSync(filePath)) {
    proxyPaths.add(filePath);
    const port = server?.address()?.port ?? preferredPort;
    return { url: `http://127.0.0.1:${port}/proxy?f=${encodeURIComponent(filePath)}` };
  }
  return { error: "Arquivo nao encontrado: " + filePath };
});

ipcMain.handle("open-file-dialog", async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Midia", extensions: ["mp4","mov","mkv","avi","webm","m4v","mp3","wav","aac","m4a","flac","ogg","opus","jpg","jpeg","png","webp","gif","heic"] },
      { name: "Todos", extensions: ["*"] },
    ],
  });
  return result.canceled ? null : result.filePaths;
});

ipcMain.handle("show-save-dialog", async (_event, opts) => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: opts.title || "Salvar",
    defaultPath: opts.defaultPath || "export",
    filters: opts.filters || [{ name: "Todos", extensions: ["*"] }],
  });
  return result.canceled ? null : result.filePath;
});

ipcMain.handle("save-project-file", async (_event, { snapshot, defaultName }) => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Salvar projeto",
    defaultPath: defaultName || "projeto",
    filters: [{ name: "Studio V4 — Projeto", extensions: ["v4"] }],
  });
  if (result.canceled || !result.filePath) return null;
  const savePath = result.filePath.endsWith(".v4") ? result.filePath : result.filePath + ".v4";
  // Remove URLs efêmeras (localhost proxy) — serão regeneradas via registerProxy ao reabrir
  const cleanSnapshot = {
    ...snapshot,
    assets: (snapshot.assets || []).map(a => ({
      ...a,
      url: "",
      previewUrl: "",
      file: undefined,
      // thumbnailUrl gerada como proxy localhost também não sobrevive entre sessões
      thumbnailUrl: (typeof a.thumbnailUrl === "string" && a.thumbnailUrl.startsWith("http://127.0.0.1"))
        ? undefined
        : a.thumbnailUrl,
    })),
  };
  try {
    fs.writeFileSync(savePath, JSON.stringify(cleanSnapshot, null, 2), "utf-8");
  } catch (err) {
    throw new Error(`Não foi possível salvar o arquivo: ${err.message}`);
  }
  return savePath;
});

ipcMain.handle("open-project-file", async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Abrir projeto",
    filters: [{ name: "Studio V4 — Projeto", extensions: ["v4"] }],
    properties: ["openFile"],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const filePath = result.filePaths[0];
  const header = Buffer.alloc(4);
  const fd = fs.openSync(filePath, "r");
  fs.readSync(fd, header, 0, 4, 0);
  fs.closeSync(fd);
  // ZIP magic: PK\x03\x04
  if (header[0] === 0x50 && header[1] === 0x4B) {
    const zip = new AdmZip(filePath);
    const tmpDir = path.join(os.tmpdir(), "studiov4", Date.now().toString());
    fs.mkdirSync(tmpDir, { recursive: true });
    zip.extractAllTo(tmpDir, true);
    const snapshot = JSON.parse(zip.readAsText("project.json"));
    snapshot.assets = (snapshot.assets || []).map(a => {
      if (a.filePath && !path.isAbsolute(a.filePath)) {
        return { ...a, filePath: path.join(tmpDir, a.filePath) };
      }
      return a;
    });
    return snapshot;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
});

// Abre projeto .v4 diretamente por path (sem dialog) — usado pelos recentes
ipcMain.handle("load-project-file", async (_event, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const header = Buffer.alloc(4);
    const fd = fs.openSync(filePath, "r");
    fs.readSync(fd, header, 0, 4, 0);
    fs.closeSync(fd);
    if (header[0] === 0x50 && header[1] === 0x4B) {
      const zip = new AdmZip(filePath);
      const tmpDir = path.join(os.tmpdir(), "studiov4", Date.now().toString());
      fs.mkdirSync(tmpDir, { recursive: true });
      zip.extractAllTo(tmpDir, true);
      const snapshot = JSON.parse(zip.readAsText("project.json"));
      snapshot.assets = (snapshot.assets || []).map(a => {
        if (a.filePath && !path.isAbsolute(a.filePath))
          return { ...a, filePath: path.join(tmpDir, a.filePath) };
        return a;
      });
      return snapshot;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch { return null; }
});

// ══════════════════════════════════════════════════════════════════════════════
// SAVE V4 PORTABLE (ZIP com mídia embutida)
// ══════════════════════════════════════════════════════════════════════════════

const COMPRESSED_EXTS = new Set([".mp4",".mov",".mkv",".avi",".webm",".m4v",".mp3",".aac",".m4a",".flac",".ogg",".opus",".hevc",".h264"]);

ipcMain.handle("save-v4-portable", async (_event, { snapshot, defaultName }) => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Exportar projeto portável",
    defaultPath: defaultName || "projeto",
    filters: [{ name: "Studio V4 — Portável", extensions: ["v4"] }],
  });
  if (result.canceled || !result.filePath) return null;
  const outPath = result.filePath.endsWith(".v4") ? result.filePath : result.filePath + ".v4";

  // Coletar arquivos únicos presentes no disco
  const assetPaths = (snapshot.assets || [])
    .map(a => a.filePath).filter(p => p && fs.existsSync(p));
  const uniquePaths = [...new Set(assetPaths)];

  // Mapear path original → nome no ZIP (desambiguando colisões de nome)
  const pathMap = new Map();
  const usedNames = new Set();
  for (const p of uniquePaths) {
    const ext = path.extname(p).toLowerCase();
    const base = path.basename(p, ext);
    let name = base + ext;
    if (usedNames.has(name)) {
      const hash = crypto.createHash("md5").update(p).digest("hex").slice(0, 6);
      name = `${base}__${hash}${ext}`;
    }
    usedNames.add(name);
    pathMap.set(p, `media/${name}`);
  }

  // Snapshot com paths relativos e URLs localhost removidas (serão regeneradas ao abrir)
  const portableSnapshot = {
    ...snapshot,
    _portable: true,
    assets: (snapshot.assets || []).map(a => ({
      ...a,
      filePath: pathMap.get(a.filePath) ?? a.filePath,
      url: "",
      previewUrl: "",
      file: undefined,
      thumbnailUrl: (typeof a.thumbnailUrl === "string" && a.thumbnailUrl.startsWith("http://127.0.0.1"))
        ? undefined
        : a.thumbnailUrl,
    })),
  };

  const totalBytes = uniquePaths.reduce((s, p) => {
    try { return s + fs.statSync(p).size; } catch { return s; }
  }, 1024);

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver("zip", { zlib: { level: 6 } });

    output.on("close", () => {
      sendProgress("export-progress", { percent: 100, outputPath: outPath });
      resolve({ outputPath: outPath });
    });
    archive.on("error", reject);
    archive.pipe(output);

    // JSON comprimido
    archive.append(Buffer.from(JSON.stringify(portableSnapshot, null, 2), "utf-8"), {
      name: "project.json", store: false,
    });

    // Mídia: vídeo/áudio já comprimidos → STORE; imagens → deflate
    for (const [origPath, zipName] of pathMap.entries()) {
      const ext = path.extname(origPath).toLowerCase();
      archive.file(origPath, { name: zipName, store: COMPRESSED_EXTS.has(ext) });
    }

    archive.on("progress", ({ fs: fsInfo }) => {
      const pct = Math.min(99, Math.round((fsInfo.processedBytes / totalBytes) * 100));
      sendProgress("export-progress", { percent: pct });
    });

    archive.finalize();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// EXPORT AUDIO (MP3 / WAV)
// ══════════════════════════════════════════════════════════════════════════════

ipcMain.handle("export-audio", async (_event, { clips, outputPath, format }) => {
  const validClips = (clips || []).filter(c => c.filePath && fs.existsSync(c.filePath));
  if (validClips.length === 0) throw new Error("Nenhum clipe valido");

  const inputs = [];
  const filterParts = [];
  const mixParts = [];

  validClips.forEach((clip, i) => {
    const speed = Math.max(0.25, Math.min(4, clip.speed || 1));
    inputs.push("-ss", String(clip.trimStart || 0), "-t", String((clip.duration || 5) / speed), "-i", clip.filePath);
    const aLabel = `[a${i}]`;
    const atempoChain = buildAtempoFilter(speed);
    filterParts.push(atempoChain
      ? `[${i}:a]${atempoChain}${aLabel}`
      : `[${i}:a]anull${aLabel}`);
    mixParts.push(aLabel);
  });

  const n = validClips.length;
  const filterComplex = [...filterParts, `${mixParts.join("")}concat=n=${n}:v=0:a=1[outa]`].join(";");
  const totalDuration = validClips.reduce((s, c) => s + (c.duration || 5), 0);

  const codecArgs = format === "wav"
    ? ["-c:a", "pcm_s16le"]
    : ["-c:a", "libmp3lame", "-b:a", "192k"];

  const args = [...inputs, "-filter_complex", filterComplex, "-map", "[outa]",
    ...codecArgs, "-progress", "pipe:1", "-nostats", "-y", outputPath];

  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    let buf = "";
    proc.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      const lines = buf.split("\n"); buf = lines.pop() ?? "";
      for (const line of lines) {
        const m = line.match(/^out_time_ms=(\d+)/);
        if (m) {
          const pct = Math.min(99, Math.round((parseInt(m[1]) / 1_000_000 / totalDuration) * 100));
          sendProgress("export-progress", { percent: pct, outputPath });
        }
      }
    });
    let stderrBuf = "";
    proc.stderr.on("data", (d) => { stderrBuf += d.toString(); });
    proc.on("close", (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        sendProgress("export-progress", { percent: 100, outputPath });
        resolve({ outputPath });
      } else {
        const detail = stderrBuf.slice(-400).trim();
        reject(new Error(`FFmpeg encerrou com codigo ${code}${detail ? `\n${detail}` : ""}`));
      }
    });
    proc.on("error", reject);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// EXPORT GIF (palette method — qualidade máxima)
// ══════════════════════════════════════════════════════════════════════════════

ipcMain.handle("export-gif", async (_event, { clips, outputPath, resolution }) => {
  const validClips = (clips || []).filter(c => c.filePath && fs.existsSync(c.filePath));
  if (validClips.length === 0) throw new Error("Nenhum clipe valido");

  const w = resolution === "720p" ? 960 : 480;
  const fps = 15;

  // Etapa 1: concat para MP4 temporário
  const tmpMp4 = path.join(os.tmpdir(), `sv4_gif_${Date.now()}.mp4`);
  const inputs = [], filterParts = [], concatParts = [];

  validClips.forEach((clip, i) => {
    const speed = Math.max(0.25, Math.min(4, clip.speed || 1));
    inputs.push("-ss", String(clip.trimStart || 0), "-t", String((clip.duration || 5) / speed), "-i", clip.filePath);
    const vLabel = `[v${i}]`;
    const aLabel = `[a${i}]`;
    filterParts.push(`[${i}:v]scale=${w}:-2:flags=lanczos${speed !== 1 ? `,setpts=${(1/speed).toFixed(4)}*PTS` : ""}${vLabel}`);
    filterParts.push(`[${i}:a]anull${aLabel}`);
    concatParts.push(vLabel, aLabel);
  });

  const n = validClips.length;
  const fc = [...filterParts, `${concatParts.join("")}concat=n=${n}:v=1:a=1[outv][outa]`].join(";");

  await new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [...inputs, "-filter_complex", fc, "-map", "[outv]",
      "-c:v", "libx264", "-crf", "22", "-preset", "ultrafast", "-an", "-y", tmpMp4], { windowsHide: true });
    let se = "";
    proc.stderr.on("data", (d) => { se += d.toString(); });
    proc.on("close", (code) => {
      if (code === 0) { resolve(); }
      else { try { fs.unlinkSync(tmpMp4); } catch {} reject(new Error(`Falha ao gerar MP4 intermediario${se ? `\n${se.slice(-300)}` : ""}`)); }
    });
    proc.on("error", (err) => { try { fs.unlinkSync(tmpMp4); } catch {} reject(err); });
  });

  sendProgress("export-progress", { percent: 40 });

  // Etapa 2: gerar paleta
  const palettePath = path.join(os.tmpdir(), `sv4_palette_${Date.now()}.png`);
  await new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, ["-i", tmpMp4, "-vf", `fps=${fps},palettegen=max_colors=256:stats_mode=diff`, "-y", palettePath], { windowsHide: true });
    let se = "";
    proc.stderr.on("data", (d) => { se += d.toString(); });
    proc.on("close", (code) => {
      if (code === 0) { resolve(); }
      else { try { fs.unlinkSync(tmpMp4); fs.unlinkSync(palettePath); } catch {} reject(new Error(`Falha ao gerar paleta GIF${se ? `\n${se.slice(-300)}` : ""}`)); }
    });
    proc.on("error", (err) => { try { fs.unlinkSync(tmpMp4); fs.unlinkSync(palettePath); } catch {} reject(err); });
  });

  sendProgress("export-progress", { percent: 70 });

  // Etapa 3: converter com paleta
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, ["-i", tmpMp4, "-i", palettePath,
      "-lavfi", `fps=${fps}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5`,
      "-y", outputPath], { windowsHide: true });
    let se = "";
    proc.stderr.on("data", (d) => { se += d.toString(); });
    proc.on("close", (code) => {
      try { fs.unlinkSync(tmpMp4); fs.unlinkSync(palettePath); } catch {}
      if (code === 0 && fs.existsSync(outputPath)) {
        sendProgress("export-progress", { percent: 100, outputPath });
        resolve({ outputPath });
      } else reject(new Error(`Falha ao converter para GIF${se ? `\n${se.slice(-400)}` : ""}`));
    });
    proc.on("error", reject);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// EXPORT VIDEO
// ══════════════════════════════════════════════════════════════════════════════

ipcMain.handle("export-video", async (_event, { clips, outputPath, resolution, captionsASS }) => {
  const allValid = (clips || []).filter(c => c.filePath && fs.existsSync(c.filePath));
  if (allValid.length === 0) throw new Error("Nenhum clipe valido");

  // track 0 → main (concat); track 1+ vídeo → overlay; track 1+ áudio → mix de fundo
  const mainClips      = allValid.filter(c => !c.isOverlay && !c.audioOnly);
  const extraAudioClips = allValid.filter(c => c.audioOnly);
  const overlayClips   = allValid.filter(c => c.isOverlay);

  if (mainClips.length === 0) throw new Error("Nenhum clipe de vídeo na track principal");

  const w = resolution === "1080p" ? 1920 : 1280;
  const h = resolution === "1080p" ? 1080 : 720;
  const inputs = [];
  const filterParts = [];
  const concatParts = [];

  // ── Track principal: video + audio ──────────────────────────────────────────
  mainClips.forEach((clip, i) => {
    const speed = Math.max(0.25, Math.min(4, clip.speed || 1));
    inputs.push("-ss", String(clip.trimStart || 0), "-t", String((clip.duration || 5) / speed), "-i", clip.filePath);
    const vLabel = `[v${i}]`;
    const aLabel = `[a${i}]`;
    filterParts.push(`[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2${speed !== 1 ? `,setpts=${(1/speed).toFixed(4)}*PTS` : ""}${vLabel}`);
    const atempoChain = buildAtempoFilter(speed);
    filterParts.push(atempoChain ? `[${i}:a]${atempoChain}${aLabel}` : `[${i}:a]anull${aLabel}`);
    concatParts.push(vLabel, aLabel);
  });

  const n = mainClips.length;
  const totalDuration = mainClips.reduce((sum, c) => sum + (c.duration || 5), 0);

  // concat da track principal → [concatv][concata]
  filterParts.push(`${concatParts.join("")}concat=n=${n}:v=1:a=1[concatv][concata]`);

  // ── Áudio extra (tracks de áudio > 0) ──────────────────────────────────────
  const extraAudioLabels = [];
  extraAudioClips.forEach((clip, j) => {
    const idx = n + j;
    const speed = Math.max(0.25, Math.min(4, clip.speed || 1));
    inputs.push("-ss", String(clip.trimStart || 0), "-t", String((clip.duration || 5) / speed), "-i", clip.filePath);
    const label = `[extra${j}]`;
    const atempoChain = buildAtempoFilter(speed);
    filterParts.push(atempoChain ? `[${idx}:a]${atempoChain}${label}` : `[${idx}:a]anull${label}`);
    extraAudioLabels.push(label);
  });

  const amixInputCount = 1 + extraAudioLabels.length;
  const audioOutFilter = extraAudioLabels.length > 0
    ? `[concata]${extraAudioLabels.join("")}amix=inputs=${amixInputCount}:normalize=0[outa]`
    : `[concata]anull[outa]`;
  filterParts.push(audioOutFilter);

  // ── Overlay de vídeo (tracks de vídeo > 0) ─────────────────────────────────
  const overBase = n + extraAudioClips.length;
  let prevVideoOut = "concatv";

  overlayClips.forEach((clip, k) => {
    const idx = overBase + k;
    const speed = Math.max(0.25, Math.min(4, clip.speed || 1));
    const startTime = clip.startTime || 0;
    const duration  = clip.duration || 5;
    const endTime   = startTime + duration;
    inputs.push("-ss", String(clip.trimStart || 0), "-t", String(duration / speed), "-i", clip.filePath);
    const speedPts = speed !== 1 ? `${(1/speed).toFixed(4)}*` : "";
    filterParts.push(
      `[${idx}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setpts=${speedPts}(PTS-STARTPTS)+${startTime.toFixed(3)}/TB[ov${k}]`
    );
    const outLabel = k === overlayClips.length - 1 ? "preoutv" : `ovout${k}`;
    filterParts.push(
      `[${prevVideoOut}][ov${k}]overlay=enable='between(t,${startTime.toFixed(3)},${endTime.toFixed(3)})':eof_action=pass[${outLabel}]`
    );
    prevVideoOut = outLabel;
  });

  const videoInLabel = overlayClips.length > 0 ? "preoutv" : "concatv";

  // ── Legenda e saída final ──────────────────────────────────────────────────
  let filterComplex;
  let assTmpPath = null;

  if (captionsASS && captionsASS.trim()) {
    assTmpPath = path.join(projectTmpDir, `captions_export_${Date.now()}.ass`);
    fs.writeFileSync(assTmpPath, captionsASS, "utf-8");
    const escapedAss = assTmpPath.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "$1\\:");
    filterParts.push(`[${videoInLabel}]ass='${escapedAss}'[outv]`);
  } else {
    filterParts.push(`[${videoInLabel}]null[outv]`);
  }

  filterComplex = filterParts.join(";");

  const args = [...inputs, "-filter_complex", filterComplex, "-map", "[outv]", "-map", "[outa]",
    "-c:v", "libx264", "-crf", "22", "-preset", "fast", "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", "-y", outputPath];

  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    let progressBuf = "";
    proc.stdout.on("data", (chunk) => {
      progressBuf += chunk.toString();
      const lines = progressBuf.split("\n");
      progressBuf = lines.pop() ?? "";
      for (const line of lines) {
        const m = line.match(/^out_time_ms=(\d+)/);
        if (m) {
          const pct = Math.min(99, Math.round((parseInt(m[1]) / 1_000_000 / totalDuration) * 100));
          sendProgress("export-progress", { percent: pct, outputPath });
        }
      }
    });
    let stderrBuf = "";
    proc.stderr.on("data", (d) => { stderrBuf += d.toString(); });
    proc.on("close", (code) => {
      if (assTmpPath) { try { fs.unlinkSync(assTmpPath); } catch {} }
      if (code === 0 && fs.existsSync(outputPath)) {
        sendProgress("export-progress", { percent: 100, outputPath });
        resolve({ outputPath });
      } else {
        const detail = stderrBuf.slice(-400).trim();
        reject(new Error(`FFmpeg encerrou com codigo ${code}${detail ? `\n${detail}` : ""}`));
      }
    });
    proc.on("error", reject);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// WINDOW & APP LIFECYCLE
// ══════════════════════════════════════════════════════════════════════════════

async function createWindow() {
  const url = await createLocalServer();
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: sw, height: sh } = primaryDisplay.workAreaSize;
  const winW = Math.min(1440, sw - 40);
  const winH = Math.min(900, sh - 40);

  mainWindow = new BrowserWindow({
    width: winW, height: winH,
    x: Math.round((sw - winW) / 2), y: Math.round((sh - winH) / 2),
    minWidth: 1100, minHeight: 720,
    backgroundColor: "#080808",
    title: "Studio V4",
    icon: path.join(__dirname, "..", "assets", "icon.ico"),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox:false necessário para preload com contextBridge funcionar em alguns builds Electron 42
      sandbox: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  // ── CSP — restringe origens de scripts/mídia para reduzir superfície XSS ──
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; " +
          "script-src 'self' 'unsafe-inline'; " +
          "style-src 'self' 'unsafe-inline'; " +
          "connect-src 'self' http://127.0.0.1:* https:; " +
          "media-src 'self' http://127.0.0.1:* blob: data:; " +
          "img-src 'self' http://127.0.0.1:* blob: data:; " +
          "font-src 'self' data:;"
        ],
      },
    });
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.focus();
    if (app.isPackaged && !fs.existsSync(ffmpegPath)) {
      dialog.showErrorBox(
        "FFmpeg não encontrado",
        `FFmpeg não foi encontrado em:\n${ffmpegPath}\n\nO Studio V4 não conseguirá processar vídeos. Reinstale o aplicativo.`
      );
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url: u }) => { shell.openExternal(u); return { action: "deny" }; });
  mainWindow.webContents.on("render-process-gone", (_e, d) => { if (d.reason !== "clean-exit") mainWindow.reload(); });

  // Permitir drag & drop sem navegar
  mainWindow.webContents.on("will-navigate", (e) => { e.preventDefault(); });

  await mainWindow.loadURL(url);

  // Checar atualizações após carregar
  if (autoUpdater) {
    autoUpdater.on("update-available", (info) => {
      sendProgress("app:update", { status: "available", version: info.version });
    });
    autoUpdater.on("download-progress", (progress) => {
      sendProgress("app:update", { status: "downloading", percent: Math.round(progress.percent) });
    });
    autoUpdater.on("update-downloaded", (info) => {
      sendProgress("app:update", { status: "ready", version: info.version });
    });
    autoUpdater.checkForUpdates().catch(() => {});
  }
}

// ── Síntese de Voz — Windows SAPI (funciona em qualquer PC Windows, sem instalar nada) ──
ipcMain.handle("media:list-voices", async () => {
  const ps = [
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "Add-Type -AssemblyName System.Speech",
    "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer",
    "$s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }",
    "$s.Dispose()",
  ].join("; ");
  return new Promise(resolve => {
    const proc = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], {
      stdio: ["ignore","pipe","pipe"], windowsHide: true,
    });
    let out = "";
    proc.stdout.on("data", d => out += d.toString());
    proc.on("close", () => {
      const voices = out.trim().split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      resolve({ voices });
    });
    proc.on("error", () => resolve({ voices: [] }));
  });
});

ipcMain.handle("media:synthesize-voice", async (_event, text, voiceName) => {
  if (typeof text !== "string") return { error: "text deve ser string" };
  const outPath    = path.join(projectTmpDir, `tts_${Date.now()}.wav`);
  const txtPath    = path.join(projectTmpDir, `tts_text_${Date.now()}.txt`);
  const scriptPath = path.join(projectTmpDir, `tts_script_${Date.now()}.ps1`);

  // Texto vai para arquivo temporário — nunca interpolado no script PS (evita injection)
  const cleanText = (text || "").slice(0, 500);
  fs.writeFileSync(txtPath, cleanText, "utf-8");

  // Voice name: apenas caracteres alfanuméricos, espaço e hífen
  const safeVoice = (voiceName || "").replace(/[^a-zA-Z0-9 \-]/g, "").slice(0, 100);

  const psScript = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
if ('${safeVoice}') { try { $s.SelectVoice('${safeVoice}') } catch {} }
$txt = [System.IO.File]::ReadAllText('${txtPath.replace(/\\/g, "\\\\")}', [System.Text.Encoding]::UTF8)
$s.SetOutputToWaveFile('${outPath.replace(/\\/g, "\\\\")}')
$s.Speak($txt)
$s.Dispose()
Write-Output 'done'
`.trim();

  fs.writeFileSync(scriptPath, psScript, "utf-8");

  return new Promise(resolve => {
    const proc = spawn("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath], {
      stdio: ["ignore","pipe","pipe"], windowsHide: true,
    });
    let errBuf = "";
    proc.stderr.on("data", d => errBuf += d.toString());
    proc.on("close", code => {
      try { fs.unlinkSync(txtPath); } catch {}
      try { fs.unlinkSync(scriptPath); } catch {}
      if (code === 0 && fs.existsSync(outPath)) {
        resolve({ path: outPath, url: `file://${outPath.replace(/\\/g, "/")}` });
      } else {
        resolve({ error: (errBuf || "PowerShell SAPI falhou").slice(-300) });
      }
    });
    proc.on("error", e => resolve({ error: String(e?.message || e) }));
  });
});

// ── Lip Sync — Wav2Lip via Python (limite: 5min de vídeo por vez) ──────────
const MAX_LIPSYNC_SEC = 300;

ipcMain.handle("media:lipsync-status", async () => {
  return new Promise(resolve => {
    // shell: false — python sem shell; args controlados pelo app, sem input de usuário
    const proc = spawn("python", ["-c", "import wav2lip_inference; print('ok')"], {
      stdio: ["ignore","pipe","pipe"], windowsHide: true,
    });
    let out = "";
    proc.stdout.on("data", d => out += d.toString());
    proc.on("close", code => resolve({ ready: code === 0 && out.includes("ok") }));
    proc.on("error", () => resolve({ ready: false }));
  });
});

ipcMain.handle("media:lipsync", async (_event, videoPath, audioPath, trimStart, trimDuration) => {
  if (typeof videoPath !== "string") return { error: "videoPath inválido" };
  if (audioPath !== null && typeof audioPath !== "string") return { error: "audioPath inválido" };
  const dur = Math.min(typeof trimDuration === "number" ? trimDuration : MAX_LIPSYNC_SEC, MAX_LIPSYNC_SEC);
  const ts  = typeof trimStart === "number" && trimStart > 0 ? trimStart : 0;
  const baseName  = safeBaseName(videoPath);
  const tmpVideo  = path.join(projectTmpDir, `ls_v_${Date.now()}_${baseName}.mp4`);
  const tmpAudio  = audioPath ? null : path.join(projectTmpDir, `ls_a_${Date.now()}.wav`);
  const outputPath = path.join(projectTmpDir, `lipsync_${Date.now()}_${baseName}.mp4`);

  // Corta vídeo até MAX_LIPSYNC_SEC
  const { code: c1 } = await runProcess(ffmpegPath, [
    "-y", "-ss", String(ts), "-t", String(dur),
    "-i", videoPath, "-c:v", "libx264", "-preset", "fast", "-c:a", "aac", tmpVideo,
  ]);
  if (c1 !== 0) return { error: "Falha ao cortar vídeo" };

  // Extrai áudio do clipe se nenhum áudio externo foi fornecido
  if (!audioPath && tmpAudio) {
    const { code: c2 } = await runProcess(ffmpegPath, [
      "-y", "-ss", String(ts), "-t", String(dur),
      "-i", videoPath, "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", tmpAudio,
    ]);
    if (c2 !== 0) {
      try { fs.unlinkSync(tmpVideo); } catch {}
      return { error: "Falha ao extrair áudio" };
    }
  }

  const actualAudio = audioPath || tmpAudio;
  sendProgress("media:progress", { filePath: videoPath, stage: "lipsync", percent: 5 });

  const TIMEOUT_MS = (MAX_LIPSYNC_SEC / 60) * 7 * 60 * 1000 + 60_000; // ~7min CPU/min + margem

  return new Promise(resolve => {
    // shell: false — evita interpretação de metacaracteres do shell nos caminhos
    const proc = spawn("python", [
      "-m", "wav2lip_inference",
      "--face", tmpVideo, "--audio", actualAudio, "--out", outputPath,
    ], { stdio: ["ignore","pipe","pipe"], windowsHide: true });

    const cleanup = () => {
      try { fs.unlinkSync(tmpVideo); } catch {}
      if (tmpAudio) { try { fs.unlinkSync(tmpAudio); } catch {} }
    };

    // Timeout: mata o processo se ultrapassar o limite esperado
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      cleanup();
      resolve({ error: `Wav2Lip excedeu o tempo limite (${Math.round(TIMEOUT_MS / 60000)} min). Tente um clipe mais curto.` });
    }, TIMEOUT_MS);

    let errBuf = "";
    const MAX_BUF = 8000;
    proc.stderr.on("data", d => {
      const chunk = d.toString();
      errBuf = (errBuf + chunk).slice(-MAX_BUF); // mantém só os últimos 8k chars
      const m = errBuf.match(/(\d+)%\|/g);
      if (m) {
        const pct = Math.min(94, 5 + parseInt(m[m.length - 1]) * 0.89);
        sendProgress("media:progress", { filePath: videoPath, stage: "lipsync", percent: pct });
      }
    });
    proc.stdout.on("data", () => {});

    proc.on("close", code => {
      clearTimeout(timer);
      cleanup();
      if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
        sendProgress("media:progress", { filePath: videoPath, stage: "lipsync-done", percent: 100 });
        resolve({ outputPath, url: `file://${outputPath.replace(/\\/g, "/")}` });
      } else if (code === 0) {
        resolve({ error: "Wav2Lip concluiu mas não gerou o arquivo de saída. Verifique se o rosto está visível no vídeo." });
      } else {
        resolve({ error: `Wav2Lip falhou (código ${code}):\n${errBuf.slice(-600)}` });
      }
    });
    proc.on("error", e => {
      clearTimeout(timer);
      cleanup();
      resolve({ error: String(e?.message || e) });
    });
  });
});

app.commandLine.appendSwitch("enable-features", "PlatformHEVCDecoderSupport");
app.commandLine.appendSwitch("disable-gpu-sandbox");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

app.whenReady().then(async () => {
  await createWindow();
  // Downloads de background — stems ONNX + Whisper.cpp (8s de delay para não atrasar o startup)
  setTimeout(() => {
    ensureModelDownloaded().catch(() => {});
    ensureWhisperReady().catch(() => {});
  }, 8000);
});
app.on("window-all-closed", () => { if (server) server.close(); if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
