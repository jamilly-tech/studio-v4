import { useState } from "react";
import { Scissors, Check, AlertTriangle, Loader2, Play, RefreshCw, Copy } from "lucide-react";
import type { ImportedAsset } from "@/types/editor";
import type { CleanCutPause } from "@/utils/audio";
import { analyzeAudioForCleanCuts } from "@/utils/audio";

interface CleanCutPanelProps {
  assets: ImportedAsset[];
  selectedAssetId: string | null;
  onApplyCuts: (assetId: string, cuts: CleanCutPause[], totalDuration: number) => void;
  onSeek: (time: number) => void;
}

type RepeatTake = { idx: number; start: number; end: number; duration: number; meanVol: number; maxVol: number };

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1).padStart(4, "0");
  return `${m}:${sec}`;
}

function similarity(a: RepeatTake, b: RepeatTake): number {
  const durR = Math.min(a.duration, b.duration) / Math.max(a.duration, b.duration);
  const volD = Math.abs(a.meanVol - b.meanVol);
  return Math.round(durR * 70 + Math.max(0, (7 - volD) / 7) * 30);
}

export function CleanCutPanel({ assets, selectedAssetId, onApplyCuts, onSeek }: CleanCutPanelProps) {
  const [tab, setTab] = useState<"silence" | "repeats">("silence");

  // ── Silence / Clean Cut ─────────────────────────────────────────────────────
  const [analyzing, setAnalyzing] = useState(false);
  const [cuts, setCuts] = useState<CleanCutPause[]>([]);
  const [totalDuration, setTotalDuration] = useState(0);
  const [analyzedAssetId, setAnalyzedAssetId] = useState<string | null>(null);
  const [silenceError, setSilenceError] = useState<string | null>(null);

  // ── Repeat Detection ────────────────────────────────────────────────────────
  const [repeatAnalyzing, setRepeatAnalyzing] = useState(false);
  const [repeatGroups, setRepeatGroups] = useState<RepeatTake[][]>([]);
  const [takesFound, setTakesFound] = useState(0);
  const [repeatAnalyzedId, setRepeatAnalyzedId] = useState<string | null>(null);
  const [repeatError, setRepeatError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const selectedAsset = assets.find((a) => a.id === selectedAssetId);
  const hasAudioAsset = selectedAsset && (selectedAsset.kind === "video" || selectedAsset.kind === "audio");

  async function handleAnalyzeSilence() {
    if (!selectedAsset) return;
    const source = selectedAsset.previewUrl || selectedAsset.url || selectedAsset.filePath;
    if (!source) return;
    setAnalyzing(true);
    setSilenceError(null);
    setCuts([]);
    try {
      const result = await analyzeAudioForCleanCuts(source);
      setCuts(result.cuts);
      setTotalDuration(result.totalDuration);
      setAnalyzedAssetId(selectedAsset.id);
    } catch (err) {
      setSilenceError(err instanceof Error ? err.message : "Falha na analise");
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleAnalyzeRepeats() {
    if (!selectedAsset?.filePath) return;
    setRepeatAnalyzing(true);
    setRepeatError(null);
    setRepeatGroups([]);
    setDismissed(new Set());
    try {
      const result = await window.studioV4?.media?.detectRepeats(selectedAsset.filePath);
      if (result?.error) { setRepeatError(result.error); return; }
      setRepeatGroups(result?.groups ?? []);
      setTakesFound(result?.takesFound ?? 0);
      setRepeatAnalyzedId(selectedAsset.id);
    } catch (err) {
      setRepeatError(err instanceof Error ? err.message : "Falha na analise");
    } finally {
      setRepeatAnalyzing(false);
    }
  }

  const cutCount    = cuts.filter((c) => c.action === "cut").length;
  const reviewCount = cuts.filter((c) => c.action === "review").length;
  const visibleGroups = repeatGroups.filter((g) => {
    const key = `${g[0].idx}-${g[1]?.idx}`;
    return !dismissed.has(key);
  });

  return (
    <div className="flex flex-col gap-3">
      {/* Header + tabs */}
      <div>
        <h3 className="text-xs font-black flex items-center gap-1.5">
          <Scissors className="size-3.5 text-primary" />
          Corte Inteligente
        </h3>
        <div className="mt-2 flex rounded-lg border border-border overflow-hidden">
          <button
            type="button"
            onClick={() => setTab("silence")}
            className={`flex-1 py-1 text-[10px] font-bold transition ${tab === "silence" ? "bg-primary text-white" : "text-muted-foreground hover:bg-muted/40"}`}
          >
            Silêncios
          </button>
          <button
            type="button"
            onClick={() => setTab("repeats")}
            className={`flex-1 py-1 text-[10px] font-bold transition relative ${tab === "repeats" ? "bg-primary text-white" : "text-muted-foreground hover:bg-muted/40"}`}
          >
            Repetições
            {visibleGroups.length > 0 && repeatAnalyzedId === selectedAssetId && (
              <span className="absolute -top-1 -right-1 size-3.5 rounded-full bg-amber-400 text-[7px] font-black text-black grid place-items-center">{visibleGroups.length}</span>
            )}
          </button>
        </div>
      </div>

      {!hasAudioAsset ? (
        <div className="rounded-lg border border-border bg-card p-3 text-center">
          <p className="text-[10px] text-muted-foreground">
            Selecione um video ou audio na biblioteca para analisar.
          </p>
        </div>
      ) : tab === "silence" ? (
        <>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Detecta pausas reais sem cortar fala. Preserva micro-falas, sílabas e respiros.
          </p>
          <button
            type="button"
            onClick={handleAnalyzeSilence}
            disabled={analyzing}
            className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-bold text-white hover:bg-primary/90 active:scale-95 transition disabled:opacity-50"
          >
            {analyzing ? (
              <><Loader2 className="size-4 animate-spin" /> Analisando áudio...</>
            ) : (
              <><Scissors className="size-4" /> Analisar "{selectedAsset.displayName || selectedAsset.name}"</>
            )}
          </button>

          {silenceError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-2.5">
              <p className="text-[10px] text-destructive">{silenceError}</p>
            </div>
          )}

          {cuts.length > 0 && analyzedAssetId === selectedAssetId && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3 rounded-lg bg-card p-2.5 border border-border">
                <div className="text-center">
                  <p className="text-lg font-black text-primary">{cuts.length}</p>
                  <p className="text-[8px] text-muted-foreground">pausas</p>
                </div>
                <div className="h-8 w-px bg-border" />
                <div className="text-center">
                  <p className="text-lg font-black text-green-500">{cutCount}</p>
                  <p className="text-[8px] text-muted-foreground">cortar</p>
                </div>
                <div className="h-8 w-px bg-border" />
                <div className="text-center">
                  <p className="text-lg font-black text-yellow-500">{reviewCount}</p>
                  <p className="text-[8px] text-muted-foreground">revisar</p>
                </div>
              </div>

              <div className="max-h-[260px] overflow-y-auto rounded-lg border border-border">
                {cuts.map((cut) => (
                  <div
                    key={cut.id}
                    className="flex items-center gap-2 border-b border-border/50 px-2.5 py-2 last:border-0 hover:bg-card/50 cursor-pointer"
                    onClick={() => onSeek(cut.startTime)}
                  >
                    <div
                      className="grid size-5 place-items-center rounded-full text-white shrink-0"
                      style={{ backgroundColor: cut.color }}
                    >
                      {cut.action === "cut" ? <Check className="size-3" /> : <AlertTriangle className="size-3" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-semibold">{cut.label}</p>
                      <p className="text-[9px] text-muted-foreground">{cut.reason}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[10px] font-mono">{cut.time}</p>
                      <p className="text-[8px] text-muted-foreground">{cut.score}% conf.</p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onSeek(cut.startTime); }}
                      className="grid size-5 place-items-center rounded text-muted-foreground hover:text-foreground"
                    >
                      <Play className="size-3" />
                    </button>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() => onApplyCuts(analyzedAssetId!, cuts, totalDuration)}
                className="flex items-center justify-center gap-2 rounded-lg border border-primary bg-primary/10 px-4 py-2 text-xs font-bold text-primary hover:bg-primary/20 transition"
              >
                <Scissors className="size-3.5" />
                Aplicar {cutCount} cortes na timeline
              </button>
            </div>
          )}
        </>
      ) : (
        /* ── Aba Repetições ── */
        <>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Identifica takes com duração e volume similares — possíveis regravações do mesmo trecho. Nada é removido automaticamente.
          </p>

          <button
            type="button"
            onClick={handleAnalyzeRepeats}
            disabled={repeatAnalyzing}
            className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-bold text-white hover:bg-primary/90 active:scale-95 transition disabled:opacity-50"
          >
            {repeatAnalyzing ? (
              <><Loader2 className="size-4 animate-spin" /> Analisando takes...</>
            ) : (
              <><Copy className="size-4" /> Detectar Takes Repetidos</>
            )}
          </button>

          {repeatError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-2.5">
              <p className="text-[10px] text-destructive">{repeatError}</p>
            </div>
          )}

          {repeatAnalyzedId === selectedAssetId && !repeatAnalyzing && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3 rounded-lg bg-card p-2.5 border border-border">
                <div className="text-center">
                  <p className="text-lg font-black text-primary">{takesFound}</p>
                  <p className="text-[8px] text-muted-foreground">takes</p>
                </div>
                <div className="h-8 w-px bg-border" />
                <div className="text-center">
                  <p className="text-lg font-black text-amber-400">{repeatGroups.length}</p>
                  <p className="text-[8px] text-muted-foreground">repetidos</p>
                </div>
                <div className="h-8 w-px bg-border" />
                <div className="text-center">
                  <p className="text-lg font-black text-green-400">
                    {takesFound - repeatGroups.reduce((acc, g) => acc + g.length - 1, 0)}
                  </p>
                  <p className="text-[8px] text-muted-foreground">únicos</p>
                </div>
              </div>

              {visibleGroups.length === 0 ? (
                <div className="rounded-lg border border-border bg-card/40 p-3 text-center">
                  <p className="text-[10px] text-muted-foreground">
                    {repeatGroups.length === 0
                      ? "Nenhum take repetido encontrado — todos os trechos parecem únicos."
                      : "Todos os grupos foram ignorados."}
                  </p>
                  {dismissed.size > 0 && (
                    <button
                      type="button"
                      onClick={() => setDismissed(new Set())}
                      className="mt-2 text-[9px] text-primary underline"
                    >
                      Restaurar ignorados
                    </button>
                  )}
                </div>
              ) : (
                <div className="max-h-[280px] overflow-y-auto rounded-lg border border-border flex flex-col">
                  {visibleGroups.map((group, gi) => {
                    const key = `${group[0].idx}-${group[1]?.idx}`;
                    const sim = group.length >= 2 ? similarity(group[0], group[1]) : 0;
                    return (
                      <div key={key} className="border-b border-border/50 last:border-0">
                        <div className="flex items-center justify-between px-2.5 py-1.5 bg-amber-500/5">
                          <div className="flex items-center gap-1.5">
                            <Copy className="size-3 text-amber-400 shrink-0" />
                            <span className="text-[9px] font-bold text-amber-300">
                              Grupo {gi + 1} · {group.length} takes similares
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[8px] font-mono text-amber-400/70">{sim}% sim.</span>
                            <button
                              type="button"
                              onClick={() => setDismissed(prev => new Set([...prev, key]))}
                              className="text-[8px] text-muted-foreground hover:text-foreground underline"
                            >
                              Ignorar
                            </button>
                          </div>
                        </div>
                        {group.map((take, ti) => (
                          <div
                            key={take.idx}
                            className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-card/50 cursor-pointer"
                            onClick={() => onSeek(take.start)}
                          >
                            <div className={`size-4 rounded-full grid place-items-center text-white shrink-0 text-[7px] font-black ${ti === 0 ? "bg-primary/70" : "bg-muted-foreground/50"}`}>
                              {ti + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] font-mono">{fmtTime(take.start)}</span>
                                <span className="text-[8px] text-muted-foreground">→</span>
                                <span className="text-[10px] font-mono">{fmtTime(take.end)}</span>
                              </div>
                              <p className="text-[8px] text-muted-foreground">{take.duration.toFixed(1)}s · {take.meanVol.toFixed(0)} dBFS</p>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); onSeek(take.start); }}
                              className="grid size-5 place-items-center rounded text-muted-foreground hover:text-foreground shrink-0"
                              title="Ir para este take"
                            >
                              <Play className="size-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}

              <button
                type="button"
                onClick={handleAnalyzeRepeats}
                className="flex items-center justify-center gap-1.5 text-[9px] text-muted-foreground hover:text-foreground transition"
              >
                <RefreshCw className="size-3" /> Reanalisar
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
