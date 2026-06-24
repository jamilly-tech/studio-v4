import { useState } from "react";
import { Layers, FolderOpen, Plus, Upload, ChevronRight, ChevronDown, Palette, Film } from "lucide-react";
import type { ImportedAsset } from "@/types/editor";

type PresetFolder = {
  id: string;
  name: string;
  emoji: string;
  items: PresetItem[];
  collapsed: boolean;
};

type PresetItem = {
  id: string;
  name: string;
  type: "lut" | "preset" | "template";
  source: string;
  preview?: string;
};

const DEFAULT_FOLDERS: PresetFolder[] = [
  {
    id: "adobe", name: "Adobe", emoji: "🎬",
    collapsed: false,
    items: [
      { id: "ae-glow", name: "Glow Suave", type: "preset", source: "After Effects" },
      { id: "ae-cinematic", name: "Cinematic Bars", type: "preset", source: "After Effects" },
      { id: "pr-smooth", name: "Smooth Cut", type: "preset", source: "Premiere" },
      { id: "pr-film", name: "Film Grain 16mm", type: "preset", source: "Premiere" },
    ],
  },
  {
    id: "davinci", name: "DaVinci", emoji: "🎨",
    collapsed: false,
    items: [
      { id: "dv-teal", name: "Teal & Orange", type: "lut", source: "DaVinci Resolve" },
      { id: "dv-bw", name: "B&W Contrast", type: "lut", source: "DaVinci Resolve" },
      { id: "dv-vintage", name: "Vintage 70s", type: "lut", source: "DaVinci Resolve" },
    ],
  },
  {
    id: "capcut", name: "CapCut", emoji: "✂️",
    collapsed: true,
    items: [
      { id: "cc-vlog", name: "Vlog Clean", type: "template", source: "CapCut" },
      { id: "cc-retro", name: "Retro VHS", type: "preset", source: "CapCut" },
    ],
  },
  {
    id: "vegas", name: "Sony Vegas", emoji: "🎵",
    collapsed: true,
    items: [
      { id: "sv-shake", name: "Camera Shake", type: "preset", source: "Sony Vegas" },
      { id: "sv-color", name: "Color Correction", type: "preset", source: "Sony Vegas" },
    ],
  },
  {
    id: "luts", name: "LUTs", emoji: "🌈",
    collapsed: false,
    items: [
      { id: "lut-rec709", name: "Rec.709 Standard", type: "lut", source: ".cube" },
      { id: "lut-slog", name: "S-Log3 to Rec.709", type: "lut", source: ".cube" },
      { id: "lut-warm", name: "Warm Sunset", type: "lut", source: ".cube" },
      { id: "lut-cold", name: "Cold Blue", type: "lut", source: ".cube" },
      { id: "lut-skin", name: "Skin Tone Fix", type: "lut", source: ".cube" },
    ],
  },
  {
    id: "meus", name: "Meus Presets", emoji: "⭐",
    collapsed: true,
    items: [],
  },
];

const TYPE_COLORS: Record<string, string> = {
  lut: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  preset: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  template: "bg-amber-500/20 text-amber-400 border-amber-500/30",
};

const TYPE_LABELS: Record<string, string> = {
  lut: "LUT",
  preset: "Preset",
  template: "Template",
};

interface PresetsPanelProps {
  onApplyPreset: (presetId: string, presetName: string) => void;
  onImportPreset: () => void;
}

export function PresetsPanel({ onApplyPreset, onImportPreset }: PresetsPanelProps) {
  const [folders, setFolders] = useState<PresetFolder[]>(DEFAULT_FOLDERS);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  function toggleFolder(folderId: string) {
    setFolders((prev) =>
      prev.map((f) => (f.id === folderId ? { ...f, collapsed: !f.collapsed } : f))
    );
  }

  const filteredFolders = search.trim()
    ? folders.map((f) => ({
        ...f,
        items: f.items.filter((item) =>
          item.name.toLowerCase().includes(search.toLowerCase()) ||
          item.source.toLowerCase().includes(search.toLowerCase())
        ),
        collapsed: false,
      })).filter((f) => f.items.length > 0)
    : folders;

  const totalPresets = folders.reduce((sum, f) => sum + f.items.length, 0);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-xs font-black flex items-center gap-1.5">
          <Layers className="size-3.5 text-primary" />
          Presets e LUTs
        </h3>
        <p className="mt-1 text-[10px] text-muted-foreground leading-relaxed">
          Importe de Adobe, DaVinci, CapCut, Vegas ou qualquer .cube/.look/.ffx
        </p>
      </div>

      <div className="flex gap-1.5">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar preset..."
          className="flex-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-[10px] outline-none focus:border-primary placeholder:text-muted-foreground/40"
        />
        <button
          type="button"
          onClick={onImportPreset}
          className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-[10px] font-bold text-white hover:bg-primary/90 active:scale-95 transition"
        >
          <Upload className="size-3" />
          Importar
        </button>
      </div>

      <p className="text-[8px] text-muted-foreground/50">
        {totalPresets} presets em {folders.length} pastas
      </p>

      <div className="max-h-[400px] overflow-y-auto -mx-1">
        {filteredFolders.map((folder) => (
          <div key={folder.id} className="mb-0.5">
            <button
              type="button"
              onClick={() => toggleFolder(folder.id)}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left hover:bg-card transition"
            >
              {folder.collapsed ? <ChevronRight className="size-3 text-muted-foreground" /> : <ChevronDown className="size-3 text-muted-foreground" />}
              <span className="text-[11px]">{folder.emoji}</span>
              <span className="text-[11px] font-bold flex-1">{folder.name}</span>
              <span className="text-[9px] text-muted-foreground/50">{folder.items.length}</span>
            </button>

            {!folder.collapsed && (
              <div className="ml-5 grid gap-0.5 pb-1">
                {folder.items.length === 0 ? (
                  <p className="px-2 py-1.5 text-[9px] text-muted-foreground/40 italic">
                    Vazio — arraste presets aqui
                  </p>
                ) : (
                  folder.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", `preset:${item.id}:${item.name}`);
                        e.dataTransfer.effectAllowed = "copy";
                      }}
                      onClick={() => onApplyPreset(item.id, item.name)}
                      onMouseEnter={() => setHoveredItem(item.id)}
                      onMouseLeave={() => setHoveredItem(null)}
                      className={`group flex cursor-grab items-center gap-2 rounded-md px-2 py-1.5 text-left transition active:cursor-grabbing ${
                        hoveredItem === item.id ? "bg-card ring-1 ring-primary/30" : "hover:bg-card/50"
                      }`}
                    >
                      <div className="grid size-8 place-items-center rounded bg-muted/50 overflow-hidden shrink-0">
                        {item.type === "lut" ? (
                          <div className="size-full bg-gradient-to-br from-purple-600/40 via-orange-500/30 to-teal-500/40" />
                        ) : item.type === "template" ? (
                          <Film className="size-3.5 text-amber-400/60" />
                        ) : (
                          <Palette className="size-3.5 text-blue-400/60" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[10px] font-medium">{item.name}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className={`inline-flex rounded px-1 py-px text-[7px] font-bold border ${TYPE_COLORS[item.type]}`}>
                            {TYPE_LABELS[item.type]}
                          </span>
                          <span className="text-[8px] text-muted-foreground/50">{item.source}</span>
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
