import { useState } from "react";
import { Captions, Loader2, Play, Copy, Check } from "lucide-react";
import type { ImportedAsset, TranscriptSegment } from "@/types/editor";

const LANGUAGES = [
  { id: "pt", label: "Portugues", flag: "BR" },
  { id: "en", label: "English", flag: "EN" },
  { id: "es", label: "Espanol", flag: "ES" },
  { id: "auto", label: "Auto", flag: "??" },
] as const;

type LangId = typeof LANGUAGES[number]["id"];

interface TranscriptionPanelProps {
  assets: ImportedAsset[];
  selectedAssetId: string | null;
  onSeek: (time: number) => void;
  onCaptionsGenerated: (segments: TranscriptSegment[]) => void;
}

export function TranscriptionPanel({ assets, selectedAssetId, onSeek, onCaptionsGenerated }: TranscriptionPanelProps) {
  const [language, setLanguage] = useState<LangId>("pt");
  const [transcribing, setTranscribing] = useState(false);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [transcribedAssetId, setTranscribedAssetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

      {segments.length > 0 && transcribedAssetId === selectedAssetId && (
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

          <div className="max-h-[300px] overflow-y-auto rounded-lg border border-border">
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
                  <p className="mt-0.5 text-[8px] font-mono text-muted-foreground/50">
                    {formatTime(seg.start)} — {formatTime(seg.end)}
                  </p>
                </div>
              </div>
            ))}
          </div>
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
