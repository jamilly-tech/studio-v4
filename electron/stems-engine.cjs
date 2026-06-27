"use strict";
/**
 * stems-engine.cjs — Separação vocal via MDX-Net ONNX (sem Python)
 * Modelo: Kim_Vocal_2  (n_fft=6144, hop=1024, dim_f=2048, chunk_t=256)
 */

const path = require("path");
const fs   = require("fs");
const { spawn } = require("child_process");

// MDX-Net parameters for Kim_Vocal_2
const MDX = Object.freeze({ N_FFT: 6144, HOP: 1024, DIM_F: 2048, CHUNK_T: 256, SR: 44100 });

// ── Radix-2 in-place FFT (power-of-2 only) ─────────────────────────────────

function nextPow2(n) { let p = 1; while (p < n) p <<= 1; return p; }

function fftRadix2(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 2 : -2) * Math.PI / len;
    const wr0 = Math.cos(ang), wi0 = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wr = 1, wi = 0;
      const half = len >> 1;
      for (let j = 0; j < half; j++) {
        const tr = wr*re[i+j+half] - wi*im[i+j+half];
        const ti = wr*im[i+j+half] + wi*re[i+j+half];
        re[i+j+half] = re[i+j]-tr; im[i+j+half] = im[i+j]-ti;
        re[i+j] += tr; im[i+j] += ti;
        const nwr = wr*wr0 - wi*wi0; wi = wr*wi0 + wi*wr0; wr = nwr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

// ── Bluestein chirp-Z: FFT de tamanho arbitrário N ─────────────────────────

function fftN(inRe, inIm, N) {
  if ((N & (N-1)) === 0) {
    const re = new Float64Array(N); const im = new Float64Array(N);
    for (let i = 0; i < N; i++) { re[i] = inRe[i]||0; if (inIm) im[i] = inIm[i]||0; }
    fftRadix2(re, im, false); return { re, im };
  }
  const M = nextPow2(2*N - 1);
  const cRe = new Float64Array(M), cIm = new Float64Array(M);
  for (let n = 0; n < N; n++) {
    const a = Math.PI*n*n/N;
    cRe[n] = Math.cos(a); cIm[n] = Math.sin(a);
    if (n > 0) { cRe[M-n] = cRe[n]; cIm[M-n] = cIm[n]; }
  }
  const aRe = new Float64Array(M), aIm = new Float64Array(M);
  for (let n = 0; n < N; n++) {
    const xr = inRe[n]||0, xi = inIm?inIm[n]||0:0;
    aRe[n] = xr*cRe[n] + xi*cIm[n]; aIm[n] = xi*cRe[n] - xr*cIm[n];
  }
  const fcRe = cRe.slice(), fcIm = cIm.slice();
  fftRadix2(aRe, aIm, false); fftRadix2(fcRe, fcIm, false);
  for (let k = 0; k < M; k++) {
    const pr = aRe[k]*fcRe[k] - aIm[k]*fcIm[k];
    aIm[k] = aRe[k]*fcIm[k] + aIm[k]*fcRe[k]; aRe[k] = pr;
  }
  for (let k = 0; k < M; k++) aIm[k] = -aIm[k];
  fftRadix2(aRe, aIm, false);
  for (let k = 0; k < M; k++) { aRe[k] /= M; aIm[k] = -aIm[k]/M; }
  const outRe = new Float64Array(N), outIm = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    outRe[k] = aRe[k]*cRe[k] + aIm[k]*cIm[k];
    outIm[k] = aIm[k]*cRe[k] - aRe[k]*cIm[k];
  }
  return { re: outRe, im: outIm };
}

function ifftN(inRe, inIm, N) {
  const cj = new Float64Array(N);
  for (let i = 0; i < N; i++) cj[i] = -(inIm[i]||0);
  const { re, im } = fftN(inRe, cj, N);
  for (let i = 0; i < N; i++) { re[i] /= N; im[i] = -(im[i]/N); }
  return { re, im };
}

// ── Hann window ─────────────────────────────────────────────────────────────

function hannWindow(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5*(1-Math.cos(2*Math.PI*i/(n-1)));
  return w;
}

// ── STFT — retorna specRe[ch] / specIm[ch]: Float32Array layout [frame*freqBins+freq] ─

function stft(left, right, nFft, hop) {
  const win = hannWindow(nFft);
  const freqBins = Math.floor(nFft/2) + 1;
  const nSamples = Math.max(left.length, right.length);
  const nFrames  = Math.max(1, Math.floor((nSamples - nFft) / hop) + 1);
  const specRe = [new Float32Array(nFrames*freqBins), new Float32Array(nFrames*freqBins)];
  const specIm = [new Float32Array(nFrames*freqBins), new Float32Array(nFrames*freqBins)];
  const channels = [left, right];
  for (let c = 0; c < 2; c++) {
    const sig = channels[c];
    for (let f = 0; f < nFrames; f++) {
      const start = f * hop;
      const frame = new Float64Array(nFft);
      for (let i = 0; i < nFft; i++) frame[i] = (sig[start+i]||0) * win[i];
      const { re, im } = fftN(frame, null, nFft);
      const base = f * freqBins;
      for (let k = 0; k < freqBins; k++) { specRe[c][base+k] = re[k]; specIm[c][base+k] = im[k]; }
    }
  }
  return { specRe, specIm, nFrames, freqBins };
}

// ── ISTFT ────────────────────────────────────────────────────────────────────

function istft(specRe, specIm, nFft, hop, nFrames) {
  const win = hannWindow(nFft);
  const freqBins = Math.floor(nFft/2) + 1;
  const sigLen = (nFrames-1)*hop + nFft;
  const sig = new Float32Array(sigLen), wts = new Float32Array(sigLen);
  for (let f = 0; f < nFrames; f++) {
    const base = f * freqBins;
    const fullRe = new Float64Array(nFft), fullIm = new Float64Array(nFft);
    for (let k = 0; k < freqBins; k++) { fullRe[k] = specRe[base+k]; fullIm[k] = specIm[base+k]; }
    for (let k = 1; k < Math.floor(nFft/2); k++) { fullRe[nFft-k] = fullRe[k]; fullIm[nFft-k] = -fullIm[k]; }
    const { re } = ifftN(fullRe, fullIm, nFft);
    const start = f * hop;
    for (let i = 0; i < nFft; i++) { const w = win[i]; sig[start+i] += re[i]*w; wts[start+i] += w*w; }
  }
  for (let i = 0; i < sigLen; i++) if (wts[i] > 1e-8) sig[i] /= wts[i];
  return sig;
}

// ── Extrai PCM f32le via FFmpeg ──────────────────────────────────────────────

function extractPCM(filePath, ffmpegPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      "-i", filePath, "-vn",
      "-ar", String(MDX.SR), "-ac", "2",
      "-f", "f32le", "-acodec", "pcm_f32le", "pipe:1",
    ], { stdio: ["ignore","pipe","pipe"] });
    const chunks = [];
    proc.stdout.on("data", d => chunks.push(d));
    proc.stderr.on("data", () => {});
    proc.on("close", code => {
      if (code !== 0 && chunks.length === 0) return reject(new Error("ffmpeg: falha ao extrair PCM"));
      const buf = Buffer.concat(chunks);
      const n = Math.floor(buf.length / 8);
      const left = new Float32Array(n), right = new Float32Array(n);
      for (let i = 0; i < n; i++) { left[i] = buf.readFloatLE(i*8); right[i] = buf.readFloatLE(i*8+4); }
      resolve({ left, right });
    });
    proc.on("error", reject);
  });
}

// ── Escreve WAV 16-bit estéreo ────────────────────────────────────────────────

function writePCMtoWAV(left, right, filePath) {
  const n = left.length, ch = 2, bps = 2, dataSize = n*ch*bps;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF",0); buf.writeUInt32LE(36+dataSize,4);
  buf.write("WAVE",8); buf.write("fmt ",12);
  buf.writeUInt32LE(16,16); buf.writeUInt16LE(1,20); buf.writeUInt16LE(ch,22);
  buf.writeUInt32LE(MDX.SR,24); buf.writeUInt32LE(MDX.SR*ch*bps,28);
  buf.writeUInt16LE(ch*bps,32); buf.writeUInt16LE(bps*8,34);
  buf.write("data",36); buf.writeUInt32LE(dataSize,40);
  let off = 44;
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1,Math.min(1,left[i]))*32767), off);  off+=2;
    buf.writeInt16LE(Math.round(Math.max(-1,Math.min(1,right[i]))*32767), off); off+=2;
  }
  fs.writeFileSync(filePath, buf);
}

// ── Pipeline MDX-Net ─────────────────────────────────────────────────────────

async function separateStems(modelPath, ffmpegPath, filePath, outputDir, onProgress) {
  let ort;
  try { ort = require("onnxruntime-node"); }
  catch { throw new Error("onnxruntime-node não instalado. Execute: npm install onnxruntime-node"); }

  onProgress?.(3);

  const { left, right } = await extractPCM(filePath, ffmpegPath);
  onProgress?.(10);

  const { N_FFT, HOP, DIM_F, CHUNK_T } = MDX;
  const padLen = Math.ceil((left.length + N_FFT) / HOP) * HOP;
  const padL = new Float32Array(padLen); padL.set(left);
  const padR = new Float32Array(padLen); padR.set(right);

  onProgress?.(12);
  const { specRe, specIm, nFrames, freqBins } = stft(padL, padR, N_FFT, HOP);
  onProgress?.(42);

  // Magnitude e fase para cada canal, apenas as primeiras DIM_F bins
  const magArr = [new Float32Array(nFrames*DIM_F), new Float32Array(nFrames*DIM_F)];
  const phsArr = [new Float32Array(nFrames*DIM_F), new Float32Array(nFrames*DIM_F)];
  for (let c = 0; c < 2; c++) {
    for (let f = 0; f < nFrames; f++) {
      const fb = f*freqBins, mb = f*DIM_F;
      for (let k = 0; k < DIM_F; k++) {
        const re = specRe[c][fb+k], im = specIm[c][fb+k];
        magArr[c][mb+k] = Math.sqrt(re*re + im*im);
        phsArr[c][mb+k] = Math.atan2(im, re);
      }
    }
  }

  // Normalização global (igual ao treinamento)
  let sum = 0, cnt = 0;
  for (let c = 0; c < 2; c++) for (let i = 0; i < magArr[c].length; i++) { sum += magArr[c][i]; cnt++; }
  const gMean = sum / cnt;
  let sq = 0;
  for (let c = 0; c < 2; c++) for (let i = 0; i < magArr[c].length; i++) sq += (magArr[c][i]-gMean)**2;
  const gStd = Math.sqrt(sq/cnt) + 1e-9;

  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ["cpu"],
    graphOptimizationLevel: "all",
  });
  const inputName  = session.inputNames[0];
  const outputName = session.outputNames[0];

  const nChunks  = Math.ceil(nFrames / CHUNK_T);
  const vocalMag = [new Float32Array(nFrames*DIM_F), new Float32Array(nFrames*DIM_F)];

  for (let ci = 0; ci < nChunks; ci++) {
    const t0  = ci * CHUNK_T;
    const buf = new Float32Array(2 * DIM_F * CHUNK_T);
    for (let c = 0; c < 2; c++) {
      for (let f = 0; f < DIM_F; f++) {
        for (let t = 0; t < CHUNK_T; t++) {
          const ti = t0+t;
          buf[c*DIM_F*CHUNK_T + f*CHUNK_T + t] = ti < nFrames
            ? (magArr[c][ti*DIM_F+f] - gMean) / gStd
            : 0;
        }
      }
    }
    const res = await session.run({ [inputName]: new ort.Tensor("float32", buf, [1, 2, DIM_F, CHUNK_T]) });
    const pred = res[outputName].data;
    for (let c = 0; c < 2; c++) {
      for (let f = 0; f < DIM_F; f++) {
        for (let t = 0; t < CHUNK_T; t++) {
          const ti = t0+t;
          if (ti >= nFrames) continue;
          vocalMag[c][ti*DIM_F+f] = Math.max(0, pred[c*DIM_F*CHUNK_T + f*CHUNK_T + t] * gStd + gMean);
        }
      }
    }
    onProgress?.(42 + Math.round((ci+1)/nChunks * 40));
  }

  // Reconstrução dos espectros complexos com phase vocoder
  const vRe = [new Float32Array(nFrames*freqBins), new Float32Array(nFrames*freqBins)];
  const vIm = [new Float32Array(nFrames*freqBins), new Float32Array(nFrames*freqBins)];
  const iRe = [new Float32Array(nFrames*freqBins), new Float32Array(nFrames*freqBins)];
  const iIm = [new Float32Array(nFrames*freqBins), new Float32Array(nFrames*freqBins)];

  for (let c = 0; c < 2; c++) {
    for (let f = 0; f < nFrames; f++) {
      const fb = f*freqBins, mb = f*DIM_F;
      for (let k = 0; k < freqBins; k++) {
        const idx = fb+k;
        if (k < DIM_F) {
          const vm = vocalMag[c][mb+k], ph = phsArr[c][mb+k];
          const im = Math.max(0, magArr[c][mb+k] - vm);
          vRe[c][idx] = vm*Math.cos(ph); vIm[c][idx] = vm*Math.sin(ph);
          iRe[c][idx] = im*Math.cos(ph); iIm[c][idx] = im*Math.sin(ph);
        } else {
          // bins acima de DIM_F: ficam só no instrumental
          iRe[c][idx] = specRe[c][idx]; iIm[c][idx] = specIm[c][idx];
        }
      }
    }
  }

  onProgress?.(85);

  const origLen = left.length;
  const vL = istft(vRe[0], vIm[0], N_FFT, HOP, nFrames).slice(0, origLen);
  const vR = istft(vRe[1], vIm[1], N_FFT, HOP, nFrames).slice(0, origLen);
  const iL = istft(iRe[0], iIm[0], N_FFT, HOP, nFrames).slice(0, origLen);
  const iR = istft(iRe[1], iIm[1], N_FFT, HOP, nFrames).slice(0, origLen);

  fs.mkdirSync(outputDir, { recursive: true });
  const vocPath = path.join(outputDir, "vocals.wav");
  const insPath = path.join(outputDir, "no_vocals.wav");
  writePCMtoWAV(vL, vR, vocPath);
  writePCMtoWAV(iL, iR, insPath);

  onProgress?.(100);
  return { vocalsPath: vocPath, instrumentalsPath: insPath };
}

module.exports = { separateStems };
