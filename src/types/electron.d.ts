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
  stage: "probe" | "thumbnail" | "waveform" | "waveform-done" | "proxy" | "proxy-done" | "proxy-error" | "convert" | "convert-done" | "strip" | "transcribe" | "stems" | "stems-done" | "lipsync" | "lipsync-done" | "remove-watermark" | "done";
  percent: number;
  proxyUrl?: string;
  waveformPeaks?: number[];
  error?: string;
  eta?: number | null;
  audioDuration?: number;
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
        separateStems: (filePath: string) => Promise<{ vocalsPath?: string; vocalsUrl?: string; instrumentalsPath?: string; instrumentalsUrl?: string; error?: string }>;
        separateStemsFast: (filePath: string) => Promise<{ vocalsPath?: string; vocalsUrl?: string; instrumentalsPath?: string; instrumentalsUrl?: string; error?: string }>;
        stemsModelStatus: () => Promise<{ ready: boolean; path: string | null }>;
        downloadStemsModel: () => Promise<{ ready: boolean }>;
        separateStemsBuiltin: (filePath: string) => Promise<{ vocalsPath?: string; vocalsUrl?: string; instrumentalsPath?: string; instrumentalsUrl?: string; error?: string }>;
        onModelProgress: (cb: (data: { percent?: number; done?: number; total?: number; ready?: boolean; error?: string; name?: string }) => void) => () => void;
        whisperStatus: () => Promise<{ exeReady: boolean; tinyReady: boolean; smallReady: boolean }>;
        transcribeBuiltin: (filePath: string, language?: string, trimStart?: number, trimDuration?: number, model?: string) => Promise<{ segments: Array<{ start: number; end: number; text: string }>; language?: string; error?: string }>;
        onWhisperStatus: (cb: (data: { stage?: string; percent?: number; done?: number; total?: number; ready?: boolean; error?: string }) => void) => () => void;
        thumbnailStrip: (filePath: string, opts?: { count?: number; width?: number; height?: number }) => Promise<{ thumbnails: string[]; duration: number }>;
        transcribe: (filePath: string, language?: string, trimStart?: number, trimDuration?: number) => Promise<{ segments: Array<{ start: number; end: number; text: string }>; language?: string; error?: string }>;
        detectRepeats: (filePath: string) => Promise<{ groups: Array<Array<{ idx: number; start: number; end: number; duration: number; meanVol: number; maxVol: number }>>; totalDuration: number; takesFound: number; error?: string }>;
        removeWatermark: (filePath: string, region: { x: number; y: number; w: number; h: number }) => Promise<{ outputPath: string; proxyUrl: string }>;
        onProgress: (cb: (data: MediaProgressEvent) => void) => () => void;
        registerProxy: (filePath: string) => Promise<{ url?: string; error?: string }>;
        saveAudio: (srcPath: string, defaultName?: string) => Promise<{ savedPath?: string; canceled?: boolean; error?: string }>;
        detectSilence: (filePath: string, opts?: { noiseDb?: number; minDur?: number; minPause?: number }) => Promise<{ intervals: { start: number; end: number; duration: number }[]; totalDuration: number; error?: string }>;
        listVoices: () => Promise<{ voices: string[] }>;
        synthesizeVoice: (text: string, voice?: string) => Promise<{ path?: string; url?: string; error?: string }>;
        lipsyncStatus: () => Promise<{ ready: boolean }>;
        lipSync: (videoPath: string, audioPath: string | null, trimStart?: number, trimDuration?: number) => Promise<{ outputPath?: string; url?: string; error?: string }>;
      };

      googleAuthConfigured: () => Promise<{ configured: boolean }>;
      googleAuth: () => Promise<{ accessToken: string; refreshToken: string | null; expiresIn: number }>;
      googleRefreshToken: (refreshToken: string) => Promise<{ accessToken: string; expiresIn: number }>;

      readRecentProjects: () => Promise<unknown[]>;
      writeRecentProjects: (data: unknown[]) => Promise<void>;
      readConfig: () => Promise<Record<string, unknown>>;
      writeConfig: (data: Record<string, unknown>) => Promise<boolean>;

      getPathForFile: (file: File) => string | null;
      openFileDialog: () => Promise<string[] | null>;
      showSaveDialog: (opts: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>;
      saveProjectFile: (payload: { snapshot: unknown; defaultName: string }) => Promise<string | null>;
      openProjectFile: () => Promise<unknown | null>;
      loadProjectFile: (filePath: string) => Promise<unknown | null>;

      exportVideo: (payload: { clips: { filePath: string | null; trimStart: number; duration: number; speed: number; audioOnly?: boolean; isOverlay?: boolean; startTime?: number }[]; outputPath: string; resolution: string; captionsASS?: string }) => Promise<{ outputPath: string }>;
      exportAudio: (payload: { clips: { filePath: string | null; trimStart: number; duration: number; speed: number }[]; outputPath: string; format: string }) => Promise<{ outputPath: string }>;
      exportGif: (payload: { clips: { filePath: string | null; trimStart: number; duration: number; speed: number }[]; outputPath: string; resolution: string }) => Promise<{ outputPath: string }>;
      savePortableV4: (payload: { snapshot: unknown; defaultName: string }) => Promise<unknown>;
      onExportProgress: (cb: (data: { percent: number; outputPath: string }) => void) => () => void;
    };
  }
}
