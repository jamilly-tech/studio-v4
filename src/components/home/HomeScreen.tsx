import { Plus, FolderOpen, Film, Cloud } from "lucide-react";
import type { GoogleDriveProfile, RecentVideoProject, ThemeMode } from "@/types/editor";
import logoWhite from "@/assets/v4-user-logo-white.png";
import logoRed   from "@/assets/v4-user-logo-red.png";

export function HomeScreen({
  theme,
  driveConnected,
  googleProfile,
  projectName,
  assetCount,
  lastThumbnailUrl,
  recentVideos,
  onDrive,
  onEnter,
  onNewProject,
  onOpenFile,
  onOpenProject,
}: {
  theme: ThemeMode;
  driveConnected: boolean;
  googleProfile: GoogleDriveProfile | null;
  projectName: string;
  assetCount: number;
  lastThumbnailUrl?: string;
  recentVideos: RecentVideoProject[];
  onDrive: () => void;
  onEnter: () => void;
  onNewProject: () => void;
  onOpenFile: () => void;
  onOpenProject: (name: string, filePath?: string) => void;
}) {
  return (
    <section className="relative min-h-0 flex-1 overflow-y-auto bg-background text-foreground">
      {/* Dot grid sutil */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.035] [background-image:radial-gradient(hsl(var(--foreground))_1px,transparent_1px)] [background-size:22px_22px]" />

      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col gap-5 p-5 pb-8">

        {/* ── Cabeçalho ────────────────────────────────────────────────── */}
        <header className="flex items-center justify-between gap-3">
          <img
            src={theme === "dark" ? logoWhite : logoRed}
            alt="Studio V4"
            className="h-7 w-24 object-contain object-left"
          />
          <button
            type="button"
            onClick={onDrive}
            className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-bold text-foreground transition hover:bg-secondary active:scale-95"
          >
            {driveConnected && googleProfile?.picture ? (
              <img src={googleProfile.picture} className="size-4 rounded-full object-cover" alt="" />
            ) : (
              <Cloud className="size-3.5 text-muted-foreground" />
            )}
            {driveConnected ? googleProfile?.name?.split(" ")[0] || "Drive" : "Conectar Drive"}
          </button>
        </header>

        {/* ── Hero + Ações ──────────────────────────────────────────────── */}
        <div className="grid gap-3 lg:grid-cols-[1fr_190px]">

          {/* Card hero — Continuar projeto */}
          <button
            type="button"
            onClick={onEnter}
            className="group relative min-h-[210px] overflow-hidden rounded-2xl border border-border/50 bg-card text-left shadow-sm transition-all duration-200 hover:border-primary/40 hover:shadow-md hover:shadow-primary/10 active:scale-[0.99]"
          >
            {/* Thumbnail ou gradiente */}
            {lastThumbnailUrl ? (
              <img
                src={lastThumbnailUrl}
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                alt=""
              />
            ) : (
              <>
                <div className="absolute inset-0 bg-gradient-to-br from-primary/25 via-primary/5 to-transparent" />
                <div className="absolute right-6 top-6 opacity-10">
                  <Film className="size-24 text-primary" />
                </div>
              </>
            )}

            {/* Gradiente de leitura */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />

            {/* Texto sobreposto */}
            <div className="absolute bottom-0 left-0 right-0 flex items-end justify-between p-4">
              <div className="min-w-0">
                <p className="text-[9px] font-black uppercase tracking-[0.15em] text-white/50">
                  Continuar editando
                </p>
                <p className="mt-0.5 truncate text-xl font-black text-white">
                  {projectName || "Meu Projeto"}
                </p>
                <p className="mt-0.5 text-[10px] text-white/45">
                  {assetCount > 0
                    ? `${assetCount} arquivo${assetCount !== 1 ? "s" : ""} importado${assetCount !== 1 ? "s" : ""}`
                    : "Arraste arquivos para começar"}
                </p>
              </div>
              <div className="ml-3 flex size-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm transition group-hover:bg-primary">
                <span className="ml-0.5 text-base leading-none">▶</span>
              </div>
            </div>
          </button>

          {/* Coluna de ações */}
          <div className="flex flex-col gap-2.5">
            <button
              type="button"
              onClick={onNewProject}
              className="group flex flex-1 flex-col items-center justify-center gap-2.5 rounded-2xl border border-dashed border-primary/35 bg-primary/5 p-4 text-center transition hover:border-primary/70 hover:bg-primary/10 active:scale-[0.97]"
            >
              <div className="flex size-9 items-center justify-center rounded-full bg-primary/15 transition group-hover:bg-primary">
                <Plus className="size-4 text-primary transition group-hover:text-white" />
              </div>
              <div>
                <p className="text-sm font-black text-foreground">Novo projeto</p>
                <p className="text-[10px] text-muted-foreground">Timeline vazia</p>
              </div>
            </button>

            <button
              type="button"
              onClick={onOpenFile}
              className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card py-2.5 text-xs font-bold text-muted-foreground transition hover:border-primary/40 hover:text-foreground active:scale-[0.97]"
            >
              <FolderOpen className="size-3.5" />
              Abrir .v4
            </button>
          </div>
        </div>

        {/* ── Projetos recentes ─────────────────────────────────────────── */}
        {recentVideos.length > 0 && (
          <div>
            <p className="mb-3 text-[9px] font-black uppercase tracking-[0.14em] text-muted-foreground/75">
              Recentes
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {recentVideos.slice(0, 6).map((video) => (
                <button
                  key={video.id}
                  type="button"
                  onClick={() => onOpenProject(video.projectName, video.filePath)}
                  className="group text-left transition active:scale-[0.98]"
                >
                  {/* Thumbnail 16:9 */}
                  <div className="relative aspect-video overflow-hidden rounded-xl border border-border/50 bg-card transition-all group-hover:border-primary/40 group-hover:shadow-md group-hover:shadow-primary/8">
                    {video.thumbnailUrl ? (
                      <img
                        src={video.thumbnailUrl}
                        className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        alt=""
                      />
                    ) : (
                      <>
                        <div className="absolute inset-0 bg-gradient-to-br from-primary/12 via-card to-black/15" />
                        <span className="absolute inset-0 flex items-center justify-center text-5xl font-black text-foreground/[0.07] select-none">
                          {video.projectName?.[0]?.toUpperCase() ?? "?"}
                        </span>
                      </>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/65 to-transparent" />
                    <p className="absolute bottom-2 left-2.5 right-2.5 truncate text-[10px] font-bold leading-tight text-white">
                      {video.projectName}
                    </p>
                  </div>
                  <p className="mt-1.5 text-[9px] text-muted-foreground/50">{video.meta}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Rodapé ────────────────────────────────────────────────────── */}
        <footer className="mt-2 border-t border-border/30 pt-4 text-center">
          <p className="text-[8.5px] text-muted-foreground/35">
            Studio V4 · Jamilly Barros · Kalyna Lima · Jasson Oliveira &amp; Co
          </p>
        </footer>

      </div>
    </section>
  );
}
