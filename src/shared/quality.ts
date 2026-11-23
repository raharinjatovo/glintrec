import type { QualityId } from './ipc';

export interface QualityPreset {
  id: QualityId;
  label: string;
  /** Upper bound for the output canvas (smaller sources are never upscaled). */
  maxWidth: number;
  maxHeight: number;
  fps: number;
  videoBitsPerSecond: number;
}

export const QUALITY_PRESETS: QualityPreset[] = [
  { id: '720p30', label: '720p, 30 fps', maxWidth: 1280, maxHeight: 720, fps: 30, videoBitsPerSecond: 4_000_000 },
  { id: '1080p30', label: '1080p, 30 fps', maxWidth: 1920, maxHeight: 1080, fps: 30, videoBitsPerSecond: 8_000_000 },
  { id: '1080p60', label: '1080p, 60 fps', maxWidth: 1920, maxHeight: 1080, fps: 60, videoBitsPerSecond: 12_000_000 },
];

export const QUALITY_IDS: QualityId[] = QUALITY_PRESETS.map((p) => p.id);
export const DEFAULT_QUALITY: QualityId = '1080p30';

/** Unknown ids fall back to the default preset. */
export function qualityPreset(id: unknown): QualityPreset {
  return QUALITY_PRESETS.find((p) => p.id === id) ?? QUALITY_PRESETS.find((p) => p.id === DEFAULT_QUALITY)!;
}
