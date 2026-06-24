import type { TimelineVisualCopy } from "@/types/editor";

export interface PlaybackPosition {
  clip: TimelineVisualCopy;
  sourceTime: number;
}

/** Converte tempo da timeline → clip ativo + offset no arquivo fonte */
export function resolveAtTime(
  copies: TimelineVisualCopy[],
  timelineTime: number
): PlaybackPosition | null {
  const sorted = [...copies].sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0));
  for (const clip of sorted) {
    const start = clip.startTime ?? 0;
    const dur = clip.duration ?? 0;
    if (timelineTime >= start && timelineTime < start + dur) {
      const localOffset = timelineTime - start;
      const sourceTime = (clip.trimStart ?? 0) + localOffset * (clip.speed ?? 1);
      return { clip, sourceTime };
    }
  }
  return null;
}

/** Duração total da timeline (fim do último clipe) */
export function getTimelineDuration(copies: TimelineVisualCopy[]): number {
  return copies.reduce((max, c) => Math.max(max, (c.startTime ?? 0) + (c.duration ?? 0)), 0);
}

/** Converte tempo do arquivo fonte → tempo na timeline para o clip dado */
export function sourceTimeToTimeline(
  clip: TimelineVisualCopy,
  sourceTime: number
): number {
  const trimStart = clip.trimStart ?? 0;
  const speed = clip.speed ?? 1;
  const clipStart = clip.startTime ?? 0;
  return clipStart + (sourceTime - trimStart) / speed;
}
