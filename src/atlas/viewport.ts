/** Viewport arithmetic for the Atlas (fit, ensure-visible). Pure. */
import type { Rect } from './layout';

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface Size2 {
  width: number;
  height: number;
}

export const MIN_ZOOM = 0.06;
export const MAX_ZOOM = 2.5;

/** Viewport that centres `r` and fits it with `padding` (fraction of the canvas) on each side. */
export function fitRect(r: Rect, canvas: Size2, opts: { maxZoom?: number; minZoom?: number; padding?: number } = {}): Viewport {
  const pad = opts.padding ?? 0.08;
  const availW = canvas.width * (1 - 2 * pad);
  const availH = canvas.height * (1 - 2 * pad);
  const zoom = Math.max(opts.minZoom ?? MIN_ZOOM, Math.min(opts.maxZoom ?? MAX_ZOOM, availW / Math.max(1, r.w), availH / Math.max(1, r.h)));
  return { x: canvas.width / 2 - (r.x + r.w / 2) * zoom, y: canvas.height / 2 - (r.y + r.h / 2) * zoom, zoom };
}

/** Is the rect fully on screen (with a margin in screen pixels)? */
export function inView(r: Rect, vp: Viewport, canvas: Size2, margin = 24): boolean {
  const x0 = r.x * vp.zoom + vp.x;
  const y0 = r.y * vp.zoom + vp.y;
  const x1 = (r.x + r.w) * vp.zoom + vp.x;
  const y1 = (r.y + r.h) * vp.zoom + vp.y;
  return x0 >= margin && y0 >= margin && x1 <= canvas.width - margin && y1 <= canvas.height - margin;
}

/**
 * The smallest viewport change that brings `r` fully into view: nothing if it
 * already is, a pan if it fits at the current zoom, otherwise zoom out to fit.
 */
export function ensureVisible(r: Rect, vp: Viewport, canvas: Size2, margin = 48): Viewport | null {
  if (inView(r, vp, canvas, margin / 2)) return null;
  const fits = r.w * vp.zoom <= canvas.width - 2 * margin && r.h * vp.zoom <= canvas.height - 2 * margin;
  if (fits) return { x: canvas.width / 2 - (r.x + r.w / 2) * vp.zoom, y: canvas.height / 2 - (r.y + r.h / 2) * vp.zoom, zoom: vp.zoom };
  return fitRect(r, canvas, { maxZoom: vp.zoom, padding: 0.06 });
}
