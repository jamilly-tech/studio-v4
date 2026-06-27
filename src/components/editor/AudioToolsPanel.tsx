import { useState, useEffect, useRef } from "react";
import { Music2, Mic2, Guitar, Download, Loader2, AlertCircle, CheckCircle2, Clock, Zap, Cpu } from "lucide-react";
import type { ImportedAsset } from "@/types/editor";

interface AudioToolsPanelProps {
  asset: ImportedAsset | undefined;
  onAddAudioToTimeline?: (path: string, label?: string) => Promise<void>;
}

type StemsState =
  | { status: "idle" }
  | { status: "running"; mode?: "fast" | "ai" | "builtin" }
  | { status: "done"; vocalsUrl?: string; instrumentalsUrl?: string; mode?: "fast" | "ai" | "builtin" }
  | { status: "error"; message: string };

type WavState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; path: string; saving?: boolean }
  | { status: "error"; message: string };

type ModelStatus =
  | { state: "checking" }
  | { state: "not-ready" }
  | { state: "downloading"; percent: number; done?: number; total?: number }
  | { state: "ready" };

function buildWavePath(peaks: number[]): string {
  if (!peaks || peaks.length < 2) return "M 0,50 L 100,50";
  const n = peaks.length;
  const cx = (i: number) => ((i / (n - 1)) * 100).toFixed(2);
  const topPts = peaks.map((p, i) => `${cx(i)},${(50 - p * 44).toFixed(1)}`).join(" L ");
  const botPts = [...peaks].reverse().map((p, i) => `${cx(n - 1 - i)},${(50 + p * 44).toFixed(1)}`).join(" L ");
  return `M ${topPts} L ${botPts} Z`;
}

function fmtBytes(n: number) {
  if (n < 1_000_000) return `${(n/1024).toFixed(0)} KB`;
  return `${(n/1_048_576).toFixed(1)} MB`;
}

export function AudioToolsPanel({ asset, onAddAudioToTimeline }: AudioToolsPanelProps) {
  const [wavState, setWavState] = useState<WavState>({ status: "idle" });
  const [stemsState, setStemsState] = useState<StemsState>({ status: "idle" });
  const [stemsElapsed, setStemsElapsed] = useState(0);
  const [modelStatus, setModelStatus] = useState<ModelStatus>({ state: "checking" });
  const stemsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unsubModelRef = useRef<(() => void) | null>(null);

  // Check model status on mount and subscribe to download progress
  useEffect(() => {
    const api = window.studioV4?.media;
    if (!api) { setModelStatus({ state: "not-ready" }); return; }

    api.stemsModelStatus?.().then(r => {
      setModelStatus(r.ready ? { state: "ready" } : { state: "not-ready" });
    }).catch(() => setModelStatus({ state: "not-ready" }));

    // Subscribe to download progress events (background download)
    unsubModelRef.current = api.onModelProgress?.((data) => {
      if (data.error) { setModelStatus({ state: "not-ready" }); return; }
      if (data.ready) { setModelStatus({ state: "ready" }); return; }
      if (typeof data.percent === "number") {
        setModelStatus({ state: "downloading", percent: data.percent, done: data.done, total: data.total });
      }
    });

    return () => { unsubModelRef.current?.(); };
  }, []);

  const stemsRunMode = stemsState.status === "running" ? stemsState.mode : undefined;
  useEffect(() => {
    if (stemsRunMode === "ai" || stemsRunMode === "builtin") {
      setStemsElapsed(0);
      stemsTimerRef.current = setInterval(() => setStemsElapsed(s => s + 1), 1000);
    } else {
      if (stemsTimerRef.current) { clearInterval(stemsTimerRef.current); stemsTimerRef.current = null; }
    }
    return () => { if (stemsTimerRef.current) clearInterval(stemsTimerRef.current); };
  }, [stemsRunMode]);

  const filePath = asset?.filePath;
  const hasMedia = !!(filePath && (asset?.kind === "video" || asset?.kind === "audio"));
  const waveformPeaks = asset?.waveformPeaks;

  async function handleExtractWav() {
    if (!filePath) return;
    setWavState({ status: "running" });
    try {
      const result = await window.studioV4?.media?.extractWav(filePath);
      if (result?.path) {
        setWavState({ status: "done", path: result.path });
        await onAddAudioToTimeline?.(result.path, "Áudio Extraído");
      } else {
        setWavState({ status: "error", message: result?.error ?? "Erro ao extrair áudio" });
      }
    } catch (err: unknown) {
      setWavState({ status: "error", message: String((err as Error)?.message ?? err) });
    }
  }

  async function handleSeparateStems(mode: "fast" | "ai" | "builtin") {
    if (!filePath) return;
    if (stemsState.status === "running") return;
    setStemsState({ status: "running", mode });
    try {
      let result: { vocalsPath?: string; vocalsUrl?: string; instrumentalsPath?: string; instrumentalsUrl?: string; error?: string } | undefined;
      if (mode === "fast")    result = await window.studioV4?.media?.separateStemsFast(filePath);
      else if (mode === "ai") result = await window.studioV4?.media?.separateStems(filePath);
      else                    result = await window.studioV4?.media?.separateStemsBuiltin(filePath);

      if (result?.vocalsPath || result?.instrumentalsPath || result?.vocalsUrl || result?.instrumentalsUrl) {
        setStemsState({ status: "done", vocalsUrl: result.vocalsUrl, instrumentalsUrl: result.instrumentalsUrl, mode });
        if (result.vocalsPath)        await onAddAudioToTimeline?.(result.vocalsPath, "Vocais");
        else if (result.vocalsUrl)    await onAddAudioToTimeline?.(result.vocalsUrl, "Vocais");
        if (result.instrumentalsPath) await onAddAudioToTimeline?.(result.instrumentalsPath, "Instrumentos");
        else if (result.instrumentalsUrl) await onAddAudioToTimeline?.(result.instrumentalsUrl, "Instrumentos");
      } else {
        setStemsState({ status: "error", message: result?.error ?? "Erro ao separar stems" });
      }
    } catch (err: unknown) {
      setStemsState({ status: "error", message: String((err as Error)?.message ?? err) });
    }
  }

  async function handleDownloadModel() {
    setModelStatus({ state: "downloading", percent: 0 });
    try {
      await window.studioV4?.media?.downloadStemsModel?.();
    } catch {
      setModelStatus({ state: "not-ready" });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-xs font-black">Ferramentas de Áudio</h3>

      {/* Waveform */}
      {waveformPeaks && waveformPeaks.length > 0 && (
        <div>
          <p className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-wider mb-1.5">Waveform</p>
          <div className="relative h-14 rounded-md bg-muted/30 overflow-hidden">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
              <path d={buildWavePath(waveformPeaks)} fill="hsl(var(--primary) / 0.5)" />
              <line x1="0" y1="50" x2="100" y2="50" stroke="hsl(var(--primary) / 0.2)" strokeWidth="0.5" />
            </svg>
          </div>
        </div>
      )}

      {!hasMedia && (
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Selecione um vídeo ou áudio na mídia para usar as ferramentas.
        </p>
      )}

      {/* Extrator de Áudio WAV */}
      <div className="rounded-lg border border-border bg-card/50 p-3 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Music2 className="size-3.5 text-primary shrink-0" />
          <span className="text-[11px] font-bold">Extrator de Áudio</span>
        </div>
        <p className="text-[9px] text-muted-foreground leading-relaxed">
          Extrai o áudio do vídeo como arquivo WAV (16kHz mono).
        </p>
        {wavState.status === "idle" && (
          <button type="button" disabled={!hasMedia} onClick={handleExtractWav}
            className="rounded-md bg-primary px-3 py-1.5 text-[10px] font-bold text-white hover:bg-primary/90 transition disabled:opacity-40 disabled:cursor-not-allowed">
            Extrair WAV
          </button>
        )}
        {wavState.status === "running" && (
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> Extraindo...
          </div>
        )}
        {wavState.status === "done" && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5 text-[10px] text-green-400">
              <CheckCircle2 className="size-3" /> Extraído com sucesso
            </div>
            <p className="text-[8px] text-muted-foreground break-all font-mono">{wavState.path}</p>
            <button type="button" disabled={!!wavState.saving}
              onClick={async () => {
                const p = wavState.path;
                setWavState({ status: "done", path: p, saving: true });
                try {
                  const r = await window.studioV4?.media?.saveAudio?.(p, (asset?.displayName ?? "audio") + ".wav");
                  if (r?.error) alert(r.error);
                } catch (e: unknown) {
                  alert(e instanceof Error ? e.message : "Erro ao salvar");
                } finally {
                  setWavState({ status: "done", path: p, saving: false });
                }
              }}
              className="rounded-md border border-border px-2 py-1 text-[10px] font-semibold hover:bg-card transition disabled:opacity-50">
              {wavState.saving ? "Salvando..." : "Salvar como..."}
            </button>
            <button type="button" onClick={() => setWavState({ status: "idle" })}
              className="text-[9px] text-muted-foreground hover:text-foreground underline text-left">
              Extrair outro
            </button>
          </div>
        )}
        {wavState.status === "error" && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-[10px] text-destructive">
              <AlertCircle className="size-3" /> {wavState.message}
            </div>
            <button type="button" onClick={() => setWavState({ status: "idle" })}
              className="text-[9px] text-muted-foreground hover:text-foreground underline text-left">
              Tentar novamente
            </button>
          </div>
        )}
      </div>

      {/* Separação de Vocais / Instrumentos */}
      <div className="rounded-lg border border-border bg-card/50 p-3 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Mic2 className="size-3.5 text-primary shrink-0" />
          <span className="text-[11px] font-bold">Separação de Vocais</span>
        </div>
        <p className="text-[9px] text-muted-foreground leading-relaxed">
          Separa voz e instrumentos do áudio.
        </p>

        {stemsState.status === "idle" && (
          <div className="flex flex-col gap-1.5">

            {/* IA Integrada (ONNX — sem Python) */}
            <div className="rounded-lg border border-primary/20 bg-primary/[0.04] p-2.5 flex flex-col gap-2">
              <div className="flex items-center gap-1.5">
                <Cpu className="size-3 text-primary" />
                <span className="text-[10px] font-black text-primary">IA Integrada</span>
                <span className="ml-auto text-[8px] text-muted-foreground/50 font-mono">sem Python</span>
              </div>

              {modelStatus.state === "checking" && (
                <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
                  <Loader2 className="size-2.5 animate-spin" /> Verificando modelo...
                </div>
              )}

              {modelStatus.state === "downloading" && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-[9px]">
                    <span className="text-muted-foreground">Baixando modelo...</span>
                    <span className="font-mono text-primary tabular-nums">{modelStatus.percent}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${modelStatus.percent}%` }}
                    />
                  </div>
                  {modelStatus.total && modelStatus.total > 0 && (
                    <p className="text-[8px] text-muted-foreground/60 font-mono">
                      {fmtBytes(modelStatus.done ?? 0)} / {fmtBytes(modelStatus.total)}
                    </p>
                  )}
                </div>
              )}

              {modelStatus.state === "not-ready" && (
                <div className="flex flex-col gap-1.5">
                  <p className="text-[8px] text-muted-foreground/70 leading-relaxed">
                    Modelo de IA (~65 MB) será baixado na primeira vez.
                  </p>
                  <button type="button" onClick={handleDownloadModel}
                    className="flex items-center justify-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-3 py-1.5 text-[10px] font-bold text-primary hover:bg-primary/20 transition">
                    <Download className="size-3" /> Baixar agora
                  </button>
                </div>
              )}

              {modelStatus.state === "ready" && (
                <button type="button" disabled={!hasMedia} onClick={() => handleSeparateStems("builtin")}
                  className="rounded-md bg-primary px-3 py-1.5 text-[10px] font-bold text-white hover:bg-primary/90 transition disabled:opacity-40 disabled:cursor-not-allowed">
                  Separar com IA Integrada
                </button>
              )}
            </div>

            {/* Divisor */}
            <div className="flex items-center gap-2 my-0.5">
              <div className="flex-1 h-px bg-border/40" />
              <span className="text-[8px] text-muted-foreground/40 font-mono">ou</span>
              <div className="flex-1 h-px bg-border/40" />
            </div>

            {/* Modo Rápido */}
            <button type="button" disabled={!hasMedia} onClick={() => handleSeparateStems("fast")}
              className="flex items-center justify-center gap-1.5 rounded-md bg-card border border-border px-3 py-1.5 text-[10px] font-bold hover:bg-muted/40 transition disabled:opacity-40 disabled:cursor-not-allowed">
              <Zap className="size-3 text-amber-400" />
              Modo Rápido (FFmpeg)
            </button>
            <p className="text-[8px] text-muted-foreground/60 leading-relaxed px-0.5">
              Instantâneo — subtração de canal central. Menos preciso em vozes espalhadas.
            </p>
          </div>
        )}

        {stemsState.status === "running" && stemsState.mode === "fast" && (
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Loader2 className="size-3 animate-spin text-amber-400" />
            <span>Separando com FFmpeg...</span>
          </div>
        )}

        {stemsState.status === "running" && (stemsState.mode === "ai" || stemsState.mode === "builtin") && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <Loader2 className="size-3 animate-spin text-primary" />
                <span>{stemsState.mode === "builtin" ? "IA Integrada..." : "Demucs..."}</span>
              </div>
              <div className="flex items-center gap-1 text-[9px] font-mono text-muted-foreground/60">
                <Clock className="size-2.5" />
                <span>{Math.floor(stemsElapsed/60).toString().padStart(2,"0")}:{(stemsElapsed%60).toString().padStart(2,"0")}</span>
              </div>
            </div>
            <div className="h-1 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary/60 rounded-full animate-pulse"
                style={{ width: `${Math.min(95, (stemsElapsed/120)*100)}%`, transition: "width 1s linear" }} />
            </div>
            <p className="text-[8px] text-muted-foreground leading-relaxed">
              {stemsElapsed < 10 ? "Preparando áudio..." : stemsElapsed < 45 ? "Calculando espectro..." : "Inferência ONNX em andamento..."}
            </p>
          </div>
        )}

        {stemsState.status === "done" && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5 text-[10px] text-green-400">
              <CheckCircle2 className="size-3" />
              <span>Separação concluída</span>
              {stemsState.mode === "fast" && (
                <span className="ml-1 rounded px-1 py-px bg-amber-500/15 text-amber-400 text-[8px] font-bold">Rápido</span>
              )}
              {stemsState.mode === "builtin" && (
                <span className="ml-1 rounded px-1 py-px bg-primary/15 text-primary text-[8px] font-bold">IA</span>
              )}
            </div>
            {stemsState.vocalsUrl && (
              <StemTrack label="Vocais" icon={<Mic2 className="size-3" />} url={stemsState.vocalsUrl} />
            )}
            {stemsState.instrumentalsUrl && (
              <StemTrack label="Instrumentos" icon={<Guitar className="size-3" />} url={stemsState.instrumentalsUrl} />
            )}
            <button type="button" onClick={() => setStemsState({ status: "idle" })}
              className="text-[9px] text-muted-foreground hover:text-foreground underline text-left">
              Processar outro
            </button>
          </div>
        )}

        {stemsState.status === "error" && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-start gap-1.5 text-[10px] text-destructive">
              <AlertCircle className="size-3 mt-0.5 shrink-0" />
              <span>{stemsState.message}</span>
            </div>
            <button type="button" onClick={() => setStemsState({ status: "idle" })}
              className="text-[9px] text-muted-foreground hover:text-foreground underline text-left">
              Tentar novamente
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function StemTrack({ label, icon, url }: { label: string; icon: React.ReactNode; url: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-muted/30 px-2 py-1.5">
      <span className="text-primary">{icon}</span>
      <span className="text-[10px] font-semibold flex-1">{label}</span>
      <audio src={url} controls className="h-6 w-20" style={{ colorScheme: "dark" }} />
      <a href={url} download={`${label.toLowerCase()}.wav`}
        className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-card hover:text-foreground"
        title={`Baixar ${label}`}>
        <Download className="size-3" />
      </a>
    </div>
  );
}
