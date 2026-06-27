import { useState, useEffect } from "react";
import { Mic, Volume2, Zap, Loader2, CheckCircle, AlertCircle, X } from "lucide-react";

const MAX_CHARS = 400;
const MAX_LIPSYNC_SEC = 300;

export interface MediaCtx {
  filePath: string;
  trimStart: number;
  duration: number;
}

interface Props {
  mediaContext: MediaCtx | null;
  onAddAudioToTimeline?: (url: string, label: string) => void;
  onAddVideoToTimeline?: (url: string, label: string) => void;
}

export function VoiceToolsPanel({ mediaContext, onAddAudioToTimeline, onAddVideoToTimeline }: Props) {
  // ── Síntese de voz ────────────────────────────────────────────────────────
  const [voices, setVoices] = useState<string[]>([]);
  const [selectedVoice, setSelectedVoice] = useState("");
  const [ttsText, setTtsText] = useState("");
  const [ttsLoading, setTtsLoading] = useState(false);
  const [ttsResult, setTtsResult] = useState<{ path?: string; url?: string; error?: string } | null>(null);

  // ── Lip sync ──────────────────────────────────────────────────────────────
  const [lipsyncReady, setLipsyncReady] = useState<boolean | null>(null);
  const [audioFilePath, setAudioFilePath] = useState<string | null>(null);
  const [lipsyncLoading, setLipsyncLoading] = useState(false);
  const [lipsyncPercent, setLipsyncPercent] = useState(0);
  const [lipsyncResult, setLipsyncResult] = useState<{ outputPath?: string; url?: string; error?: string } | null>(null);

  useEffect(() => {
    let mounted = true;
    const api = window.studioV4?.media;
    if (!api) return;

    api.listVoices?.().then(r => {
      if (!mounted) return;
      const v = r.voices ?? [];
      setVoices(v);
      if (v.length) setSelectedVoice(v[0]);
    }).catch(() => {});

    api.lipsyncStatus?.().then(r => {
      if (!mounted) return;
      setLipsyncReady(r.ready);
    }).catch(() => { if (mounted) setLipsyncReady(false); });

    const unsub = api.onProgress?.((ev) => {
      if (!mounted) return;
      if (ev.stage === "lipsync")      setLipsyncPercent(ev.percent);
      if (ev.stage === "lipsync-done") setLipsyncPercent(100);
    });
    return () => { mounted = false; unsub?.(); };
  }, []);

  async function handleSynthesize() {
    const api = window.studioV4?.media;
    if (!api || !ttsText.trim()) return;
    setTtsLoading(true);
    setTtsResult(null);
    try {
      const r = await api.synthesizeVoice!(ttsText.slice(0, MAX_CHARS), selectedVoice);
      setTtsResult(r);
    } catch (e: unknown) {
      setTtsResult({ error: e instanceof Error ? e.message : "Erro" });
    } finally {
      setTtsLoading(false);
    }
  }

  async function handlePickAudio() {
    const paths = await window.studioV4?.openFileDialog?.();
    if (paths?.length) setAudioFilePath(paths[0]);
  }

  async function handleLipsync() {
    if (!mediaContext?.filePath) return;
    const api = window.studioV4?.media;
    if (!api) return;
    setLipsyncLoading(true);
    setLipsyncResult(null);
    setLipsyncPercent(3);
    try {
      const r = await api.lipSync!(
        mediaContext.filePath,
        audioFilePath,
        mediaContext.trimStart,
        Math.min(mediaContext.duration, MAX_LIPSYNC_SEC),
      );
      setLipsyncResult(r);
    } catch (e: unknown) {
      setLipsyncResult({ error: e instanceof Error ? e.message : "Erro" });
    } finally {
      setLipsyncLoading(false);
    }
  }

  const clipSec = mediaContext ? Math.min(mediaContext.duration, MAX_LIPSYNC_SEC) : MAX_LIPSYNC_SEC;
  const estMin  = Math.max(1, Math.ceil(clipSec * 6 / 60)); // ~6min CPU por min de vídeo

  return (
    <div className="flex flex-col gap-3">

      {/* ── Síntese de Voz ── */}
      <div className="rounded-xl border border-border bg-card p-3 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Volume2 className="size-3.5 text-primary" />
          <span className="text-[10px] font-bold text-foreground">Síntese de Voz</span>
          <span className="ml-auto rounded border border-border/50 px-1 py-0.5 text-[7px] text-muted-foreground">
            Windows SAPI · gratuito
          </span>
        </div>

        <p className="text-[8px] text-muted-foreground/60 leading-relaxed -mt-1">
          Gera narração usando as vozes instaladas no Windows. Funciona em qualquer PC, sem internet.
        </p>

        {voices.length > 0 ? (
          <select
            value={selectedVoice}
            onChange={e => setSelectedVoice(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-[10px] text-foreground"
          >
            {voices.map(v => (
              <option key={v} value={v}>
                {v.replace(/^Microsoft\s+/i, "").replace(/\s+-\s+.*$/, "")}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-[8px] text-muted-foreground/50">Carregando vozes...</p>
        )}

        <div className="relative">
          <textarea
            value={ttsText}
            onChange={e => setTtsText(e.target.value.slice(0, MAX_CHARS))}
            rows={3}
            placeholder="Digite o texto para narrar..."
            className="w-full resize-none rounded-lg border border-border bg-background px-2.5 py-2 text-[10px] text-foreground leading-relaxed placeholder:text-muted-foreground/40 focus:border-primary/60 focus:outline-none transition"
          />
          <span className={`absolute bottom-2 right-2 text-[7px] tabular-nums select-none ${ttsText.length >= MAX_CHARS ? "text-amber-400" : "text-muted-foreground/30"}`}>
            {ttsText.length}/{MAX_CHARS}
          </span>
        </div>

        <button
          type="button"
          onClick={handleSynthesize}
          disabled={ttsLoading || !ttsText.trim()}
          className="flex items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2 text-xs font-black text-white hover:bg-primary/90 transition disabled:opacity-40 active:scale-[0.98]"
        >
          {ttsLoading
            ? <><Loader2 className="size-3.5 animate-spin" />Gerando...</>
            : <><Mic className="size-3.5" />Gerar Narração</>}
        </button>

        {ttsResult?.url && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5 text-[8.5px] text-green-400">
              <CheckCircle className="size-3" />Pronto — ouça e adicione à timeline
            </div>
            <audio controls className="w-full h-7" src={ttsResult.url} />
            {onAddAudioToTimeline && ttsResult.path && (
              <button
                type="button"
                onClick={() => onAddAudioToTimeline(ttsResult.path!, "Narração gerada")}
                className="rounded-lg border border-primary/40 bg-primary/10 px-2 py-1 text-[9px] font-semibold text-primary hover:bg-primary/20 transition"
              >
                Adicionar à timeline
              </button>
            )}
          </div>
        )}
        {ttsResult?.error && (
          <pre className="text-[8px] text-destructive bg-destructive/10 rounded-lg p-2 whitespace-pre-wrap break-words leading-relaxed">
            {ttsResult.error}
          </pre>
        )}
      </div>

      {/* ── Sincronização Labial ── */}
      <div className="rounded-xl border border-border bg-card p-3 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Zap className="size-3.5 text-amber-400" />
          <span className="text-[10px] font-bold text-foreground">Sincronização Labial</span>
          <span className="ml-auto rounded border border-border/50 px-1 py-0.5 text-[7px] text-muted-foreground">
            Wav2Lip · Python
          </span>
        </div>

        {/* Limites sempre visíveis */}
        <div className="rounded-lg bg-muted/30 border border-border/40 px-2.5 py-2 flex flex-col gap-0.5">
          <p className="text-[8px] font-bold text-muted-foreground/70 uppercase tracking-wide mb-0.5">Limites desta ferramenta</p>
          <p className="text-[7.5px] text-muted-foreground/60">Máximo <strong className="text-foreground/70">5 minutos</strong> de vídeo por processamento</p>
          <p className="text-[7.5px] text-muted-foreground/60">Tempo estimado: <strong className="text-foreground/70">~{estMin} min</strong> em CPU (sem GPU)</p>
          <p className="text-[7.5px] text-muted-foreground/60">Melhor resultado: rosto frontal, boa iluminação</p>
          <p className="text-[7.5px] text-muted-foreground/60">Gratuito e local — funciona em qualquer PC com Python</p>
        </div>

        {lipsyncReady === false && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/25 p-2.5">
            <AlertCircle className="size-3.5 text-amber-400 shrink-0 mt-px" />
            <div className="flex flex-col gap-1">
              <p className="text-[8.5px] text-amber-300 font-bold">Wav2Lip não encontrado</p>
              <p className="text-[7.5px] text-muted-foreground leading-relaxed">
                Instale com: <code className="rounded bg-muted/60 px-1 text-[7px]">pip install wav2lip-inference</code>
              </p>
              <p className="text-[7px] text-muted-foreground/60">Reinicie o Studio V4 após instalar.</p>
            </div>
          </div>
        )}

        {lipsyncReady !== false && (
          <>
            {!mediaContext && (
              <p className="text-[8.5px] text-muted-foreground/50 text-center py-1">
                Selecione um clipe com rosto na timeline
              </p>
            )}

            {mediaContext && (
              <>
                <div className="rounded-lg border border-border/50 bg-background/40 px-2.5 py-1.5 text-[8.5px] text-muted-foreground flex items-center justify-between">
                  <span className="truncate mr-2">{mediaContext.filePath.split(/[/\\]/).pop()}</span>
                  {mediaContext.duration > MAX_LIPSYNC_SEC && (
                    <span className="shrink-0 text-[7.5px] text-amber-400 font-semibold">cortado para 30s</span>
                  )}
                </div>

                {/* Áudio externo opcional */}
                <div className="flex items-center gap-1.5">
                  <div className={`flex-1 min-w-0 rounded-lg border border-dashed px-2 py-1.5 text-[8px] truncate ${audioFilePath ? "border-primary/40 text-foreground" : "border-border/50 text-muted-foreground/50"}`}>
                    {audioFilePath ? audioFilePath.split(/[/\\]/).pop() : "Áudio externo (opcional — usa o do clipe)"}
                  </div>
                  <button type="button" onClick={handlePickAudio}
                    className="shrink-0 rounded-lg border border-border px-2 py-1.5 text-[9px] font-semibold text-muted-foreground hover:text-foreground transition">
                    Escolher
                  </button>
                  {audioFilePath && (
                    <button type="button" onClick={() => setAudioFilePath(null)}
                      className="shrink-0 grid size-6 place-items-center rounded-lg border border-border/50 text-muted-foreground/50 hover:text-muted-foreground transition">
                      <X className="size-3" />
                    </button>
                  )}
                </div>

                {/* Barra de progresso */}
                {lipsyncLoading && (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-[9px]">
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Loader2 className="size-2.5 animate-spin" />Processando...
                      </span>
                      <span className="font-mono text-amber-400 tabular-nums">{lipsyncPercent.toFixed(0)}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-amber-400 rounded-full transition-all duration-500"
                        style={{ width: `${lipsyncPercent}%` }}
                      />
                    </div>
                    <p className="text-[7.5px] text-muted-foreground/50">
                      Aguarde — isso pode levar alguns minutos em CPU
                    </p>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleLipsync}
                  disabled={lipsyncLoading || lipsyncReady === null}
                  className="flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-3 py-2.5 text-xs font-black text-white hover:bg-amber-400 transition disabled:opacity-40 active:scale-[0.98]"
                >
                  {lipsyncLoading
                    ? <><Loader2 className="size-3.5 animate-spin" />Sincronizando...</>
                    : <><Zap className="size-3.5" />Sincronizar Lábios</>}
                </button>
              </>
            )}

            {lipsyncResult?.outputPath && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-1.5 text-[8.5px] text-green-400">
                  <CheckCircle className="size-3" />Vídeo pronto
                </div>
                {onAddVideoToTimeline && (
                  <button
                    type="button"
                    onClick={() => onAddVideoToTimeline(lipsyncResult.outputPath!, "Lip sync")}
                    className="rounded-lg border border-green-500/40 bg-green-500/10 px-2 py-1 text-[9px] font-semibold text-green-400 hover:bg-green-500/20 transition"
                  >
                    Adicionar à timeline
                  </button>
                )}
              </div>
            )}
            {lipsyncResult?.error && (
              <pre className="text-[8px] text-destructive bg-destructive/10 rounded-lg p-2 whitespace-pre-wrap break-words leading-relaxed">
                {lipsyncResult.error}
              </pre>
            )}
          </>
        )}
      </div>
    </div>
  );
}
