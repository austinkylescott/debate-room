// Debate Room · Atomic shape vocabulary.
// Every path is drawn in a 100×100 box centred on 0,0: scale with transform="translate(x y) rotate(r) scale(s/100)".
// Fills come from tokens (var(--primary), var(--mustard), var(--teal), var(--avocado), var(--pink), var(--sky));
// spines, balls and hairlines use var(--ink).

export const SHAPES = {
 boomerang:"M-50,-22 C-47,-32 -37,-32 -31,-25 C-19,-11 -9,-2 2,-1 C14,-2 26,-14 38,-32 C43,-40 53,-38 51,-28 C45,-6 24,26 2,28 C-20,28 -42,2 -50,-22Z",
 kidney:"M-40,-6 C-44,-30 -14,-40 8,-34 C34,-28 48,-6 42,14 C36,34 10,40 -6,32 C-14,28 -12,16 -22,16 C-34,16 -38,8 -40,-6Z",
 amoeba:"M-44,-6 C-48,-34 -10,-46 18,-40 C44,-34 52,-8 40,12 C30,28 34,40 16,44 C-4,48 -10,30 -26,30 C-42,30 -42,12 -44,-6Z",
 leaf:"M0,-48 C26,-26 30,18 0,48 C-30,18 -26,-26 0,-48Z",
 teardrop:"M0,-46 C10,-18 24,0 24,16 A24,24 0 0 1 -24,16 C-24,0 -10,-18 0,-46Z",
 diamond:"M0,-48 L20,0 L0,48 L-20,0Z",
 sparkle:"M0,-50 C4,-8 8,-4 50,0 C8,4 4,8 0,50 C-4,8 -8,4 -50,0 C-8,-4 -4,-8 0,-50Z",
 bowl:"M-48,-12 A48,48 0 0 0 48,-12Z",
 arrow:"M-48,-5 L20,-5 L20,-18 L48,0 L20,18 L20,5 L-48,5Z"
} as const;

export type ShapeName = keyof typeof SHAPES;

/** 8-point compass star (long points at N/E/S/W). Returns an SVG points string in the 100-box. */
export function compassPoints(): string {
  const pts: string[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (Math.PI * i) / 8 - Math.PI / 2;
    const r = i % 4 === 0 ? 50 : i % 2 === 0 ? 24 : 9;
    pts.push(`${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`);
  }
  return pts.join(" ");
}

/** Ball-tipped starburst: spokes from the centre, alternating long and short, each ending in a ball. */
export function starburst(n = 8): { x: number; y: number; r: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (Math.PI * 2 * i) / n;
    const len = i % 2 ? 36 : 50;
    return { x: Math.cos(a) * len, y: Math.sin(a) * len, r: 4.5 };
  });
}

/** Breathing morph: nudges every coordinate of a path by up to `amp`, keeping the same commands so SMIL can interpolate. */
export function wobble(d: string, amp: number, seed: number): string {
  let i = 0;
  return d.replace(/-?\d+(\.\d+)?/g, (m) => {
    i++;
    return (+m + Math.sin(seed * 12.9898 + i * 78.233) * amp).toFixed(1);
  });
}

/** The <animate> values for a breathing container (amoeba ≈ 3.5, kidney ≈ 3.5; 10–12s). Skip entirely under prefers-reduced-motion. */
export function breatheValues(d: string, amp = 3.5): string {
  return [d, wobble(d, amp, 1), wobble(d, amp, 2), d].join(";");
}
