import { Cloud } from "lucide-react";
import type { GoogleDriveProfile, RecentVideoProject, ThemeMode } from "@/types/editor";
import logoWhite from "@/assets/v4-user-logo-white.png";
import logoRed   from "@/assets/v4-user-logo-red.png";

export function HomeScreen({
  theme,
  driveConnected,
  googleProfile,
  projectName,
  assetCount,
  recentVideos,
  onDrive,
  onEnter,
  onNewProject,
  onOpenProject,
}: {
  theme: ThemeMode;
  driveConnected: boolean;
  googleProfile: GoogleDriveProfile | null;
  projectName: string;
  assetCount: number;
  recentVideos: RecentVideoProject[];
  onDrive: () => void;
  onEnter: () => void;
  onNewProject: () => void;
  onOpenProject: (name: string, filePath?: string) => void;
}) {
  return (
    <section className="relative min-h-0 flex-1 overflow-y-auto bg-background p-5 text-foreground">
      {/* grade decorativa */}
      <div className="absolute inset-0 opacity-[0.03] [background-image:linear-gradient(hsl(var(--foreground))_1px,transparent_1px),linear-gradient(90deg,hsl(var(--foreground))_1px,transparent_1px)] [background-size:44px_44px]" />

      <div className="relative z-10 mx-auto grid w-full max-w-7xl gap-5">
        {/* cabeçalho */}
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img
              src={theme === "dark" ? logoWhite : logoRed}
              alt="Studio V4"
              className="h-10 w-36 object-contain object-left"
            />
            <div>
              <p className="text-lg font-black text-foreground">Studio V4</p>
              <p className="text-xs font-semibold text-muted-foreground">Editor</p>
            </div>
          </div>

          {/* bloco Google Drive */}
          <div className="flex items-center gap-2 rounded-md border border-border bg-card p-2 shadow-sm">
            <div className="flex min-w-0 items-center gap-3">
              <span
                className={`grid size-10 shrink-0 place-items-center rounded-md ${
                  driveConnected
                    ? "bg-[hsl(var(--success))] text-[hsl(var(--success-foreground))]"
                    : "bg-primary text-primary-foreground"
                }`}
              >
                {driveConnected && googleProfile?.picture ? (
                  <img
                    src={googleProfile.picture}
                    alt={googleProfile.name}
                    className="size-10 rounded-md object-cover"
                  />
                ) : (
                  <Cloud className="size-5" />
                )}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-black text-foreground">
                  {driveConnected ? googleProfile?.name || "Drive pronto" : "Google Drive"}
                </p>
                {driveConnected && googleProfile?.email && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{googleProfile.email}</p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onDrive}
              className="shrink-0 rounded-md bg-secondary px-3 py-2 text-xs font-black text-foreground transition hover:bg-muted active:scale-95"
            >
              {driveConnected ? "Conta" : "Conectar"}
            </button>
          </div>
        </header>

        {/* cartões de projeto */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <button
            type="button"
            onClick={onEnter}
            className="group flex flex-col gap-2 rounded-lg border border-border bg-card p-4 text-left transition hover:border-primary/50 hover:bg-secondary"
          >
            <p className="text-sm font-black text-foreground group-hover:text-primary">
              Continuar projeto
            </p>
            <p className="text-xs text-muted-foreground">
              {projectName} — {assetCount} arquivo(s)
            </p>
          </button>

          <button
            type="button"
            onClick={onNewProject}
            className="group flex flex-col gap-2 rounded-lg border border-border bg-card p-4 text-left transition hover:border-primary/50 hover:bg-secondary"
          >
            <p className="text-sm font-black text-foreground group-hover:text-primary">
              Novo projeto
            </p>
            <p className="text-xs text-muted-foreground">Timeline vazia, pronto para importar</p>
          </button>
        </div>

        {/* recentes */}
        {recentVideos.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-black text-muted-foreground uppercase tracking-wider">
              Recentes
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {recentVideos.slice(0, 6).map((video) => (
                <button
                  key={video.id}
                  type="button"
                  onClick={() => onOpenProject(video.projectName, video.filePath)}
                  className="flex items-center gap-3 rounded-md border border-border bg-card p-3 text-left transition hover:bg-secondary hover:border-border"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-bold text-foreground">{video.projectName}</p>
                    <p className="truncate text-[10px] text-muted-foreground">{video.meta}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* rodapé */}
        <footer className="mt-8 border-t border-border pt-6 text-center">
          <p className="text-xs font-black text-muted-foreground tracking-wide">Studio V4</p>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Criado por{" "}
            <span className="font-bold text-foreground">Jamilly Barros · Jasson Oliveira &amp; Co</span>
            {" · "}
            <span className="font-bold text-foreground">Kalyna Lima · V4 Aguiar</span>
          </p>
          <p className="mt-1 text-[9px] text-muted-foreground/50">
            Todos os direitos reservados
          </p>
        </footer>
      </div>
    </section>
  );
}
