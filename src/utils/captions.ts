import type { CaptionSegment } from "@/types/editor";
import { createLocalId } from "./id";

export function createSegmentId(): string {
  return createLocalId("cap");
}

// ── Normalização ──────────────────────────────────────────────────────────────

const PROPER_NOUNS: string[] = [
  "Brasil","São Paulo","Rio de Janeiro","Belo Horizonte","Curitiba","Porto Alegre",
  "Salvador","Fortaleza","Manaus","Recife","Brasília","Goiânia","Belém","Maceió",
  "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
  "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro",
  "Segunda","Terça","Quarta","Quinta","Sexta","Sábado","Domingo",
  "YouTube","Instagram","TikTok","WhatsApp","Facebook","Twitter","Pinterest","LinkedIn",
  "Google","iPhone","Android","Windows","MacOS","iOS","Linux",
  "CapCut","Premiere","DaVinci","Canva","Figma","Photoshop","Lightroom",
  "Studio V4","ChatGPT","OpenAI","Anthropic",
];

export function normalizeCaptionText(text: string): string {
  if (!text?.trim()) return text;
  let t = text.trim();

  // Remove espaços múltiplos
  t = t.replace(/\s{2,}/g, " ");

  // Remove espaço antes de pontuação
  t = t.replace(/\s+([,;:.!?])/g, "$1");

  // Garante espaço após , ; :
  t = t.replace(/([,;:])([^\s\d])/g, "$1 $2");

  // Múltiplos pontos → reticências
  t = t.replace(/\.{2,}/g, "...");

  // Capitaliza a primeira letra do texto
  t = t.charAt(0).toUpperCase() + t.slice(1);

  // Capitaliza após . ! ? seguido de espaço
  t = t.replace(/([.!?]\s+)([a-z])/g, (_m, p, l) => p + l.toUpperCase());

  // Restaura nomes próprios conhecidos (case-insensitive → forma correta)
  for (const noun of PROPER_NOUNS) {
    const safe = noun.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    t = t.replace(new RegExp(`\\b${safe}\\b`, "gi"), noun);
  }

  return t;
}

export function normalizeAllCaptions(segs: CaptionSegment[]): CaptionSegment[] {
  return segs.map(s => ({ ...s, text: normalizeCaptionText(s.text) }));
}

// ── Busca ─────────────────────────────────────────────────────────────────────

function stripAccents(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function searchSegments(segs: CaptionSegment[], query: string): number[] {
  if (!query.trim()) return [];
  const q = stripAccents(query.toLowerCase());
  return segs.reduce<number[]>((acc, s, i) => {
    if (stripAccents(s.text.toLowerCase()).includes(q)) acc.push(i);
    return acc;
  }, []);
}

// ── Substituição ──────────────────────────────────────────────────────────────

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function replaceInSegment(
  segs: CaptionSegment[], idx: number, search: string, replace: string
): CaptionSegment[] {
  return segs.map((s, i) => {
    if (i !== idx) return s;
    return { ...s, text: s.text.replace(new RegExp(escapeRegex(search), "gi"), replace) };
  });
}

export function replaceInAllSegments(
  segs: CaptionSegment[], search: string, replace: string
): CaptionSegment[] {
  const re = new RegExp(escapeRegex(search), "gi");
  return segs.map(s => ({ ...s, text: s.text.replace(re, replace) }));
}

// ── Operações de segmento ─────────────────────────────────────────────────────

export function updateSegmentText(segs: CaptionSegment[], idx: number, text: string): CaptionSegment[] {
  return segs.map((s, i) => i === idx ? { ...s, text } : s);
}

export function deleteSegment(segs: CaptionSegment[], idx: number): CaptionSegment[] {
  return segs.filter((_, i) => i !== idx);
}

export function splitSegment(segs: CaptionSegment[], idx: number, splitAt: number): CaptionSegment[] {
  const seg = segs[idx];
  if (!seg) return segs;
  const mid = Math.max(seg.start + 0.1, Math.min(seg.end - 0.1, splitAt));
  if (mid <= seg.start || mid >= seg.end) return segs;

  const words = seg.text.trim().split(/\s+/);
  const half = Math.ceil(words.length / 2);
  const left: CaptionSegment = {
    ...seg, id: createLocalId("cap"), end: mid,
    text: words.slice(0, half).join(" "),
  };
  const right: CaptionSegment = {
    ...seg, id: createLocalId("cap"), start: mid,
    text: words.slice(half).join(" "),
  };
  return [...segs.slice(0, idx), left, right, ...segs.slice(idx + 1)];
}

export function mergeWithNext(segs: CaptionSegment[], idx: number): CaptionSegment[] {
  if (idx >= segs.length - 1) return segs;
  const curr = segs[idx];
  const next = segs[idx + 1];
  const merged: CaptionSegment = {
    ...curr,
    end: next.end,
    text: (curr.text + " " + next.text).trim(),
  };
  return [...segs.slice(0, idx), merged, ...segs.slice(idx + 2)];
}

// ── Serialização SRT ──────────────────────────────────────────────────────────

function toSRTTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export function serializeCaptionsToSRT(segs: CaptionSegment[]): string {
  return segs
    .map((s, i) => `${i + 1}\n${toSRTTime(s.start)} --> ${toSRTTime(s.end)}\n${s.text}`)
    .join("\n\n");
}

// ── Serialização ASS ──────────────────────────────────────────────────────────

export interface CaptionStyleForExport {
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  bgColor?: string;
  bgOpacity?: number;
  shadow?: boolean;
  outline?: boolean;
  captionY?: number;
  playResX?: number;
  playResY?: number;
}

function toASSTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.round((sec % 1) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function hexToASS(hex: string, alpha = 0): string {
  const h = (hex || "#000000").replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) || 0;
  const g = parseInt(h.slice(2, 4), 16) || 0;
  const b = parseInt(h.slice(4, 6), 16) || 0;
  const a = Math.max(0, Math.min(255, alpha));
  return `&H${a.toString(16).padStart(2, "0").toUpperCase()}${b.toString(16).padStart(2, "0").toUpperCase()}${g.toString(16).padStart(2, "0").toUpperCase()}${r.toString(16).padStart(2, "0").toUpperCase()}`;
}

export function serializeCaptionsToASS(segs: CaptionSegment[], style?: CaptionStyleForExport): string {
  const resX = style?.playResX ?? 1920;
  const resY = style?.playResY ?? 1080;
  const fontName = (style?.fontFamily ?? "Arial").replace(/,/g, "");
  const fontSize = Math.round(style?.fontSize ?? 24);
  const primary = hexToASS(style?.color ?? "#ffffff", 0);
  const bgAlpha = style?.bgOpacity !== undefined
    ? Math.round((1 - style.bgOpacity / 100) * 255)
    : 128;
  const back = hexToASS(style?.bgColor ?? "#000000", bgAlpha);
  const outline = style?.outline ? 1 : 0;
  const shadow = style?.shadow ? 1 : 0;
  const captionY = style?.captionY ?? 32;
  const marginV = Math.round(resY * (captionY / 100) * 0.35);

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${resX}`,
    `PlayResY: ${resY}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${fontName},${fontSize},${primary},&H000000FF,&H00000000,${back},0,0,0,0,100,100,0,0,1,${outline},${shadow},2,10,10,${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");

  const events = segs
    .map(s => `Dialogue: 0,${toASSTime(s.start)},${toASSTime(s.end)},Default,,0,0,0,,${s.text.replace(/\n/g, "\\N")}`)
    .join("\n");

  return `${header}\n${events}\n`;
}

export function parseSRTToSegments(srt: string): CaptionSegment[] {
  const blocks = srt.trim().split(/\n\n+/);
  return blocks.flatMap(block => {
    const lines = block.trim().split("\n");
    if (lines.length < 3) return [];
    const m = lines[1].match(/(\d{2}:\d{2}:\d{2}[,.]?\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]?\d{3})/);
    if (!m) return [];
    const parse = (t: string) => {
      const [hms, ms] = t.replace(",", ".").split(".");
      const [h, min, s] = hms.split(":").map(Number);
      return h * 3600 + min * 60 + s + Number("0." + ms);
    };
    return [{
      id: createLocalId("cap"),
      start: parse(m[1]),
      end: parse(m[2]),
      text: lines.slice(2).join("\n"),
    }];
  });
}
