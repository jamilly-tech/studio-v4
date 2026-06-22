import type { IconComponent } from "@/types/editor";

export type MenuCommand =
  | "new-project"
  | "import"
  | "export"
  | "share"
  | "drive"
  | "save"
  | "slice"
  | "cut-clean"
  | "captions-panel"
  | "audio-panel"
  | "home"
  | "save-layout"
  | "load-layout"
  | "reset-layout"
  | "save-file"
  | "open-file"
  | "help";

export type MenuItem = [string, MenuCommand, IconComponent, string?];

export function MenuColumn({
  title,
  items,
  onSelect,
}: {
  title: string;
  items: MenuItem[];
  onSelect: (command: MenuCommand) => void;
}) {
  return (
    <div className="border-r border-border last:border-r-0">
      <p className="border-b border-border bg-card px-3 py-2 font-black text-primary">{title}</p>
      <div className="p-1">
        {items.map(([label, command, Icon, detail]) => (
          <button
            key={`${title}-${label}`}
            type="button"
            onClick={() => onSelect(command)}
            className="flex w-full items-center gap-2 rounded px-2 py-2 text-left font-semibold text-muted-foreground hover:bg-card hover:text-foreground"
            title={detail ?? label}
          >
            <Icon className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
