// Фирменный призрак GO — оригинальная векторная иллюстрация.
export default function Mascot({ size = 150 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 160 160"
      className="mascot"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="mascot-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#b79cff" />
          <stop offset=".55" stopColor="#7c4df0" />
          <stop offset="1" stopColor="#4a22b8" />
        </linearGradient>
        <linearGradient id="mascot-crown" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe08a" />
          <stop offset="1" stopColor="#f1a93b" />
        </linearGradient>
      </defs>

      <ellipse cx="80" cy="148" rx="44" ry="6" fill="rgba(124,77,240,.28)" />

      <path
        d="M30 96c0-34 22-60 50-60s50 26 50 60v34c0 6-6 9-11 5l-8-6-9 8c-4 3-9 3-13 0l-9-8-9 8c-4 3-9 3-13 0l-9-8-8 6c-5 4-11 1-11-5z"
        fill="url(#mascot-body)"
      />
      <path
        d="M44 70c6-18 20-28 36-28"
        stroke="rgba(255,255,255,.4)"
        strokeWidth="5"
        strokeLinecap="round"
        fill="none"
      />

      <path d="M58 38l6-18 10 12 6-16 6 16 10-12 6 18z" fill="url(#mascot-crown)" />

      <rect x="42" y="72" width="34" height="22" rx="9" fill="#12091f" />
      <rect x="84" y="72" width="34" height="22" rx="9" fill="#12091f" />
      <rect x="74" y="78" width="12" height="5" rx="2" fill="#12091f" />
      <path d="M48 77l12 0" stroke="rgba(255,255,255,.35)" strokeWidth="3" strokeLinecap="round" />
      <path d="M90 77l12 0" stroke="rgba(255,255,255,.35)" strokeWidth="3" strokeLinecap="round" />

      <path d="M68 108q12 9 24 0" stroke="#12091f" strokeWidth="4" strokeLinecap="round" fill="none" />
    </svg>
  );
}
