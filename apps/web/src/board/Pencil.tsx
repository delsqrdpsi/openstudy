"use client";

/**
 * A pencil whose tip sits at the element's origin. The board moves it to the
 * end of the text being written or along the stroke being drawn.
 */
export function Pencil({ x, y, scale, idle }: { x: number; y: number; scale: number; idle: boolean }) {
  // Counter-scale a little so it stays readable when zoomed out, without growing huge up close.
  const k = Math.min(1.5, Math.max(0.85, 1 / Math.sqrt(scale)));
  return (
    <div className={`wb-pen${idle ? " is-idle" : ""}`} style={{ transform: `translate(${x}px, ${y}px) scale(${k})` }} aria-hidden>
      <svg width="48" height="48" viewBox="0 0 48 48">
        {/* Drawn upright with the tip at (4,44), then leaned to the upper right around the tip. */}
        <g transform="rotate(42 4 44)">
          <rect x="-1" y="2" width="10" height="7" rx="2" fill="#e88aa0" stroke="#1f2a37" strokeWidth="1.2" />
          <rect x="-1" y="8" width="10" height="4" fill="#b9c2cc" stroke="#1f2a37" strokeWidth="1.2" />
          <rect x="-1" y="12" width="10" height="20" fill="#f6c453" stroke="#1f2a37" strokeWidth="1.2" />
          <line x1="2.4" y1="12" x2="2.4" y2="32" stroke="#d9a63a" strokeWidth="1" />
          <line x1="5.6" y1="12" x2="5.6" y2="32" stroke="#d9a63a" strokeWidth="1" />
          <path d="M-1 32 L4 44 L9 32 Z" fill="#f0d9b5" stroke="#1f2a37" strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M2.4 39.5 L4 44 L5.6 39.5 Z" fill="#1f2a37" />
        </g>
      </svg>
    </div>
  );
}
