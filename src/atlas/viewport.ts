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
  return {
    x: canvas.width / 2 - (r.x + r.w / 2) * zoom,
    y: canvas.height / 2 - (r.y + r.h / 2) * zoom,
    zoom,
  };
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
  if (fits)
    return {
      x: canvas.width / 2 - (r.x + r.w / 2) * vp.zoom,
      y: canvas.height / 2 - (r.y + r.h / 2) * vp.zoom,
      zoom: vp.zoom,
    };
  return fitRect(r, canvas, { maxZoom: vp.zoom, padding: 0.06 });
}

/** Screen-space margins kept free of map content (the canvas chrome sits there). */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const CHROME: Insets = { top: 100, right: 20, bottom: 20, left: 20 };

/** Lowest zoom the camera chooses on its own for a selection (users may zoom out further). */
export const READABLE_ZOOM = 0.8;

/** Zoom at which `r` exactly fits the free area. */
export function fitZoom(r: Rect, canvas: Size2, insets: Insets = CHROME): number {
  const w = Math.max(1, canvas.width - insets.left - insets.right);
  const h = Math.max(1, canvas.height - insets.top - insets.bottom);
  return Math.min(w / Math.max(1, r.w), h / Math.max(1, r.h));
}

/**
 * Place `r` at `zoom`: centred in the free area when it fits, otherwise with
 * its top-left corner (the header) at the free area's top-left — and, when
 * `anchor` is given, centred on that point along any axis that does not fit.
 */
export function placeRect(r: Rect, zoom: number, canvas: Size2, insets: Insets = CHROME, anchor?: { x: number; y: number }): Viewport {
  const availW = canvas.width - insets.left - insets.right;
  const availH = canvas.height - insets.top - insets.bottom;
  const place = (start: number, size: number, avail: number, inset: number, a?: number) => {
    if (size * zoom <= avail) return inset + (avail - size * zoom) / 2 - start * zoom;
    if (a !== undefined) {
      // Centre on the anchor, but never leave empty space before the rect's start or after its end.
      const v = inset + avail / 2 - a * zoom;
      return Math.max(inset + avail - (start + size) * zoom, Math.min(v, inset - start * zoom));
    }
    return inset - start * zoom;
  };
  return { x: place(r.x, r.w, availW, insets.left, anchor?.x), y: place(r.y, r.h, availH, insets.top, anchor?.y), zoom };
}

/**
 * Camera after a container was expanded by the user: keep its header where it
 * is on screen, zoom out only as far as needed to show the new contents (but
 * not below readable), then pan the minimum to bring it into view.
 */
export function afterExpand(r: Rect, vp: Viewport, canvas: Size2, insets: Insets = CHROME): Viewport {
  const want = fitZoom(r, canvas, insets);
  const zoom = Math.min(Math.max(vp.zoom, READABLE_ZOOM), Math.max(want, READABLE_ZOOM));
  const sx = r.x * vp.zoom + vp.x;
  const sy = r.y * vp.zoom + vp.y;
  let x = sx - r.x * zoom;
  let y = sy - r.y * zoom;
  const nudge = (pos: number, start: number, size: number, lo: number, hi: number) => {
    const a = start * zoom + pos;
    const b = a + size * zoom;
    if (b - a > hi - lo) return pos + (lo - a); // too big: header to the free area's start
    if (a < lo) return pos + (lo - a);
    if (b > hi) return pos - (b - hi);
    return pos;
  };
  x = nudge(x, r.x, r.w, insets.left, canvas.width - insets.right);
  y = nudge(y, r.y, r.h, insets.top, canvas.height - insets.bottom);
  return { x, y, zoom };
}

/**
 * Camera for a selection that arrived from elsewhere (deep link, search, tree,
 * reveal): frame its surroundings — its own contents when it is an open
 * container, otherwise its parent container — at a readable zoom; when that
 * frame is too big, centre on the selection at the readable zoom instead.
 */
export function frameSelection(node: Rect, frame: Rect, canvas: Size2, opts: { maxZoom?: number; minZoom?: number } = {}, insets: Insets = CHROME): Viewport {
  const want = fitZoom(frame, canvas, insets) * 0.94;
  const zoom = Math.max(opts.minZoom ?? READABLE_ZOOM, Math.min(opts.maxZoom ?? 1.15, want));
  const centre = { x: node.x + node.w / 2, y: node.y + Math.min(node.h, 200) / 2 };
  return placeRect(frame, zoom, canvas, insets, centre);
}
