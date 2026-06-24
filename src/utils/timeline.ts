import type { ImportedAsset, TimelineVisualCopy } from "@/types/editor";
import { parseDurationSeconds } from "./format";
import { createLocalId } from "./id";

export const timelinePixelsPerSecond = 34;
export const minimumTimelineClipSeconds = 0.35;
export const defaultTimelineClipSeconds = 6;

export function getAssetDurationSeconds(asset?: Pick<ImportedAsset, "metadata"> | null) {
  const direct = asset?.metadata?.durationSeconds;
  if (Number.isFinite(direct) && direct && direct > 0) return direct;
  return parseDurationSeconds(asset?.metadata?.duration);
}

export function getTimelineClipDuration(copy: TimelineVisualCopy, asset?: ImportedAsset | null) {
  const explicitDuration = copy.duration;
  if (Number.isFinite(explicitDuration) && explicitDuration && explicitDuration > 0) {
    return Math.max(minimumTimelineClipSeconds, explicitDuration);
  }

  const trimStart = copy.trimStart ?? 0;
  const trimEnd = copy.trimEnd ?? 0;
  if (trimEnd > trimStart) return Math.max(minimumTimelineClipSeconds, trimEnd - trimStart);

  const assetDuration = getAssetDurationSeconds(asset);
  if (assetDuration > 0) return assetDuration;

  if (copy.widthPx && copy.widthPx > 0) {
    return Math.max(minimumTimelineClipSeconds, copy.widthPx / timelinePixelsPerSecond);
  }

  return defaultTimelineClipSeconds;
}

export function getTimelineClipWidth(copy: TimelineVisualCopy, asset?: ImportedAsset | null) {
  return Math.max(72, Math.round(getTimelineClipDuration(copy, asset) * timelinePixelsPerSecond));
}

export function getTimelineClipWidthAtScale(
  copy: TimelineVisualCopy,
  asset: ImportedAsset | null | undefined,
  pixelsPerSecond: number,
) {
  return Math.max(72, Math.round(getTimelineClipDuration(copy, asset) * pixelsPerSecond));
}

export function snapTimelineSeconds(seconds: number, enabled = true) {
  const safeSeconds = Math.max(0, seconds);
  return enabled ? Math.round(safeSeconds * 10) / 10 : safeSeconds;
}

export function getTimelineEndTime(copies: TimelineVisualCopy[], assets: ImportedAsset[]) {
  let nextAutoStart = 0;
  return copies.reduce((end, copy) => {
    const asset = assets.find((item) => item.id === copy.assetId);
    const duration = getTimelineClipDuration(copy, asset);
    const startTime = copy.startTime ?? nextAutoStart;
    nextAutoStart = Math.max(nextAutoStart, startTime + duration);
    return Math.max(end, startTime + duration);
  }, 0);
}

export function createTimelineCopyForAsset(
  asset: ImportedAsset,
  startTime: number,
  tag: TimelineVisualCopy["analysisTag"] = "manual",
  trackIndex = 0,
): TimelineVisualCopy {
  const duration = getAssetDurationSeconds(asset) || defaultTimelineClipSeconds;
  return {
    id: createLocalId("clip"),
    assetId: asset.id,
    startTime,
    duration,
    trimStart: 0,
    trimEnd: duration,
    trackIndex,
    widthPx: Math.round(duration * timelinePixelsPerSecond),
    analysisTag: tag,
  };
}
