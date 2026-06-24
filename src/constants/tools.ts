import {
  ArrowLeftRight, AudioLines, Bot, Captions, Film, Layers,
  LayoutTemplate, Music2, Palette, Settings, SlidersHorizontal,
  Sparkles, Sticker, Text, Wand2,
} from "lucide-react";
import type { ToolId } from "@/types/editor";

export const toolMap: Record<ToolId, { label: string; icon: typeof Film }> = {
  media: { label: "Midia", icon: Film },
  audio: { label: "Audio", icon: Music2 },
  presets: { label: "Presets", icon: Layers },
  text: { label: "Texto", icon: Text },
  stickers: { label: "Stickers", icon: Sticker },
  effects: { label: "Efeitos", icon: Sparkles },
  transitions: { label: "Transicoes", icon: ArrowLeftRight },
  captions: { label: "Legendas", icon: Captions },
  filters: { label: "Filtros", icon: Palette },
  adjust: { label: "Ajuste", icon: SlidersHorizontal },
  templates: { label: "Modelos", icon: LayoutTemplate },
  ai: { label: "IA", icon: Bot },
  restore: { label: "Restaurar", icon: Wand2 },
  settings: { label: "Config", icon: Settings },
};

export const toolDescriptions: Record<ToolId, string> = {
  media: "Importa video, audio, imagem, preset e qualquer arquivo do projeto.",
  audio: "Separa voz, ruido, outra pessoa, instrumentos e eco em camadas detectaveis.",
  presets: "Organiza presets de Premiere, After, Vegas, CapCut, LUTs e arquivos proprios.",
  text: "Cria titulos, chamadas e textos editaveis com visual da marca.",
  stickers: "Adiciona setas, selos e marcadores visuais sem poluir a timeline.",
  effects: "Aplica efeitos de foco, zoom e corte limpo com controle manual.",
  transitions: "Troca cenas com cortes, fades e movimentos simples.",
  captions: "Gera, localiza, revisa e estiliza legendas por fala.",
  filters: "Ajusta cor, contraste e tons de pele para acabamento premium.",
  adjust: "Corrige luz, nitidez e cor sem quebrar o arquivo original.",
  templates: "Usa estruturas prontas para shorts, aulas e depoimentos.",
  ai: "Sugere acoes de IA para acelerar repeticoes, cortes e melhores cenas.",
  restore: "Remove ruido e falhas de camera regenerativamente via filtro bilateral WebGL.",
  settings: "Configura transcricao local, modelos e preferencias do app.",
};

export const attachedTools: ToolId[] = [
  "audio",
  "effects",
  "transitions",
  "filters",
  "adjust",
  "templates",
];
