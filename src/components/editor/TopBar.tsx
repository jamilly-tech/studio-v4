import { useEffect, useState } from "react";
import {
  AudioLines, Captions, ChevronDown, CircleHelp, FileText,
  FolderOpen, Home, LayoutTemplate, Menu, PenLine, RotateCcw,
  Save, Scissors, Sun, Moon,
} from "lucide-react";
import type { ThemeMode, GoogleDriveProfile } from "@/types/editor";
import { MenuColumn, type MenuCommand, type MenuItem } from "./MenuColumn";
import logoRed   from "@/assets/v4-user-logo-red.png";
import logoWhite from "@/assets/v4-user-logo-white.png";

export function TopBar({
  theme,
  projectName,
  driveConnected,
  googleProfile,
  onProjectNameChange,
  onThemeChange,
  onMenuCommand,
  onAction,
}: {
  theme: ThemeMode;
  projectName: string;
  driveConnected: boolean;
  googleProfile: GoogleDriveProfile | null;
  onProjectNameChange: (name: string) => void;
  onThemeChange: (theme: ThemeMode) => void;
  onMenuCommand: (command: MenuCommand) => void;
  onAction: (message: string) => void;
}) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [draftName, setDraftName]         = useState(projectName);
  const [menuOpen, setMenuOpen]           = useState(false);

  useEffect(() => {
    if (!isEditingName) setDraftName(projectName);
  }, [isEditingName, projectName]);

  function saveProjectName() {
    const nextName = draftName.trim() || projectName;
    setDraftName(nextName);
    setIsEditingName(false);
    if (nextName !== projectName) onProjectNameChange(nextName);
  }

  return (
    <header className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-card px-3">
      {/* esquerda: logo + menu */}
      <div className="flex items-center gap-3">
        <img
          src={theme === "dark" ? logoWhite : logoRed}
          alt="Studio V4"
          className="h-7 w-28 object-contain object-left"
        />

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2.5 py-1.5 text-xs font-bold text-foreground transition hover:bg-muted"
          >
            <Menu className="size-4" />
            Menu
            <ChevronDown className="size-3 text-muted-foreground" />
          </button>

          {menuOpen && (
            <div className="absolute left-0 top-9 z-50 grid w-[560px] grid-cols-4 overflow-hidden rounded-md border border-border bg-background text-xs shadow-2xl">
              <MenuColumn
                title="Arquivo"
                items={[
                  ["Inicio",       "home",        Home,         "Volta para a tela inicial"],
                  ["Novo projeto", "new-project",  FileText,     "Limpa a timeline e começa do zero"],
                  ["Salvar .v4",   "save-file",    Save,         "Salva projeto como arquivo local .v4"],
                  ["Abrir .v4",    "open-file",    FolderOpen,   "Abre projeto salvo em arquivo .v4"],
                ] as MenuItem[]}
                onSelect={(command) => { setMenuOpen(false); onMenuCommand(command); }}
              />
              <MenuColumn
                title="Editar"
                items={[
                  ["Fatiar",           "slice",         PenLine,    "Divide o trecho selecionado"],
                  ["Corte limpo auto", "cut-clean",     Scissors,   "Marca pausas sem cortar fala"],
                  ["Legendas",         "captions-panel",Captions,   "Gera, busca e ajusta texto por fala"],
                  ["Audio IA",         "audio-panel",   AudioLines, "Separa voz, ruído, eco e instrumentos"],
                ] as MenuItem[]}
                onSelect={(command) => { setMenuOpen(false); onMenuCommand(command); }}
              />
              <MenuColumn
                title="Layout"
                items={[
                  ["Salvar blocos",    "save-layout",  Save,           "Guarda sua organização de painéis"],
                  ["Carregar blocos",  "load-layout",  LayoutTemplate, "Restaura o layout salvo"],
                  ["Restaurar padrão", "reset-layout", RotateCcw,      "Volta ao layout original"],
                ] as MenuItem[]}
                onSelect={(command) => { setMenuOpen(false); onMenuCommand(command); }}
              />
              <MenuColumn
                title="Ajuda"
                items={[
                  ["Central de ajuda", "help", CircleHelp, "Como usar, fluxo e criação V4"],
                ] as MenuItem[]}
                onSelect={(command) => { setMenuOpen(false); onMenuCommand(command); }}
              />
            </div>
          )}
        </div>
      </div>

      {/* centro: nome do projeto */}
      <div className="flex items-center gap-2">
        {isEditingName ? (
          <input
            value={draftName}
            autoFocus
            onChange={(e) => setDraftName(e.currentTarget.value)}
            onBlur={saveProjectName}
            onKeyDown={(e) => {
              if (e.key === "Enter")   e.currentTarget.blur();
              if (e.key === "Escape") { setDraftName(projectName); setIsEditingName(false); }
            }}
            className="h-7 w-44 rounded-md border border-primary bg-card px-3 text-center text-xs font-bold text-foreground outline-none ring-1 ring-primary/40"
            aria-label="Renomear projeto"
          />
        ) : (
          <button
            type="button"
            onClick={() => setIsEditingName(true)}
            className="max-w-[200px] truncate rounded-md border border-border bg-secondary px-3 py-1.5 text-xs font-bold text-foreground transition hover:border-primary/50 hover:bg-muted"
            title="Clique para renomear"
          >
            {projectName}
          </button>
        )}
      </div>

      {/* direita: tema */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onThemeChange(theme === "dark" ? "light" : "dark")}
          className="grid size-8 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
          title={theme === "dark" ? "Modo claro" : "Modo escuro"}
        >
          {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
      </div>
    </header>
  );
}
