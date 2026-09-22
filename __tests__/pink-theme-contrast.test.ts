import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Reads the actual shipped CSS (not a hand-copied palette) and checks every
 * text/background token pair the pink theme uses against WCAG AA, the same
 * way the dark theme's tokens were checked when it was built. If someone
 * edits a colour in globals.css later, this test reads the new value.
 */

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}
function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const css = readFileSync(resolve(__dirname, '../src/app/globals.css'), 'utf8');
function token(block: RegExp, name: string): string {
  const m = block.exec(css);
  if (!m) throw new Error(`block not found: ${block}`);
  const decl = new RegExp(`--${name}:\\s*([^;]+);`).exec(m[0]);
  if (!decl) throw new Error(`--${name} not found in matched block`);
  const v = decl[1].trim();
  if (v.startsWith('var(')) return token(block, v.slice(4, -1).replace('--', ''));
  return v;
}
const pink = (name: string) => token(/:root\[data-theme='pink'\] \{[\s\S]*?\n\}/, name);

/** For a gradient/multi-colour token, the worst (lowest-contrast) stop against `fg`. */
function worstStopContrast(fg: string, name: string): number {
  const block = /:root\[data-theme='pink'\] \{[\s\S]*?\n\}/.exec(css)![0];
  const decl = new RegExp(`--${name}:\\s*([^;]+);`).exec(block)![1];
  const stops = [...decl.matchAll(/#[0-9a-fA-F]{6}/g)].map((m) => m[0]);
  if (stops.length === 0) throw new Error(`no hex stops found in --${name}: ${decl}`);
  return Math.min(...stops.map((stop) => contrast(fg, stop)));
}

describe('pink theme colours (read from globals.css) meet WCAG AA', () => {
  it('uses the requested bubblegum pink and butter yellow as its signature colours', () => {
    // exact hexes from the request, used somewhere in the theme (not necessarily as body text colour)
    expect(css.toLowerCase()).toContain('#ffb7d9');
    expect(css.toLowerCase()).toContain('#ffe7a8');
  });

  it.each([
    ['text on bg', 'text', 'bg', 4.5],
    ['text on surface', 'text', 'surface', 4.5],
    ['text on surface-2', 'text', 'surface-2', 4.5],
    ['dim text on bg', 'text-dim', 'bg', 4.5],
    ['dim text on surface', 'text-dim', 'surface', 4.5],
    ['accent-text (links) on bg', 'accent-text', 'bg', 4.5],
    ['accent-text (links) on surface', 'accent-text', 'surface', 4.5],
    ['white button text on accent-solid', 'on-accent', 'accent-solid', 4.5],
    ['white button text on accent-solid-hover', 'on-accent', 'accent-solid-hover', 4.5],
    ['white button text on danger-solid', 'on-accent', 'danger-solid', 4.5],
    ['danger text on surface', 'danger', 'surface', 4.5],
    ['ok(green) text on surface', 'ok', 'surface', 4.5],
    ['ok(green) text on ok-soft', 'ok', 'ok-soft', 4.5],
    ['warn text on surface', 'warn', 'surface', 4.5],
    ['dark text on the "everyone free" calendar cell', 'cal-all-text', 'cal-all', 4.5],
  ])('%s >= %s:1', (_label, fg, bg, min) => {
    const c = contrast(pink(fg), pink(bg));
    expect(c).toBeGreaterThanOrEqual(min);
  });

  it('headline text stays readable across every stop of the "everyone free" hero gradient (>= 3:1, large/bold text)', () => {
    // --hero-bg / --hero-all-bg are gradients (not solid colours), so every colour stop is checked individually.
    expect(worstStopContrast(pink('text'), 'hero-bg')).toBeGreaterThanOrEqual(3);
    expect(worstStopContrast(pink('text'), 'hero-all-bg')).toBeGreaterThanOrEqual(3);
  });
});
