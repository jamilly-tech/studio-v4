import { useState } from "react";
import { Music2, Mic2, Guitar, Download, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import type { ImportedAsset } from "@/types/editor";

interface AudioToolsPanelProps {
  asset: ImportedAsset | undefined;
  onAddAudioToTimeline?: (path: string, label?: string) => Promise<void>;
}

type StemsState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; vocalsUrl?: string; instrumentalsUrl?: string }
  | { status: "error"; message: string };

type WavState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; path: string; saving?: boolean }
  | { status: "error"; message: string };

function splitIntoTwoLines(text: string): [string, string] {
  const words = text.trim().split(" ");
  if (words.length <= 3) return [text.trim(), ""];
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
}

function buildWavePath(peaks: number[]): string {
  if (!peaks || peaks.length < 2) return "M 0,50 L 100,50";
  const n = peaks.length;
  const cx = (i: number) => ((i / (n - 1)) * 100).toFixed(2);
  const topPts = peaks.map((p, i) => `${cx(i)},${(50 - p * 44).toFixed(1)}`).join(" L ");
  const botPts = [...peaks].reverse().map((p, i) => `${cx(n - 1 - i)},${(50 + p * 44).toFixed(1)}`).join(" L ");
  return `M ${topPts} L ${botPts} Z`;
}

export function AudioToolsPanel({ asset, onAddAudioToTimeline }: AudioToolsPanelProps) {
  const [wavState, setWavState] = useState<WavState>({ status: "idle" });
  const [stemsState, setStemsState] = useState<StemsState>({ status: "idle" });

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
    } catch (err: any) {
      setWavState({ status: "error", message: String(err?.message ?? err) });
    }
  }

  async function handleSeparateStems() {
    if (!filePath) return;
    setStemsState({ status: "running" });
    try {
      const result = await window.studioV4?.media?.separateStems(filePath);
      if (result?.vocalsPath || result?.instrumentalsPath || result?.vocalsUrl || result?.instrumentalsUrl) {
        setStemsState({ status: "done", vocalsUrl: result.vocalsUrl, instrumentalsUrl: result.instrumentalsUrl });
        // Usa path local (mais confiável que URL para ingestFiles)
        if (result.vocalsPath) await onAddAudioToTimeline?.(result.vocalsPath, "Vocais");
        else if (result.vocalsUrl) await onAddAudioToTimeline?.(result.vocalsUrl, "Vocais");
        if (result.instrumentalsPath) await onAddAudioToTimeline?.(result.instrumentalsPath, "Instrumentos");
        else if (result.instrumentalsUrl) await onAddAudioToTimeline?.(result.instrumentalsUrl, "Instrumentos");
      } else {
        setStemsState({ status: "error", message: result?.error ?? "Erro ao separar stems" });
      }
    } catch (err: any) {
      setStemsState({ status: "error", message: String(err?.message ?? err) });
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
          <button
            type="button"
            disabled={!hasMedia}
            onClick={handleExtractWav}
            className="rounded-md bg-primary px-3 py-1.5 text-[10px] font-bold text-white hover:bg-primary/90 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
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
            <button
              type="button"
              disabled={!!wavState.saving}
              onClick={async () => {
                const p = wavState.path;
                setWavState({ status: "done", path: p, saving: true });
                const r = await window.studioV4?.media?.saveAudio?.(
                  p,
                  (asset?.displayName ?? "audio") + ".wav",
                );
                if (r?.error) alert(r.error);
                setWavState({ status: "done", path: p, saving: false });
              }}
              className="rounded-md border border-border px-2 py-1 text-[10px] font-semibold hover:bg-card transition disabled:opacity-50"
            >
              {wavState.saving ? "Salvando..." : "Salvar como..."}
            </button>
            <button
              type="button"
              onClick={() => setWavState({ status: "idle" })}
              className="text-[9px] text-muted-foreground hover:text-foreground underline text-left"
            >
              Extrair outro
            </button>
          </div>
        )}
        {wavState.status === "error" && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-[10px] text-destructive">
              <AlertCircle className="size-3" /> {wavState.message}
            </div>
            <button
              type="button"
              onClick={() => setWavState({ status: "idle" })}
              className="text-[9px] text-muted-foreground hover:text-foreground underline text-left"
            >
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
          Separa voz e instrumentos usando IA (Demucs). Funciona com múltiplas vozes.
        </p>
        {stemsState.status === "idle" && (
          <button
            type="button"
            disabled={!hasMedia}
            onClick={handleSeparateStems}
            className="rounded-md bg-primary px-3 py-1.5 text-[10px] font-bold text-white hover:bg-primary/90 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Separar Vocais / Instrumentos
          </button>
        )}
        {stemsState.status === "running" && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> Processando com IA...
            </div>
            <p className="text-[8px] text-muted-foreground">
              Pode demorar 1–5 min. Na primeira vez baixa o modelo (~150MB).
            </p>
          </div>
        )}
        {stemsState.status === "done" && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5 text-[10px] text-green-400">
              <CheckCircle2 className="size-3" /> Separação concluída
            </div>
            {stemsState.vocalsUrl && (
              <StemTrack label="Vocais" icon={<Mic2 className="size-3" />} url={stemsState.vocalsUrl} />
            )}
            {stemsState.instrumentalsUrl && (
              <StemTrack label="Instrumentos" icon={<Guitar className="size-3" />} url={stemsState.instrumentalsUrl} />
            )}
            <button
              type="button"
              onClick={() => setStemsState({ status: "idle" })}
              className="text-[9px] text-muted-foreground hover:text-foreground underline text-left"
            >
              Processar outro
            </button>
          </div>
        )}
        {stemsState.status === "error" && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-[10px] text-destructive">
              <AlertCircle className="size-3" /> {stemsState.message}
            </div>
            <button
              type="button"
              onClick={() => setStemsState({ status: "idle" })}
              className="text-[9px] text-muted-foreground hover:text-foreground underline text-left"
            >
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
      <a
        href={url}
        download={`${label.toLowerCase()}.wav`}
        className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-card hover:text-foreground"
        title={`Baixar ${label}`}
      >
        <Download className="size-3" />
      </a>
    </div>
  );
}
