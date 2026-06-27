import { useState, useRef, useEffect } from "react";
import {
  Play, Search, Wand2, Trash2, Scissors, Loader2,
  ChevronUp, ChevronDown, X, MergeIcon, Zap,
} from "lucide-react";
import type { CaptionSegment } from "@/types/editor";
import {
  normalizeCaptionText, normalizeAllCaptions,
  searchSegments, replaceInSegment, replaceInAllSegments,
  updateSegmentText, deleteSegment, splitSegment, mergeWithNext,
  createSegmentId,
} from "@/utils/captions";

const LANGUAGES = [
  { id: "pt", label: "PT" },
  { id: "en", label: "EN" },
  { id: "es", label: "ES" },
  { id: "auto", label: "Auto" },
];

const MODELS = [
  { id: "tiny",     label: "Rápido",      badge: "⚡" },
  { id: "small",    label: "Equilibrado", badge: null },
  { id: "large-v3", label: "Qualidade",   badge: null },
];

function fmt(s: number): string {
  const mm = Math.floor(s / 60);
  const ss = (s % 60).toFixed(1).padStart(4, "0");
  return `${mm}:${ss}`;
}

function fmtEta(sec: number): string {
  if (sec < 60) return `~${sec}s`;
  return `~${Math.floor(sec / 60)}min ${sec % 60}s`;
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
  const [model, setModel] = useState("tiny");
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [matches, setMatches] = useState<number[]>([]);
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Progresso da transcrição
  const [txProgress, setTxProgress] = useState<{
    percent: number;
    eta: number | null;
    audioDuration: number;
  } | null>(null);

  // Status do Whisper.cpp nativo
  const [builtinReady, setBuiltinReady] = useState(false);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const api = window.studioV4?.media;
    if (!api) return;

    // Checa disponibilidade do Whisper.cpp
    api.whisperStatus?.().then(s => {
      setBuiltinReady(s.exeReady && s.tinyReady);
    }).catch(() => {});

    // Escuta progresso de transcrição (emitido por ambos os caminhos)
    unsubRef.current = api.onProgress?.((ev) => {
      if (ev.stage !== "transcribe") return;
      if (ev.percent >= 100) {
        setTxProgress(null);
        return;
      }
      setTxProgress({
        percent: ev.percent,
        eta: ev.eta ?? null,
        audioDuration: ev.audioDuration ?? 0,
      });
    });

    // Ouve quando Whisper.cpp termina de baixar em background
    const unsubWh = api.onWhisperStatus?.((data) => {
      if (data.ready && (data.stage === "model-tiny" || data.stage === "exe")) {
        api.whisperStatus?.().then(s => setBuiltinReady(s.exeReady && s.tinyReady)).catch(() => {});
      }
    });

    return () => {
      unsubRef.current?.();
      unsubWh?.();
    };
  }, []);

  const activeIdx = segments.findIndex(s => currentTime >= s.start && currentTime <= s.end);

  useEffect(() => {
    if (!searchQuery.trim()) { setMatches([]); return; }
    const m = searchSegments(segments, searchQuery);
    setMatches(m);
    setCursor(0);
  }, [searchQuery, segments]);

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
    const api = window.studioV4?.media;
    if (!api) { setError("Transcrição requer o app desktop."); return; }

    setTranscribing(true);
    setError(null);
    setTxProgress({ percent: 2, eta: null, audioDuration: mediaContext.duration });

    try {
      // Salva preferência de modelo
      const cfg = (await window.studioV4?.readConfig?.()) || {};
      await window.studioV4?.writeConfig?.({ ...cfg, whisperModel: model });

      let result: { segments?: Array<{ start: number; end: number; text: string }>; language?: string; error?: string } | undefined;

      // Usa Whisper.cpp nativo quando disponível (tiny e small) — muito mais rápido
      let smallReady = false;
      if (builtinReady && model === "small") {
        smallReady = await api.whisperStatus?.().then(s => s.smallReady).catch(() => false) ?? false;
      }
      const useCpp = builtinReady && (model === "tiny" || (model === "small" && smallReady));
      if (useCpp) {
        result = await api.transcribeBuiltin!(
          mediaContext.filePath, language,
          mediaContext.trimStart, mediaContext.duration,
          model === "small" ? "small" : "tiny",
        );
      } else {
        // Fallback: Python faster-whisper
        result = await api.transcribe!(
          mediaContext.filePath, language,
          mediaContext.trimStart, mediaContext.duration,
        );
      }

      if (result?.error) { setError(result.error); return; }

      const segs: CaptionSegment[] = (result?.segments ?? []).map((s) => ({
        id: createSegmentId(),
        start: s.start + (mediaContext.trimStart ?? 0),
        end:   s.end   + (mediaContext.trimStart ?? 0),
        text:  normalizeCaptionText(s.text),
        originalText: s.text,
        language: result!.language,
      }));
      onSegmentsChange(segs);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao transcrever");
    } finally {
      setTranscribing(false);
      setTxProgress(null);
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

      {/* ── Gerar legendas ── */}
      <div className="rounded-xl border border-border bg-card p-3 flex flex-col gap-3">

        {/* Idioma */}
        <div className="flex gap-1">
          {LANGUAGES.map(l => (
            <button key={l.id} type="button" onClick={() => setLanguage(l.id)}
              className={`flex-1 rounded-lg py-1 text-[10px] font-bold transition border ${
                language === l.id
                  ? "bg-primary/15 border-primary text-primary"
                  : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
              }`}>
              {l.label}
            </button>
          ))}
        </div>

        {/* Modelo */}
        <div className="flex gap-1">
          {MODELS.map(m => (
            <button key={m.id} type="button" onClick={() => setModel(m.id)}
              className={`flex-1 rounded-lg py-1.5 text-[9px] font-bold transition border flex flex-col items-center gap-0.5 ${
                model === m.id
                  ? "bg-primary/15 border-primary text-primary"
                  : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
              }`}>
              {m.badge && <span>{m.badge}</span>}
              {m.label}
            </button>
          ))}
        </div>

        {/* Badge do motor */}
        {builtinReady && (model === "tiny" || model === "small") && !transcribing && (
          <div className="flex items-center gap-1 text-[8px] text-primary/70 -mt-1">
            <span className="size-1.5 rounded-full bg-primary/70" />
            Motor nativo ativo — instantâneo
          </div>
        )}

        {/* Progresso de transcrição */}
        {transcribing && txProgress && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-[9px]">
              <span className="text-muted-foreground flex items-center gap-1">
                <Loader2 className="size-2.5 animate-spin" />
                Transcrevendo...
              </span>
              <span className="font-mono text-primary tabular-nums">{txProgress.percent}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500"
                style={{ width: `${txProgress.percent}%` }}
              />
            </div>
            {txProgress.eta !== null && txProgress.eta > 0 && (
              <p className="text-[8px] text-muted-foreground/70 tabular-nums">
                {fmtEta(txProgress.eta)} restantes
              </p>
            )}
            {txProgress.audioDuration > 0 && txProgress.percent < 5 && (
              <p className="text-[8px] text-muted-foreground/60">
                Áudio: {Math.round(txProgress.audioDuration)}s · preparando...
              </p>
            )}
          </div>
        )}

        {/* Botão gerar */}
        <button
          type="button"
          onClick={handleTranscribe}
          disabled={transcribing || !mediaContext}
          className="flex items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2.5 text-xs font-black text-white hover:bg-primary/90 transition disabled:opacity-40 active:scale-[0.98]"
        >
          {transcribing
            ? <><Loader2 className="size-3.5 animate-spin" />Transcrevendo...</>
            : <><Zap className="size-3.5" />Gerar Legendas</>}
        </button>

        {!mediaContext && (
          <p className="text-[9px] text-muted-foreground/70 text-center">
            Selecione um clipe na timeline primeiro.
          </p>
        )}
        {error && (
          <pre className="text-[9px] text-destructive leading-relaxed whitespace-pre-wrap break-words rounded-lg bg-destructive/10 p-2">
            {error}
          </pre>
        )}
      </div>

      {segments.length > 0 && (
        <>
          {/* Toolbar */}
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-muted-foreground flex-1 font-semibold">
              {segments.length} legenda{segments.length !== 1 ? "s" : ""}
            </span>
            <button type="button" title="Corrigir capitalização em todas"
              onClick={() => onSegmentsChange(normalizeAllCaptions(segments))}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-[9px] border border-border text-muted-foreground hover:text-amber-400 hover:border-amber-400/40 transition">
              <Wand2 className="size-3" />Corrigir todas
            </button>
            <button type="button" title="Buscar / substituir"
              onClick={() => setShowSearch(v => !v)}
              className={`grid size-6 place-items-center rounded-lg border transition ${
                showSearch
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}>
              <Search className="size-3" />
            </button>
          </div>

          {/* Busca / substituição */}
          {showSearch && (
            <div className="rounded-xl border border-border bg-card p-2.5 flex flex-col gap-1.5">
              <div className="flex items-center gap-1">
                <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Buscar..."
                  className="flex-1 min-w-0 rounded-lg border border-border bg-background px-2 py-1 text-[10px] text-foreground placeholder:text-muted-foreground/40" />
                {matches.length > 0 && (
                  <span className="shrink-0 text-[8px] text-muted-foreground tabular-nums">
                    {cursor + 1}/{matches.length}
                  </span>
                )}
                <button type="button" onClick={() => navSearch(-1)}
                  className="grid size-6 place-items-center rounded-lg border border-border text-muted-foreground hover:text-foreground">
                  <ChevronUp className="size-3" />
                </button>
                <button type="button" onClick={() => navSearch(1)}
                  className="grid size-6 place-items-center rounded-lg border border-border text-muted-foreground hover:text-foreground">
                  <ChevronDown className="size-3" />
                </button>
                <button type="button" onClick={() => { setSearchQuery(""); setShowSearch(false); }}
                  className="grid size-6 place-items-center rounded-lg border border-border text-muted-foreground hover:text-foreground">
                  <X className="size-3" />
                </button>
              </div>
              <div className="flex items-center gap-1">
                <input value={replaceQuery} onChange={e => setReplaceQuery(e.target.value)}
                  placeholder="Substituir por..."
                  className="flex-1 min-w-0 rounded-lg border border-border bg-background px-2 py-1 text-[10px] text-foreground placeholder:text-muted-foreground/40" />
                <button type="button" disabled={!searchQuery || matches.length === 0}
                  onClick={() => onSegmentsChange(replaceInSegment(segments, matches[cursor], searchQuery, replaceQuery))}
                  className="shrink-0 rounded-lg border border-border px-2 py-1 text-[9px] font-semibold text-muted-foreground hover:text-foreground disabled:opacity-40 transition">
                  Esta
                </button>
                <button type="button" disabled={!searchQuery || matches.length === 0}
                  onClick={() => onSegmentsChange(replaceInAllSegments(segments, searchQuery, replaceQuery))}
                  className="shrink-0 rounded-lg border border-border px-2 py-1 text-[9px] font-semibold text-muted-foreground hover:text-foreground disabled:opacity-40 transition">
                  Todas
                </button>
              </div>
            </div>
          )}

          {/* Lista de segmentos */}
          <div ref={listRef} className="flex flex-col gap-1.5 max-h-[420px] overflow-y-auto pr-0.5">
            {segments.map((seg, idx) => {
              const isActive = idx === activeIdx;
              const isMatch  = matches.includes(idx);
              const isCursor = matches[cursor] === idx && searchQuery.trim().length > 0;
              return (
                <div key={seg.id}
                  className={`rounded-xl border p-2 flex flex-col gap-1.5 transition ${
                    isActive
                      ? "border-primary/50 bg-primary/[0.06]"
                      : isCursor
                        ? "border-amber-500/50 bg-amber-500/[0.06]"
                        : isMatch
                          ? "border-amber-500/25 bg-amber-500/[0.04]"
                          : "border-border/50 bg-card/30 hover:bg-card/60"
                  }`}>
                  {/* Cabeçalho */}
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => onSeek(seg.start)}
                      className="shrink-0 grid size-5 place-items-center rounded-lg bg-primary/10 text-primary hover:bg-primary/25 transition">
                      <Play className="size-2.5" />
                    </button>
                    <span className="text-[7.5px] font-mono text-muted-foreground flex-1">
                      {fmt(seg.start)} → {fmt(seg.end)}
                    </span>
                    <button type="button" title="Corrigir capitalização — só esta"
                      onClick={() => onSegmentsChange(segments.map((s, i) => i === idx ? { ...s, text: normalizeCaptionText(s.text) } : s))}
                      className="grid size-5 place-items-center rounded-lg text-muted-foreground hover:text-amber-400 transition">
                      <Wand2 className="size-2.5" />
                    </button>
                    <button type="button" title="Dividir no playhead"
                      onClick={() => onSegmentsChange(splitSegment(segments, idx, currentTime))}
                      className="grid size-5 place-items-center rounded-lg text-muted-foreground hover:text-blue-400 transition">
                      <Scissors className="size-2.5" />
                    </button>
                    {idx < segments.length - 1 && (
                      <button type="button" title="Juntar com próxima"
                        onClick={() => onSegmentsChange(mergeWithNext(segments, idx))}
                        className="grid size-5 place-items-center rounded-lg text-muted-foreground hover:text-green-400 transition">
                        <MergeIcon className="size-2.5" />
                      </button>
                    )}
                    <button type="button" title="Excluir"
                      onClick={() => onSegmentsChange(deleteSegment(segments, idx))}
                      className="grid size-5 place-items-center rounded-lg text-muted-foreground hover:text-destructive transition">
                      <Trash2 className="size-2.5" />
                    </button>
                  </div>

                  {/* Textarea */}
                  <textarea
                    value={seg.text}
                    onChange={e => onSegmentsChange(updateSegmentText(segments, idx, e.target.value))}
                    rows={2}
                    className="w-full resize-none rounded-lg border border-border/60 bg-background/60 px-2 py-1 text-[10px] text-foreground leading-relaxed placeholder:text-muted-foreground/40 focus:border-primary/60 focus:outline-none focus:bg-background transition"
                  />

                  {/* Ações de texto */}
                  <div className="flex gap-1">
                    <button type="button"
                      onClick={() => onSegmentsChange(segments.map((s, i) => i === idx ? { ...s, text: normalizeCaptionText(s.text) } : s))}
                      className="flex-1 rounded-lg border border-border/50 py-0.5 text-[8.5px] font-semibold text-muted-foreground hover:text-foreground hover:border-border transition">
                      Alterar só esta
                    </button>
                    <button type="button"
                      onClick={() => onSegmentsChange(normalizeAllCaptions(segments))}
                      className="flex-1 rounded-lg border border-border/50 py-0.5 text-[8.5px] font-semibold text-muted-foreground hover:text-amber-400 hover:border-amber-400/40 transition">
                      Alterar todas
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
