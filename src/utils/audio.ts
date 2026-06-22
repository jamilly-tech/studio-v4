export type CleanCutPause = {
  id: string;
  label: string;
  time: string;
  startTime: number;
  endTime: number;
  width: number;
  color: string;
  score?: number;
  reason?: string;
  action?: "review" | "cut";
};

export async function decodeAudioBufferFromFile(fileOrUrl: File | string): Promise<AudioBuffer> {
  const isUrl = typeof fileOrUrl === "string";
  const file = isUrl ? null : (fileOrUrl as File);

  if (file && file.size > 0) {
    const ctx1 = new AudioContext();
    await ctx1.resume();
    try {
      const ab = await file.arrayBuffer();
      const buf = await ctx1.decodeAudioData(ab.slice(0));
      await ctx1.close().catch(() => {});
      return buf;
    } catch { /* next attempt */ }
    await ctx1.close().catch(() => {});

    try {
      const url2 = URL.createObjectURL(file);
      const res = await fetch(url2);
      URL.revokeObjectURL(url2);
      const ab2 = await res.arrayBuffer();
      const ctx2 = new AudioContext();
      await ctx2.resume();
      const buf = await ctx2.decodeAudioData(ab2);
      await ctx2.close().catch(() => {});
      return buf;
    } catch { /* next attempt */ }
  }

  return new Promise<AudioBuffer>((resolve, reject) => {
    const srcUrl = isUrl ? (fileOrUrl as string) : URL.createObjectURL(file!);
    const shouldRevoke = !isUrl;
    const videoEl = document.createElement("video");
    videoEl.src = srcUrl;
    videoEl.preload = "auto";
    videoEl.playbackRate = 8.0;

    const SAMPLE_RATE = 22050;
    const liveCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
    const chunks: Float32Array[] = [];
    let processor: ScriptProcessorNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let timeoutId: ReturnType<typeof setTimeout>;

    function cleanup() {
      clearTimeout(timeoutId);
      try { processor?.disconnect(); } catch { /* */ }
      try { source?.disconnect(); } catch { /* */ }
      try { liveCtx.close(); } catch { /* */ }
      if (shouldRevoke) URL.revokeObjectURL(srcUrl);
    }

    videoEl.onloadedmetadata = async () => {
      try {
        await liveCtx.resume();
        const stream = (videoEl as any).captureStream?.() ?? (videoEl as any).mozCaptureStream?.();
        if (!stream) { cleanup(); reject(new Error("captureStream nao disponivel")); return; }

        source = liveCtx.createMediaStreamSource(stream);
        processor = liveCtx.createScriptProcessor(4096, 1, 1);
        processor.onaudioprocess = (e) => {
          chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
        };
        source.connect(processor);
        processor.connect(liveCtx.destination);

        const expectedMs = (videoEl.duration / 8.0 + 4) * 1000;
        timeoutId = setTimeout(() => { videoEl.pause(); buildBuffer(); }, expectedMs);
        videoEl.onended = buildBuffer;
        void videoEl.play();
      } catch (err) { cleanup(); reject(err); }
    };

    function buildBuffer() {
      cleanup();
      if (chunks.length === 0) { reject(new Error("Nenhum audio capturado")); return; }
      const total = chunks.reduce((s, c) => s + c.length, 0);
      const mono = new Float32Array(total);
      let off = 0;
      for (const c of chunks) { mono.set(c, off); off += c.length; }
      const offCtx = new OfflineAudioContext(1, total, SAMPLE_RATE);
      const bsrc = offCtx.createBufferSource();
      const tmpBuf = offCtx.createBuffer(1, total, SAMPLE_RATE);
      tmpBuf.getChannelData(0).set(mono);
      bsrc.buffer = tmpBuf;
      bsrc.connect(offCtx.destination);
      bsrc.start(0);
      offCtx.startRendering().then(resolve).catch(reject);
    }

    videoEl.onerror = () => { cleanup(); reject(new Error("Erro ao carregar video para analise")); };
    videoEl.load();
  });
}

export async function analyzeAudioForCleanCuts(file: File | string): Promise<{ cuts: CleanCutPause[]; totalDuration: number }> {
  const SILENCE_THRESHOLD = 0.008;
  const TAIL_THRESHOLD = 0.08;
  const FRAME_SAMPLES = 512;
  const MIN_SILENCE_MS = 280;

  const buf = await decodeAudioBufferFromFile(file);
  const totalDuration = buf.duration;
  const sampleRate = buf.sampleRate;
  const numCh = buf.numberOfChannels;
  const totalSamples = buf.length;

  const mono = new Float32Array(totalSamples);
  for (let c = 0; c < numCh; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < totalSamples; i++) mono[i] += ch[i] / numCh;
  }

  const frames: number[] = [];
  for (let i = 0; i < totalSamples; i += FRAME_SAMPLES) {
    const end = Math.min(i + FRAME_SAMPLES, totalSamples);
    let sum = 0;
    for (let j = i; j < end; j++) sum += mono[j] * mono[j];
    frames.push(Math.sqrt(sum / (end - i)));
  }

  const minSilenceFrames = Math.ceil((MIN_SILENCE_MS / 1000) * sampleRate / FRAME_SAMPLES);
  const sortedFrames = [...frames].sort((a, b) => a - b);
  const noiseFloor = sortedFrames[Math.floor(sortedFrames.length * 0.18)] ?? SILENCE_THRESHOLD;
  const speechFloor = sortedFrames[Math.floor(sortedFrames.length * 0.68)] ?? TAIL_THRESHOLD;
  const adaptiveSilenceThreshold = Math.max(SILENCE_THRESHOLD, Math.min(0.035, noiseFloor * 2.4));
  const adaptiveTailThreshold = Math.max(TAIL_THRESHOLD, Math.min(0.18, speechFloor * 0.65));

  const results: CleanCutPause[] = [];
  let silenceStart = -1;

  for (let i = 0; i < frames.length; i++) {
    const rms = frames[i];
    if (silenceStart === -1) {
      if (rms < adaptiveSilenceThreshold) silenceStart = i;
    } else {
      if (rms >= adaptiveSilenceThreshold) {
        const silenceLen = i - silenceStart;
        if (silenceLen >= minSilenceFrames) {
          const t0 = (silenceStart * FRAME_SAMPLES) / sampleRate;
          const t1 = (i * FRAME_SAMPLES) / sampleRate;
          const dur = t1 - t0;
          const before = frames.slice(Math.max(0, silenceStart - 10), silenceStart);
          const after = frames.slice(i, Math.min(frames.length, i + 10));
          const beforeAvg = before.reduce((sum, v) => sum + v, 0) / Math.max(1, before.length);
          const afterAvg = after.reduce((sum, v) => sum + v, 0) / Math.max(1, after.length);
          const edgeEnergy = Math.max(beforeAvg, afterAvg);
          const confidence = Math.max(55, Math.min(98, Math.round((dur * 32) + (edgeEnergy > adaptiveTailThreshold ? 32 : 12))));
          const widthPx = Math.max(56, Math.min(180, dur * 38));
          const mm = Math.floor(t0 / 60);
          const ss = Math.floor(t0 % 60);
          results.push({
            id: `cut-real-${results.length + 1}`,
            label: `Pausa ${results.length + 1}`,
            time: `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`,
            startTime: t0,
            endTime: t1,
            width: widthPx,
            color: confidence >= 76 ? "#52cc5a" : "#ffc02a",
            score: confidence,
            reason: dur > 0.9 ? "Pausa longa com baixa energia" : "Pausa curta revisavel",
            action: confidence >= 76 ? "cut" : "review",
          });
        }
        silenceStart = -1;
      }
    }
  }

  const mergedResults = results.reduce<CleanCutPause[]>((merged, cut) => {
    const previous = merged[merged.length - 1];
    if (previous && cut.startTime - previous.endTime < 0.22) {
      previous.endTime = cut.endTime;
      previous.width = Math.max(previous.width, cut.width);
      previous.score = Math.max(previous.score ?? 0, cut.score ?? 0);
      previous.reason = "Pausas proximas agrupadas";
      previous.action = (previous.score ?? 0) >= 76 ? "cut" : "review";
      return merged;
    }
    merged.push(cut);
    return merged;
  }, []);

  return { cuts: mergedResults, totalDuration };
}

export async function computeWaveformPeaks(fileOrUrl: File | string, numBars = 80): Promise<number[]> {
  try {
    const buf = await decodeAudioBufferFromFile(fileOrUrl);
    const ch0 = buf.getChannelData(0);
    const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : ch0;
    const step = Math.ceil(buf.length / numBars);
    const peaks = Array.from({ length: numBars }, (_, b) => {
      let max = 0;
      for (let i = b * step; i < Math.min((b + 1) * step, buf.length); i++) {
        max = Math.max(max, Math.abs((ch0[i] + ch1[i]) / 2));
      }
      return max;
    });
    const peakMax = Math.max(...peaks, 0.01);
    return peaks.map((p) => p / peakMax);
  } catch {
    return [];
  }
}
