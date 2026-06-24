import type { FormatPreset } from "@/types/editor";

export const formatPresets: FormatPreset[] = [
  { id: "reels", label: "Reels", size: "1080x1920", aspect: "9 / 16" },
  { id: "tiktok", label: "TikTok", size: "1080x1920", aspect: "9 / 16" },
  { id: "youtube", label: "YouTube", size: "1920x1080", aspect: "16 / 9" },
  { id: "feed", label: "Feed", size: "1080x1080", aspect: "1 / 1" },
  { id: "story", label: "Story", size: "1080x1920", aspect: "9 / 16" },
  { id: "wide", label: "Wide", size: "2560x1440", aspect: "16 / 9" },
];
