import React, { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import { useAssetsStore } from "@/stores/assets.store";
import { useTimelineStore } from "@/stores/timeline.store";
import { formatPresets } from "@/stores/format.store";
import { EditorShell } from "@/components/editor/EditorShell";
import { TopBar } from "@/components/editor/TopBar";
import { HomeScreen } from "@/components/home/HomeScreen";
import { Timeline } from "@/components/editor/Timeline";
import { CleanCutPanel } from "@/components/editor/CleanCutPanel";
import { DrivePanel } from "@/components/editor/DrivePanel";
import { TranscriptionPanel } from "@/components/editor/TranscriptionPanel";
import { PresetsPanel } from "@/components/editor/PresetsPanel";
import { EffectsPanel } from "@/components/editor/EffectsPanel";
import { formatFileSize } from "@/utils/format";
import { createLocalId } from "@/utils/id";
import { createTimelineCopyForAsset, minimumTimelineClipSeconds, timelinePixelsPerSecond } from "@/utils/timeline";
import type { CleanCutPause } from "@/utils/audio";
import type {
  AppScreen, DialogId, FormatPreset, GoogleDriveProfile,
  ImportedAsset, PreviewQualityId, RecentVideoProject,
  ThemeMode, ToolId, TranscriptSegment, TimelineVisualCopy,
} from "@/types/editor";
import type { MenuCommand } from "@/components/editor/MenuColumn";
import type { MediaProgressEvent } from "@/types/electron";
import {
  Film, Upload, Plus, Play, Pause, SkipBack, SkipForward,
  Volume2, VolumeX, Music2, ImageIcon, Type, Scissors,
  Wand2, Captions, SlidersHorizontal, Cloud, Layers,
  Smartphone, Monitor, Square, RectangleHorizontal, Circle,
  Move, Crop, Eraser, PenTool, ChevronDown, SplitSquareVertical, Stamp,
} from "lucide-react";

type PreviewToolId = "move" | "crop" | "chroma" | "mask-rect" | "mask-circle" | "mask-pen" | "remove-wm" | null;

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
  const [importProgress, setImportProgress] = useState<Record<string, { stage: string; percent: number }>>({});
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [dropHighlight, setDropHighlight] = useState(false);
  const [captionSegments, setCaptionSegments] = useState<TranscriptSegment[]>([]);
  const [activeEffect, setActiveEffect] = useState<string | null>(null);
  const [activeEffectCss, setActiveEffectCss] = useState<string>("none");
  const [formatOpen, setFormatOpen] = useState(false);
  const [previewTool, setPreviewTool] = useState<PreviewToolId>(null);
  const [splitScreen, setSplitScreen] = useState(false);
  const [videoTransform, setVideoTransform] = useState({ x: 0, y: 0, scale: 100 });
  const [captionY, setCaptionY] = useState(18);
  const [wmRegion, setWmRegion] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [wmRemoving, setWmRemoving] = useState(false);
  const [exportResolution, setExportResolution] = useState<"720p" | "1080p">("1080p");
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [vocalSep, setVocalSep] = useState<{ loading: boolean; message: string | null; vocalsUrl?: string; instrumentalUrl?: string | null; isError: boolean } | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const dragCounterRef = useRef(0);
  const previewStageRef = useRef<HTMLDivElement>(null);
  const [previewFrameSize, setPreviewFrameSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  // Ratio numerico do formato ativo (ex: "9 / 16" -> 0.5625)
  const formatRatio = (() => {
    const parts = activeFormat.aspect.split("/").map((p) => parseFloat(p.trim()));
    if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) return parts[0] / parts[1];
    return 9 / 16;
  })();

  // Calcula o tamanho do frame de preview respeitando o aspect ratio e cabendo nos dois eixos
  useEffect(() => {
    const stage = previewStageRef.current;
    if (!stage) return;
    const compute = () => {
      const cs = getComputedStyle(stage);
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const availW = stage.clientWidth - padX;
      const availH = stage.clientHeight - padY;
      if (availW <= 0 || availH <= 0) return;
      // Cabe pela largura
      let w = availW;
      let h = w / formatRatio;
      // Se estourar a altura, limita pela altura
      if (h > availH) {
        h = availH;
        w = h * formatRatio;
      }
      setPreviewFrameSize({ width: Math.round(w), height: Math.round(h) });
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [formatRatio]);

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

  const handleLoadProject = useCallback(async (snapshot: unknown) => {
    const data = snapshot as any;
    if (data.projectName) setProjectName(data.projectName);
    if (data.visualCopies) setVisualCopies(data.visualCopies);
    if (data.captionSegments) setCaptionSegments(data.captionSegments);

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
        const recent = [
          { name: data.projectName, date: new Date().toISOString() },
          ...((await window.studioV4?.readRecentProjects?.()) as any[] ?? [])
            .filter((r: any) => r.name !== data.projectName)
            .slice(0, 9),
        ];
        window.studioV4?.writeRecentProjects?.(recent);
        setRecentVideos(recent);
      }
    }
  }, [setAssets, setVisualCopies]);

  useEffect(() => {
    if (!window.studioV4?.media?.onProgress) return;
    return window.studioV4.media.onProgress((data: MediaProgressEvent) => {
      setImportProgress((prev) => ({ ...prev, [data.filePath]: { stage: data.stage, percent: data.percent } }));
      if (data.stage === "proxy-done" && data.proxyUrl) {
        const asset = useAssetsStore.getState().assets.find((a) => a.filePath === data.filePath);
        if (asset) useAssetsStore.getState().updateAsset(asset.id, { url: data.proxyUrl, previewUrl: data.proxyUrl });
      }
    });
  }, []);

  useEffect(() => {
    window.studioV4?.readRecentProjects?.().then((data) => {
      if (Array.isArray(data)) setRecentVideos(data as RecentVideoProject[]);
    });
  }, []);

  useEffect(() => {
    if (!window.studioV4?.onExportProgress) return;
    return window.studioV4.onExportProgress((data: { percent: number; outputPath?: string }) => {
      setExportProgress(data.percent);
    });
  }, []);

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

  const handleSeek = useCallback((t: number) => {
    setCurrentTime(t);
    if (videoRef.current) videoRef.current.currentTime = t;
  }, []);

  const ingestFiles = useCallback(async (filePaths: string[]) => {
    if (!window.studioV4?.media?.ingest) return;
    setImporting(true);

    for (const filePath of filePaths) {
      try {
        const result = await window.studioV4.media.ingest(filePath);
        if (result.error) { console.error(`Ingest error for ${filePath}:`, result.error); continue; }

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
      } catch (err) {
        console.error(`Failed to ingest ${filePath}:`, err);
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
  }, [ingestFiles]);

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

  function handleMenuCommand(command: MenuCommand) {
    switch (command) {
      case "home": setScreen("home"); break;
      case "new-project":
        setProjectName("Studio V4 " + String(Date.now()).slice(-3));
        setAssets([]);
        timelineClear();
        break;
      case "import": handleImport(); break;
      case "export": setDialog("export"); break;
      case "drive": setDialog("drive"); break;
      case "save": case "save-file": {
        const snap = getProjectSnapshot();
        window.studioV4?.saveProjectFile?.({ snapshot: snap, defaultName: projectName }).then((savedPath) => {
          if (savedPath) {
            window.studioV4?.readRecentProjects?.().then((prev) => {
              const list = [
                { name: projectName, date: new Date().toISOString() },
                ...((prev as any[] ?? []).filter((r: any) => r.name !== projectName).slice(0, 9)),
              ];
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

        <div className="flex min-h-0 flex-1">
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

          <main className="flex min-w-0 flex-1 flex-col bg-[var(--workspace)]">
            <div className="flex min-h-0 flex-1">
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
                      {Object.entries(importProgress).map(([fp, { stage, percent }]) => (
                        <div key={fp} className="mt-1.5">
                          <p className="truncate text-[9px] text-muted-foreground">{fp.split(/[/\\]/).pop()}</p>
                          <div className="mt-0.5 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${percent}%` }} />
                          </div>
                          <p className="text-[8px] text-muted-foreground mt-0.5">{stageLabel(stage)} — {percent}%</p>
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
                        className="flex items-center gap-1 rounded-md border border-white/15 bg-white/8 px-1.5 py-1 hover:bg-white/12 transition"
                        title={`${activeFormat.label} ${activeFormat.size}`}
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
                    <div className="h-5 w-px bg-white/15" />
                    {/* Preview tools */}
                    <button type="button" onClick={() => setPreviewTool(previewTool === "move" ? null : "move")} className={`grid size-7 place-items-center rounded-md transition ${previewTool === "move" ? "bg-primary text-white" : "text-foreground/70 hover:bg-white/10 hover:text-foreground"}`} title="Mover/Redimensionar">
                      <Move className="size-3.5" />
                    </button>
                    <button type="button" onClick={() => setPreviewTool(previewTool === "crop" ? null : "crop")} className={`grid size-7 place-items-center rounded-md transition ${previewTool === "crop" ? "bg-primary text-white" : "text-foreground/70 hover:bg-white/10 hover:text-foreground"}`} title="Cortar">
                      <Crop className="size-3.5" />
                    </button>
                    <div className="h-5 w-px bg-white/15" />
                    {/* Mask tools */}
                    <button type="button" onClick={() => setPreviewTool(previewTool === "chroma" ? null : "chroma")} className={`grid size-7 place-items-center rounded-md transition ${previewTool === "chroma" ? "bg-green-500 text-white" : "text-foreground/70 hover:bg-white/10 hover:text-foreground"}`} title="Chroma Key">
                      <Eraser className="size-3.5" />
                    </button>
                    <button type="button" onClick={() => setPreviewTool(previewTool === "mask-rect" ? null : "mask-rect")} className={`grid size-7 place-items-center rounded-md transition ${previewTool === "mask-rect" ? "bg-primary text-white" : "text-foreground/70 hover:bg-white/10 hover:text-foreground"}`} title="Mascara retangular">
                      <RectangleHorizontal className="size-3.5" />
                    </button>
                    <button type="button" onClick={() => setPreviewTool(previewTool === "mask-circle" ? null : "mask-circle")} className={`grid size-7 place-items-center rounded-md transition ${previewTool === "mask-circle" ? "bg-primary text-white" : "text-foreground/70 hover:bg-white/10 hover:text-foreground"}`} title="Mascara circular">
                      <Circle className="size-3.5" />
                    </button>
                    <button type="button" onClick={() => setPreviewTool(previewTool === "mask-pen" ? null : "mask-pen")} className={`grid size-7 place-items-center rounded-md transition ${previewTool === "mask-pen" ? "bg-primary text-white" : "text-foreground/70 hover:bg-white/10 hover:text-foreground"}`} title="Mascara livre (pen)">
                      <PenTool className="size-3.5" />
                    </button>
                    <div className="h-5 w-px bg-white/15" />
                    <button type="button" onClick={() => setSplitScreen(!splitScreen)} className={`grid size-7 place-items-center rounded-md transition ${splitScreen ? "bg-primary text-white" : "text-foreground/70 hover:bg-white/10 hover:text-foreground"}`} title="Tela dividida">
                      <SplitSquareVertical className="size-3.5" />
                    </button>
                    <div className="h-5 w-px bg-white/15" />
                    <button type="button" onClick={() => setPreviewTool(previewTool === "remove-wm" ? null : "remove-wm")} className={`grid size-7 place-items-center rounded-md transition ${previewTool === "remove-wm" ? "bg-amber-500 text-white" : "text-foreground/70 hover:bg-white/10 hover:text-foreground"}`} title="Remover marca d'agua">
                      <Stamp className="size-3.5" />
                    </button>
                  </div>

                  <span className="text-[9px] text-foreground/50 font-mono">{activeFormat.size}</span>
                </div>

                {/* Preview area — respeita o aspect ratio do formato selecionado */}
                <div ref={previewStageRef} className="preview-stage relative flex flex-1 items-center justify-center overflow-hidden bg-[var(--preview-surface)] p-3">
                  <div
                    className="preview-frame relative overflow-hidden rounded bg-[var(--preview-frame)] shadow-2xl ring-1 ring-white/10"
                    style={
                      previewFrameSize.width > 0
                        ? { width: previewFrameSize.width, height: previewFrameSize.height }
                        : { aspectRatio: activeFormat.aspect, maxHeight: "100%", maxWidth: "100%" }
                    }
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
                        style={{
                          filter: activeEffectCss,
                          transform: `translate(${videoTransform.x}px, ${videoTransform.y}px) scale(${videoTransform.scale / 100})`,
                        }}
                        muted={isMuted}
                        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
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
                    {captionSegments.length > 0 && (
                      <div
                        className="absolute left-1/2 -translate-x-1/2 cursor-move select-none"
                        style={{ bottom: `${captionY}%` }}
                        onPointerDown={(e) => {
                          const startY = e.clientY;
                          const startVal = captionY;
                          const parent = e.currentTarget.parentElement!;
                          const h = parent.getBoundingClientRect().height;
                          const move = (ev: PointerEvent) => {
                            const dy = startY - ev.clientY;
                            setCaptionY(Math.max(2, Math.min(80, startVal + (dy / h) * 100)));
                          };
                          const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
                          window.addEventListener("pointermove", move);
                          window.addEventListener("pointerup", up);
                        }}
                      >
                        <div className="rounded bg-black/70 px-3 py-1.5 text-center backdrop-blur-sm">
                          <p className="text-white text-xs font-bold whitespace-nowrap">
                            {captionSegments.find((s) => currentTime >= s.start && currentTime <= s.end)?.text || ""}
                          </p>
                        </div>
                      </div>
                    )}

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
                                  if (!previewAsset?.filePath || !wmRegion) return;
                                  setWmRemoving(true);
                                  try {
                                    const result = await window.studioV4?.media?.removeWatermark(previewAsset.filePath, wmRegion);
                                    if (result?.proxyUrl) {
                                      updateAsset(previewAsset.id, { previewUrl: result.proxyUrl, url: result.proxyUrl });
                                    }
                                  } catch (err) {
                                    console.error(err);
                                  } finally {
                                    setWmRemoving(false);
                                    setWmRegion(null);
                                    setPreviewTool(null);
                                  }
                                }}
                                className="rounded bg-amber-500 px-2 py-0.5 text-[9px] font-bold text-black hover:bg-amber-400 disabled:opacity-50"
                              >
                                {wmRemoving ? "Removendo..." : "Remover marca"}
                              </button>
                            </>
                          ) : (
                            <span className="text-[9px] text-white/60">Desenhe um retangulo sobre a marca d'agua</span>
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
                  {activeTool === "ai" ? (
                    <CleanCutPanel
                      assets={assets}
                      selectedAssetId={selectedAssetId}
                      onApplyCuts={handleApplyCuts}
                      onSeek={handleSeek}
                    />
                  ) : activeTool === "captions" ? (
                    <TranscriptionPanel
                      assets={assets}
                      selectedAssetId={selectedAssetId}
                      onSeek={handleSeek}
                      onCaptionsGenerated={setCaptionSegments}
                    />
                  ) : activeTool === "presets" ? (
                    <PresetsPanel
                      onApplyPreset={(id, name) => { /* TODO: apply preset to timeline */ }}
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
                  ) : activeTool === "audio" ? (
                    <div className="flex flex-col gap-3">
                      <h3 className="text-xs font-black">Áudio IA</h3>
                      <p className="text-[10px] text-muted-foreground leading-relaxed">
                        Use o <strong>Corte Limpo</strong> para remover silêncios automaticamente com análise de áudio.
                      </p>
                      <button
                        type="button"
                        onClick={() => setActiveTool("ai")}
                        className="rounded-lg bg-primary px-3 py-2 text-xs font-bold text-white hover:bg-primary/90 transition"
                      >
                        Ir para Corte Limpo
                      </button>

                      {/* Separacao vocal (com fallback FFmpeg) */}
                      <div className="rounded-xl border border-border bg-card/40 p-3">
                        <p className="mb-1 text-[9px] font-black uppercase tracking-widest text-muted-foreground/70">Separar Voz</p>
                        <p className="mb-2 text-[10px] text-muted-foreground leading-relaxed">
                          Isola voz e instrumental do clipe selecionado.
                        </p>
                        <button
                          type="button"
                          disabled={!previewAsset?.filePath || vocalSep?.loading}
                          onClick={async () => {
                            if (!previewAsset?.filePath) return;
                            setVocalSep({ loading: true, message: null, isError: false });
                            try {
                              const r = await window.studioV4?.media?.separateVocals?.(previewAsset.filePath);
                              if (!r || r.error) {
                                setVocalSep({ loading: false, isError: true, message: r?.message || r?.error || "Falha na separacao vocal" });
                              } else {
                                setVocalSep({ loading: false, isError: false, message: r.message, vocalsUrl: r.vocalsUrl, instrumentalUrl: r.instrumentalUrl });
                              }
                            } catch (err) {
                              setVocalSep({ loading: false, isError: true, message: err instanceof Error ? err.message : "Erro na separacao vocal" });
                            }
                          }}
                          className="w-full rounded-lg bg-primary px-3 py-2 text-xs font-bold text-white hover:bg-primary/90 transition disabled:opacity-40"
                        >
                          {vocalSep?.loading ? "Separando..." : "Separar voz / instrumental"}
                        </button>
                        {vocalSep?.message && (
                          <div className={`mt-2 rounded-lg border p-2 ${vocalSep.isError ? "border-destructive/30 bg-destructive/10" : "border-amber-500/30 bg-amber-500/10"}`}>
                            <p className={`text-[9px] leading-relaxed ${vocalSep.isError ? "text-destructive" : "text-amber-600 dark:text-amber-300"}`}>{vocalSep.message}</p>
                          </div>
                        )}
                        {vocalSep?.vocalsUrl && (
                          <div className="mt-2 flex flex-col gap-1.5">
                            <div>
                              <p className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground/60">Voz</p>
                              <audio src={vocalSep.vocalsUrl} controls className="mt-0.5 h-7 w-full" />
                            </div>
                            {vocalSep.instrumentalUrl && (
                              <div>
                                <p className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground/60">Instrumental</p>
                                <audio src={vocalSep.instrumentalUrl} controls className="mt-0.5 h-7 w-full" />
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {previewAsset?.waveformPeaks && previewAsset.waveformPeaks.length > 0 && (
                        <div>
                          <p className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-wider mb-1">Waveform</p>
                          <div className="flex h-12 items-end gap-px rounded bg-muted/30 px-1">
                            {previewAsset.waveformPeaks.map((peak, i) => (
                              <div key={i} className="flex-1 bg-primary/60 rounded-sm" style={{ height: `${Math.max(4, peak * 100)}%` }} />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
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
                    <div className="flex flex-col gap-4">
                      {/* Cabecalho com thumbnail */}
                      <div className="overflow-hidden rounded-xl border border-border bg-card">
                        <div className="relative aspect-video w-full bg-[var(--preview-frame)]">
                          {previewAsset.thumbnailUrl ? (
                            <img src={previewAsset.thumbnailUrl} className="h-full w-full object-cover" alt="" />
                          ) : (
                            <div className="grid h-full w-full place-items-center">
                              {previewAsset.kind === "audio" ? <Music2 className="size-8 text-white/20" /> : previewAsset.kind === "image" ? <ImageIcon className="size-8 text-white/20" /> : <Film className="size-8 text-white/20" />}
                            </div>
                          )}
                          <span className="absolute bottom-1.5 left-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-white/80 backdrop-blur-sm">
                            {previewAsset.kind}
                          </span>
                          {previewAsset.metadata?.duration && (
                            <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[8px] font-mono text-white/80 backdrop-blur-sm">
                              {previewAsset.metadata.duration}
                            </span>
                          )}
                        </div>
                        <div className="px-3 py-2.5">
                          <p className="truncate text-[12px] font-bold" title={previewAsset.name}>{previewAsset.displayName || previewAsset.name}</p>
                          <p className="mt-0.5 text-[9px] text-muted-foreground">{previewAsset.size}</p>
                        </div>
                      </div>

                      {/* Card de propriedades */}
                      <InfoCard title="Propriedades">
                        <InfoRow label="Arquivo" value={previewAsset.name} />
                        {previewAsset.metadata?.resolution && <InfoRow label="Resolucao" value={previewAsset.metadata.resolution} />}
                        {previewAsset.metadata?.duration && <InfoRow label="Duracao" value={previewAsset.metadata.duration} />}
                        {previewAsset.metadata?.codec && <InfoRow label="Codec" value={previewAsset.metadata.codec} />}
                        {previewAsset.metadata?.fps && <InfoRow label="FPS" value={previewAsset.metadata.fps} />}
                        <InfoRow label="Tamanho" value={previewAsset.size} />
                        <InfoRow label="Tipo" value={previewAsset.kind} />
                      </InfoCard>

                      {/* Card do Drive */}
                      <InfoCard title="Backup & Drive">
                        <DrivePanel
                          connected={driveConnected}
                          profile={googleProfile}
                          projectName={projectName}
                          onConnect={(p) => { setGoogleProfile(p); setDriveConnected(true); }}
                          onDisconnect={() => { setGoogleProfile(null); setDriveConnected(false); }}
                          onLoadProject={handleLoadProject}
                          getProjectSnapshot={getProjectSnapshot}
                        />
                      </InfoCard>
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
              currentTime={currentTime}
              captionSegments={captionSegments}
              onSeek={handleSeek}
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
        {dialog === "export" && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => { if (exportProgress === null || exportProgress === 100) setDialog(null); }}>
            <div className="w-[420px] rounded-xl border border-border bg-background p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-sm font-black mb-4">Exportar Vídeo</h2>

              {exportProgress !== null && exportProgress < 100 ? (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">Exportando... {exportProgress}%</p>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${exportProgress}%` }} />
                  </div>
                </div>
              ) : exportProgress === 100 ? (
                <div className="space-y-3">
                  <p className="text-xs text-green-500 font-bold">Exportação concluída!</p>
                  <button type="button" onClick={() => { setDialog(null); setExportProgress(null); }} className="w-full rounded-lg bg-primary px-4 py-2 text-xs font-bold text-white hover:bg-primary/90">
                    Fechar
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {exportError && (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3">
                      <p className="text-[11px] text-destructive">{exportError}</p>
                    </div>
                  )}

                  <div>
                    <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-wider mb-1.5">Resolução</p>
                    <div className="flex gap-2">
                      {(["720p", "1080p"] as const).map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setExportResolution(r)}
                          className={`flex-1 rounded-lg border py-2 text-xs font-bold transition ${exportResolution === r ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/50"}`}
                        >
                          {r === "720p" ? "720p (HD)" : "1080p (Full HD)"}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="text-[10px] text-muted-foreground space-y-0.5">
                    <p>{visualCopies.length} clipe{visualCopies.length !== 1 ? "s" : ""} na timeline</p>
                    <p>Formato: MP4 H.264 — AAC 192k</p>
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button type="button" onClick={() => { setDialog(null); setExportError(null); }} className="flex-1 rounded-lg border border-border px-4 py-2 text-xs font-bold text-muted-foreground hover:text-foreground">
                      Cancelar
                    </button>
                    <button
                      type="button"
                      disabled={visualCopies.length === 0}
                      onClick={async () => {
                        setExportError(null);
                        const outputPath = await window.studioV4?.showSaveDialog?.({
                          title: "Exportar vídeo",
                          defaultPath: projectName || "export",
                          filters: [{ name: "Vídeo MP4", extensions: ["mp4"] }],
                        });
                        if (!outputPath) return;
                        setExportProgress(0);
                        try {
                          const clips = visualCopies.map((c) => {
                            const asset = assets.find((a) => a.id === c.assetId);
                            return {
                              filePath: asset?.filePath || "",
                              trimStart: c.trimStart ?? 0,
                              duration: c.duration ?? 5,
                              speed: c.speed ?? 1,
                            };
                          });
                          await window.studioV4?.exportVideo?.({ clips, outputPath, resolution: exportResolution });
                        } catch (err) {
                          setExportProgress(null);
                          setExportError(err instanceof Error ? err.message : "Erro ao exportar");
                        }
                      }}
                      className="flex-1 rounded-lg bg-primary px-4 py-2 text-xs font-bold text-white hover:bg-primary/90 disabled:opacity-40"
                    >
                      Exportar
                    </button>
                  </div>
                </div>
              )}
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

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card/40 p-3">
      <p className="mb-2 text-[9px] font-black uppercase tracking-widest text-muted-foreground/70">{title}</p>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/40 pb-1.5 last:border-0 last:pb-0">
      <p className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-muted-foreground/60">{label}</p>
      <p className="min-w-0 break-all text-right text-[11px] font-semibold">{value}</p>
    </div>
  );
}

function stageLabel(stage: string): string {
  const map: Record<string, string> = {
    probe: "Analisando", thumbnail: "Thumbnail", waveform: "Waveform",
    proxy: "Criando proxy", "proxy-done": "Proxy pronto",
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
