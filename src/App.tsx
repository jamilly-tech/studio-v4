import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import { useAssetsStore } from "@/stores/assets.store";
import { useTimelineStore } from "@/stores/timeline.store";
import { formatPresets } from "@/stores/format.store";
import { EditorShell } from "@/components/editor/EditorShell";
import { TopBar } from "@/components/editor/TopBar";
import { HomeScreen } from "@/components/home/HomeScreen";
import { Timeline } from "@/components/editor/Timeline";
import { CleanCutPanel } from "@/components/editor/CleanCutPanel";
import { AudioToolsPanel } from "@/components/editor/AudioToolsPanel";
import { DrivePanel } from "@/components/editor/DrivePanel";
import { CaptionEditorPanel } from "@/components/editor/CaptionEditorPanel";
import { PresetsPanel } from "@/components/editor/PresetsPanel";
import { EffectsPanel } from "@/components/editor/EffectsPanel";
import { formatFileSize } from "@/utils/format";
import { createLocalId } from "@/utils/id";
import { serializeCaptionsToSRT } from "@/utils/captions";
import { createTimelineCopyForAsset, minimumTimelineClipSeconds, timelinePixelsPerSecond } from "@/utils/timeline";
import { resolveAtTime, getTimelineDuration, sourceTimeToTimeline } from "@/utils/playback";
import type { CleanCutPause } from "@/utils/audio";
import type {
  AppScreen, CaptionSegment, DialogId, FormatPreset, GoogleDriveProfile,
  ImportedAsset, PreviewQualityId, RecentVideoProject,
  ThemeMode, ToolId, TimelineVisualCopy,
} from "@/types/editor";
import type { MenuCommand } from "@/components/editor/MenuColumn";
import type { MediaProgressEvent } from "@/types/electron";
import {
  Film, Upload, Plus, Play, Pause, SkipBack, SkipForward,
  Volume2, VolumeX, Music2, ImageIcon, Type, Scissors,
  Wand2, Captions, SlidersHorizontal, Cloud, Layers, Settings,
  Smartphone, Monitor, Square, RectangleHorizontal, Circle,
  Move, Crop, Eraser, PenTool, ChevronDown, SplitSquareVertical, Stamp, X,
} from "lucide-react";

type PreviewToolId = "move" | "crop" | "chroma" | "mask-rect" | "mask-circle" | "mask-pen" | "remove-wm" | null;

const PRESET_FILTERS: Record<string, string> = {
  "ae-glow":      "brightness(1.1) contrast(0.9) saturate(1.2)",
  "ae-cinematic": "contrast(1.3) saturate(0.8) brightness(0.95)",
  "pr-smooth":    "saturate(1.1) brightness(1.02)",
  "pr-film":      "sepia(0.3) contrast(1.15) saturate(0.9)",
  "dv-teal":      "saturate(1.4) hue-rotate(15deg)",
  "dv-bw":        "grayscale(1) contrast(1.2)",
  "dv-vintage":   "sepia(0.4) saturate(1.2) brightness(0.95)",
  "lut-rec709":   "contrast(1.05) saturate(1.0)",
  "lut-slog":     "contrast(1.2) saturate(1.3) brightness(1.05)",
  "lut-warm":     "sepia(0.2) saturate(1.3) brightness(1.05)",
  "lut-cold":     "saturate(0.9) hue-rotate(200deg) brightness(1.05)",
  "lut-skin":     "saturate(1.1) contrast(1.05) brightness(1.02)",
  "cc-vlog":      "saturate(0.95) brightness(1.05) contrast(0.97)",
  "cc-retro":     "sepia(0.5) contrast(1.1) hue-rotate(10deg)",
  "sv-shake":     "contrast(1.1) saturate(1.1)",
  "sv-color":     "contrast(1.2) saturate(1.1) brightness(1.02)",
};

const FORMAT_ICONS: Record<string, React.ReactNode> = {
  reels: <Smartphone className="size-3.5" />,
  tiktok: <Smartphone className="size-3.5" />,
  youtube: <Monitor className="size-3.5" />,
  feed: <Square className="size-3.5" />,
  story: <Smartphone className="size-3.5" />,
  wide: <Monitor className="size-3.5" />,
};

const sidebarTools: { id: ToolId; label: string; icon: typeof Film }[] = [
  { id: "media", label: "Midia", icon: Film },
  { id: "audio", label: "Audio", icon: Music2 },
  { id: "presets", label: "Presets", icon: Layers },
  { id: "text", label: "Texto", icon: Type },
  { id: "captions", label: "Legendas", icon: Captions },
  { id: "effects", label: "Efeitos", icon: Wand2 },
  { id: "ai", label: "Corte", icon: Scissors },
  { id: "settings", label: "Config", icon: Settings },
];

export function App() {
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [screen, setScreen] = useState<AppScreen>("home");
  const [dialog, setDialog] = useState<DialogId>(null);
  const [projectName, setProjectName] = useState("Studio V4 001");
  const [activeTool, setActiveTool] = useState<ToolId>("media");
  const [activeFormat, setActiveFormat] = useState<FormatPreset>(formatPresets[0]);
  const [recentVideos, setRecentVideos] = useState<RecentVideoProject[]>([]);
  const [googleProfile, setGoogleProfile] = useState<GoogleDriveProfile | null>(null);
  const [driveConnected, setDriveConnected] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<Record<string, { stage: string; percent: number; error?: string }>>({});
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [dropHighlight, setDropHighlight] = useState(false);
  const [captionSegments, setCaptionSegments] = useState<CaptionSegment[]>([]);
  const [activeEffect, setActiveEffect] = useState<string | null>(null);
  const [activeEffectCss, setActiveEffectCss] = useState<string>("none");
  const [formatOpen, setFormatOpen] = useState(false);
  const [previewTool, setPreviewTool] = useState<PreviewToolId>(null);
  const [splitScreen, setSplitScreen] = useState(false);
  const [videoTransform, setVideoTransform] = useState({ x: 0, y: 0, scale: 100 });
  const CAPTION_SAFE_ZONE: Record<string, number> = {
    reels: 32, tiktok: 32, story: 22, youtube: 12, wide: 12, feed: 10,
  };
  const [captionY, setCaptionY] = useState(32);
  const [captionFont, setCaptionFont] = useState("Arial");
  const [captionFontSize, setCaptionFontSize] = useState(9);
  const [captionBold, setCaptionBold] = useState(true);
  const [captionItalic, setCaptionItalic] = useState(false);
  const [captionColor, setCaptionColor] = useState("#ffffff");
  const [captionBgColor, setCaptionBgColor] = useState("#000000");
  const [captionBgOpacity, setCaptionBgOpacity] = useState(80);
  const [captionShadow, setCaptionShadow] = useState(false);
  const [captionOutline, setCaptionOutline] = useState(false);
  const [selectedCopyId, setSelectedCopyId] = useState<string | null>(null);
  const [whisperModel, setWhisperModel] = useState("small");
  const [wmRegion, setWmRegion] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [wmRemoving, setWmRemoving] = useState(false);
  const [wmProgress, setWmProgress] = useState(0);
  const [exportResolution, setExportResolution] = useState<"720p" | "1080p">("1080p");
  const [exportFormat, setExportFormat] = useState<"v4" | "mp4" | "mov" | "gif" | "mp3" | "wav">("mp4");
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<{ id: string; msg: string; type: "error" | "info" | "ok" }[]>([]);

  const addToast = useCallback((msg: string, type: "error" | "info" | "ok" = "info") => {
    const id = Date.now().toString() + Math.random();
    setToasts((prev) => [...prev.slice(-4), { id, msg, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }, []);

  const videoRef = useRef<HTMLVideoElement>(null);
  const dragCounterRef = useRef(0);

  const { assets, setAssets, addAssets, selectedAssetId, setSelectedAssetId, updateAsset } = useAssetsStore();
  const { visualCopies, setVisualCopies, undo, redo, clear: timelineClear } = useTimelineStore();

  // ── Clean Cut: aplica cortes na timeline ─────────────────────────────────
  const handleApplyCuts = useCallback((assetId: string, cuts: CleanCutPause[], totalDuration: number) => {
    const asset = assets.find((a) => a.id === assetId);
    if (!asset) return;

    const baseClip = createTimelineCopyForAsset(asset, 0);
    const segments: TimelineVisualCopy[] = [];
    let cursor = 0;
    const orderedCuts = [...cuts].filter((c) => c.action === "cut").sort((a, b) => a.startTime - b.startTime);

    for (const cut of orderedCuts) {
      const duration = cut.startTime - cursor;
      if (duration >= minimumTimelineClipSeconds) {
        segments.push({
          ...baseClip,
          id: createLocalId("clip"),
          startTime: cursor,
          duration,
          trimStart: cursor,
          trimEnd: cut.startTime,
          widthPx: Math.round(duration * timelinePixelsPerSecond),
          analysisTag: "clean-cut",
          note: `Mantido antes de ${cut.label}`,
        });
      }
      cursor = Math.max(cursor, cut.endTime);
    }

    const tail = totalDuration - cursor;
    if (tail >= minimumTimelineClipSeconds) {
      segments.push({
        ...baseClip,
        id: createLocalId("clip"),
        startTime: cursor,
        duration: tail,
        trimStart: cursor,
        trimEnd: totalDuration,
        widthPx: Math.round(tail * timelinePixelsPerSecond),
        analysisTag: "clean-cut",
        note: "Trecho limpo final",
      });
    }

    let timeOffset = 0;
    const repositioned = segments.map((seg) => {
      const s = { ...seg, startTime: timeOffset };
      timeOffset += seg.duration ?? 0;
      return s;
    });

    setVisualCopies(repositioned);
  }, [assets, setVisualCopies]);

  // ── Drive: snapshot do projeto ───────────────────────────────────────────
  const getProjectSnapshot = useCallback(() => ({
    projectName,
    assets: assets.map((a) => ({ ...a, file: undefined })),
    visualCopies,
    captionSegments,
  }), [projectName, assets, visualCopies, captionSegments]);

  // Contexto de mídia ativo para transcrição (clipe selecionado ou asset selecionado)
  const activeMediaContext = useMemo(() => {
    const copy = selectedCopyId ? visualCopies.find(c => c.id === selectedCopyId) : null;
    const asset = copy
      ? assets.find(a => a.id === copy.assetId)
      : selectedAssetId ? assets.find(a => a.id === selectedAssetId) : null;
    if (!asset?.filePath) return null;
    if (asset.kind !== "video" && asset.kind !== "audio") return null;
    const trimStart = copy?.trimStart ?? 0;
    const trimEnd = copy?.trimEnd ?? (asset.metadata?.durationSeconds ?? 0);
    return {
      filePath: asset.filePath,
      trimStart,
      duration: Math.max(0.1, trimEnd - trimStart),
    };
  }, [selectedCopyId, selectedAssetId, visualCopies, assets]);

  const handleLoadProject = useCallback(async (snapshot: unknown) => {
    const data = snapshot as any;
    if (data.projectName) setProjectName(data.projectName);
    if (data.visualCopies) setVisualCopies(data.visualCopies);
    if (data.captionSegments) setCaptionSegments(
      (data.captionSegments as CaptionSegment[]).map(s => ({
        ...s,
        id: s.id || createLocalId("cap"),
      }))
    );

    if (data.assets && Array.isArray(data.assets)) {
      // Re-registra caminhos no proxy do servidor local e reconstrói URLs
      const restored = await Promise.all(
        (data.assets as ImportedAsset[]).map(async (a) => {
          if (!a.filePath) return a;
          const reg = await window.studioV4?.media?.registerProxy?.(a.filePath);
          if (reg?.url) return { ...a, url: reg.url, previewUrl: reg.url };
          return a;
        })
      );
      setAssets(restored);

      // Atualiza projetos recentes
      if (data.projectName) {
        const entry = {
          id: createLocalId("proj"),
          projectName: data.projectName,
          name: data.projectName,
          meta: new Date().toLocaleDateString("pt-BR"),
          updatedAt: new Date().toISOString(),
        };
        const prev = ((await window.studioV4?.readRecentProjects?.()) as any[] ?? [])
          .filter((r: any) => (r.projectName || r.name) !== data.projectName)
          .slice(0, 9);
        const recent = [entry, ...prev];
        window.studioV4?.writeRecentProjects?.(recent);
        setRecentVideos(recent);
      }
    }
  }, [setAssets, setVisualCopies]);

  useEffect(() => {
    if (!window.studioV4?.media?.onProgress) return;
    return window.studioV4.media.onProgress((data: MediaProgressEvent) => {
      setImportProgress((prev) => ({ ...prev, [data.filePath]: { stage: data.stage, percent: data.percent, error: data.error } }));
      if (data.stage === "proxy-done" && data.proxyUrl) {
        const asset = useAssetsStore.getState().assets.find((a) => a.filePath === data.filePath);
        if (asset) useAssetsStore.getState().updateAsset(asset.id, { url: data.proxyUrl, previewUrl: data.proxyUrl });
      }
      if (data.stage === "proxy-error" && data.error) {
        const asset = useAssetsStore.getState().assets.find((a) => a.filePath === data.filePath);
        if (asset) useAssetsStore.getState().updateAsset(asset.id, { error: data.error });
        addToast(data.error, "info");
      }
      if (data.stage === "waveform-done" && data.waveformPeaks) {
        const asset = useAssetsStore.getState().assets.find((a) => a.filePath === data.filePath);
        if (asset) useAssetsStore.getState().updateAsset(asset.id, { waveformPeaks: data.waveformPeaks });
      }
    });
  }, []);

  useEffect(() => {
    window.studioV4?.readRecentProjects?.().then((raw) => {
      if (!Array.isArray(raw)) return;
      // Normaliza tanto o schema antigo {name,date} quanto o novo {projectName,updatedAt}
      const normalized: RecentVideoProject[] = (raw as any[]).map((r, i) => ({
        id: r.id || r.date || String(i),
        name: r.projectName || r.name || "Projeto",
        projectName: r.projectName || r.name || "Projeto",
        meta: r.meta || (r.date ? new Date(r.date).toLocaleDateString("pt-BR") : ""),
        updatedAt: r.updatedAt || r.date || "",
        filePath: r.filePath,
      }));
      setRecentVideos(normalized);
    });
  }, []);

  useEffect(() => {
    if (!window.studioV4?.onExportProgress) return;
    return window.studioV4.onExportProgress((data: { percent: number; outputPath?: string }) => {
      setExportProgress(data.percent);
    });
  }, []);

  useEffect(() => {
    setCaptionY(CAPTION_SAFE_ZONE[activeFormat.id] ?? 12);
  }, [activeFormat.id]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
      if (e.key === " " && !["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault();
        setIsPlaying((p) => !p);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [undo, redo]);

  // Aplica velocidade de reprodução do clipe ativo
  useEffect(() => {
    if (!videoRef.current) return;
    const activeClip = visualCopies.find(c => {
      const s = c.startTime ?? 0;
      const d = c.duration ?? 5;
      return currentTime >= s && currentTime <= s + d;
    });
    const speed = activeClip?.speed ?? 1;
    videoRef.current.playbackRate = Math.max(0.1, Math.min(16, speed));
  }, [currentTime, visualCopies]);

  const ingestFiles = useCallback(async (filePaths: string[]) => {
    if (!window.studioV4?.media?.ingest) return;
    setImporting(true);

    for (const filePath of filePaths) {
      try {
        const result = await window.studioV4.media.ingest(filePath);
        if (result.error) {
          console.error(`Ingest error for ${filePath}:`, result.error);
          addToast(`Erro ao importar ${result.fileName || filePath}: ${result.error}`, "error");
          continue;
        }

        const asset: ImportedAsset = {
          id: createLocalId("asset"),
          name: result.fileName,
          displayName: result.fileName.replace(/\.[^.]+$/, ""),
          kind: result.kind as ImportedAsset["kind"],
          size: formatFileSize(result.metadata.fileSize),
          url: result.proxyUrl || result.convertedUrl || "",
          previewUrl: result.proxyUrl || result.convertedUrl || undefined,
          filePath: result.filePath,
          thumbnailUrl: result.thumbnailUrl || undefined,
          waveformPeaks: result.waveformPeaks || undefined,
          metadata: {
            duration: formatDuration(result.metadata.duration),
            durationSeconds: result.metadata.duration,
            resolution: result.metadata.video ? `${result.metadata.video.width}x${result.metadata.video.height}` : undefined,
            fps: result.metadata.video ? `${result.metadata.video.fps}` : undefined,
            codec: result.metadata.video?.codec || result.metadata.audio?.codec || undefined,
          },
          status: "ready",
        };

        addAssets([asset]);
      } catch (err: any) {
        const msg = err?.message || String(err);
        console.error(`Failed to ingest ${filePath}:`, err);
        addToast(`Falha ao importar: ${msg}`, "error");
      }
    }

    setImporting(false);
    setImportProgress({});
  }, [addAssets]);

  const handleImport = useCallback(async () => {
    const paths = await window.studioV4?.openFileDialog?.();
    if (paths && paths.length > 0) await ingestFiles(paths);
  }, [ingestFiles]);

  const handleDrop = useCallback((e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setDropHighlight(false);

    const text = e.dataTransfer.getData("text/plain");
    if (text.startsWith("preset:")) {
      const [, id] = text.split(":");
      const f = PRESET_FILTERS[id];
      if (f) { setActiveEffect(id); setActiveEffectCss(f); }
      return;
    }

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    const paths: string[] = [];
    for (const f of files) {
      let p: string | null = null;
      if (window.studioV4?.getPathForFile) {
        try { p = window.studioV4.getPathForFile(f); } catch {}
      }
      if (!p) p = (f as any).path || null;
      if (p) paths.push(p);
    }
    if (paths.length > 0) ingestFiles(paths);
  }, [ingestFiles, PRESET_FILTERS]);

  const handleDragEnter = useCallback((e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    dragCounterRef.current += 1;
    if (e.dataTransfer.types.includes("Files")) setDropHighlight(true);
  }, []);

  const handleDragOver = useCallback((e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes("Files")) setDropHighlight(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setDropHighlight(false);
    }
  }, []);

  const addToTimeline = useCallback((asset: ImportedAsset) => {
    const endTime = visualCopies.reduce((max, c) => Math.max(max, (c.startTime ?? 0) + (c.duration ?? 5)), 0);
    const copy = createTimelineCopyForAsset(asset, endTime);
    setVisualCopies((prev) => [...prev, copy]);
  }, [visualCopies, setVisualCopies]);

  const handleAddAudioToTimeline = useCallback(async (audioPath: string) => {
    await ingestFiles([audioPath]);
    const asset = useAssetsStore.getState().assets.find((a) => a.filePath === audioPath || a.url === audioPath);
    if (!asset) return;
    // Áudio extraído vai sempre para track 1 (abaixo do vídeo), começando no tempo 0
    const copy = createTimelineCopyForAsset(asset, 0, "manual", 1);
    setVisualCopies((prev) => [...prev, copy]);
  }, [ingestFiles, setVisualCopies]);

  const handleExtractAudioFromClip = useCallback(async (assetId: string, startTime: number) => {
    const asset = useAssetsStore.getState().assets.find((a) => a.id === assetId);
    if (!asset?.filePath) return;
    const result = await window.studioV4?.media?.extractWav?.(asset.filePath);
    if (!result?.path) return;
    await ingestFiles([result.path]);
    const newAsset = useAssetsStore.getState().assets.find((a) => a.filePath === result.path || a.url === result.path);
    if (newAsset) {
      const copy = createTimelineCopyForAsset(newAsset, startTime);
      setVisualCopies((prev) => [...prev, copy]);
    }
  }, [ingestFiles, setVisualCopies]);


  function handleMenuCommand(command: MenuCommand) {
    switch (command) {
      case "home": setScreen("home"); break;
      case "new-project": {
        const d = new Date();
        const stamp = `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`;
        setProjectName(`Projeto ${stamp}`);
        setAssets([]);
        timelineClear();
        break;
      }
      case "import": handleImport(); break;
      case "export": setDialog("export"); break;
      case "drive": setDialog("drive"); break;
      case "save": case "save-file": {
        const snap = getProjectSnapshot();
        window.studioV4?.saveProjectFile?.({ snapshot: snap, defaultName: projectName }).then((savedPath) => {
          if (savedPath) {
            window.studioV4?.readRecentProjects?.().then((prev) => {
              const entry = {
                id: createLocalId("proj"),
                projectName,
                name: projectName,
                meta: new Date().toLocaleDateString("pt-BR"),
                updatedAt: new Date().toISOString(),
                filePath: savedPath,
              };
              const list = [entry, ...((prev as any[] ?? []).filter((r: any) => (r.projectName || r.name) !== projectName).slice(0, 9))];
              window.studioV4?.writeRecentProjects?.(list);
              setRecentVideos(list);
            });
          }
        });
        break;
      }
      case "help": setDialog("help"); break;
      case "cut-clean":
        setScreen("editor");
        setActiveTool("ai");
        break;
      case "captions-panel":
        setScreen("editor");
        setActiveTool("captions");
        break;
      case "audio-panel":
        setScreen("editor");
        setActiveTool("audio");
        break;
      case "slice":
        window.dispatchEvent(new CustomEvent("timeline:split"));
        break;
      case "save-layout":
      case "load-layout":
      case "reset-layout":
        addToast("Layout personalizado em desenvolvimento.", "info");
        break;
      case "share":
        addToast("Compartilhamento em desenvolvimento.", "info");
        break;
      case "open-file":
        window.studioV4?.openProjectFile?.().then((data: unknown) => {
          if (data) { handleLoadProject(data); setScreen("editor"); }
        }).catch(() => {});
        break;
      default: break;
    }
  }

  const previewAsset = selectedAssetId ? assets.find((a) => a.id === selectedAssetId) : assets[0];
  const previewUrl = previewAsset?.previewUrl || previewAsset?.url || "";
  const hasMedia = assets.length > 0;

  if (screen === "home") {
    return (
      <EditorShell theme={theme}>
        <div className="flex h-screen flex-col">
          <HomeScreen
            theme={theme}
            driveConnected={driveConnected}
            googleProfile={googleProfile}
            projectName={projectName}
            assetCount={assets.length}
            recentVideos={recentVideos}
            onDrive={() => setDialog("drive")}
            onEnter={() => setScreen("editor")}
            onNewProject={() => { handleMenuCommand("new-project"); setScreen("editor"); }}
            onOpenProject={(name) => { setProjectName(name); setScreen("editor"); }}
          />
        </div>
      </EditorShell>
    );
  }

  return (
    <EditorShell theme={theme}>
      <div className="flex h-screen flex-col" onDrop={handleDrop} onDragEnter={handleDragEnter} onDragOver={handleDragOver} onDragLeave={handleDragLeave}>
        <TopBar
          theme={theme} projectName={projectName} driveConnected={driveConnected} googleProfile={googleProfile}
          onProjectNameChange={setProjectName} onThemeChange={setTheme} onMenuCommand={handleMenuCommand} onAction={() => {}}
        />

        {dropHighlight && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary pointer-events-none">
            <div className="rounded-lg bg-background/90 px-6 py-4 text-center shadow-xl">
              <Upload className="mx-auto size-8 text-primary" />
              <p className="mt-2 text-sm font-bold">Solte para importar</p>
            </div>
          </div>
        )}

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* ── Sidebar com labels ── */}
          <aside className="flex w-[72px] flex-col items-center gap-0.5 border-r border-border bg-background py-2 overflow-y-auto">
            {sidebarTools.map(({ id, label, icon: Icon }) => {
              const isActive = activeTool === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTool(id)}
                  className={`flex w-16 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 transition ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-card hover:text-foreground"
                  }`}
                >
                  <Icon className="size-[18px]" />
                  <span className="text-[9px] font-semibold leading-none">{label}</span>
                </button>
              );
            })}
          </aside>

          <main className="flex min-w-0 flex-1 flex-col bg-[var(--workspace)] overflow-hidden">
            <div className="flex min-h-0 flex-1 overflow-hidden">
              {/* ── Painel esquerdo: Biblioteca ── */}
              <section className="flex w-[260px] min-w-[220px] flex-col border-r border-border bg-background">
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <p className="text-xs font-black">Biblioteca</p>
                  <button
                    type="button"
                    onClick={handleImport}
                    className="flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-[10px] font-bold text-white hover:bg-primary/90 active:scale-95 transition"
                  >
                    <Plus className="size-3" />
                    Importar
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-2">
                  {importing && (
                    <div className="mb-2 rounded-lg bg-primary/10 p-2.5 border border-primary/20">
                      <p className="text-[10px] font-bold text-primary">Importando...</p>
                      {Object.entries(importProgress).map(([fp, { stage, percent, error }]) => (
                        <div key={fp} className="mt-1.5">
                          <p className="truncate text-[9px] text-muted-foreground">{fp.split(/[/\\]/).pop()}</p>
                          <div className="mt-0.5 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${stage === "proxy-error" ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${percent > 0 ? percent : 100}%` }} />
                          </div>
                          <p className={`text-[8px] mt-0.5 ${stage === "proxy-error" ? "text-amber-400" : "text-muted-foreground"}`}>
                            {stageLabel(stage)}{stage !== "proxy-error" ? ` — ${percent}%` : ""}
                          </p>
                          {error && stage === "proxy-error" && (
                            <p className="text-[8px] text-amber-400/70 mt-0.5 leading-relaxed">{error}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {assets.length === 0 && !importing ? (
                    <div className="grid h-full place-items-center text-center px-4">
                      <div>
                        <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-muted/50">
                          <Upload className="size-6 text-muted-foreground/40" />
                        </div>
                        <p className="mt-3 text-xs font-semibold text-muted-foreground">Arraste arquivos aqui</p>
                        <p className="mt-1 text-[10px] text-muted-foreground/50 leading-relaxed">
                          ou clique <strong>Importar</strong> acima
                        </p>
                        <p className="mt-3 text-[9px] text-muted-foreground/40">
                          MP4, MOV, MKV, OGG, WAV, PNG, JPG e mais
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-0.5">
                      {assets.map((asset) => {
                        const kindIcon = asset.kind === "audio" ? Music2 : asset.kind === "image" ? ImageIcon : Film;
                        const KindIcon = kindIcon;
                        return (
                          <div
                            key={asset.id}
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData("text/plain", `asset:${asset.id}`);
                              e.dataTransfer.effectAllowed = "copy";
                            }}
                            className={`group flex items-center gap-2 rounded-lg px-2 py-2 cursor-grab active:cursor-grabbing transition ${
                              selectedAssetId === asset.id ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-card"
                            }`}
                            onClick={() => setSelectedAssetId(asset.id)}
                            onDoubleClick={() => addToTimeline(asset)}
                          >
                            {asset.thumbnailUrl ? (
                              <img src={asset.thumbnailUrl} className="size-9 rounded object-cover" alt="" />
                            ) : (
                              <div className="grid size-9 place-items-center rounded bg-muted text-muted-foreground">
                                <KindIcon className="size-4" />
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[11px] font-medium">{asset.displayName || asset.name}</p>
                              <p className="text-[9px] text-muted-foreground">
                                {asset.size}
                                {asset.metadata?.duration ? ` · ${asset.metadata.duration}` : ""}
                                {asset.metadata?.resolution ? ` · ${asset.metadata.resolution}` : ""}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); addToTimeline(asset); }}
                              className="invisible grid size-6 place-items-center rounded-md bg-primary text-white group-hover:visible active:scale-90 transition"
                              title="Adicionar na timeline"
                            >
                              <Plus className="size-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>

              {/* ── Preview ── */}
              <section className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center justify-between border-b border-border bg-card px-2 py-1">
                  {/* Preview tools: formato, mask, split */}
                  <div className="flex items-center gap-1">
                    {/* Format dropdown */}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setFormatOpen(!formatOpen)}
                        className="flex items-center gap-1 rounded-md border border-border bg-secondary px-1.5 py-1 text-foreground transition hover:bg-muted"
                        title={`${activeFormat.label} ${activeFormat.size} · Safe zone legenda: ${CAPTION_SAFE_ZONE[activeFormat.id] ?? 12}% do fundo`}
                      >
                        {FORMAT_ICONS[activeFormat.id] || <Smartphone className="size-3.5" />}
                        <ChevronDown className="size-2.5 text-muted-foreground" />
                      </button>
                      {formatOpen && (
                        <div className="absolute left-0 top-8 z-50 w-36 rounded-lg border border-border bg-background shadow-xl overflow-hidden">
                          {formatPresets.map((fp) => (
                            <button
                              key={fp.id}
                              type="button"
                              onClick={() => { setActiveFormat(fp); setFormatOpen(false); }}
                              className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition ${
                                activeFormat.id === fp.id ? "bg-primary/10 text-primary" : "hover:bg-card text-foreground"
                              }`}
                            >
                              {FORMAT_ICONS[fp.id] || <Smartphone className="size-3.5" />}
                              <span className="text-[10px] font-semibold">{fp.label}</span>
                              <span className="ml-auto text-[8px] text-muted-foreground">{fp.size.split("x")[0]}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="h-5 w-px bg-border" />
                    {/* Preview tools */}
                    <button type="button" onClick={() => setPreviewTool(previewTool === "move" ? null : "move")} className={`grid size-7 place-items-center rounded-md transition ${previewTool === "move" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`} title="Mover/Redimensionar">
                      <Move className="size-3.5" />
                    </button>
                    <button type="button" onClick={() => setPreviewTool(previewTool === "crop" ? null : "crop")} className={`grid size-7 place-items-center rounded-md transition ${previewTool === "crop" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`} title="Cortar">
                      <Crop className="size-3.5" />
                    </button>
                    <div className="h-5 w-px bg-border" />
                    {/* Mask tools */}
                    <button type="button" onClick={() => setPreviewTool(previewTool === "chroma" ? null : "chroma")} className={`grid size-7 place-items-center rounded-md transition ${previewTool === "chroma" ? "bg-green-500 text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`} title="Chroma Key">
                      <Eraser className="size-3.5" />
                    </button>
                    <button type="button" onClick={() => setPreviewTool(previewTool === "mask-rect" ? null : "mask-rect")} className={`grid size-7 place-items-center rounded-md transition ${previewTool === "mask-rect" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`} title="Mascara retangular">
                      <RectangleHorizontal className="size-3.5" />
                    </button>
                    <button type="button" onClick={() => setPreviewTool(previewTool === "mask-circle" ? null : "mask-circle")} className={`grid size-7 place-items-center rounded-md transition ${previewTool === "mask-circle" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`} title="Mascara circular">
                      <Circle className="size-3.5" />
                    </button>
                    <button type="button" onClick={() => setPreviewTool(previewTool === "mask-pen" ? null : "mask-pen")} className={`grid size-7 place-items-center rounded-md transition ${previewTool === "mask-pen" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`} title="Mascara livre (pen)">
                      <PenTool className="size-3.5" />
                    </button>
                    <div className="h-5 w-px bg-border" />
                    <button type="button" onClick={() => setSplitScreen(!splitScreen)} className={`grid size-7 place-items-center rounded-md transition ${splitScreen ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`} title="Tela dividida">
                      <SplitSquareVertical className="size-3.5" />
                    </button>
                    <div className="h-5 w-px bg-border" />
                    <button type="button" onClick={() => setPreviewTool(previewTool === "remove-wm" ? null : "remove-wm")} className={`grid size-7 place-items-center rounded-md transition ${previewTool === "remove-wm" ? "bg-amber-500 text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`} title="Remover marca d'agua">
                      <Stamp className="size-3.5" />
                    </button>
                  </div>

                  <span className="text-[9px] text-muted-foreground font-mono">{activeFormat.size}</span>
                </div>

                {/* Preview area */}
                <div className="relative flex flex-1 min-h-0 items-center justify-center bg-[var(--preview-surface)] p-2 overflow-hidden">
                  <div
                    className="relative overflow-hidden rounded bg-[var(--preview-frame)]"
                    style={{ aspectRatio: activeFormat.aspect, maxHeight: "100%", maxWidth: "100%", width: "90%" }}
                  >
                    {splitScreen && previewUrl ? (
                      <div className="absolute inset-0 flex flex-col">
                        <div className="flex-1 overflow-hidden border-b border-white/20">
                          <video src={previewUrl} className="h-full w-full object-cover" style={{ filter: activeEffectCss }} muted />
                        </div>
                        <div className="flex-1 overflow-hidden">
                          <video src={previewUrl} className="h-full w-full object-cover" style={{ filter: activeEffectCss, transform: "scaleX(-1)" }} muted />
                        </div>
                        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-0.5 bg-white/40 cursor-row-resize" />
                      </div>
                    ) : previewUrl && (previewAsset?.kind === "video" || previewAsset?.kind === "audio") ? (
                      <video
                        ref={videoRef}
                        src={previewUrl}
                        className="absolute inset-0 h-full w-full object-contain transition-[filter] duration-200"
                        style={(() => {
                          const activeClip = visualCopies.find(c => {
                            const s = c.startTime ?? 0;
                            const d = c.duration ?? 5;
                            return currentTime >= s && currentTime <= s + d;
                          });
                          const opacity = activeClip?.opacity != null ? activeClip.opacity / 100 : 1;
                          const brightness = activeClip?.brightness != null ? activeClip.brightness / 100 : 1;
                          const clipFilter = brightness !== 1 ? `brightness(${brightness})` : "";
                          const combinedFilter = [activeEffectCss !== "none" ? activeEffectCss : "", clipFilter].filter(Boolean).join(" ") || "none";
                          return {
                            filter: combinedFilter,
                            opacity,
                            transform: `translate(${videoTransform.x}px, ${videoTransform.y}px) scale(${videoTransform.scale / 100})`,
                          };
                        })()}
                        muted={isMuted}
                        onTimeUpdate={(e) => {
                          const srcTime = e.currentTarget.currentTime;
                          const pos = resolveAtTime(visualCopies, currentTime);
                          if (pos && pos.clip) {
                            const tlTime = sourceTimeToTimeline(pos.clip, srcTime);
                            const duration = getTimelineDuration(visualCopies);
                            if (duration > 0 && tlTime >= duration) {
                              e.currentTarget.pause();
                              setIsPlaying(false);
                              setCurrentTime(duration);
                            } else {
                              setCurrentTime(Math.max(0, tlTime));
                            }
                          } else {
                            setCurrentTime(srcTime);
                          }
                        }}
                        onEnded={() => setIsPlaying(false)}
                      />
                    ) : previewUrl && previewAsset?.kind === "image" ? (
                      <img
                        src={previewUrl}
                        className="absolute inset-0 h-full w-full object-contain transition-[filter] duration-200"
                        style={{
                          filter: activeEffectCss,
                          transform: `translate(${videoTransform.x}px, ${videoTransform.y}px) scale(${videoTransform.scale / 100})`,
                        }}
                        alt=""
                      />
                    ) : (
                      <div className="absolute inset-0 grid place-items-center">
                        <Film className="size-10 text-white/10" />
                      </div>
                    )}

                    {/* Caption overlay — arrastavel */}
                    {captionSegments.length > 0 && (() => {
                      const seg = captionSegments.find((s) => currentTime >= s.start && currentTime <= s.end);
                      const text = seg?.text?.trim() ?? "";
                      const words = text.split(/\s+/).filter(Boolean);
                      const mid = Math.ceil(words.length / 2);
                      const line1 = words.slice(0, mid).join(" ");
                      const line2 = words.slice(mid).join(" ");
                      if (!line1) return null;
                      return (
                        <div
                          className="absolute left-1/2 -translate-x-1/2 cursor-move select-none w-[88%]"
                          style={{ bottom: `${captionY}%` }}
                          onPointerDown={(e) => {
                            const startY = e.clientY;
                            const startVal = captionY;
                            const parent = e.currentTarget.parentElement!;
                            const h = parent.getBoundingClientRect().height;
                            const move = (ev: PointerEvent) => {
                              const dy = startY - ev.clientY;
                              const dyPct = (dy / h) * 100;
                              setCaptionY(Math.max(2, Math.min(88, startVal + dyPct)));
                            };
                            const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
                            window.addEventListener("pointermove", move);
                            window.addEventListener("pointerup", up);
                          }}
                        >
                          <div className="rounded-md px-3 py-1.5 text-center" style={{
                            backgroundColor: captionBgOpacity > 0
                              ? `${captionBgColor}${Math.round(captionBgOpacity * 2.55).toString(16).padStart(2, "0")}`
                              : "transparent",
                          }}>
                            {[line1, line2].filter(Boolean).map((line, i) => (
                              <p key={i} className="leading-snug" style={{
                                fontFamily: captionFont,
                                fontSize: `${captionFontSize}px`,
                                fontWeight: captionBold ? "bold" : "normal",
                                fontStyle: captionItalic ? "italic" : "normal",
                                color: captionColor,
                                textShadow: captionShadow ? "0 1px 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.7)" : captionOutline ? "1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000" : "none",
                              }}>{line}</p>
                            ))}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Move/resize handle overlay */}
                    {previewTool === "move" && previewUrl && (
                      <div
                        className="absolute inset-0 cursor-move"
                        onPointerDown={(e) => {
                          const startX = e.clientX;
                          const startY = e.clientY;
                          const orig = { ...videoTransform };
                          const move = (ev: PointerEvent) => {
                            setVideoTransform({ ...orig, x: orig.x + ev.clientX - startX, y: orig.y + ev.clientY - startY });
                          };
                          const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
                          window.addEventListener("pointermove", move);
                          window.addEventListener("pointerup", up);
                        }}
                        onWheel={(e) => {
                          setVideoTransform((prev) => ({ ...prev, scale: Math.max(10, Math.min(300, prev.scale + (e.deltaY > 0 ? -5 : 5))) }));
                        }}
                      >
                        <div className="absolute inset-2 border-2 border-dashed border-white/30 rounded pointer-events-none" />
                        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-black/70 px-2 py-0.5">
                          <span className="text-[9px] text-white/70 font-mono">{videoTransform.scale}% · arraste para mover · scroll para zoom</span>
                        </div>
                      </div>
                    )}

                    {/* Chroma key indicator */}
                    {previewTool === "chroma" && (
                      <div className="absolute inset-0 grid place-items-center pointer-events-none">
                        <div className="rounded-lg bg-green-500/20 border-2 border-dashed border-green-400/50 px-4 py-2">
                          <p className="text-xs font-bold text-green-300">Chroma Key ativo</p>
                          <p className="text-[9px] text-green-200/60">Clique na cor do fundo para remover</p>
                        </div>
                      </div>
                    )}

                    {/* Mask indicators */}
                    {previewTool === "mask-rect" && (
                      <div className="absolute inset-[15%] border-2 border-dashed border-yellow-400/60 rounded pointer-events-none">
                        <div className="absolute -top-5 left-0 text-[8px] text-yellow-300/70">Mascara retangular</div>
                      </div>
                    )}
                    {previewTool === "mask-circle" && (
                      <div className="absolute inset-[15%] border-2 border-dashed border-yellow-400/60 rounded-full pointer-events-none">
                        <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-[8px] text-yellow-300/70">Mascara circular</div>
                      </div>
                    )}
                    {previewTool === "mask-pen" && (
                      <div className="absolute inset-0 cursor-crosshair">
                        <div className="absolute top-2 left-1/2 -translate-x-1/2 rounded bg-black/70 px-2 py-0.5">
                          <span className="text-[9px] text-white/70">Clique ponto a ponto para desenhar mascara</span>
                        </div>
                      </div>
                    )}

                    {/* Remove watermark — selecionar regiao */}
                    {previewTool === "remove-wm" && (
                      <div
                        className="absolute inset-0 cursor-crosshair"
                        onPointerDown={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const startX = ((e.clientX - rect.left) / rect.width) * 100;
                          const startY = ((e.clientY - rect.top) / rect.height) * 100;
                          const move = (ev: PointerEvent) => {
                            const cx = ((ev.clientX - rect.left) / rect.width) * 100;
                            const cy = ((ev.clientY - rect.top) / rect.height) * 100;
                            setWmRegion({
                              x: Math.min(startX, cx),
                              y: Math.min(startY, cy),
                              w: Math.abs(cx - startX),
                              h: Math.abs(cy - startY),
                            });
                          };
                          const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
                          window.addEventListener("pointermove", move);
                          window.addEventListener("pointerup", up);
                        }}
                      >
                        {wmRegion && (
                          <div
                            className="absolute border-2 border-dashed border-amber-400 bg-amber-400/10"
                            style={{ left: `${wmRegion.x}%`, top: `${wmRegion.y}%`, width: `${wmRegion.w}%`, height: `${wmRegion.h}%` }}
                          />
                        )}
                        <div className="absolute top-2 left-1/2 -translate-x-1/2 rounded-lg bg-black/80 px-3 py-1.5 flex items-center gap-2">
                          {wmRegion && wmRegion.w > 1 ? (
                            <>
                              <span className="text-[9px] text-amber-300">Regiao selecionada</span>
                              <button
                                type="button"
                                disabled={wmRemoving}
                                onClick={async () => {
                                  if (!wmRegion) return;
                                  if (!previewAsset?.filePath) {
                                    alert("Este arquivo não tem caminho local. Reimporte o vídeo pelo botão de importar para usar essa função.");
                                    return;
                                  }
                                  setWmRemoving(true);
                                  setWmProgress(0);
                                  const unsub = window.studioV4?.media?.onProgress?.((data) => {
                                    if (data.stage === "remove-watermark") setWmProgress(data.percent);
                                  });
                                  try {
                                    const result = await window.studioV4?.media?.removeWatermark(previewAsset.filePath, wmRegion);
                                    if (result?.proxyUrl) {
                                      updateAsset(previewAsset.id, { previewUrl: result.proxyUrl, url: result.proxyUrl });
                                    }
                                  } catch (err) {
                                    addToast(`Remoção de marca falhou: ${err instanceof Error ? err.message : String(err)}`, "error");
                                  } finally {
                                    unsub?.();
                                    setWmRemoving(false);
                                    setWmProgress(0);
                                    setWmRegion(null);
                                    setPreviewTool(null);
                                  }
                                }}
                                className="rounded bg-amber-500 px-2 py-0.5 text-[9px] font-bold text-black hover:bg-amber-400 disabled:opacity-50"
                              >
                                {wmRemoving ? `${wmProgress}%` : "Remover marca"}
                              </button>
                            </>
                          ) : (
                            <span className="text-[9px] text-white/80">Desenhe um retangulo sobre a marca d'agua</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Transport */}
                {hasMedia && (
                  <div className="flex h-9 items-center justify-center gap-2 border-t border-border bg-background px-3">
                    <button type="button" onClick={() => { if (videoRef.current) videoRef.current.currentTime = 0; }} className="text-muted-foreground hover:text-foreground">
                      <SkipBack className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (videoRef.current) {
                          if (isPlaying) videoRef.current.pause(); else videoRef.current.play();
                          setIsPlaying(!isPlaying);
                        }
                      }}
                      className="grid size-7 place-items-center rounded-full bg-primary text-white hover:bg-primary/90 active:scale-95 transition"
                    >
                      {isPlaying ? <Pause className="size-3.5" /> : <Play className="size-3.5 ml-0.5" />}
                    </button>
                    <button type="button" onClick={() => { if (videoRef.current) videoRef.current.currentTime += 5; }} className="text-muted-foreground hover:text-foreground">
                      <SkipForward className="size-3.5" />
                    </button>
                    <span className="ml-2 text-[9px] font-mono text-muted-foreground tabular-nums">
                      {formatTimecode(currentTime)}
                    </span>
                    <div className="ml-auto flex items-center gap-1.5">
                      <button type="button" onClick={() => setIsMuted(!isMuted)} className="text-muted-foreground hover:text-foreground">
                        {isMuted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
                      </button>
                      <button type="button" onClick={() => setVideoTransform({ x: 0, y: 0, scale: 100 })} className="text-[8px] text-muted-foreground hover:text-foreground" title="Reset posicao">
                        Reset
                      </button>
                    </div>
                  </div>
                )}
              </section>

              {/* ── Painel direito: contextual ── */}
              <section className="flex w-[260px] min-w-[220px] flex-col border-l border-border bg-background">
                <div className="flex-1 overflow-y-auto p-3">

                  {/* ── Propriedades do clipe selecionado ── */}
                  {(() => {
                    const selCopy = selectedCopyId ? visualCopies.find(c => c.id === selectedCopyId) : null;
                    if (!selCopy) return null;
                    const update = (patch: Partial<typeof selCopy>) =>
                      setVisualCopies(prev => prev.map(c => c.id === selCopy.id ? { ...c, ...patch } : c));
                    return (
                      <div className="rounded-lg border border-primary/30 bg-primary/5 p-2.5 flex flex-col gap-2 mb-3">
                        <div className="flex items-center justify-between">
                          <p className="text-[9px] font-bold text-primary uppercase tracking-wider">Elemento selecionado</p>
                          <button type="button" onClick={() => setSelectedCopyId(null)}
                            className="grid size-4 place-items-center rounded text-muted-foreground hover:text-foreground">
                            <X className="size-3" />
                          </button>
                        </div>

                        {/* Opacidade */}
                        <div className="flex items-center gap-2">
                          <label className="text-[9px] text-muted-foreground w-12 shrink-0">Opacidade</label>
                          <input type="range" min={0} max={100} step={1} value={selCopy.opacity ?? 100}
                            onChange={e => update({ opacity: Number(e.target.value) })}
                            className="flex-1 h-1 accent-primary" />
                          <span className="text-[9px] tabular-nums w-7">{selCopy.opacity ?? 100}%</span>
                        </div>

                        {/* Volume */}
                        <div className="flex items-center gap-2">
                          <label className="text-[9px] text-muted-foreground w-12 shrink-0">Volume</label>
                          <input type="range" min={0} max={200} step={5} value={selCopy.volume ?? 100}
                            onChange={e => update({ volume: Number(e.target.value) })}
                            className="flex-1 h-1 accent-primary" />
                          <span className="text-[9px] tabular-nums w-7">{selCopy.volume ?? 100}%</span>
                        </div>

                        {/* Velocidade */}
                        <div className="flex items-center gap-2">
                          <label className="text-[9px] text-muted-foreground w-12 shrink-0">Velocidade</label>
                          <input type="range" min={25} max={400} step={25} value={Math.round((selCopy.speed ?? 1) * 100)}
                            onChange={e => update({ speed: Number(e.target.value) / 100 })}
                            className="flex-1 h-1 accent-primary" />
                          <span className="text-[9px] tabular-nums w-7">{Math.round((selCopy.speed ?? 1) * 100)}%</span>
                        </div>

                        {/* Brilho */}
                        <div className="flex items-center gap-2">
                          <label className="text-[9px] text-muted-foreground w-12 shrink-0">Brilho</label>
                          <input type="range" min={0} max={200} step={5} value={selCopy.brightness ?? 100}
                            onChange={e => update({ brightness: Number(e.target.value) })}
                            className="flex-1 h-1 accent-primary" />
                          <span className="text-[9px] tabular-nums w-7">{selCopy.brightness ?? 100}%</span>
                        </div>

                        <div className="border-t border-border/40 my-0.5" />
                        <p className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-wider">Posição / Tela dividida</p>

                        {/* Escala */}
                        <div className="flex items-center gap-2">
                          <label className="text-[9px] text-muted-foreground w-12 shrink-0">Escala</label>
                          <input type="range" min={10} max={200} step={5} value={selCopy.scale ?? 100}
                            onChange={e => update({ scale: Number(e.target.value) })}
                            className="flex-1 h-1 accent-primary" />
                          <span className="text-[9px] tabular-nums w-7">{selCopy.scale ?? 100}%</span>
                        </div>

                        {/* Pos X */}
                        <div className="flex items-center gap-2">
                          <label className="text-[9px] text-muted-foreground w-12 shrink-0">Pos X</label>
                          <input type="range" min={-100} max={100} step={1} value={selCopy.posX ?? 0}
                            onChange={e => update({ posX: Number(e.target.value) })}
                            className="flex-1 h-1 accent-primary" />
                          <span className="text-[9px] tabular-nums w-7">{selCopy.posX ?? 0}%</span>
                        </div>

                        {/* Pos Y */}
                        <div className="flex items-center gap-2">
                          <label className="text-[9px] text-muted-foreground w-12 shrink-0">Pos Y</label>
                          <input type="range" min={-100} max={100} step={1} value={selCopy.posY ?? 0}
                            onChange={e => update({ posY: Number(e.target.value) })}
                            className="flex-1 h-1 accent-primary" />
                          <span className="text-[9px] tabular-nums w-7">{selCopy.posY ?? 0}%</span>
                        </div>

                        {/* Atalhos tela dividida */}
                        <div className="flex gap-1.5 flex-wrap">
                          <button type="button" onClick={() => update({ posX: -50, scale: 50 })}
                            className="rounded border border-border px-2 py-0.5 text-[8px] text-muted-foreground hover:text-foreground hover:border-primary/40 transition">
                            ◧ Esquerda
                          </button>
                          <button type="button" onClick={() => update({ posX: 50, scale: 50 })}
                            className="rounded border border-border px-2 py-0.5 text-[8px] text-muted-foreground hover:text-foreground hover:border-primary/40 transition">
                            ◨ Direita
                          </button>
                          <button type="button" onClick={() => update({ posX: 0, posY: 0, scale: 100 })}
                            className="rounded border border-border px-2 py-0.5 text-[8px] text-muted-foreground hover:text-foreground hover:border-primary/40 transition">
                            ⛶ Cheio
                          </button>
                        </div>
                      </div>
                    );
                  })()}

                  {activeTool === "ai" ? (
                    <CleanCutPanel
                      assets={assets}
                      selectedAssetId={selectedAssetId}
                      onApplyCuts={handleApplyCuts}
                      onSeek={(t) => { setCurrentTime(t); if (videoRef.current) videoRef.current.currentTime = t; }}
                    />
                  ) : activeTool === "captions" ? (
                    <>
                    {/* Estilo da legenda — painel completo */}
                    <div className="rounded-lg border border-border bg-card/50 p-2.5 flex flex-col gap-2 mb-1">
                      <p className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-wider">Texto</p>

                      {/* Fonte */}
                      <div className="flex items-center gap-2">
                        <label className="text-[9px] text-muted-foreground w-9 shrink-0">Fonte</label>
                        <select
                          value={captionFont}
                          onChange={(e) => setCaptionFont(e.target.value)}
                          className="flex-1 rounded border border-border bg-background px-1.5 py-1 text-[10px] text-foreground"
                        >
                          {["Arial","Helvetica","Verdana","Tahoma","Georgia","Impact","Trebuchet MS","Comic Sans MS","Courier New","Times New Roman","Montserrat","Roboto","Open Sans"].map(f => (
                            <option key={f} value={f}>{f}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-[9px] text-muted-foreground w-9 shrink-0">Outra</label>
                        <input
                          type="text"
                          placeholder="Nome da fonte do PC..."
                          className="flex-1 rounded border border-border bg-background px-1.5 py-1 text-[10px] text-foreground placeholder:text-muted-foreground/40"
                          onBlur={(e) => { if (e.target.value.trim()) setCaptionFont(e.target.value.trim()); }}
                          onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLInputElement).value.trim()) setCaptionFont((e.target as HTMLInputElement).value.trim()); }}
                        />
                      </div>

                      {/* Tamanho */}
                      <div className="flex items-center gap-2">
                        <label className="text-[9px] text-muted-foreground w-9 shrink-0">Tam.</label>
                        <input type="range" min={8} max={48} step={1} value={captionFontSize}
                          onChange={(e) => setCaptionFontSize(Number(e.target.value))}
                          className="flex-1 h-1 accent-primary" />
                        <span className="text-[9px] text-muted-foreground w-6 tabular-nums">{captionFontSize}px</span>
                      </div>

                      {/* Cor do texto */}
                      <div className="flex items-center gap-2">
                        <label className="text-[9px] text-muted-foreground w-9 shrink-0">Cor</label>
                        <input type="color" value={captionColor} onChange={(e) => setCaptionColor(e.target.value)}
                          className="h-6 w-8 cursor-pointer rounded border border-border bg-transparent p-0" />
                        <span className="text-[9px] text-muted-foreground font-mono">{captionColor}</span>
                      </div>

                      {/* Negrito / Itálico */}
                      <div className="flex items-center gap-2">
                        <label className="text-[9px] text-muted-foreground w-9 shrink-0">Estilo</label>
                        <button type="button" onClick={() => setCaptionBold(b => !b)}
                          className={`rounded px-2 py-0.5 text-[9px] font-bold transition ${captionBold ? "bg-primary text-white" : "border border-border text-muted-foreground hover:text-foreground"}`}>
                          N
                        </button>
                        <button type="button" onClick={() => setCaptionItalic(b => !b)}
                          className={`rounded px-2 py-0.5 text-[9px] italic transition ${captionItalic ? "bg-primary text-white" : "border border-border text-muted-foreground hover:text-foreground"}`}>
                          I
                        </button>
                      </div>

                      {/* Separador */}
                      <div className="border-t border-border/40 my-0.5" />
                      <p className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-wider">Fundo</p>

                      {/* Cor do fundo */}
                      <div className="flex items-center gap-2">
                        <label className="text-[9px] text-muted-foreground w-9 shrink-0">Cor</label>
                        <input type="color" value={captionBgColor} onChange={(e) => setCaptionBgColor(e.target.value)}
                          className="h-6 w-8 cursor-pointer rounded border border-border bg-transparent p-0" />
                        <button type="button" onClick={() => setCaptionBgOpacity(op => op > 0 ? 0 : 80)}
                          className={`ml-auto rounded px-2 py-0.5 text-[9px] transition ${captionBgOpacity > 0 ? "bg-primary text-white" : "border border-border text-muted-foreground hover:text-foreground"}`}>
                          {captionBgOpacity > 0 ? "Ligado" : "Desligado"}
                        </button>
                      </div>

                      {/* Opacidade do fundo */}
                      <div className="flex items-center gap-2">
                        <label className="text-[9px] text-muted-foreground w-9 shrink-0">Opac.</label>
                        <input type="range" min={0} max={100} step={5} value={captionBgOpacity}
                          onChange={(e) => setCaptionBgOpacity(Number(e.target.value))}
                          className="flex-1 h-1 accent-primary" />
                        <span className="text-[9px] text-muted-foreground w-7 tabular-nums">{captionBgOpacity}%</span>
                      </div>

                      {/* Separador */}
                      <div className="border-t border-border/40 my-0.5" />
                      <p className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-wider">Efeitos</p>

                      {/* Sombra / Contorno */}
                      <div className="flex items-center gap-2">
                        <label className="text-[9px] text-muted-foreground w-9 shrink-0">Efeito</label>
                        <button type="button" onClick={() => { setCaptionShadow(v => !v); setCaptionOutline(false); }}
                          className={`rounded px-2 py-0.5 text-[9px] transition ${captionShadow ? "bg-primary text-white" : "border border-border text-muted-foreground hover:text-foreground"}`}>
                          Sombra
                        </button>
                        <button type="button" onClick={() => { setCaptionOutline(v => !v); setCaptionShadow(false); }}
                          className={`rounded px-2 py-0.5 text-[9px] transition ${captionOutline ? "bg-primary text-white" : "border border-border text-muted-foreground hover:text-foreground"}`}>
                          Contorno
                        </button>
                      </div>

                      {/* Separador */}
                      <div className="border-t border-border/40 my-0.5" />
                      <p className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-wider">Posição</p>

                      {/* Y — slider de posição */}
                      <div className="flex items-center gap-2">
                        <label className="text-[9px] text-muted-foreground w-9 shrink-0">Y</label>
                        <input type="range" min={2} max={88} step={1} value={Math.round(captionY)}
                          onChange={(e) => setCaptionY(Number(e.target.value))}
                          className="flex-1 h-1 accent-primary" />
                        <span className="text-[9px] text-muted-foreground w-7 tabular-nums">{Math.round(captionY)}%</span>
                      </div>
                    </div>
                    <CaptionEditorPanel
                      segments={captionSegments}
                      onSegmentsChange={setCaptionSegments}
                      onSeek={(t) => { setCurrentTime(t); if (videoRef.current) videoRef.current.currentTime = t; }}
                      currentTime={currentTime}
                      mediaContext={activeMediaContext}
                    />
                    </>
                  ) : activeTool === "presets" ? (
                    <PresetsPanel
                      onApplyPreset={(id, _name) => {
                        const f = PRESET_FILTERS[id];
                        if (f) { setActiveEffect(id); setActiveEffectCss(f); }
                      }}
                      onImportPreset={handleImport}
                    />
                  ) : activeTool === "effects" ? (
                    <EffectsPanel
                      activeEffect={activeEffect}
                      onApplyEffect={(id, css) => { setActiveEffect(id); setActiveEffectCss(css); }}
                      previewFrameUrl={previewAsset?.thumbnailUrl}
                    />
                  ) : activeTool === "text" ? (
                    <div className="flex flex-col gap-3">
                      <h3 className="text-xs font-black">Texto</h3>
                      <p className="text-[10px] text-muted-foreground leading-relaxed">
                        Para adicionar legendas e texto ao vídeo use o painel <strong>Legendas</strong> (ícone Cc na barra lateral) com transcrição automática.
                      </p>
                      <button
                        type="button"
                        onClick={() => setActiveTool("captions")}
                        className="rounded-lg bg-primary px-3 py-2 text-xs font-bold text-white hover:bg-primary/90 transition"
                      >
                        Ir para Legendas
                      </button>
                    </div>
                  ) : activeTool === "settings" ? (
                    <div className="flex flex-col gap-3">
                      <p className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-wider">Transcrição (faster-whisper)</p>
                      <div className="rounded-lg border border-border bg-card/50 p-2.5 flex flex-col gap-2">
                        <p className="text-[10px] text-muted-foreground leading-relaxed">
                          Transcrição local, offline, sem API. Requer Python + faster-whisper instalados.
                        </p>
                        <label className="text-[9px] text-muted-foreground font-semibold">Modelo padrão</label>
                        <select
                          value={whisperModel}
                          onChange={async (e) => {
                            const m = e.target.value;
                            setWhisperModel(m);
                            const cfg = (await window.studioV4?.readConfig?.()) || {};
                            await window.studioV4?.writeConfig?.({ ...cfg, whisperModel: m });
                          }}
                          className="rounded border border-border bg-background px-2 py-1.5 text-[10px] text-foreground w-full"
                        >
                          <option value="small">Rápido — small (~150 MB)</option>
                          <option value="medium">Equilibrado — medium (~450 MB)</option>
                          <option value="large-v3">Qualidade — large-v3 (~1.5 GB)</option>
                        </select>
                        <div className="rounded border border-border/40 bg-muted/20 px-2 py-1.5 text-[9px] text-muted-foreground leading-relaxed font-mono">
                          pip install faster-whisper
                        </div>
                      </div>
                      <div className="border-t border-border/40 my-0.5" />
                      <p className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-wider">Tela dividida</p>
                      <div className="rounded-lg border border-border bg-card/50 p-2.5 flex flex-col gap-2">
                        <p className="text-[10px] text-muted-foreground leading-relaxed">
                          Para colocar dois vídeos lado a lado: adicione ambos na timeline em tracks diferentes (o segundo clip vai para o track abaixo). No futuro export, os tracks são compostos em camadas. Para split-screen manual, coloque os dois clipes no mesmo intervalo de tempo em tracks 0 e 1.
                        </p>
                      </div>
                    </div>
                  ) : activeTool === "audio" ? (
                    <AudioToolsPanel asset={previewAsset} onAddAudioToTimeline={handleAddAudioToTimeline} />
                  ) : activeTool === "media" && !previewAsset ? (
                    <DrivePanel
                      connected={driveConnected}
                      profile={googleProfile}
                      projectName={projectName}
                      onConnect={(p) => { setGoogleProfile(p); setDriveConnected(true); }}
                      onDisconnect={() => { setGoogleProfile(null); setDriveConnected(false); }}
                      onLoadProject={handleLoadProject}
                      getProjectSnapshot={getProjectSnapshot}
                    />
                  ) : previewAsset ? (
                    <div className="flex flex-col gap-3">
                      <h3 className="text-xs font-black">Info</h3>
                      {previewAsset.thumbnailUrl && (
                        <img src={previewAsset.thumbnailUrl} className="w-full rounded-lg object-cover" alt="" />
                      )}
                      <InfoRow label="Arquivo" value={previewAsset.name} />
                      {previewAsset.metadata?.resolution && <InfoRow label="Resolucao" value={previewAsset.metadata.resolution} />}
                      {previewAsset.metadata?.duration && <InfoRow label="Duracao" value={previewAsset.metadata.duration} />}
                      {previewAsset.metadata?.codec && <InfoRow label="Codec" value={previewAsset.metadata.codec} />}
                      {previewAsset.metadata?.fps && <InfoRow label="FPS" value={previewAsset.metadata.fps} />}
                      <InfoRow label="Tamanho" value={previewAsset.size} />
                      <InfoRow label="Tipo" value={previewAsset.kind} />
                      <div className="mt-2 border-t border-border pt-3">
                        <DrivePanel
                          connected={driveConnected}
                          profile={googleProfile}
                          projectName={projectName}
                          onConnect={(p) => { setGoogleProfile(p); setDriveConnected(true); }}
                          onDisconnect={() => { setGoogleProfile(null); setDriveConnected(false); }}
                          onLoadProject={handleLoadProject}
                          getProjectSnapshot={getProjectSnapshot}
                        />
                      </div>
                    </div>
                  ) : (
                    <DrivePanel
                      connected={driveConnected}
                      profile={googleProfile}
                      projectName={projectName}
                      onConnect={(p) => { setGoogleProfile(p); setDriveConnected(true); }}
                      onDisconnect={() => { setGoogleProfile(null); setDriveConnected(false); }}
                      onLoadProject={handleLoadProject}
                      getProjectSnapshot={getProjectSnapshot}
                    />
                  )}
                </div>
              </section>
            </div>

            <Timeline
              assets={assets}
              visualCopies={visualCopies}
              onSetVisualCopies={setVisualCopies}
              selectedAssetId={selectedAssetId}
              onSelectAsset={setSelectedAssetId}
              selectedCopyId={selectedCopyId}
              onSelectCopy={setSelectedCopyId}
              currentTime={currentTime}
              onExtractAudioFromClip={handleExtractAudioFromClip}
              onSeek={(t) => {
                const duration = getTimelineDuration(visualCopies);
                const clamped = duration > 0 ? Math.min(t, duration) : t;
                setCurrentTime(clamped);
                if (videoRef.current) {
                  const pos = resolveAtTime(visualCopies, clamped);
                  if (pos) videoRef.current.currentTime = pos.sourceTime;
                }
              }}
              onDropAsset={(assetId, atTime) => {
                const asset = assets.find((a) => a.id === assetId);
                if (!asset) return;
                const copy = createTimelineCopyForAsset(asset, atTime);
                setVisualCopies((prev) => [...prev, copy]);
              }}
            />
          </main>
        </div>

        {/* ── Modal: Exportar ── */}
        {dialog === "export" && (() => {
          const FORMATS = [
            { id: "v4"  as const, label: ".v4 Portável", sub: "Editável em qualquer PC" },
            { id: "mp4" as const, label: "MP4",          sub: "H.264 · Para publicar"  },
            { id: "mov" as const, label: "MOV",          sub: "H.264 · Para edição"    },
            { id: "gif" as const, label: "GIF",          sub: "Animação"               },
            { id: "mp3" as const, label: "MP3",          sub: "Áudio comprimido"       },
            { id: "wav" as const, label: "WAV",          sub: "Áudio sem compressão"   },
          ] as const;
          const isVideo  = exportFormat === "mp4" || exportFormat === "mov" || exportFormat === "gif";
          const isAudio  = exportFormat === "mp3" || exportFormat === "wav";
          const isPortable = exportFormat === "v4";

          const getClips = () => visualCopies.map((c) => {
            const asset = assets.find((a) => a.id === c.assetId);
            return { filePath: asset?.filePath || "", trimStart: c.trimStart ?? 0, duration: c.duration ?? 5, speed: c.speed ?? 1 };
          });

          const runExport = async () => {
            setExportError(null);
            setExportProgress(0);
            try {
              const clips = getClips();
              if (isPortable) {
                const snapshot = getProjectSnapshot();
                const res = await window.studioV4?.savePortableV4?.({ snapshot, defaultName: projectName });
                if (!res) setExportProgress(null);
              } else if (isAudio) {
                const outputPath = await window.studioV4?.showSaveDialog?.({
                  title: `Exportar ${exportFormat.toUpperCase()}`,
                  defaultPath: projectName || "export",
                  filters: [{ name: `Áudio ${exportFormat.toUpperCase()}`, extensions: [exportFormat] }],
                });
                if (!outputPath) { setExportProgress(null); return; }
                await window.studioV4?.exportAudio?.({ clips, outputPath, format: exportFormat });
              } else if (exportFormat === "gif") {
                const outputPath = await window.studioV4?.showSaveDialog?.({
                  title: "Exportar GIF",
                  defaultPath: projectName || "export",
                  filters: [{ name: "GIF Animado", extensions: ["gif"] }],
                });
                if (!outputPath) { setExportProgress(null); return; }
                await window.studioV4?.exportGif?.({ clips, outputPath, resolution: exportResolution });
              } else {
                const ext = exportFormat;
                const outputPath = await window.studioV4?.showSaveDialog?.({
                  title: `Exportar ${ext.toUpperCase()}`,
                  defaultPath: projectName || "export",
                  filters: [{ name: `Vídeo ${ext.toUpperCase()}`, extensions: [ext] }],
                });
                if (!outputPath) { setExportProgress(null); return; }
                await window.studioV4?.exportVideo?.({
                  clips, outputPath, resolution: exportResolution,
                  captionsSRT: captionSegments.length > 0 ? serializeCaptionsToSRT(captionSegments) : undefined,
                  captionStyle: captionSegments.length > 0 ? {
                    fontFamily: captionFont, fontSize: captionFontSize,
                    color: captionColor, bgColor: captionBgColor, bgOpacity: captionBgOpacity,
                    shadow: captionShadow, outline: captionOutline, captionY,
                  } : undefined,
                });
              }
            } catch (err) {
              setExportProgress(null);
              setExportError(err instanceof Error ? err.message : "Erro ao exportar");
            }
          };

          return (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => { if (exportProgress === null || exportProgress === 100) setDialog(null); }}>
              <div className="w-[460px] rounded-xl border border-border bg-background p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <h2 className="text-sm font-black mb-4">Exportar</h2>

                {exportProgress !== null && exportProgress < 100 ? (
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground">
                      {isPortable ? "Empacotando mídia..." : "Exportando..."} {exportProgress}%
                    </p>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${exportProgress}%` }} />
                    </div>
                    {isPortable && <p className="text-[10px] text-muted-foreground">Vídeos são copiados sem recompressão — processo rápido.</p>}
                  </div>
                ) : exportProgress === 100 ? (
                  <div className="space-y-3">
                    <p className="text-xs text-green-500 font-bold">Exportação concluída!</p>
                    <button type="button" onClick={() => { setDialog(null); setExportProgress(null); }} className="w-full rounded-lg bg-primary px-4 py-2 text-xs font-bold text-white hover:bg-primary/90">Fechar</button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {exportError && (
                      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3">
                        <p className="text-[11px] text-destructive">{exportError}</p>
                      </div>
                    )}

                    {/* Seletor de formato */}
                    <div>
                      <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-wider mb-2">Formato</p>
                      <div className="grid grid-cols-3 gap-1.5">
                        {FORMATS.map((f) => (
                          <button
                            key={f.id}
                            type="button"
                            onClick={() => setExportFormat(f.id)}
                            className={`rounded-lg border p-2 text-left transition ${exportFormat === f.id ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"}`}
                          >
                            <p className={`text-[11px] font-black ${exportFormat === f.id ? "text-primary" : "text-foreground"}`}>{f.label}</p>
                            <p className="text-[9px] text-muted-foreground mt-0.5 leading-tight">{f.sub}</p>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Resolução (só para vídeo/gif) */}
                    {(isVideo) && (
                      <div>
                        <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-wider mb-1.5">Resolução</p>
                        <div className="flex gap-2">
                          {(["720p", "1080p"] as const).map((r) => (
                            <button key={r} type="button" onClick={() => setExportResolution(r)}
                              className={`flex-1 rounded-lg border py-2 text-xs font-bold transition ${exportResolution === r ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/50"}`}>
                              {r === "720p" ? "720p (HD)" : "1080p (Full HD)"}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Info contextual */}
                    <div className="text-[10px] text-muted-foreground space-y-0.5">
                      <p>{visualCopies.length} clipe{visualCopies.length !== 1 ? "s" : ""} na timeline</p>
                      {isPortable && <p className="text-amber-400/80">Inclui todos os arquivos de mídia — abre em qualquer PC com Studio V4 instalado.</p>}
                      {exportFormat === "mp4" && <p>MP4 H.264 · AAC 192k</p>}
                      {exportFormat === "mov" && <p>MOV H.264 · AAC 192k · compatível com Premiere e DaVinci</p>}
                      {exportFormat === "gif" && <p>GIF com paleta de 256 cores · 15fps · sem áudio</p>}
                      {exportFormat === "mp3" && <p>MP3 192k · áudio de todos os clipes concatenados</p>}
                      {exportFormat === "wav" && <p>WAV PCM 16-bit · sem compressão · qualidade máxima</p>}
                    </div>

                    <div className="flex gap-2 pt-1">
                      <button type="button" onClick={() => { setDialog(null); setExportError(null); }} className="flex-1 rounded-lg border border-border px-4 py-2 text-xs font-bold text-muted-foreground hover:text-foreground">
                        Cancelar
                      </button>
                      <button
                        type="button"
                        disabled={visualCopies.length === 0}
                        onClick={runExport}
                        className="flex-1 rounded-lg bg-primary px-4 py-2 text-xs font-bold text-white hover:bg-primary/90 disabled:opacity-40"
                      >
                        Exportar {exportFormat === "v4" ? ".v4" : exportFormat.toUpperCase()}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* ── Toasts ── */}
        {toasts.length > 0 && (
          <div className="absolute bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
            {toasts.map((t) => (
              <div
                key={t.id}
                className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 shadow-xl text-[11px] font-semibold max-w-[320px] pointer-events-auto ${
                  t.type === "error"
                    ? "border-destructive/40 bg-destructive/10 text-destructive"
                    : t.type === "ok"
                    ? "border-green-500/40 bg-green-500/10 text-green-400"
                    : "border-border bg-background/95 text-foreground"
                }`}
              >
                <span className="flex-1 leading-snug">{t.msg}</span>
                <button
                  type="button"
                  onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
                  className="shrink-0 text-muted-foreground hover:text-foreground ml-1"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── Modal: Ajuda ── */}
        {dialog === "help" && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setDialog(null)}>
            <div className="w-[520px] max-h-[80vh] overflow-y-auto rounded-xl border border-border bg-background p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-sm font-black">Central de Ajuda — Studio V4</h2>
                <button type="button" onClick={() => setDialog(null)} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
              </div>
              <div className="flex flex-col gap-5 text-[11px]">
                <div>
                  <p className="text-[9px] font-black text-primary uppercase tracking-widest mb-2">Fluxo recomendado</p>
                  <ol className="flex flex-col gap-1.5 text-muted-foreground leading-relaxed list-decimal list-inside">
                    <li>Arraste o vídeo para a biblioteca ou clique <strong className="text-foreground">Importar</strong></li>
                    <li>Aguarde o waveform carregar na faixa (barra verde aparece)</li>
                    <li>Abra <strong className="text-foreground">Corte</strong> → Analisar → Aplicar cortes automáticos</li>
                    <li>Abra <strong className="text-foreground">Legendas</strong> → Transcrever → revise e posicione</li>
                    <li>Aplique efeito ou LUT em <strong className="text-foreground">Efeitos / Presets</strong></li>
                    <li>Salve com <kbd className="rounded bg-muted px-1 py-px font-mono text-[9px]">Ctrl+S</kbd> ou no Google Drive</li>
                    <li>Exporte em MP4 pelo menu <strong className="text-foreground">Arquivo → Exportar</strong></li>
                  </ol>
                </div>
                <div className="border-t border-border pt-4">
                  <p className="text-[9px] font-black text-primary uppercase tracking-widest mb-2">Atalhos de teclado</p>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-muted-foreground">
                    {[
                      ["Espaço",        "Play / Pause"],
                      ["Ctrl + Z",      "Desfazer"],
                      ["Ctrl + Y",      "Refazer"],
                      ["Ctrl + S",      "Salvar projeto .v4"],
                      ["Ctrl + /",      "Dividir clipe no playhead"],
                      ["Drag arquivo",  "Importar vídeo/áudio/imagem"],
                      ["Handle ←→",     "Trim início / fim do clipe"],
                      ["Drag preset",   "Aplicar LUT na faixa"],
                    ].map(([k, v]) => (
                      <div key={k} className="flex items-center gap-2">
                        <kbd className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] text-foreground">{k}</kbd>
                        <span>{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="border-t border-border pt-4">
                  <p className="text-[9px] font-black text-primary uppercase tracking-widest mb-2">Formato .v4</p>
                  <p className="text-muted-foreground leading-relaxed">
                    Projetos são salvos em <strong className="text-foreground">.v4</strong> — formato exclusivo que preserva cortes, legendas, efeitos e velocidade de cada clipe. Sincronize via Google Drive para abrir em qualquer PC com Studio V4 instalado.
                  </p>
                </div>
                <div className="border-t border-border pt-4">
                  <p className="text-[9px] font-black text-primary uppercase tracking-widest mb-2">Dúvidas frequentes</p>
                  <div className="flex flex-col gap-2 text-muted-foreground leading-relaxed">
                    <p><strong className="text-foreground">Waveform não aparece?</strong> Aguarde — o processamento ocorre em segundo plano. Vídeos longos levam até 30 s.</p>
                    <p><strong className="text-foreground">Transcrição falhou?</strong> Verifique sua conexão com a internet. A transcrição usa o Groq Whisper via API.</p>
                    <p><strong className="text-foreground">Drive não conecta?</strong> A autenticação Google requer o app desktop instalado. Não funciona em preview web.</p>
                    <p><strong className="text-foreground">Export vazio?</strong> Certifique-se de que há clipes na timeline antes de exportar.</p>
                  </div>
                </div>
                <div className="border-t border-border pt-3 text-center text-[9px] text-muted-foreground/50">
                  Studio V4 · v1.0.0 · Jamilly Tech
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Modal: Drive (quando chamado pelo menu) ── */}
        {dialog === "drive" && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setDialog(null)}>
            <div className="w-[360px] rounded-xl border border-border bg-background p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-black">Google Drive</h2>
                <button type="button" onClick={() => setDialog(null)} className="text-muted-foreground hover:text-foreground text-lg leading-none">×</button>
              </div>
              <DrivePanel
                connected={driveConnected}
                profile={googleProfile}
                projectName={projectName}
                onConnect={(p) => { setGoogleProfile(p); setDriveConnected(true); }}
                onDisconnect={() => { setGoogleProfile(null); setDriveConnected(false); }}
                onLoadProject={(snap) => { handleLoadProject(snap); setDialog(null); setScreen("editor"); }}
                getProjectSnapshot={getProjectSnapshot}
              />
            </div>
          </div>
        )}
      </div>
    </EditorShell>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-wider">{label}</p>
      <p className="mt-0.5 text-[11px] font-medium break-all">{value}</p>
    </div>
  );
}

function stageLabel(stage: string): string {
  const map: Record<string, string> = {
    probe: "Analisando", thumbnail: "Thumbnail", waveform: "Waveform",
    proxy: "Criando proxy", "proxy-done": "Proxy pronto", "proxy-error": "Falha no proxy",
    convert: "Convertendo", "convert-done": "Convertido",
    strip: "Timeline", transcribe: "Transcrevendo", done: "Pronto",
  };
  return map[stage] || stage;
}

function formatDuration(seconds: number): string {
  if (!seconds || !Number.isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatTimecode(seconds: number): string {
  if (!seconds || !Number.isFinite(seconds)) return "00:00:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
