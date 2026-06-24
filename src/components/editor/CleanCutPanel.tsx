import { useState } from "react";
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha na analise");
    } finally {
      setAnalyzing(false);
    }
  }

  const cutCount = cuts.filter((c) => c.action === "cut").length;
  const reviewCount = cuts.filter((c) => c.action === "review").length;

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

              <div className="max-h-[300px] overflow-y-auto rounded-lg border border-border">
                {cuts.map((cut) => (
                  <div
                    key={cut.id}
                    className="flex items-center gap-2 border-b border-border/50 px-2.5 py-2 last:border-0 hover:bg-card/50 cursor-pointer"
                    onClick={() => onSeek(cut.startTime)}
                  >
                    <div
                      className="grid size-5 place-items-center rounded-full text-white"
                      style={{ backgroundColor: cut.color }}
                    >
                      {cut.action === "cut" ? (
                        <Check className="size-3" />
                      ) : (
                        <AlertTriangle className="size-3" />
                      )}
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
      )}
    </div>
  );
}
