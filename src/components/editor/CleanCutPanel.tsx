import { useMemo, useState } from "react";
import { Scissors, Check, AlertTriangle, Loader2, Play } from "lucide-react";
import type { ImportedAsset } from "@/types/editor";
import type { CleanCutPause } from "@/utils/audio";
import { analyzeAudioForCleanCuts } from "@/utils/audio";

interface CleanCutPanelProps {
  assets: ImportedAsset[];
  selectedAssetId: string | null;
  onApplyCuts: (assetId: string, cuts: CleanCutPause[], totalDuration: number) => void;
  onSeek: (time: number) => void;
}

export function CleanCutPanel({ assets, selectedAssetId, onApplyCuts, onSeek }: CleanCutPanelProps) {
  const [analyzing, setAnalyzing] = useState(false);
  const [cuts, setCuts] = useState<CleanCutPause[]>([]);
  const [totalDuration, setTotalDuration] = useState(0);
  const [analyzedAssetId, setAnalyzedAssetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Conjunto de ids de pausas selecionadas para corte
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const selectedAsset = assets.find((a) => a.id === selectedAssetId);
  const hasAudioAsset = selectedAsset && (selectedAsset.kind === "video" || selectedAsset.kind === "audio");

  async function handleAnalyze() {
    if (!selectedAsset) return;
    const source = selectedAsset.previewUrl || selectedAsset.url || selectedAsset.filePath;
    if (!source) return;

    setAnalyzing(true);
    setError(null);
    setCuts([]);

    try {
      const result = await analyzeAudioForCleanCuts(source);
      setCuts(result.cuts);
      setTotalDuration(result.totalDuration);
      setAnalyzedAssetId(selectedAsset.id);
      // Pre-seleciona apenas as pausas com acao "cut" (alta confianca)
      setSelectedIds(new Set(result.cuts.filter((c) => c.action === "cut").map((c) => c.id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha na analise");
    } finally {
      setAnalyzing(false);
    }
  }

  const cutCount = cuts.filter((c) => c.action === "cut").length;
  const reviewCount = cuts.filter((c) => c.action === "review").length;
  const selectedCount = selectedIds.size;

  function toggleCut(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(cuts.map((c) => c.id)));
  }

  function selectNone() {
    setSelectedIds(new Set());
  }

  // So aplica as pausas marcadas, forcando action="cut" nelas
  const cutsToApply = useMemo(
    () => cuts.filter((c) => selectedIds.has(c.id)).map((c) => ({ ...c, action: "cut" as const })),
    [cuts, selectedIds]
  );

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-xs font-black flex items-center gap-1.5">
          <Scissors className="size-3.5 text-primary" />
          Corte Limpo
        </h3>
        <p className="mt-1 text-[10px] text-muted-foreground leading-relaxed">
          Detecta silencio real sem cortar fala. Preserva micro-falas, silabas curtas e respiros — diferente do corte bruto.
        </p>
      </div>

      {!hasAudioAsset ? (
        <div className="rounded-lg border border-border bg-card p-3 text-center">
          <p className="text-[10px] text-muted-foreground">
            Selecione um video ou audio na biblioteca para analisar.
          </p>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={handleAnalyze}
            disabled={analyzing}
            className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-bold text-white hover:bg-primary/90 active:scale-95 transition disabled:opacity-50"
          >
            {analyzing ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Analisando audio...
              </>
            ) : (
              <>
                <Scissors className="size-4" />
                Analisar "{selectedAsset.displayName || selectedAsset.name}"
              </>
            )}
          </button>

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-2.5">
              <p className="text-[10px] text-destructive">{error}</p>
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

              {/* Selecionar todas / nenhuma */}
              <div className="flex items-center justify-between px-0.5">
                <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/60">
                  {selectedCount} de {cuts.length} marcadas
                </p>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={selectAll} className="text-[9px] font-bold text-primary hover:underline">Todas</button>
                  <span className="text-muted-foreground/30">|</span>
                  <button type="button" onClick={selectNone} className="text-[9px] font-bold text-muted-foreground hover:underline">Nenhuma</button>
                </div>
              </div>

              <div className="max-h-[300px] overflow-y-auto rounded-lg border border-border">
                {cuts.map((cut) => {
                  const isSel = selectedIds.has(cut.id);
                  return (
                    <div
                      key={cut.id}
                      className={`flex items-center gap-2 border-b border-border/50 px-2.5 py-2 last:border-0 transition cursor-pointer ${
                        isSel ? "bg-primary/5" : "hover:bg-card/50"
                      }`}
                      onClick={() => toggleCut(cut.id)}
                    >
                      {/* Checkbox de inclusao */}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggleCut(cut.id); }}
                        className={`grid size-5 shrink-0 place-items-center rounded-md border transition ${
                          isSel
                            ? "border-primary bg-primary text-white"
                            : "border-border bg-transparent text-transparent hover:border-primary/50"
                        }`}
                        title={isSel ? "Incluir corte" : "Excluir corte"}
                      >
                        <Check className="size-3" />
                      </button>
                      <div
                        className="grid size-4 shrink-0 place-items-center rounded-full text-white"
                        style={{ backgroundColor: cut.color }}
                        title={cut.action === "cut" ? "Alta confianca" : "Revisar"}
                      >
                        {cut.action === "cut" ? <Check className="size-2.5" /> : <AlertTriangle className="size-2.5" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-semibold">{cut.label}</p>
                        <p className="text-[9px] text-muted-foreground">{cut.reason}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[10px] font-mono">{cut.time}</p>
                        <p className="text-[8px] text-muted-foreground">{cut.score}% confianca</p>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onSeek(cut.startTime); }}
                        className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:text-foreground"
                        title="Ir para a pausa"
                      >
                        <Play className="size-3" />
                      </button>
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                disabled={selectedCount === 0}
                onClick={() => onApplyCuts(analyzedAssetId!, cutsToApply, totalDuration)}
                className="flex items-center justify-center gap-2 rounded-lg border border-primary bg-primary/10 px-4 py-2 text-xs font-bold text-primary hover:bg-primary/20 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Scissors className="size-3.5" />
                {selectedCount === 0
                  ? "Selecione pausas para cortar"
                  : `Aplicar ${selectedCount} corte${selectedCount !== 1 ? "s" : ""} na timeline`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
