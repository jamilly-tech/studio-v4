import { useCallback, useEffect, useRef, useState } from "react";
import { Film, Music2, ImageIcon, Trash2, Scissors, Volume2, Plus, X, Copy } from "lucide-react";
import type { ImportedAsset, TimelineVisualCopy } from "@/types/editor";
import { getTimelineClipDuration, timelinePixelsPerSecond } from "@/utils/timeline";
import { createLocalId } from "@/utils/id";

type Updater<T> = T | ((prev: T) => T);

type TimelineSlot = {
  id: string;
  name: string;
  copies: TimelineVisualCopy[];
};

interface TimelineProps {
  assets: ImportedAsset[];
  visualCopies: TimelineVisualCopy[];
  onSetVisualCopies: (updater: Updater<TimelineVisualCopy[]>) => void;
  selectedAssetId: string | null;
  onSelectAsset: (id: string | null) => void;
  currentTime: number;
  onSeek: (time: number) => void;
  onDropAsset?: (assetId: string, atTime: number) => void;
  onExtractAudioFromClip?: (assetId: string, startTime: number) => void;
  selectedCopyId?: string | null;
  onSelectCopy?: (id: string | null) => void;
}

export function Timeline({
  assets, visualCopies, onSetVisualCopies,
  selectedAssetId, onSelectAsset, currentTime, onSeek, onDropAsset,
  onExtractAudioFromClip, selectedCopyId: selectedCopyIdProp, onSelectCopy,
}: TimelineProps) {
  const [zoom, setZoom] = useState(1);
  const [selectedClipIdLocal, setSelectedClipIdLocal] = useState<string | null>(null);
  const selectedClipId = selectedCopyIdProp !== undefined ? selectedCopyIdProp : selectedClipIdLocal;
  const setSelectedClipId = (id: string | null) => {
    setSelectedClipIdLocal(id);
    onSelectCopy?.(id);
  };
  const [dragState, setDragState] = useState<{ id: string; startX: number; origTime: number } | null>(null);
  const [trimState, setTrimState] = useState<{
    id: string; side: "left" | "right"; startX: number;
    origStartTime: number; origTrimStart: number; origTrimEnd: number; origDuration: number;
  } | null>(null);
  const [dropHighlight, setDropHighlight] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Multi-timeline slots
  const [slots, setSlots] = useState<TimelineSlot[]>([
    { id: "main", name: "Timeline 1", copies: [] },
  ]);
  const [activeSlotId, setActiveSlotId] = useState("main");

  const pxPerSec = timelinePixelsPerSecond * zoom;

  // Agrupar clipes por trackIndex para overlay
  const videoClips = visualCopies.filter((c) => {
    const a = assets.find((x) => x.id === c.assetId);
    return a?.kind === "video" || a?.kind === "image";
  });
  const audioClips = visualCopies.filter((c) => {
    const a = assets.find((x) => x.id === c.assetId);
    return a?.kind === "audio";
  });

  // Tracks por trackIndex explícito (permite overlay manual)
  const videoTrackIndices = new Set(videoClips.map((c) => c.trackIndex ?? 0));
  const audioTrackIndices = new Set(audioClips.map((c) => c.trackIndex ?? 0));

  // Garantir pelo menos track 0
  videoTrackIndices.add(0);
  audioTrackIndices.add(0);

  const videoTrackList = [...videoTrackIndices].sort((a, b) => a - b);
  const audioTrackList = [...audioTrackIndices].sort((a, b) => a - b);

  const totalDuration = visualCopies.reduce((max, c) => {
    const start = c.startTime ?? 0;
    const dur = getTimelineClipDuration(c, assets.find((a) => a.id === c.assetId));
    return Math.max(max, start + dur);
  }, 0);

  // Timeline infinita: sempre 30s de margem extra
  const timelineWidth = Math.max(1200, (totalDuration + 30) * pxPerSec);

  const trackH = 44;

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleRulerClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0);
    const raw = x / pxPerSec;
    const clamped = totalDuration > 0 ? Math.min(totalDuration, raw) : raw;
    onSeek(Math.max(0, clamped));
  }, [pxPerSec, onSeek, totalDuration]);

  const handleDeleteClip = useCallback(() => {
    if (!selectedClipId) return;
    onSetVisualCopies((prev) => prev.filter((c) => c.id !== selectedClipId));
    setSelectedClipId(null);
  }, [selectedClipId, onSetVisualCopies]);

  const handleSplitClip = useCallback(() => {
    if (!selectedClipId) return;
    const clip = visualCopies.find((c) => c.id === selectedClipId);
    if (!clip) return;
    const clipStart = clip.startTime ?? 0;
    const clipDur = clip.duration ?? 5;
    const splitPoint = currentTime - clipStart;
    if (splitPoint <= 0.2 || splitPoint >= clipDur - 0.2) return;

    const left: TimelineVisualCopy = { ...clip, id: createLocalId("clip"), duration: splitPoint, trimEnd: (clip.trimStart ?? 0) + splitPoint };
    const right: TimelineVisualCopy = { ...clip, id: createLocalId("clip"), startTime: clipStart + splitPoint, duration: clipDur - splitPoint, trimStart: (clip.trimStart ?? 0) + splitPoint };
    onSetVisualCopies((prev) => prev.map((c) => (c.id === selectedClipId ? left : c)).concat([right]));
    setSelectedClipId(null);
  }, [selectedClipId, visualCopies, currentTime, onSetVisualCopies]);

  useEffect(() => {
    const handler = () => handleSplitClip();
    window.addEventListener("timeline:split", handler);
    return () => window.removeEventListener("timeline:split", handler);
  }, [handleSplitClip]);

  const handleDuplicateClip = useCallback(() => {
    if (!selectedClipId) return;
    const clip = visualCopies.find((c) => c.id === selectedClipId);
    if (!clip) return;
    const newTrack = (clip.trackIndex ?? 0) + 1;
    const dup: TimelineVisualCopy = { ...clip, id: createLocalId("clip"), trackIndex: newTrack };
    onSetVisualCopies((prev) => [...prev, dup]);
  }, [selectedClipId, visualCopies, onSetVisualCopies]);

  const handleVolumeChange = useCallback((clipId: string, volume: number) => {
    onSetVisualCopies((prev) =>
      prev.map((c) => (c.id === clipId ? { ...c, ...({ volumeDb: volume } as any) } : c))
    );
  }, [onSetVisualCopies]);

  const handleSpeedChange = useCallback((clipId: string, speed: number) => {
    onSetVisualCopies((prev) => prev.map((c) => (c.id === clipId ? { ...c, speed } : c)));
  }, [onSetVisualCopies]);

  const handleOpacityChange = useCallback((clipId: string, opacity: number) => {
    onSetVisualCopies((prev) => prev.map((c) => (c.id === clipId ? { ...c, opacity } : c)));
  }, [onSetVisualCopies]);

  const handleBrightnessChange = useCallback((clipId: string, brightness: number) => {
    onSetVisualCopies((prev) => prev.map((c) => (c.id === clipId ? { ...c, brightness } : c)));
  }, [onSetVisualCopies]);

  const handleDragStart = useCallback((e: React.PointerEvent, clipId: string) => {
    const clip = visualCopies.find((c) => c.id === clipId);
    if (!clip) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragState({ id: clipId, startX: e.clientX, origTime: clip.startTime ?? 0 });
  }, [visualCopies]);

  const handleDragMove = useCallback((e: React.PointerEvent) => {
    if (!dragState) return;
    const dx = e.clientX - dragState.startX;
    const newTime = Math.max(0, Math.round((dragState.origTime + dx / pxPerSec) * 10) / 10);
    onSetVisualCopies((prev) => prev.map((c) => (c.id === dragState.id ? { ...c, startTime: newTime } : c)));
  }, [dragState, pxPerSec, onSetVisualCopies]);

  const handleDragEnd = useCallback(() => setDragState(null), []);

  const MIN_CLIP_SECS = 0.2;

  const handleTrimStart = useCallback((e: React.PointerEvent, clipId: string, side: "left" | "right") => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const clip = visualCopies.find((c) => c.id === clipId);
    if (!clip) return;
    setTrimState({
      id: clipId, side, startX: e.clientX,
      origStartTime: clip.startTime ?? 0,
      origTrimStart: clip.trimStart ?? 0,
      origTrimEnd: clip.trimEnd ?? (clip.duration ?? 5),
      origDuration: clip.duration ?? 5,
    });
  }, [visualCopies]);

  const handleTrimMove = useCallback((e: React.PointerEvent) => {
    if (!trimState) return;
    const deltaX = e.clientX - trimState.startX;
    const deltaT = deltaX / pxPerSec;
    onSetVisualCopies((prev) => prev.map((c) => {
      if (c.id !== trimState.id) return c;
      if (trimState.side === "left") {
        const newStart = Math.max(0, trimState.origStartTime + deltaT);
        const newTrimStart = Math.max(0, trimState.origTrimStart + deltaT);
        const newDur = Math.max(MIN_CLIP_SECS, trimState.origDuration - deltaT);
        return { ...c, startTime: newStart, trimStart: newTrimStart, duration: newDur };
      } else {
        const newDur = Math.max(MIN_CLIP_SECS, trimState.origDuration + deltaT);
        const newTrimEnd = trimState.origTrimStart + newDur;
        return { ...c, duration: newDur, trimEnd: newTrimEnd };
      }
    }));
  }, [trimState, pxPerSec, onSetVisualCopies]);

  const handleTrimEnd = useCallback(() => setTrimState(null), []);

  // Adicionar nova track de vídeo
  const addVideoTrack = useCallback(() => {
    const maxTrack = Math.max(...videoClips.map((c) => c.trackIndex ?? 0), -1);
    // Marca no state que existe essa track (via um clipe fantasma que será removido)
    // Na prática, basta o usuário arrastar um clipe com trackIndex > 0
    // Aqui só expandimos a visualização
    videoTrackList.push(maxTrack + 1);
  }, [videoClips, videoTrackList]);

  const addAudioTrack = useCallback(() => {
    audioTrackList.push(Math.max(...audioClips.map((c) => c.trackIndex ?? 0), -1) + 1);
  }, [audioClips, audioTrackList]);

  // ── Slot management ─────────────────────────────────────────────────────

  function addSlot() {
    const num = slots.length + 1;
    const newSlot: TimelineSlot = { id: createLocalId("slot"), name: `Timeline ${num}`, copies: [] };
    setSlots((prev) => [...prev, newSlot]);
    setActiveSlotId(newSlot.id);
  }

  function removeSlot(slotId: string) {
    if (slots.length <= 1) return;
    setSlots((prev) => prev.filter((s) => s.id !== slotId));
    if (activeSlotId === slotId) setActiveSlotId(slots[0].id === slotId ? slots[1]?.id || "main" : slots[0].id);
  }

  function switchSlot(slotId: string) {
    // Salvar copies atuais no slot ativo
    setSlots((prev) => prev.map((s) => (s.id === activeSlotId ? { ...s, copies: visualCopies } : s)));
    // Carregar copies do novo slot
    const target = slots.find((s) => s.id === slotId);
    if (target) onSetVisualCopies(target.copies);
    setActiveSlotId(slotId);
  }

  const selectedCopy = selectedClipId ? visualCopies.find((c) => c.id === selectedClipId) : null;
  const selectedAsset = selectedCopy ? assets.find((a) => a.id === selectedCopy.assetId) : null;
  const selectedIsVideo = selectedAsset?.kind === "video";
  const selectedVolume = (selectedCopy as any)?.volumeDb ?? 0;
  const selectedSpeed = selectedCopy?.speed ?? 1;
  const selectedOpacity = selectedCopy?.opacity ?? 100;
  const selectedBrightness = selectedCopy?.brightness ?? 100;

  return (
    <section className="flex h-[36%] min-h-[180px] flex-col border-t border-border bg-background">
      {/* Header: tabs + tools */}
      <div className="flex h-8 items-center justify-between border-b border-border px-2">
        <div className="flex items-center gap-0.5 overflow-x-auto">
          {slots.map((slot) => (
            <button
              key={slot.id}
              type="button"
              onClick={() => switchSlot(slot.id)}
              className={`group flex items-center gap-1 rounded-t-md px-2 py-1 text-[10px] font-semibold transition shrink-0 ${
                activeSlotId === slot.id
                  ? "bg-card text-foreground border-x border-t border-border"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {slot.name}
              {slots.length > 1 && (
                <span
                  onClick={(e) => { e.stopPropagation(); removeSlot(slot.id); }}
                  className="invisible ml-0.5 grid size-3.5 place-items-center rounded-full hover:bg-destructive/20 hover:text-destructive group-hover:visible cursor-pointer"
                >
                  <X className="size-2.5" />
                </span>
              )}
            </button>
          ))}
          <button
            type="button"
            onClick={addSlot}
            className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-card hover:text-foreground ml-0.5"
            title="Nova timeline"
          >
            <Plus className="size-3" />
          </button>
          <span className="ml-2 text-[9px] text-muted-foreground">
            {visualCopies.length} clipe{visualCopies.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {selectedClipId && (
            <>
              <div className="flex items-center gap-0.5">
                <Volume2 className="size-3 text-muted-foreground" />
                <input type="range" min={-20} max={12} step={1} value={selectedVolume}
                  onChange={(e) => handleVolumeChange(selectedClipId, Number(e.target.value))}
                  className="h-1 w-14 accent-primary" title={`${selectedVolume}dB`} />
                <span className="text-[7px] text-muted-foreground w-6 text-right tabular-nums font-mono">{selectedVolume > 0 ? "+" : ""}{selectedVolume}</span>
              </div>
              <div className="h-4 w-px bg-border" />
              <button type="button" onClick={handleDuplicateClip} className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-card hover:text-foreground" title="Duplicar em nova track (overlay)">
                <Copy className="size-3" />
              </button>
              <button type="button" onClick={handleSplitClip} className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-card hover:text-foreground" title="Dividir">
                <Scissors className="size-3" />
              </button>
              <button type="button" onClick={handleDeleteClip} className="grid size-5 place-items-center rounded text-destructive hover:bg-destructive/10" title="Remover">
                <Trash2 className="size-3" />
              </button>
              <div className="h-4 w-px bg-border" />
              {selectedIsVideo && onExtractAudioFromClip && selectedCopy && (
                <button
                  type="button"
                  onClick={() => onExtractAudioFromClip(selectedCopy.assetId, selectedCopy.startTime ?? 0)}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground hover:bg-card hover:text-green-400 transition"
                  title="Extrair áudio e adicionar na faixa de áudio"
                >
                  <Music2 className="size-3" />
                  Extrair áudio
                </button>
              )}
            </>
          )}
          <div className="flex items-center gap-0.5">
            <button type="button" onClick={() => setZoom(Math.max(0.25, zoom - 0.25))} className="rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:bg-card">-</button>
            <span className="text-[8px] text-muted-foreground w-7 text-center tabular-nums font-mono">{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={() => setZoom(Math.min(4, zoom + 0.25))} className="rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:bg-card">+</button>
            <button
              type="button"
              onClick={() => {
                if (!totalDuration || !scrollRef.current) return;
                const trackLabelW = 56;
                const containerW = scrollRef.current.clientWidth - trackLabelW;
                const fit = containerW / totalDuration / timelinePixelsPerSecond;
                setZoom(Math.max(0.05, Math.min(4, fit)));
              }}
              className="rounded px-1 py-0.5 text-[9px] text-muted-foreground hover:bg-card ml-0.5"
              title="Ajustar zoom para ver todo o vídeo"
            >
              Fit
            </button>
          </div>
        </div>
      </div>

      {/* Clip property bar — só quando um clipe está selecionado */}
      {selectedClipId && (
        <div className="flex h-7 items-center gap-3 border-b border-border bg-card/40 px-2 shrink-0">
          <span className="text-[8px] font-bold text-muted-foreground uppercase tracking-wider shrink-0">Camada</span>
          {/* Speed */}
          <div className="flex items-center gap-0.5">
            <span className="text-[8px] text-muted-foreground w-6">Vel</span>
            <input
              type="range" min={0.25} max={2} step={0.25} value={selectedSpeed}
              onChange={(e) => handleSpeedChange(selectedClipId, Number(e.target.value))}
              className="h-1 w-12 accent-primary" title={`${selectedSpeed}x`}
            />
            <span className="text-[7px] text-muted-foreground w-5 tabular-nums font-mono">{selectedSpeed}x</span>
          </div>
          <div className="h-3.5 w-px bg-border" />
          {/* Opacity */}
          <div className="flex items-center gap-0.5">
            <span className="text-[8px] text-muted-foreground w-6">Opa</span>
            <input
              type="range" min={0} max={100} step={5} value={selectedOpacity}
              onChange={(e) => handleOpacityChange(selectedClipId, Number(e.target.value))}
              className="h-1 w-12 accent-primary" title={`${selectedOpacity}%`}
            />
            <span className="text-[7px] text-muted-foreground w-5 tabular-nums font-mono">{selectedOpacity}%</span>
          </div>
          <div className="h-3.5 w-px bg-border" />
          {/* Brightness */}
          <div className="flex items-center gap-0.5">
            <span className="text-[8px] text-muted-foreground w-7">Brilho</span>
            <input
              type="range" min={50} max={150} step={5} value={selectedBrightness}
              onChange={(e) => handleBrightnessChange(selectedClipId, Number(e.target.value))}
              className="h-1 w-12 accent-primary" title={`${selectedBrightness}%`}
            />
            <span className="text-[7px] text-muted-foreground w-7 tabular-nums font-mono">{selectedBrightness}%</span>
          </div>
        </div>
      )}

      {/* Body */}
      <div
        ref={scrollRef}
        className={`relative flex-1 overflow-auto transition-colors ${dropHighlight ? "bg-primary/5 outline outline-1 outline-primary/30" : ""}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("text/plain")) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            setDropHighlight(true);
          }
        }}
        onDragLeave={() => setDropHighlight(false)}
        onDrop={(e) => {
          setDropHighlight(false);
          const data = e.dataTransfer.getData("text/plain");
          if (!data.startsWith("asset:") || !onDropAsset) return;
          e.preventDefault();
          const assetId = data.slice(6);
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left + e.currentTarget.scrollLeft - 56;
          const time = Math.max(0, x / pxPerSec);
          onDropAsset(assetId, time);
        }}
      >
        {/* Ruler */}
        <div
          className="sticky top-0 z-10 h-5 border-b border-border bg-card/80 backdrop-blur-sm cursor-pointer"
          style={{ width: timelineWidth }}
          onClick={handleRulerClick}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            const rect = e.currentTarget.getBoundingClientRect();
            const scroll = scrollRef.current?.scrollLeft ?? 0;
            onSeek(Math.max(0, (e.clientX - rect.left + scroll) / pxPerSec));
          }}
          onPointerMove={(e) => {
            if (e.buttons !== 1) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const scroll = scrollRef.current?.scrollLeft ?? 0;
            onSeek(Math.max(0, (e.clientX - rect.left + scroll) / pxPerSec));
          }}
        >
          {Array.from({ length: Math.ceil((totalDuration + 30)) }, (_, i) => (
            <div key={i} className="absolute top-0 h-full border-l border-border/30" style={{ left: i * pxPerSec }}>
              {i % 5 === 0 && (
                <span className="ml-1 text-[8px] text-muted-foreground/50 font-mono">
                  {Math.floor(i / 60)}:{String(i % 60).padStart(2, "0")}
                </span>
              )}
            </div>
          ))}
        </div>

        <div className="relative" style={{ width: timelineWidth }}>
          {/* Video tracks */}
          {videoTrackList.map((trackIdx, vi) => (
            <div key={`vt-${trackIdx}`} className="relative border-b border-border/15" style={{ height: trackH }}>
              {vi === 0 && (
                <div className="absolute left-0 top-0 w-14 z-10 flex flex-col items-center justify-center gap-0.5 bg-background border-r border-border"
                  style={{ height: videoTrackList.length * trackH }}>
                  <Film className="size-3 text-muted-foreground" />
                  <span className="text-[7px] font-bold text-muted-foreground/60">V{videoTrackList.length > 1 ? "" : ""}</span>
                  <button type="button" onClick={() => {/* add video track just expands */}} className="mt-0.5 grid size-3.5 place-items-center rounded text-muted-foreground/40 hover:text-foreground" title="Adicionar track">
                    <Plus className="size-2.5" />
                  </button>
                </div>
              )}
              <div className="ml-14 relative h-full">
                {vi > 0 && (
                  <div className="absolute left-0 top-0 text-[6px] text-muted-foreground/30 font-mono px-1">V{trackIdx + 1}</div>
                )}
                {videoClips
                  .filter((c) => (c.trackIndex ?? 0) === trackIdx)
                  .map((copy) => renderVideoClip(copy, assets, pxPerSec, trackH, selectedClipId, setSelectedClipId, onSelectAsset, handleDragStart, handleDragMove, handleDragEnd, handleTrimStart, handleTrimMove, handleTrimEnd))}
              </div>
            </div>
          ))}

          {/* Audio tracks */}
          {audioTrackList.map((trackIdx, ai) => (
            <div key={`at-${trackIdx}`} className="relative border-b border-border/15" style={{ height: trackH }}>
              {ai === 0 && (
                <div className="absolute left-0 top-0 w-14 z-10 flex flex-col items-center justify-center gap-0.5 bg-background border-r border-border"
                  style={{ height: audioTrackList.length * trackH }}>
                  <Music2 className="size-3 text-green-500/60" />
                  <span className="text-[7px] font-bold text-muted-foreground/60">A</span>
                  <button type="button" className="mt-0.5 grid size-3.5 place-items-center rounded text-muted-foreground/40 hover:text-foreground" title="Adicionar track">
                    <Plus className="size-2.5" />
                  </button>
                </div>
              )}
              <div className="ml-14 relative h-full">
                {ai > 0 && (
                  <div className="absolute left-0 top-0 text-[6px] text-muted-foreground/30 font-mono px-1">A{trackIdx + 1}</div>
                )}
                {audioClips
                  .filter((c) => (c.trackIndex ?? 0) === trackIdx)
                  .map((copy) => renderAudioClip(copy, assets, pxPerSec, trackH, selectedClipId, setSelectedClipId, onSelectAsset, handleDragStart, handleDragMove, handleDragEnd, handleTrimStart, handleTrimMove, handleTrimEnd))}
              </div>
            </div>
          ))}

          {/* Playhead */}
          <div
            className="absolute top-0 bottom-0 z-20 w-px bg-primary pointer-events-none"
            style={{ left: 56 + currentTime * pxPerSec }}
          >
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2.5 h-3 bg-primary rounded-b-sm" />
          </div>
        </div>

        {visualCopies.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-[11px] text-muted-foreground/60">
              Arraste um arquivo da biblioteca ou clique duplo para adicionar
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

// ── Render helpers ────────────────────────────────────────────────────────

function renderVideoClip(
  copy: TimelineVisualCopy, assets: ImportedAsset[], pxPerSec: number, trackH: number,
  selectedClipId: string | null, setSelectedClipId: (id: string) => void,
  onSelectAsset: (id: string) => void,
  onDragStart: (e: React.PointerEvent, id: string) => void,
  onDragMove: (e: React.PointerEvent) => void,
  onDragEnd: () => void,
  onTrimStart: (e: React.PointerEvent, id: string, side: "left" | "right") => void,
  onTrimMove: (e: React.PointerEvent) => void,
  onTrimEnd: () => void,
) {
  const asset = assets.find((a) => a.id === copy.assetId);
  const duration = getTimelineClipDuration(copy, asset);
  const width = Math.max(40, duration * pxPerSec);
  const left = (copy.startTime ?? 0) * pxPerSec;
  const isSelected = selectedClipId === copy.id;
  const vol = (copy as any).volumeDb ?? 0;
  const h = trackH - 6;

  return (
    <div
      key={copy.id}
      className={`absolute top-[3px] rounded overflow-hidden cursor-grab active:cursor-grabbing transition-shadow ${
        isSelected ? "ring-2 ring-primary shadow-lg z-10" : "hover:ring-1 hover:ring-primary/40"
      }`}
      style={{ left, width, height: h }}
      onClick={(e) => { e.stopPropagation(); setSelectedClipId(copy.id); onSelectAsset(copy.assetId); }}
      onPointerDown={(e) => onDragStart(e, copy.id)}
      onPointerMove={onDragMove}
      onPointerUp={onDragEnd}
    >
      <div className="absolute inset-0 flex bg-primary/15">
        {asset?.thumbnailUrl
          ? Array.from({ length: Math.max(1, Math.ceil(width / 50)) }, (_, i) => (
              <img key={i} src={asset.thumbnailUrl!} className="h-full w-[50px] shrink-0 object-cover opacity-40" alt="" />
            ))
          : <div className="h-full w-full bg-primary/10" />
        }
      </div>
      {asset?.waveformPeaks && asset.waveformPeaks.length > 0 && (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute bottom-0 left-0 w-full h-[38%] opacity-55">
          <path d={buildWavePath(asset.waveformPeaks)} fill="rgba(255,255,255,0.25)" />
        </svg>
      )}
      {vol !== 0 && (
        <div className="absolute top-0.5 right-0.5 rounded bg-black/80 px-0.5 py-px">
          <span className="text-[6px] text-white font-mono">{vol > 0 ? "+" : ""}{vol}</span>
        </div>
      )}
      <div className="absolute top-0.5 left-0.5 rounded bg-black/80 px-0.5 py-px">
        <span className="text-[6px] text-white font-mono">{fmtDur(duration)}</span>
      </div>
      <div className="absolute inset-x-0 bottom-0 flex items-end px-1 pb-0.5 pt-4 bg-gradient-to-t from-black/70 to-transparent">
        <span className="truncate text-[8px] font-semibold text-white">
          {asset?.displayName || "Clipe"}
        </span>
      </div>
      {/* Trim handles */}
      <div
        className="absolute left-0 top-0 h-full w-2 cursor-col-resize bg-white/5 hover:bg-primary/60 transition z-20"
        onPointerDown={(e) => onTrimStart(e, copy.id, "left")}
        onPointerMove={onTrimMove}
        onPointerUp={onTrimEnd}
      />
      <div
        className="absolute right-0 top-0 h-full w-2 cursor-col-resize bg-white/5 hover:bg-primary/60 transition z-20"
        onPointerDown={(e) => onTrimStart(e, copy.id, "right")}
        onPointerMove={onTrimMove}
        onPointerUp={onTrimEnd}
      />
    </div>
  );
}

function renderAudioClip(
  copy: TimelineVisualCopy, assets: ImportedAsset[], pxPerSec: number, trackH: number,
  selectedClipId: string | null, setSelectedClipId: (id: string) => void,
  onSelectAsset: (id: string) => void,
  onDragStart: (e: React.PointerEvent, id: string) => void,
  onDragMove: (e: React.PointerEvent) => void,
  onDragEnd: () => void,
  onTrimStart: (e: React.PointerEvent, id: string, side: "left" | "right") => void,
  onTrimMove: (e: React.PointerEvent) => void,
  onTrimEnd: () => void,
) {
  const asset = assets.find((a) => a.id === copy.assetId);
  const duration = getTimelineClipDuration(copy, asset);
  const width = Math.max(40, duration * pxPerSec);
  const left = (copy.startTime ?? 0) * pxPerSec;
  const isSelected = selectedClipId === copy.id;
  const vol = (copy as any).volumeDb ?? 0;
  const h = trackH - 6;

  return (
    <div
      key={copy.id}
      className={`absolute top-[3px] rounded overflow-hidden cursor-grab active:cursor-grabbing ${
        isSelected ? "ring-2 ring-green-400 z-10" : "hover:ring-1 hover:ring-green-400/40"
      }`}
      style={{ left, width, height: h }}
      onClick={(e) => { e.stopPropagation(); setSelectedClipId(copy.id); onSelectAsset(copy.assetId); }}
      onPointerDown={(e) => onDragStart(e, copy.id)}
      onPointerMove={onDragMove}
      onPointerUp={onDragEnd}
    >
      <div className="absolute inset-0 bg-green-500/10">
        {asset?.waveformPeaks && asset.waveformPeaks.length > 0 ? (
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
            <path d={buildWavePath(asset.waveformPeaks)} fill="rgba(74,222,128,0.45)" />
            <line x1="0" y1="50" x2="100" y2="50" stroke="rgba(74,222,128,0.2)" strokeWidth="0.5" />
          </svg>
        ) : (
          <div className="flex h-full items-center justify-center">
            <Music2 className="size-3 text-green-400/25" />
          </div>
        )}
      </div>
      <div className="absolute top-0.5 left-0.5 rounded bg-black/80 px-0.5 py-px">
        <span className="text-[6px] text-green-100 font-mono">{fmtDur(duration)}</span>
      </div>
      {vol !== 0 && (
        <div className="absolute top-0.5 right-0.5 rounded bg-black/80 px-0.5 py-px">
          <span className="text-[6px] text-green-100 font-mono">{vol > 0 ? "+" : ""}{vol}</span>
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-end px-1 pb-0.5 pt-4 bg-gradient-to-t from-black/70 to-transparent">
        <span className="truncate text-[8px] font-semibold text-green-100">
          {asset?.displayName || "Audio"}
        </span>
      </div>
      {/* Trim handles */}
      <div
        className="absolute left-0 top-0 h-full w-2 cursor-col-resize bg-white/5 hover:bg-green-400/60 transition z-20"
        onPointerDown={(e) => onTrimStart(e, copy.id, "left")}
        onPointerMove={onTrimMove}
        onPointerUp={onTrimEnd}
      />
      <div
        className="absolute right-0 top-0 h-full w-2 cursor-col-resize bg-white/5 hover:bg-green-400/60 transition z-20"
        onPointerDown={(e) => onTrimStart(e, copy.id, "right")}
        onPointerMove={onTrimMove}
        onPointerUp={onTrimEnd}
      />
    </div>
  );
}

function buildWavePath(peaks: number[]): string {
  if (!peaks || peaks.length < 2) return "M 0,50 L 100,50";
  const n = peaks.length;
  const cx = (i: number) => ((i / (n - 1)) * 100).toFixed(2);
  const topPts = peaks.map((p, i) => `${cx(i)},${(50 - p * 44).toFixed(1)}`).join(" L ");
  const botPts = [...peaks].reverse().map((p, i) => `${cx(n - 1 - i)},${(50 + p * 44).toFixed(1)}`).join(" L ");
  return `M ${topPts} L ${botPts} Z`;
}

function fmtDur(s: number): string {
  if (!s || !Number.isFinite(s)) return "0s";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m === 0 ? `${sec}s` : `${m}:${String(sec).padStart(2, "0")}`;
}
