export {};

export interface MediaProbeResult {
  filePath: string;
  fileName: string;
  fileSize: number;
  duration: number;
  bitrate: number;
  formatName: string;
  formatLongName: string;
  hasVideo: boolean;
  hasAudio: boolean;
  video: {
    codec: string;
    codecLong: string;
    width: number;
    height: number;
    fps: number;
    bitrate: number;
    pixelFormat: string;
    profile: string;
  } | null;
  audio: {
    codec: string;
    codecLong: string;
    sampleRate: number;
    channels: number;
    channelLayout: string;
    bitrate: number;
  } | null;
  error?: string;
}

export interface MediaIngestResult {
  filePath: string;
  fileName: string;
  kind: "video" | "audio" | "image" | "file";
  metadata: {
    duration: number;
    fileSize: number;
    formatName: string;
    video: { codec: string; width: number; height: number; fps: number; bitrate: number } | null;
    audio: { codec: string; sampleRate: number; channels: number; bitrate: number } | null;
  };
  thumbnailUrl: string | null;
  thumbnailStrip: string[] | null;
  waveformPeaks: number[] | null;
  proxyUrl: string | null;
  convertedUrl: string | null;
  needsProxy: boolean;
  needsConvert: boolean;
  error?: string;
}

export interface MediaProgressEvent {
  filePath: string;
  stage: "probe" | "thumbnail" | "waveform" | "proxy" | "convert" | "strip" | "transcribe" | "done";
  percent: number;
}

declare global {
  interface Window {
    studioV4?: {
      isElectron: boolean;

      media: {
        ingest: (filePath: string) => Promise<MediaIngestResult>;
        probe: (filePath: string) => Promise<MediaProbeResult>;
        thumbnail: (filePath: string, opts?: { timestamp?: string; width?: number }) => Promise<{ url?: string; error?: string }>;
        waveform: (filePath: string, numBars?: number) => Promise<{ peaks: number[] }>;
        createProxy: (filePath: string, opts?: { maxHeight?: number }) => Promise<{ proxyUrl: string; proxyPath: string }>;
        convertAudio: (filePath: string, opts?: { format?: string }) => Promise<{ url: string; path: string; format: string }>;
        extractWav: (filePath: string) => Promise<{ path?: string; error?: string }>;
        thumbnailStrip: (filePath: string, opts?: { count?: number; width?: number; height?: number }) => Promise<{ thumbnails: string[]; duration: number }>;
        transcribe: (filePath: string, language?: string) => Promise<{ segments: Array<{ start: number; end: number; text: string }>; language?: string; error?: string }>;
        removeWatermark: (filePath: string, region: { x: number; y: number; w: number; h: number }) => Promise<{ outputPath: string; proxyUrl: string }>;
        onProgress: (cb: (data: MediaProgressEvent) => void) => () => void;
      };

      googleAuth: () => Promise<{ accessToken: string; refreshToken: string | null; expiresIn: number }>;
      googleRefreshToken: (refreshToken: string) => Promise<{ accessToken: string; expiresIn: number }>;

      readRecentProjects: () => Promise<unknown[]>;
      writeRecentProjects: (data: unknown[]) => Promise<void>;
      readConfig: () => Promise<Record<string, unknown>>;
      writeConfig: (data: Record<string, unknown>) => Promise<boolean>;

      openFileDialog: () => Promise<string[] | null>;
      showSaveDialog: (opts: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>;
      saveProjectFile: (payload: { snapshot: unknown; defaultName: string }) => Promise<string | null>;
      openProjectFile: () => Promise<unknown | null>;

      exportVideo: (payload: { clips: { filePath: string | null; trimStart: number; duration: number; speed: number }[]; outputPath: string; resolution: string }) => Promise<{ outputPath: string }>;
      onExportProgress: (cb: (data: { percent: number; outputPath: string }) => void) => () => void;
    };
  }
}
