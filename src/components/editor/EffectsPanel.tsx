import { useState } from "react";
import { Wand2, Check } from "lucide-react";

type EffectItem = {
  id: string;
  name: string;
  category: string;
  cssFilter: string;
  previewGradient: string;
};

const EFFECTS: EffectItem[] = [
  { id: "none", name: "Original", category: "Base", cssFilter: "none", previewGradient: "from-gray-800 to-gray-600" },
  { id: "warm", name: "Quente", category: "Cor", cssFilter: "sepia(0.3) saturate(1.4) brightness(1.05)", previewGradient: "from-orange-700 to-yellow-600" },
  { id: "cold", name: "Frio", category: "Cor", cssFilter: "saturate(0.8) hue-rotate(15deg) brightness(1.1)", previewGradient: "from-blue-800 to-cyan-600" },
  { id: "vintage", name: "Vintage", category: "Cor", cssFilter: "sepia(0.5) contrast(1.1) brightness(0.95)", previewGradient: "from-amber-800 to-yellow-900" },
  { id: "bw", name: "P&B", category: "Cor", cssFilter: "grayscale(1) contrast(1.2)", previewGradient: "from-gray-900 to-gray-400" },
  { id: "dramatic", name: "Dramatico", category: "Cor", cssFilter: "contrast(1.4) saturate(0.6) brightness(0.9)", previewGradient: "from-gray-900 to-red-900" },
  { id: "pastel", name: "Pastel", category: "Cor", cssFilter: "saturate(0.5) brightness(1.2) contrast(0.9)", previewGradient: "from-pink-300 to-blue-300" },
  { id: "teal-orange", name: "Teal & Orange", category: "Cinema", cssFilter: "saturate(1.3) hue-rotate(-10deg) contrast(1.1)", previewGradient: "from-teal-700 to-orange-600" },
  { id: "cinema", name: "Cinema", category: "Cinema", cssFilter: "contrast(1.2) saturate(0.9) brightness(0.95) sepia(0.1)", previewGradient: "from-slate-800 to-amber-900" },
  { id: "neon", name: "Neon", category: "Estilo", cssFilter: "saturate(2) contrast(1.3) brightness(1.1)", previewGradient: "from-purple-600 to-pink-500" },
  { id: "matte", name: "Matte", category: "Estilo", cssFilter: "contrast(0.85) brightness(1.1) saturate(0.9)", previewGradient: "from-stone-600 to-stone-400" },
  { id: "sharpen", name: "Nitido", category: "Ajuste", cssFilter: "contrast(1.15) brightness(1.02)", previewGradient: "from-gray-700 to-white" },
  { id: "soft", name: "Suave", category: "Ajuste", cssFilter: "contrast(0.9) brightness(1.08) blur(0.3px)", previewGradient: "from-rose-200 to-sky-200" },
  { id: "high-contrast", name: "Alto Contraste", category: "Ajuste", cssFilter: "contrast(1.6) saturate(1.1)", previewGradient: "from-black to-white" },
];

const CATEGORIES = [...new Set(EFFECTS.map((e) => e.category))];

interface EffectsPanelProps {
  activeEffect: string | null;
  onApplyEffect: (effectId: string, cssFilter: string) => void;
  previewFrameUrl?: string;
}

export function EffectsPanel({ activeEffect, onApplyEffect, previewFrameUrl }: EffectsPanelProps) {
  const [hoveredEffect, setHoveredEffect] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const filtered = selectedCategory
    ? EFFECTS.filter((e) => e.category === selectedCategory)
    : EFFECTS;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-xs font-black flex items-center gap-1.5">
          <Wand2 className="size-3.5 text-primary" />
          Efeitos
        </h3>
        <p className="mt-1 text-[10px] text-muted-foreground leading-relaxed">
          Passe o mouse para ver o efeito no video. Clique para aplicar.
        </p>
      </div>

      <div className="flex gap-1 flex-wrap">
        <button
          type="button"
          onClick={() => setSelectedCategory(null)}
          className={`rounded-md px-2 py-1 text-[9px] font-semibold transition ${
            !selectedCategory ? "bg-primary text-white" : "bg-card text-muted-foreground border border-border hover:text-foreground"
          }`}
        >
          Todos
        </button>
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setSelectedCategory(cat)}
            className={`rounded-md px-2 py-1 text-[9px] font-semibold transition ${
              selectedCategory === cat ? "bg-primary text-white" : "bg-card text-muted-foreground border border-border hover:text-foreground"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-1.5 max-h-[400px] overflow-y-auto">
        {filtered.map((effect) => {
          const isActive = activeEffect === effect.id;
          const isHovered = hoveredEffect === effect.id;

          return (
            <button
              key={effect.id}
              type="button"
              onClick={() => onApplyEffect(effect.id, effect.cssFilter)}
              onMouseEnter={() => {
                setHoveredEffect(effect.id);
                onApplyEffect(effect.id, effect.cssFilter);
              }}
              onMouseLeave={() => {
                setHoveredEffect(null);
                if (!isActive) onApplyEffect(activeEffect || "none", EFFECTS.find((e) => e.id === (activeEffect || "none"))?.cssFilter || "none");
              }}
              className={`group relative flex flex-col rounded-lg overflow-hidden border transition ${
                isActive
                  ? "border-primary ring-1 ring-primary/40"
                  : isHovered
                  ? "border-primary/40"
                  : "border-border hover:border-muted-foreground/30"
              }`}
            >
              {/* Preview thumbnail */}
              <div className="relative h-16 overflow-hidden">
                {previewFrameUrl ? (
                  <img
                    src={previewFrameUrl}
                    className="h-full w-full object-cover"
                    style={{ filter: effect.cssFilter }}
                    alt=""
                  />
                ) : (
                  <div className={`h-full w-full bg-gradient-to-br ${effect.previewGradient}`} />
                )}
                {isActive && (
                  <div className="absolute top-1 right-1 grid size-4 place-items-center rounded-full bg-primary text-white">
                    <Check className="size-2.5" />
                  </div>
                )}
              </div>
              <div className="px-1.5 py-1 bg-card">
                <p className="truncate text-[9px] font-semibold text-center">{effect.name}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { EFFECTS };
export type { EffectItem };
