import { useEffect, useState } from "react";
import {
  AudioLines, Captions, ChevronDown, CircleHelp, FileText,
  FolderOpen, Home, LayoutTemplate, Menu, PenLine, RotateCcw,
  Save, Scissors, Sun, Moon,
} from "lucide-react";
import type { ThemeMode, GoogleDriveProfile } from "@/types/editor";
import { MenuColumn, type MenuCommand, type MenuItem } from "./MenuColumn";
import logoRed from "@/assets/v4-user-logo-red.png";
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
  const [draftName, setDraftName] = useState(projectName);
  const [menuOpen, setMenuOpen] = useState(false);

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
    <header className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-background px-3">
      <div className="flex items-center gap-3">
        <img
          src={theme === "dark" ? logoWhite : logoRed}
          alt="V4 Company"
          className="h-7 w-28 object-contain object-left"
        />
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-bold hover:bg-muted transition"
          >
            <Menu className="size-4" />
            Menu
            <ChevronDown className="size-3 text-muted-foreground" />
          </button>
          {menuOpen && (
            <div className="absolute left-0 top-8 z-50 grid w-[560px] grid-cols-4 overflow-hidden rounded-md border border-border bg-background text-xs shadow-2xl">
              <MenuColumn
                title="Arquivo"
                items={[
                  ["Inicio", "home", Home, "Volta para a tela inicial"],
                  ["Novo projeto", "new-project", FileText, "Limpa a timeline e comeca do zero"],
                  ["Salvar .sv4", "save-file", Save, "Salva projeto como arquivo local .sv4"],
                  ["Abrir .sv4", "open-file", FolderOpen, "Abre projeto salvo em arquivo .sv4"],
                ] as MenuItem[]}
                onSelect={(command) => { setMenuOpen(false); onMenuCommand(command); }}
              />
              <MenuColumn
                title="Editar"
                items={[
                  ["Fatiar", "slice", PenLine, "Divide o trecho selecionado"],
                  ["Corte limpo auto", "cut-clean", Scissors, "Marca pausas e repeticoes sem cortar fala"],
                  ["Legendas", "captions-panel", Captions, "Gera, busca e ajusta texto por fala"],
                  ["Audio IA", "audio-panel", AudioLines, "Separa voz, ruido, eco e instrumentos"],
                ] as MenuItem[]}
                onSelect={(command) => { setMenuOpen(false); onMenuCommand(command); }}
              />
              <MenuColumn
                title="Layout"
                items={[
                  ["Salvar blocos", "save-layout", Save, "Guarda sua organizacao de paineis"],
                  ["Carregar blocos", "load-layout", LayoutTemplate, "Restaura o layout salvo"],
                  ["Restaurar padrao", "reset-layout", RotateCcw, "Volta ao layout original"],
                ] as MenuItem[]}
                onSelect={(command) => { setMenuOpen(false); onMenuCommand(command); }}
              />
              <MenuColumn
                title="Ajuda"
                items={[
                  ["Central de ajuda", "help", CircleHelp, "Como usar, fluxo e criacao V4"],
                ] as MenuItem[]}
                onSelect={(command) => { setMenuOpen(false); onMenuCommand(command); }}
              />
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {isEditingName ? (
          <input
            value={draftName}
            autoFocus
            onChange={(event) => setDraftName(event.currentTarget.value)}
            onBlur={saveProjectName}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") { setDraftName(projectName); setIsEditingName(false); }
            }}
            className="h-7 w-44 rounded-md border border-primary bg-card px-3 text-center text-xs font-bold outline-none"
            aria-label="Renomear projeto"
          />
        ) : (
          <button
            type="button"
            onClick={() => setIsEditingName(true)}
            className="max-w-[200px] truncate rounded-md border border-border bg-card px-3 py-1 text-xs font-bold hover:border-primary/40 transition"
            title="Clique para renomear"
          >
            {projectName}
          </button>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onThemeChange(theme === "dark" ? "light" : "dark")}
          className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-card hover:text-foreground transition"
          title={theme === "dark" ? "Modo claro" : "Modo escuro"}
        >
          {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
      </div>
    </header>
  );
}
