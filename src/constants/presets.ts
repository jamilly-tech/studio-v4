import type { PresetGroupId, PreviewQualityId } from "@/types/editor";

export const exportVideoFormats = [
  { id: "mp4", label: "MP4", detail: "Padrao para redes, WhatsApp, YouTube e Drive" },
  { id: "mov", label: "MOV", detail: "Qualidade alta para edicao em Mac/Premiere" },
  { id: "webm", label: "WebM", detail: "Leve para versao web" },
  { id: "mkv", label: "MKV", detail: "Arquivo robusto com multiplas faixas" },
  { id: "avi", label: "AVI", detail: "Compatibilidade antiga" },
] as const;

export const previewQualityOptions: {
  id: PreviewQualityId;
  label: string;
  detail: string;
  hint: string;
}[] = [
  { id: "high", label: "Alta", detail: "Original", hint: "Para PCs fortes" },
  { id: "medium", label: "Media", detail: "720p", hint: "Equilibrio" },
  { id: "low", label: "Baixa", detail: "360p", hint: "PC fraco" },
];

export const presetGroups: {
  id: PresetGroupId;
  label: string;
  hint: string;
}[] = [
  { id: "after-effects", label: "After", hint: "FFX, AEP, JSX" },
  { id: "premiere", label: "Premiere", hint: "MOGRT, PRFPSET, PRPROJ" },
  { id: "sony-vegas", label: "Vegas", hint: "VEG, SFPRESET, FX" },
  { id: "capcut", label: "CapCut", hint: "Template, XML" },
  { id: "lut", label: "LUT/Cor", hint: "CUBE, LOOK, XMP" },
  { id: "custom", label: "Meus", hint: "Separados por voce" },
];

export type WorkspaceBlockId = "library" | "player" | "details" | "timeline";

export const blockLabels: Record<WorkspaceBlockId, string> = {
  library: "Midia e acoes",
  player: "Preview",
  details: "IA e detalhes",
  timeline: "Timeline",
};

export const initialBlockOrder: WorkspaceBlockId[] = ["library", "player", "details", "timeline"];

export const initialBlockWidths: Record<WorkspaceBlockId, number> = {
  library: 26,
  player: 48,
  details: 26,
  timeline: 100,
};

export const initialBlockHeights: Record<WorkspaceBlockId, number> = {
  library: 56,
  player: 56,
  details: 56,
  timeline: 36,
};
