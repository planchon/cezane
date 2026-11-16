import { FFPROBE, runOk } from "./proc";

export type Probe = {
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  hasVideo: boolean;
  hasAudio: boolean;
  codec?: string;
  isImage: boolean;
};

const IMAGE_CODECS = new Set(["png", "mjpeg", "webp", "bmp", "tiff", "gif", "heif", "hevc_image"]);

export async function probe(path: string): Promise<Probe> {
  const { stdout } = await runOk([FFPROBE, "-v", "error", "-print_format", "json", "-show_streams", "-show_format", path]);
  const j = JSON.parse(stdout) as {
    streams: { codec_type: string; codec_name: string; width?: number; height?: number; avg_frame_rate?: string; side_data_list?: { rotation?: number }[]; tags?: { rotate?: string } }[];
    format: { duration?: string; format_name?: string };
  };
  const v = j.streams.find((s) => s.codec_type === "video");
  const a = j.streams.find((s) => s.codec_type === "audio");
  const duration = j.format.duration ? Number(j.format.duration) : undefined;
  const isImage = Boolean(v && (IMAGE_CODECS.has(v.codec_name) || /image2|png_pipe|jpeg_pipe|webp_pipe/.test(j.format.format_name ?? "")) && (!duration || duration < 0.1 || !a));
  let width = v?.width;
  let height = v?.height;
  const rot = Math.abs(v?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? Number(v?.tags?.rotate ?? 0));
  if (rot === 90 || rot === 270) [width, height] = [height, width];
  let fps: number | undefined;
  if (v?.avg_frame_rate && v.avg_frame_rate !== "0/0") {
    const [n, d] = v.avg_frame_rate.split("/").map(Number);
    fps = d ? n! / d : n;
  }
  return { duration: isImage ? undefined : duration, width, height, fps, hasVideo: Boolean(v) && !isImage, hasAudio: Boolean(a), codec: v?.codec_name ?? a?.codec_name, isImage };
}
