/** Colour/size vocabulary for Studio elements, expressed through design tokens so both themes work. */
import type { CSSProperties } from 'react';
import type { RelationChannel } from '@/model';
import { CHANNEL_COLOR } from '@/ui/kinds';
import type { ColorToken, NodeStyle, StrokeStyle, TextSize } from './types';

export const COLOR_TOKENS: { id: ColorToken; label: string; css: string }[] = [
  { id: 'default', label: 'Neutral', css: 'var(--line-strong)' },
  { id: 'gray', label: 'Gray', css: 'var(--fg-subtle)' },
  { id: 'blue', label: 'Blue', css: 'var(--c-http)' },
  { id: 'teal', label: 'Teal', css: 'var(--k-type)' },
  { id: 'green', label: 'Green', css: 'var(--c-data)' },
  { id: 'amber', label: 'Amber', css: 'var(--c-realtime)' },
  { id: 'red', label: 'Red', css: 'var(--c-security)' },
  { id: 'pink', label: 'Pink', css: 'var(--k-page)' },
  { id: 'violet', label: 'Violet', css: 'var(--c-call)' },
  { id: 'purple', label: 'Purple (proposed)', css: 'var(--k-hypo)' },
];

const BY_ID = new Map(COLOR_TOKENS.map((c) => [c.id, c.css]));
export const tokenCss = (t: ColorToken | undefined): string => BY_ID.get(t ?? 'default') ?? 'var(--line-strong)';

export const fillCss = (t: ColorToken | 'none' | undefined, fallback = 'var(--surface)'): string => {
  if (t === 'none') return 'transparent';
  if (!t) return fallback;
  if (t === 'default') return 'var(--surface)';
  return `color-mix(in srgb, ${tokenCss(t)} 14%, var(--surface))`;
};

export const TEXT_SIZE: Record<TextSize, number> = { sm: 12, md: 14, lg: 19, xl: 28 };

export const dashArray = (s: StrokeStyle | undefined, width = 1.5): string | undefined =>
  s === 'dashed' ? `${width * 4} ${width * 3}` : s === 'dotted' ? `${width * 0.1} ${width * 2.6}` : undefined;

/** Box style (border + background) for a free node. */
export function boxStyle(style: NodeStyle | undefined, defaults: { fill?: ColorToken | 'none'; stroke?: ColorToken } = {}): CSSProperties {
  const stroke = style?.stroke ?? defaults.stroke;
  return {
    background: fillCss(style?.fill ?? defaults.fill),
    borderColor: stroke ? tokenCss(stroke) : 'var(--line-strong)',
    borderStyle: style?.strokeStyle ?? 'solid',
  };
}

export const edgeColor = (color: ColorToken | undefined, channel: RelationChannel | undefined): string =>
  color ? tokenCss(color) : channel ? CHANNEL_COLOR[channel] : 'var(--fg-subtle)';
