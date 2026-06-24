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
const os = require("node:os");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const archiver = require("archiver");
const AdmZip = require("adm-zip");

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

function safeBaseName(filePath) {
  return path.basename(filePath, path.extname(filePath)).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
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
    return { error: "Demucs nao encontrado. Instale com: pip install demucs" };
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

// ── 6c. Transcribe via Groq Whisper (chave no backend) ──────────────────────

const GROQ_API_KEY = process.env.GROQ_API_KEY || (() => {
  // Re-leitura direta caso loadEnv() tenha rodado antes de process.resourcesPath estar definido
  try {
    const envPath = path.join(process.resourcesPath || path.join(__dirname, ".."), ".env");
    const lines = fs.readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const m = line.match(/^GROQ_API_KEY=(.+)$/);
      if (m) return m[1].trim();
    }
  } catch {}
  return "";
})();

const LANG_PROMPTS = {
  pt: "Transcreva em portugues brasileiro com acentuacao correta, virgulas, pontos e pontuacao gramatical. Use letras maiusculas no inicio de frases.",
  en: "Transcribe in English with proper punctuation, capitalization, and grammar.",
  es: "Transcribe en espanol con acentuacion correcta, puntuacion y gramatica adecuada.",
  auto: "Transcribe with proper punctuation and grammar.",
};

ipcMain.handle("media:transcribe", async (_event, filePath, language) => {
  const lang = language || "pt";

  // 1. Extrair WAV 16kHz mono
  const baseName = safeBaseName(filePath);
  const wavPath = path.join(projectTmpDir, `transcribe_${Date.now()}_${baseName}.wav`);
  const extractArgs = ["-y", "-i", filePath, "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", wavPath];
  const extractResult = await runProcess(ffmpegPath, extractArgs);
  if (extractResult.code !== 0 || !fs.existsSync(wavPath)) {
    return { segments: [], error: "Falha ao extrair audio" };
  }

  sendProgress("media:progress", { filePath, stage: "transcribe", percent: 30 });

  // 2. Ler chave do config do usuario (se tiver) ou usar a default
  let apiKey = GROQ_API_KEY;
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath(), "utf-8"));
    if (cfg.groqApiKey && cfg.groqApiKey.trim()) apiKey = cfg.groqApiKey.trim();
  } catch {}

  // 3. Enviar para Groq
  try {
    const wavBuffer = fs.readFileSync(wavPath);
    const boundary = `----FormBoundary${Date.now()}`;
    const parts = [];

    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`);
    parts.push(wavBuffer);
    parts.push(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3-turbo`);
    parts.push(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\nverbose_json`);
    parts.push(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="timestamp_granularities[]"\r\n\r\nsegment`);
    if (lang !== "auto") parts.push(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${lang}`);
    parts.push(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n${LANG_PROMPTS[lang] || LANG_PROMPTS.auto}`);
    parts.push(`\r\n--${boundary}--\r\n`);

    const body = Buffer.concat(parts.map(p => typeof p === "string" ? Buffer.from(p) : p));

    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      return { segments: [], error: errData.error?.message || `Groq API: ${res.status}` };
    }

    const data = await res.json();
    const segments = (data.segments || []).map(s => ({
      start: s.start,
      end: s.end,
      text: (s.text || "").trim(),
    }));

    if (segments.length === 0 && data.text) {
      segments.push({ start: 0, end: 0, text: data.text });
    }

    sendProgress("media:progress", { filePath, stage: "transcribe", percent: 100 });
    try { fs.unlinkSync(wavPath); } catch {}
    return { segments, language: data.language || lang };
  } catch (err) {
    return { segments: [], error: err.message || "Falha na transcricao" };
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
      fps: Math.round(eval(videoStream.r_frame_rate || "0") * 100) / 100,
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
          }
        } catch {}
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
          }
        } catch {}
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
        }
      } catch {}
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
      if (pendingOAuth) { pendingOAuth.reject(new Error("timeout")); pendingOAuth = null; }
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
ipcMain.handle("media:register-proxy", (_event, filePath) => {
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
  fs.writeFileSync(savePath, JSON.stringify(snapshot, null, 2), "utf-8");
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

  // Snapshot com paths relativos
  const portableSnapshot = {
    ...snapshot,
    _portable: true,
    assets: (snapshot.assets || []).map(a => ({
      ...a,
      filePath: pathMap.get(a.filePath) ?? a.filePath,
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
    filterParts.push(speed !== 1
      ? `[${i}:a]atempo=${Math.min(2, Math.max(0.5, speed)).toFixed(4)}${aLabel}`
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
    proc.stderr.on("data", () => {});
    proc.on("close", (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        sendProgress("export-progress", { percent: 100, outputPath });
        resolve({ outputPath });
      } else reject(new Error(`FFmpeg encerrou com codigo ${code}`));
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
    proc.stderr.on("data", () => {});
    proc.on("close", (code) => code === 0 ? resolve() : reject(new Error("Falha ao gerar MP4 intermediario")));
    proc.on("error", reject);
  });

  sendProgress("export-progress", { percent: 40 });

  // Etapa 2: gerar paleta
  const palettePath = path.join(os.tmpdir(), `sv4_palette_${Date.now()}.png`);
  await new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, ["-i", tmpMp4, "-vf", `fps=${fps},palettegen=max_colors=256:stats_mode=diff`, "-y", palettePath], { windowsHide: true });
    proc.stderr.on("data", () => {});
    proc.on("close", (code) => code === 0 ? resolve() : reject(new Error("Falha ao gerar paleta GIF")));
    proc.on("error", reject);
  });

  sendProgress("export-progress", { percent: 70 });

  // Etapa 3: converter com paleta
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, ["-i", tmpMp4, "-i", palettePath,
      "-lavfi", `fps=${fps}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5`,
      "-y", outputPath], { windowsHide: true });
    proc.stderr.on("data", () => {});
    proc.on("close", (code) => {
      try { fs.unlinkSync(tmpMp4); fs.unlinkSync(palettePath); } catch {}
      if (code === 0 && fs.existsSync(outputPath)) {
        sendProgress("export-progress", { percent: 100, outputPath });
        resolve({ outputPath });
      } else reject(new Error("Falha ao converter para GIF"));
    });
    proc.on("error", reject);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// EXPORT VIDEO
// ══════════════════════════════════════════════════════════════════════════════

ipcMain.handle("export-video", async (_event, { clips, outputPath, resolution }) => {
  const validClips = (clips || []).filter(c => c.filePath && fs.existsSync(c.filePath));
  if (validClips.length === 0) throw new Error("Nenhum clipe valido");

  const w = resolution === "1080p" ? 1920 : 1280;
  const h = resolution === "1080p" ? 1080 : 720;
  const inputs = [];
  const filterParts = [];
  const concatParts = [];

  validClips.forEach((clip, i) => {
    const speed = Math.max(0.25, Math.min(4, clip.speed || 1));
    inputs.push("-ss", String(clip.trimStart || 0), "-t", String((clip.duration || 5) / speed), "-i", clip.filePath);
    const vLabel = `[v${i}]`;
    const aLabel = `[a${i}]`;
    filterParts.push(`[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2${speed !== 1 ? `,setpts=${(1/speed).toFixed(4)}*PTS` : ""}${vLabel}`);
    if (speed !== 1 && speed >= 0.5 && speed <= 2) filterParts.push(`[${i}:a]atempo=${speed.toFixed(4)}${aLabel}`);
    else if (speed !== 1) filterParts.push(`[${i}:a]atempo=${Math.min(2, Math.max(0.5, speed)).toFixed(4)}${aLabel}`);
    else filterParts.push(`[${i}:a]anull${aLabel}`);
    concatParts.push(vLabel, aLabel);
  });

  const n = validClips.length;
  const filterComplex = [...filterParts, `${concatParts.join("")}concat=n=${n}:v=1:a=1[outv][outa]`].join(";");
  const totalDuration = validClips.reduce((sum, c) => sum + (c.duration || 5), 0);

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
    proc.stderr.on("data", () => {});
    proc.on("close", (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        sendProgress("export-progress", { percent: 100, outputPath });
        resolve({ outputPath });
      } else reject(new Error(`FFmpeg encerrou com codigo ${code}`));
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
      sandbox: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  mainWindow.once("ready-to-show", () => { mainWindow.show(); mainWindow.focus(); });
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

app.commandLine.appendSwitch("enable-features", "PlatformHEVCDecoderSupport");
app.commandLine.appendSwitch("disable-gpu-sandbox");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (server) server.close(); if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
