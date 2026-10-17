"use client";

/** A small sketched face that bobs while the tutor speaks. */
export function Avatar({ speaking }: { speaking: boolean }) {
  return (
    <div
      className="absolute bottom-6 left-6 z-20 flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-[0_4px_24px_rgba(0,0,0,0.12)]"
      aria-label={speaking ? "Tutor speaking" : "Tutor idle"}
    >
      <svg viewBox="0 0 64 64" width="56" height="56" style={{ animation: speaking ? "wb-bob 0.9s ease-in-out infinite alternate" : undefined }}>
        <style>{`@keyframes wb-bob { from { transform: translateY(0) rotate(-1.5deg);} to { transform: translateY(-2px) rotate(1.5deg);} }`}</style>
        <g fill="none" stroke="#222" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 40 C14 24, 24 12, 34 13 C46 14, 52 26, 47 40 C45 48, 36 52, 30 50 C24 48, 19 45, 18 40 Z" />
          <path d="M22 18 C26 10, 40 8, 46 16" />
          <path d="M20 23 q4 -4 9 -1 M36 22 q4 -3 8 1" />
          <circle cx="27" cy="30" r="1.6" fill="#222" />
          <circle cx="40" cy="30" r="1.6" fill="#222" />
          <path d={speaking ? "M27 40 q6 6 12 0" : "M27 41 q6 2 12 0"} />
          <path d="M44 8 q4 2 2 8" />
        </g>
      </svg>
    </div>
  );
}
