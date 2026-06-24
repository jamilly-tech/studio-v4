import type React from "react";

export type ThemeMode = "light" | "dark";
export type AppScreen = "home" | "editor";
export type DialogId = "help" | "drive" | "save" | "export" | "share" | null;
export type PreviewQualityId = "high" | "medium" | "low";
export type FrameFitMode = "contain" | "cover" | "fill";
export type MosaicLayoutMode = "single" | "stack-2" | "stack-3";
export type BackgroundToolMode = "none" | "remove" | "chroma";

export type PresetGroupId =
  | "after-effects"
  | "premiere"
  | "sony-vegas"
  | "capcut"
  | "lut"
  | "custom";

export type ToolId =
  | "media"
  | "audio"
  | "presets"
  | "text"
  | "stickers"
  | "effects"
  | "transitions"
  | "captions"
  | "filters"
  | "adjust"
  | "templates"
  | "ai"
  | "restore"
  | "settings";

export type FormatPreset = {
  id: string;
  label: string;
  size: string;
  aspect: string;
};

export type AssetKind = "video" | "image" | "audio" | "preset" | "file";

export type AssetMetadata = {
  duration?: string;
  durationSeconds?: number;
  resolution?: string;
  fps?: string;
  codec?: string;
};

export type ImportedAsset = {
  id: string;
  name: string;
  displayName?: string;
  kind: AssetKind;
  size: string;
  url: string;
  previewUrl?: string;
  file?: File;
  filePath?: string;
  thumbnailUrl?: string;
  presetGroup?: PresetGroupId;
  metadata?: AssetMetadata;
  status: "checking" | "ready" | "limited" | "error" | "converting" | "needs-convert";
  error?: string;
  waveformPeaks?: number[];
  volumeDb?: number;
  audioEffect?: string | null;
};

export type RecentVideoProject = {
  id: string;
  name: string;
  projectName: string;
  meta: string;
  thumbnailUrl?: string;
  updatedAt: string;
  filePath?: string;
};

export type BrandPattern = {
  id: string;
  name: string;
  font: string;
  primaryColor: string;
  secondaryColor: string;
  captionStyle: string;
};

export type GoogleDriveProfile = {
  name: string;
  email: string;
  picture?: string;
};

export type GoogleDriveFolder = {
  id: string;
  name: string;
};

export type GoogleDriveFile = {
  id: string;
  name: string;
  size?: string;
  mimeType?: string;
};

export type FrameAdjust = {
  fit: FrameFitMode;
  scale: number;
  x: number;
  y: number;
};

export type TimelineLayerKind = "effect" | "filter" | "preset";

export type IconComponent = React.ComponentType<{ className?: string; size?: number | string }>;

export type TimelineLayerClip = {
  id: string;
  sourceId: string;
  label: string;
  detail: string;
  icon: IconComponent;
  color: string;
  kind: TimelineLayerKind;
  preview?: string;
};

export type TimelineVisualCopy = {
  id: string;
  assetId: string;
  widthPx?: number;
  startTime?: number;
  duration?: number;
  trimStart?: number;
  trimEnd?: number;
  trackIndex?: number;
  analysisTag?: "clean-cut" | "repetition-review" | "manual" | "imported";
  note?: string;
  speed?: number;
  opacity?: number;
  brightness?: number;
};

export type SmartFrame = {
  id: string;
  label: string;
  time: string;
  score: number;
  color: string;
  assetId?: string;
  sourceName?: string;
};

export type TimelineSlot = {
  id: string;
  name: string;
  layers: TimelineLayerClip[];
  visualCopies: TimelineVisualCopy[];
  smartFrames: SmartFrame[];
  captionsGenerated: boolean;
  repetitionScanDone: boolean;
};

export type TranscriptSegment = { start: number; end: number; text: string };

export type DetectedRepetition = {
  id: string;
  label: string;
  time: string;
  startTime: number;
  endTime: number;
  similarity: number;
  occurrences: number;
  text?: string;
  confidence?: number;
  occurrenceTimes?: { start: number; end: number; text: string; score: number }[];
  bestTakeStartTime?: number;
  bestTakeEndTime?: number;
};

export type CaptionRowStyle = {
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
};

export type CaptionRow = {
  id: string;
  time: string;
  text: string;
  startSec?: number;
  endSec?: number;
  style?: CaptionRowStyle;
};
