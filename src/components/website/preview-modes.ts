/**
 * The widths a website is previewed at: Desktop, Tablet and Mobile. A preview mode is only a viewport SIMULATION: the same site, drawn by the
 * same renderer, in a frame of this width (the renderer's sizes follow the width of the frame it sits in). It is not a second version of any
 * page and nothing about it is ever stored.
 *
 * One list for every place that previews a site (the Website Builder's canvas and the full Draft preview), so the widths are chosen once.
 */
export const PREVIEW_MODES = [
  { id: "desktop", label: "Desktop", width: 1024 },
  { id: "tablet", label: "Tablet", width: 768 },
  { id: "mobile", label: "Mobile", width: 390 },
] as const;

export type PreviewModeId = (typeof PREVIEW_MODES)[number]["id"];
export type PreviewMode = (typeof PREVIEW_MODES)[number];

export const DEFAULT_PREVIEW_MODE: PreviewModeId = "desktop";

export const previewMode = (id: PreviewModeId): PreviewMode => PREVIEW_MODES.find((mode) => mode.id === id) ?? PREVIEW_MODES[0];
