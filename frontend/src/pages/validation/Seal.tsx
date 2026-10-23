import { forwardRef, useId } from 'react';

export type SealTone = 'valid' | 'revoked' | 'pending' | 'neutral';

const TONE_COLOR: Record<SealTone, string> = {
  valid: 'var(--seal)',
  revoked: 'var(--revoked)',
  pending: 'var(--pending)',
  neutral: 'var(--ink-soft)',
};

/**
 * Sello circular del registro. El texto del anillo recorre el borde; el centro
 * lleva una marca distinta por estado (visto bueno, aspa, reloj o guion), así no
 * depende solo del color.
 */
export const Seal = forwardRef<SVGSVGElement, { tone: SealTone; ring: string; size?: number }>(
  function Seal({ tone, ring, size = 132 }, ref) {
    const id = useId().replace(/:/g, '');
    const color = TONE_COLOR[tone];
    const text = `${ring.toUpperCase()} · ${ring.toUpperCase()} · `;
    return (
      <svg ref={ref} viewBox="0 0 200 200" width={size} height={size} role="img" aria-label={ring} style={{ color }}>
        <defs>
          <path id={`ring-${id}`} d="M100,100 m-72,0 a72,72 0 1,1 144,0 a72,72 0 1,1 -144,0" />
        </defs>
        <circle cx="100" cy="100" r="94" fill="none" stroke="currentColor" strokeWidth="3" />
        <circle cx="100" cy="100" r="86" fill="none" stroke="currentColor" strokeWidth="1" />
        <circle cx="100" cy="100" r="52" fill="none" stroke="currentColor" strokeWidth="1" />
        <text fill="currentColor" fontFamily="'Public Sans', sans-serif" fontSize="12.5" fontWeight="700" letterSpacing="3.2">
          <textPath href={`#ring-${id}`} startOffset="0" textLength="440" lengthAdjust="spacing">{text}</textPath>
        </text>
        <g fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round">
          {tone === 'valid' && <path d="M76 102 L94 120 L127 80" />}
          {tone === 'revoked' && <path d="M80 80 L120 120 M120 80 L80 120" />}
          {tone === 'pending' && <path d="M100 74 V102 L118 114" />}
          {tone === 'neutral' && <path d="M82 100 H118" />}
        </g>
      </svg>
    );
  },
);
