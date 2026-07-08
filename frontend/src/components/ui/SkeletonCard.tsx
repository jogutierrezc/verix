import { useEffect, useState } from 'react';

// ── Types ──
interface SkeletonBlock {
  /** Width as CSS value (e.g., '60%', '48px', 'w-48') */
  w: string;
  /** Height as CSS value (e.g., '16px', 'h-4') */
  h: string;
  /** Border radius */
  rounded?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';
  /** Whether this is a circle/avatar block */
  circle?: boolean;
  /** Additional Tailwind classes */
  className?: string;
}

interface SkeletonCardProps {
  /** Vertical stacking of skeleton blocks */
  rows?: SkeletonBlock[][];
  /** Or use a preset pattern */
  variant?: 'card' | 'card-sm' | 'list-item' | 'batch-header' | 'form' | 'stats' | 'table-row' | 'chart';
  /** Total count of skeleton items */
  count?: number;
  /** Optional wrapper class */
  className?: string;
}

// ── Presets ──
const PRESETS: Record<string, SkeletonBlock[][]> = {
  'card': [
    [{ w: '48px', h: '48px', rounded: 'xl', circle: false }, { w: '60%', h: '20px', rounded: 'md' }, { w: '40%', h: '14px', rounded: 'md' }],
  ],
  'card-sm': [
    [{ w: '40px', h: '40px', rounded: 'lg', circle: false }, { w: '50%', h: '16px', rounded: 'md' }, { w: '35%', h: '12px', rounded: 'md' }],
  ],
  'list-item': [
    [{ w: '36px', h: '36px', rounded: 'lg', circle: false }, { w: '70%', h: '16px', rounded: 'md' }, { w: '45%', h: '12px', rounded: 'md' }],
  ],
  'batch-header': [
    [{ w: '40px', h: '40px', rounded: 'xl', circle: false }, { w: '55%', h: '18px', rounded: 'md' }, { w: '35%', h: '12px', rounded: 'sm' }, { w: '80px', h: '14px', rounded: 'full' }],
  ],
  'form': [
    [{ w: '100%', h: '12px', rounded: 'md' }],
    [{ w: '100%', h: '44px', rounded: 'xl' }],
    [{ w: '100%', h: '12px', rounded: 'md' }],
    [{ w: '100%', h: '44px', rounded: 'xl' }],
  ],
  'stats': [
    [{ w: '100%', h: '88px', rounded: '2xl' }],
  ],
  'table-row': [
    [{ w: '100%', h: '52px', rounded: 'lg' }],
  ],
  'chart': [
    [{ w: '100%', h: '280px', rounded: '2xl' }],
  ],
};

// ── Skeleton block ──
function SkeletonBlock({ block, index }: { block: SkeletonBlock; index: number }) {
  const isCircle = block.circle;
  const width = block.w.startsWith('w-') ? block.w : `w-[${block.w}]`;
  const height = block.h.startsWith('h-') ? block.h : `h-[${block.h}]`;
  const rounded = block.rounded || 'md';
  const roundedClass = isCircle
    ? 'rounded-full'
    : rounded === 'sm' ? 'rounded-sm'
    : rounded === 'md' ? 'rounded-md'
    : rounded === 'lg' ? 'rounded-lg'
    : rounded === 'xl' ? 'rounded-xl'
    : rounded === '2xl' ? 'rounded-2xl'
    : rounded === 'full' ? 'rounded-full'
    : 'rounded-md';

  return (
    <div
      className={`bg-surface-container/70 ${roundedClass} ${width} ${height} ${block.className || ''}`}
      style={{
        animationDelay: `${index * 80}ms`,
      }}
    />
  );
}

// ── Shimmer overlay ──
function ShimmerOverlay() {
  return (
    <div
      className="absolute inset-0 -translate-x-full animate-[shimmer_1.8s_ease-in-out_infinite]"
      style={{
        background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.5) 50%, transparent 100%)',
        width: '60%',
      }}
    />
  );
}

// ── Main SkeletonCard ──
export function SkeletonCard({ rows, variant, count = 1, className = '' }: SkeletonCardProps) {
  const [mounted, setMounted] = useState(false);
  const blocks = variant ? PRESETS[variant] || PRESETS['card'] : rows || PRESETS['card'];

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 10);
    return () => clearTimeout(timer);
  }, []);

  if (!mounted) return null;

  // For stats variant, we want multiple small stats cards in a grid
  if (variant === 'stats') {
    return (
      <div className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 ${className}`}>
        {Array.from({ length: count || 5 }).map((_, i) => (
          <div key={i} className="glass-card p-4 rounded-2xl relative overflow-hidden">
            <ShimmerOverlay />
            <div className="space-y-3">
              <div className="w-9 h-9 bg-surface-container/70 rounded-xl" style={{ animationDelay: `${i * 60}ms` }} />
              <div className="space-y-2">
                <div className="w-14 h-7 bg-surface-container/70 rounded-md" style={{ animationDelay: `${i * 60 + 30}ms` }} />
                <div className="w-20 h-3 bg-surface-container/70 rounded-sm" style={{ animationDelay: `${i * 60 + 60}ms` }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  // For chart variant
  if (variant === 'chart') {
    return (
      <div className={`glass-card p-5 rounded-2xl relative overflow-hidden ${className}`}>
        <ShimmerOverlay />
        <div className="space-y-3">
          <div className="w-32 h-4 bg-surface-container/70 rounded-md" />
          <div className="w-48 h-3 bg-surface-container/70 rounded-sm" />
          <div className="w-full h-[230px] bg-surface-container/50 rounded-xl mt-4 flex items-end justify-around px-4 gap-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="flex-1 bg-surface-container/50 rounded-t-md"
                style={{
                  height: `${30 + Math.random() * 60}%`,
                  animationDelay: `${i * 80}ms`,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Generic card/list items
  return (
    <>
      {Array.from({ length: count }).map((_, itemIdx) => (
        <div
          key={itemIdx}
          className={`glass-card rounded-2xl p-5 relative overflow-hidden ${className}`}
          style={{ animationDelay: `${itemIdx * 60}ms` }}
        >
          <ShimmerOverlay />
          <div className="space-y-4">
            {blocks.map((row, rowIdx) => (
              <div key={rowIdx} className="flex items-center gap-3">
                {row.map((block, blockIdx) => (
                  <SkeletonBlock key={blockIdx} block={block} index={blockIdx + rowIdx * row.length} />
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
