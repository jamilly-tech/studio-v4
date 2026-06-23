import { useState } from "react";
import { Captions, Loader2, Play, Copy, Check, RepeatIcon, Trash2, X } from "lucide-react";
import type { ImportedAsset, TranscriptSegment } from "@/types/editor";

const LANGUAGES = [
  { id: "pt", label: "Portugues", flag: "BR" },
  { id: "en", label: "English", flag: "EN" },
  { id: "es", label: "Espanol", flag: "ES" },
  { id: "auto", label: "Auto", flag: "??" },
] as const;

type LangId = typeof LANGUAGES[number]["id"];

interface RepeatGroup {
  groupId: number;
  indices: number[];
  similarity: number;
}

interface TranscriptionPanelProps {
  assets: ImportedAsset[];
  selectedAssetId: string | null;
  onSeek: (time: number) => void;
  onCaptionsGenerated: (segments: TranscriptSegment[]) => void;
}

// Compara dois textos por sobreposicao de palavras (Jaccard)
function wordSimilarity(a: string, b: string): number {
  const normalize = (t: string) => t.toLowerCase().replace(/[^\w\s]/g, "").trim();
  const wordsOf = (t: string) => new Set(normalize(t).split(/\s+/).filter((w) => w.length > 2));
  const wA = wordsOf(a);
  const wB = wordsOf(b);
  if (wA.size === 0 || wB.size === 0) return 0;
  const intersection = [...wA].filter((w) => wB.has(w)).length;
  const union = new Set([...wA, ...wB]).size;
  return intersection / union;
}

function findRepeatedGroups(segments: TranscriptSegment[]): RepeatGroup[] {
  const groups: RepeatGroup[] = [];
  const used = new Set<number>();

  for (let i = 0; i < segments.length; i++) {
    if (used.has(i)) continue;
    for (let j = i + 1; j < segments.length; j++) {
      if (used.has(j)) continue;
      const sim = wordSimilarity(segments[i].text, segments[j].text);
      if (sim >= 0.7) {
        groups.push({ groupId: groups.length, indices: [i, j], similarity: sim });
        used.add(i);
        used.add(j);
        break;
      }
    }
  }
  return groups;
}

export function TranscriptionPanel({ assets, selectedAssetId, onSeek, onCaptionsGenerated }: TranscriptionPanelProps) {
  const [language, setLanguage] = useState<LangId>("pt");
  const [transcribing, setTranscribing] = useState(false);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [transcribedAssetId, setTranscribedAssetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Falas repetidas
  const [repeatMode, setRepeatMode] = useState(false);
  const [repeatGroups, setRepeatGroups] = useState<RepeatGroup[]>([]);
  const [toDelete, setToDelete] = useState<Set<number>>(new Set());

  const selectedAsset = assets.find((a) => a.id === selectedAssetId);
  const hasAudio = selectedAsset && (selectedAsset.kind === "video" || selectedAsset.kind === "audio");

  async function handleTranscribe() {
    if (!selectedAsset?.filePath) return;
    if (!window.studioV4?.media?.transcribe) {
      setError("Transcricao requer o app desktop");
      return;
    }

    setTranscribing(true);
    setError(null);
    setSegments([]);
    setRepeatMode(false);

    try {
      const result = await window.studioV4.media.transcribe(selectedAsset.filePath, language);

      if (result.error) {
        setError(result.error);
        return;
      }

      setSegments(result.segments);
      setTranscribedAssetId(selectedAsset.id);
      onCaptionsGenerated(result.segments);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha na transcricao");
    } finally {
      setTranscribing(false);
    }
  }

  function handleCopyAll() {
    const text = segments.map((s) => s.text).join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleCheckRepeats() {
    const groups = findRepeatedGroups(segments);
    setRepeatGroups(groups);
    setToDelete(new Set());
    setRepeatMode(true);
  }

  function toggleDelete(index: number) {
    setToDelete((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function applyDeletions() {
    const remaining = segments.filter((_, i) => !toDelete.has(i));
    setSegments(remaining);
    onCaptionsGenerated(remaining);
    setRepeatMode(false);
    setRepeatGroups([]);
    setToDelete(new Set());
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-xs font-black flex items-center gap-1.5">
          <Captions className="size-3.5 text-primary" />
          Transcricao
        </h3>
        <p className="mt-1 text-[10px] text-muted-foreground leading-relaxed">
          Transcreve com acentuacao, pontuacao e formatacao correta. PT-BR, ingles e espanhol.
        </p>
      </div>

      <div className="flex gap-1">
        {LANGUAGES.map((lang) => (
          <button
            key={lang.id}
            type="button"
            onClick={() => setLanguage(lang.id)}
            className={`flex items-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-semibold transition ${
              language === lang.id
                ? "bg-primary text-white"
                : "bg-card text-muted-foreground hover:text-foreground border border-border"
            }`}
          >
            <span className="text-[8px] font-bold opacity-70">{lang.flag}</span>
            {lang.label}
          </button>
        ))}
      </div>

      {!hasAudio ? (
        <div className="rounded-lg border border-border bg-card p-3 text-center">
          <p className="text-[10px] text-muted-foreground">
            Selecione um video ou audio para transcrever.
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleTranscribe}
          disabled={transcribing}
          className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-bold text-white hover:bg-primary/90 active:scale-95 transition disabled:opacity-50"
        >
          {transcribing ? (
            <><Loader2 className="size-4 animate-spin" /> Transcrevendo...</>
          ) : (
            <><Captions className="size-4" /> Transcrever "{selectedAsset?.displayName}"</>
          )}
        </button>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-2.5">
          <p className="text-[10px] text-destructive">{error}</p>
        </div>
      )}

      {segments.length > 0 && transcribedAssetId === selectedAssetId && !repeatMode && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-wider">
              {segments.length} trecho{segments.length !== 1 ? "s" : ""}
            </p>
            <button
              type="button"
              onClick={handleCopyAll}
              className="flex items-center gap-1 rounded px-2 py-1 text-[9px] font-semibold text-muted-foreground hover:text-foreground hover:bg-card transition"
            >
              {copied ? <Check className="size-3 text-green-500" /> : <Copy className="size-3" />}
              {copied ? "Copiado" : "Copiar tudo"}
            </button>
          </div>

          <div className="max-h-[240px] overflow-y-auto rounded-lg border border-border">
            {segments.map((seg, i) => (
              <div
                key={i}
                className="flex gap-2 border-b border-border/50 px-2.5 py-2 last:border-0 hover:bg-card/50 cursor-pointer"
                onClick={() => onSeek(seg.start)}
              >
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onSeek(seg.start); }}
                  className="shrink-0 mt-0.5 text-muted-foreground hover:text-primary"
                >
                  <Play className="size-3" />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] leading-relaxed">{seg.text}</p>
                  <p className="mt-0.5 text-[8px] font-mono text-muted-foreground/60">
                    {formatTime(seg.start)} — {formatTime(seg.end)}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Botao verificar falas repetidas */}
          <button
            type="button"
            onClick={handleCheckRepeats}
            className="flex items-center justify-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs font-bold text-amber-400 hover:bg-amber-500/20 transition"
          >
            <RepeatIcon className="size-3.5" />
            Verificar Falas Repetidas
          </button>
        </div>
      )}

      {/* Modo: revisao de falas repetidas */}
      {repeatMode && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-black text-amber-400 flex items-center gap-1.5">
                <RepeatIcon className="size-3.5" />
                Falas Repetidas
              </p>
              <p className="mt-0.5 text-[9px] text-muted-foreground">
                {repeatGroups.length > 0
                  ? `${repeatGroups.length} par${repeatGroups.length > 1 ? "es" : ""} encontrado${repeatGroups.length > 1 ? "s" : ""}. Marque o que excluir.`
                  : "Nenhuma fala repetida encontrada."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setRepeatMode(false)}
              className="grid size-5 place-items-center rounded text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>

          {repeatGroups.length > 0 ? (
            <>
              <div className="max-h-[280px] overflow-y-auto flex flex-col gap-2">
                {repeatGroups.map((group) => (
                  <div key={group.groupId} className="rounded-lg border border-border bg-card overflow-hidden">
                    <div className="border-b border-border/60 bg-amber-500/8 px-2.5 py-1">
                      <p className="text-[8px] font-bold text-amber-400/80 uppercase tracking-wider">
                        Par {group.groupId + 1} — {Math.round(group.similarity * 100)}% similar
                      </p>
                    </div>
                    {group.indices.map((segIdx) => {
                      const seg = segments[segIdx];
                      const marked = toDelete.has(segIdx);
                      return (
                        <div
                          key={segIdx}
                          className={`flex items-start gap-2 px-2.5 py-2 border-b border-border/40 last:border-0 cursor-pointer transition ${
                            marked ? "bg-destructive/10" : "hover:bg-muted/30"
                          }`}
                          onClick={() => toggleDelete(segIdx)}
                        >
                          <div className={`mt-0.5 shrink-0 grid size-4 place-items-center rounded border transition ${
                            marked
                              ? "border-destructive bg-destructive text-white"
                              : "border-border text-transparent"
                          }`}>
                            {marked && <Trash2 className="size-2.5" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className={`text-[10px] leading-relaxed ${marked ? "line-through text-muted-foreground" : ""}`}>
                              {seg.text}
                            </p>
                            <p className="mt-0.5 text-[8px] font-mono text-muted-foreground/60">
                              {formatTime(seg.start)} — {formatTime(seg.end)}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onSeek(seg.start); }}
                            className="shrink-0 mt-0.5 text-muted-foreground hover:text-primary"
                          >
                            <Play className="size-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={applyDeletions}
                  disabled={toDelete.size === 0}
                  className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-destructive/80 px-3 py-2 text-xs font-bold text-white hover:bg-destructive transition disabled:opacity-40"
                >
                  <Trash2 className="size-3.5" />
                  Excluir {toDelete.size > 0 ? `${toDelete.size} trecho${toDelete.size > 1 ? "s" : ""}` : "selecionados"}
                </button>
                <button
                  type="button"
                  onClick={() => setRepeatMode(false)}
                  className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-card transition"
                >
                  Cancelar
                </button>
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-border bg-card p-3 text-center">
              <p className="text-[10px] text-muted-foreground">Nenhuma repeticao detectada nos trechos.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
