import { useState, useRef, useEffect } from "react";
import {
  Play, Search, Wand2, Trash2, Scissors, Loader2,
  ChevronUp, ChevronDown, X, MergeIcon,
} from "lucide-react";
import type { CaptionSegment } from "@/types/editor";
import {
  normalizeCaptionText, normalizeAllCaptions,
  searchSegments, replaceInSegment, replaceInAllSegments,
  updateSegmentText, deleteSegment, splitSegment, mergeWithNext,
  createSegmentId,
} from "@/utils/captions";

const LANGUAGES = [
  { id: "pt", label: "PT-BR" },
  { id: "en", label: "EN-US" },
  { id: "es", label: "ES-ES" },
  { id: "auto", label: "Auto" },
];

const MODELS = [
  { id: "small",    label: "Rápido",    desc: "~150 MB" },
  { id: "medium",   label: "Equilibrado", desc: "~450 MB" },
  { id: "large-v3", label: "Qualidade",  desc: "~1.5 GB" },
];

function fmt(s: number): string {
  const mm = Math.floor(s / 60);
  const ss = (s % 60).toFixed(1).padStart(4, "0");
  return `${mm}:${ss}`;
}

export interface MediaCtx {
  filePath: string;
  trimStart: number;
  duration: number;
}

interface Props {
  segments: CaptionSegment[];
  onSegmentsChange: (segs: CaptionSegment[]) => void;
  onSeek: (time: number) => void;
  currentTime: number;
  mediaContext: MediaCtx | null;
}

export function CaptionEditorPanel({
  segments, onSegmentsChange, onSeek, currentTime, mediaContext,
}: Props) {
  const [language, setLanguage] = useState("pt");
  const [model, setModel] = useState("small");
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [matches, setMatches] = useState<number[]>([]);
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const activeIdx = segments.findIndex(s => currentTime >= s.start && currentTime <= s.end);

  // Atualiza matches quando query ou segments mudam
  useEffect(() => {
    if (!searchQuery.trim()) { setMatches([]); return; }
    const m = searchSegments(segments, searchQuery);
    setMatches(m);
    setCursor(0);
  }, [searchQuery, segments]);

  // Rola até o segmento ativo
  useEffect(() => {
    if (activeIdx < 0 || !listRef.current) return;
    const el = listRef.current.children[activeIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeIdx]);

  async function handleTranscribe() {
    if (!mediaContext?.filePath) {
      setError("Selecione um clipe na timeline primeiro.");
      return;
    }
    if (!window.studioV4?.media?.transcribe) {
      setError("Transcrição requer o app desktop.");
      return;
    }
    setTranscribing(true);
    setError(null);
    try {
      // Salva modelo escolhido no config
      const cfg = (await window.studioV4?.readConfig?.()) || {};
      await window.studioV4?.writeConfig?.({ ...cfg, whisperModel: model });

      const result = await window.studioV4.media.transcribe(
        mediaContext.filePath, language,
        mediaContext.trimStart, mediaContext.duration,
      );
      if (result?.error) { setError(result.error); return; }

      const segs: CaptionSegment[] = (result?.segments ?? []).map((s: { start: number; end: number; text: string }) => ({
        id: createSegmentId(),
        start: s.start + (mediaContext.trimStart ?? 0),
        end: s.end + (mediaContext.trimStart ?? 0),
        text: normalizeCaptionText(s.text),
        originalText: s.text,
        language: result.language,
      }));
      onSegmentsChange(segs);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao transcrever");
    } finally {
      setTranscribing(false);
    }
  }

  function navSearch(dir: 1 | -1) {
    if (!matches.length) return;
    const next = (cursor + dir + matches.length) % matches.length;
    setCursor(next);
    const el = listRef.current?.children[matches[next]] as HTMLElement | undefined;
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    onSeek(segments[matches[next]].start);
  }

  return (
    <div className="flex flex-col gap-2">

      {/* Gerar Legendas */}
      <div className="rounded-lg border border-border bg-card/50 p-2 flex flex-col gap-2">
        <div className="flex items-center gap-1.5">
          <select
            value={language} onChange={e => setLanguage(e.target.value)}
            className="flex-1 rounded border border-border bg-background px-1.5 py-1 text-[10px] text-foreground"
          >
            {LANGUAGES.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
          <select
            value={model} onChange={e => setModel(e.target.value)}
            className="flex-1 rounded border border-border bg-background px-1.5 py-1 text-[10px] text-foreground"
          >
            {MODELS.map(m => <option key={m.id} value={m.id}>{m.label} ({m.desc})</option>)}
          </select>
        </div>
        <button
          type="button"
          onClick={handleTranscribe}
          disabled={transcribing || !mediaContext}
          className="flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-white hover:bg-primary/90 transition disabled:opacity-40"
        >
          {transcribing
            ? <><Loader2 className="size-3.5 animate-spin" />Transcrevendo...</>
            : "Gerar Legendas"}
        </button>

        {!mediaContext && (
          <p className="text-[9px] text-muted-foreground leading-relaxed">
            Selecione um clipe na timeline para transcrever.
          </p>
        )}
        {error && (
          <pre className="text-[9px] text-destructive leading-relaxed whitespace-pre-wrap break-words">
            {error}
          </pre>
        )}
      </div>

      {segments.length > 0 && (
        <>
          {/* Barra de ferramentas */}
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-muted-foreground flex-1">
              {segments.length} legenda{segments.length !== 1 ? "s" : ""}
            </span>
            <button
              type="button"
              title="Corrigir todas automaticamente"
              onClick={() => onSegmentsChange(normalizeAllCaptions(segments))}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] border border-border text-muted-foreground hover:text-amber-400 hover:border-amber-400/40 transition"
            >
              <Wand2 className="size-2.5" />Corrigir
            </button>
            <button
              type="button"
              title="Buscar / substituir"
              onClick={() => setShowSearch(v => !v)}
              className={`grid size-5 place-items-center rounded border transition ${
                showSearch
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              <Search className="size-2.5" />
            </button>
          </div>

          {/* Busca / substituição */}
          {showSearch && (
            <div className="rounded-lg border border-border bg-card/50 p-2 flex flex-col gap-1.5">
              {/* Linha de busca */}
              <div className="flex items-center gap-1">
                <input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Buscar..."
                  className="flex-1 min-w-0 rounded border border-border bg-background px-2 py-0.5 text-[10px] text-foreground placeholder:text-muted-foreground/40"
                />
                {matches.length > 0 && (
                  <span className="shrink-0 text-[8px] text-muted-foreground tabular-nums">
                    {cursor + 1}/{matches.length}
                  </span>
                )}
                <button type="button" onClick={() => navSearch(-1)}
                  className="grid size-5 place-items-center rounded border border-border text-muted-foreground hover:text-foreground">
                  <ChevronUp className="size-2.5" />
                </button>
                <button type="button" onClick={() => navSearch(1)}
                  className="grid size-5 place-items-center rounded border border-border text-muted-foreground hover:text-foreground">
                  <ChevronDown className="size-2.5" />
                </button>
                <button type="button" onClick={() => { setSearchQuery(""); setShowSearch(false); }}
                  className="grid size-5 place-items-center rounded border border-border text-muted-foreground hover:text-foreground">
                  <X className="size-2.5" />
                </button>
              </div>
              {/* Linha de substituição */}
              <div className="flex items-center gap-1">
                <input
                  value={replaceQuery}
                  onChange={e => setReplaceQuery(e.target.value)}
                  placeholder="Substituir por..."
                  className="flex-1 min-w-0 rounded border border-border bg-background px-2 py-0.5 text-[10px] text-foreground placeholder:text-muted-foreground/40"
                />
                <button
                  type="button"
                  disabled={!searchQuery || matches.length === 0}
                  onClick={() => onSegmentsChange(
                    replaceInSegment(segments, matches[cursor], searchQuery, replaceQuery)
                  )}
                  className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[8px] text-muted-foreground hover:text-foreground disabled:opacity-40 transition"
                >
                  Esta
                </button>
                <button
                  type="button"
                  disabled={!searchQuery || matches.length === 0}
                  onClick={() => onSegmentsChange(
                    replaceInAllSegments(segments, searchQuery, replaceQuery)
                  )}
                  className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[8px] text-muted-foreground hover:text-foreground disabled:opacity-40 transition"
                >
                  Todas
                </button>
              </div>
            </div>
          )}

          {/* Lista de segmentos */}
          <div ref={listRef} className="flex flex-col gap-1 max-h-[400px] overflow-y-auto">
            {segments.map((seg, idx) => {
              const isActive   = idx === activeIdx;
              const isMatch    = matches.includes(idx);
              const isCursor   = matches[cursor] === idx && searchQuery.trim().length > 0;
              return (
                <div
                  key={seg.id}
                  className={`rounded-lg border p-1.5 flex flex-col gap-1 transition ${
                    isActive
                      ? "border-primary/60 bg-primary/5"
                      : isCursor
                        ? "border-amber-500/60 bg-amber-500/5"
                        : isMatch
                          ? "border-amber-500/30 bg-amber-500/5"
                          : "border-border bg-card/40 hover:bg-card/70"
                  }`}
                >
                  {/* Cabeçalho: tempo + ações */}
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onSeek(seg.start)}
                      className="shrink-0 grid size-4 place-items-center rounded bg-primary/10 text-primary hover:bg-primary/25 transition"
                    >
                      <Play className="size-2" />
                    </button>
                    <span className="text-[7.5px] font-mono text-muted-foreground flex-1">
                      {fmt(seg.start)} — {fmt(seg.end)}
                    </span>
                    {/* Ações */}
                    <button
                      type="button" title="Corrigir este"
                      onClick={() => onSegmentsChange(
                        segments.map((s, i) => i === idx ? { ...s, text: normalizeCaptionText(s.text) } : s)
                      )}
                      className="grid size-4 place-items-center rounded text-muted-foreground hover:text-amber-400 transition"
                    >
                      <Wand2 className="size-2.5" />
                    </button>
                    <button
                      type="button" title="Dividir no playhead"
                      onClick={() => onSegmentsChange(splitSegment(segments, idx, currentTime))}
                      className="grid size-4 place-items-center rounded text-muted-foreground hover:text-blue-400 transition"
                    >
                      <Scissors className="size-2.5" />
                    </button>
                    {idx < segments.length - 1 && (
                      <button
                        type="button" title="Juntar com próxima"
                        onClick={() => onSegmentsChange(mergeWithNext(segments, idx))}
                        className="grid size-4 place-items-center rounded text-muted-foreground hover:text-green-400 transition"
                      >
                        <MergeIcon className="size-2.5" />
                      </button>
                    )}
                    <button
                      type="button" title="Excluir"
                      onClick={() => onSegmentsChange(deleteSegment(segments, idx))}
                      className="grid size-4 place-items-center rounded text-muted-foreground hover:text-destructive transition"
                    >
                      <Trash2 className="size-2.5" />
                    </button>
                  </div>

                  {/* Textarea editável */}
                  <textarea
                    value={seg.text}
                    onChange={e => onSegmentsChange(updateSegmentText(segments, idx, e.target.value))}
                    rows={2}
                    className="w-full resize-none rounded border border-border bg-background px-2 py-1 text-[10px] text-foreground leading-relaxed placeholder:text-muted-foreground/40 focus:border-primary/60 focus:outline-none"
                  />
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
