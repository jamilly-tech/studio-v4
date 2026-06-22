import { Cloud } from "lucide-react";
import type { GoogleDriveProfile, RecentVideoProject } from "@/types/editor";
import logoWhite from "@/assets/v4-user-logo-white.png";

export function HomeScreen({
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
    <section className="relative min-h-0 flex-1 overflow-y-auto bg-[#0f0f10] p-5 text-white">
      <div className="absolute inset-0 bg-[linear-gradient(135deg,#0f0f10,#18191b_50%,#111)]" />
      <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:44px_44px]" />

      <div className="home-reveal relative z-10 mx-auto grid w-full max-w-7xl gap-5">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src={logoWhite} alt="V4 Company" className="h-10 w-36 object-contain object-left" />
            <div>
              <p className="text-lg font-black">Studio V4</p>
              <p className="text-xs font-semibold text-white/50">Editor</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.07] p-2 backdrop-blur">
            <div className="flex min-w-0 items-center gap-3">
              <span
                className={`grid size-10 shrink-0 place-items-center rounded-md ${
                  driveConnected
                    ? "bg-[var(--success)] text-[var(--success-foreground)]"
                    : "bg-primary text-white"
                }`}
              >
                {driveConnected && googleProfile?.picture ? (
                  <img src={googleProfile.picture} alt={googleProfile.name} className="size-10 rounded-md object-cover" />
                ) : (
                  <Cloud className="size-5" />
                )}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-black">
                  {driveConnected ? googleProfile?.name || "Drive pronto" : "Google Drive"}
                </p>
                {driveConnected && googleProfile?.email && (
                  <p className="mt-1 text-xs font-semibold text-white/65">{googleProfile.email}</p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onDrive}
              className="shrink-0 rounded-md bg-white/12 px-3 py-2 text-xs font-black text-white transition hover:bg-white/18 active:scale-95"
            >
              {driveConnected ? "Conta" : "Conectar"}
            </button>
          </div>
        </header>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <button
            type="button"
            onClick={onEnter}
            className="group flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.04] p-4 text-left transition hover:border-primary/40 hover:bg-white/[0.07]"
          >
            <p className="text-sm font-black text-white group-hover:text-primary">Continuar projeto</p>
            <p className="text-xs text-white/50">{projectName} — {assetCount} arquivo(s)</p>
          </button>

          <button
            type="button"
            onClick={onNewProject}
            className="group flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.04] p-4 text-left transition hover:border-primary/40 hover:bg-white/[0.07]"
          >
            <p className="text-sm font-black text-white group-hover:text-primary">Novo projeto</p>
            <p className="text-xs text-white/50">Timeline vazia, pronto para importar</p>
          </button>
        </div>

        {recentVideos.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-black text-white/60">Recentes</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {recentVideos.slice(0, 6).map((video) => (
                <button
                  key={video.id}
                  type="button"
                  onClick={() => onOpenProject(video.projectName, video.filePath)}
                  className="flex items-center gap-3 rounded-md border border-white/10 bg-white/[0.03] p-3 text-left transition hover:bg-white/[0.07]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-bold text-white">{video.projectName}</p>
                    <p className="truncate text-[10px] text-white/40">{video.meta}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
