export const videoExtensions = new Set([
  "mp4", "mov", "mkv", "avi", "webm", "m4v", "wmv", "flv",
  "mpeg", "mpg", "3gp", "3g2", "ts", "mts", "m2ts", "ogv",
  "vob", "asf", "rm", "rmvb", "divx", "f4v",
]);

export const imageExtensions = new Set([
  "jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff",
  "svg", "heic", "heif", "avif", "raw", "dng", "cr2", "nef", "arw", "psd",
]);

export const audioExtensions = new Set([
  "mp3", "wav", "aac", "m4a", "flac", "ogg", "oga", "opus",
  "wma", "aif", "aiff", "caf", "amr", "midi", "mid",
]);

export const presetExtensions = new Set([
  "ffx", "aep", "aepx", "jsx", "jsxbin", "prfpset", "epr", "prproj",
  "mogrt", "cube", "look", "xmp", "kys", "veg", "vegbak", "sfvp0",
  "sfpreset", "sft2", "vf", "cptemplate", "capcut", "ccpreset",
  "lut", "xml", "fcpxml", "json", "drp", "resolve",
]);

export const MIME_MAP: Record<string, string> = {
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", mkv: "video/x-matroska",
  avi: "video/x-msvideo", webm: "video/webm", wmv: "video/x-ms-wmv", flv: "video/x-flv",
  mpeg: "video/mpeg", mpg: "video/mpeg", "3gp": "video/3gpp", "3g2": "video/3gpp2",
  ts: "video/mp2t", mts: "video/mp2t", m2ts: "video/mp2t", ogv: "video/ogg",
  vob: "video/x-vob", asf: "video/x-ms-asf", rm: "video/x-pn-realvideo",
  rmvb: "video/x-pn-realvideo", divx: "video/x-divx", f4v: "video/x-f4v",
  mp3: "audio/mpeg", wav: "audio/wav", aac: "audio/aac", m4a: "audio/mp4",
  flac: "audio/flac", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/opus",
  wma: "audio/x-ms-wma", aif: "audio/aiff", aiff: "audio/aiff", caf: "audio/x-caf",
  amr: "audio/amr", midi: "audio/midi", mid: "audio/midi",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  gif: "image/gif", bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff",
  svg: "image/svg+xml", heic: "image/heic", heif: "image/heif", avif: "image/avif",
  raw: "image/x-raw", dng: "image/x-canon-raw", cr2: "image/x-canon-crw",
  nef: "image/x-nikon-nef", arw: "image/x-sony-arw", psd: "image/vnd.adobe.photoshop",
};
