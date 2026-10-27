import React from "react";

interface VerzelEmblemProps {
  className?: string;
}

export const VerzelEmblem: React.FC<VerzelEmblemProps> = ({
  className = "h-20 w-20 sm:h-24 sm:w-24",
}) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      fill="none"
      className={`shrink-0 transition-all duration-200 ${className}`}
      aria-hidden="true"
    >
      <defs>
        <filter id="gemGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="1.2" floodColor="#000000" floodOpacity="0.25" />
        </filter>
      </defs>

      <g
        className="stroke-[#681417] dark:stroke-[#C5A059] transition-colors duration-200"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M 50 12 C 39 27 36 46 47 62 C 48.5 64 50 65.5 50 67 C 50 65.5 51.5 64 53 62 C 64 46 61 27 50 12 Z" />

        <path d="M 26 31 C 23 45 32 60 46 67 C 39 53 35.5 39 26 31 Z" />

        <path d="M 74 31 C 77 45 68 60 54 67 C 61 53 64.5 39 74 31 Z" />

        <path d="M 10 58 C 24 51 38 56 48 68 C 34 84 21 78 10 58 Z" />

        <path d="M 90 58 C 76 51 62 56 52 68 C 66 84 79 78 90 58 Z" />

        <path d="M 10 58 C 23 82 77 82 90 58" />

        <path d="M 50 69 L 50 83" />
      </g>

      <g
        filter="url(#gemGlow)"
        stroke="#2E0709"
        strokeWidth="1.2"
        strokeLinejoin="round"
        className="dark:stroke-[#15120F]"
      >
        <polygon
          points="44.06,55.47 25.76,66.09 44.06,33.4"
          fill="#A32428"
          className="dark:fill-[#C5A059]"
        />
        <polygon
          points="44.06,55.47 62.36,66.09 44.06,33.4"
          fill="#BD2C31"
          className="dark:fill-[#DFB86C]"
        />
        <polygon
          points="62.36,66.09 44.06,55.47 25.76,66.09"
          fill="#520E11"
          className="dark:fill-[#7D5B25]"
        />

        <polygon
          points="65.04,53.37 47.52,53.32 74.24,37.57"
          fill="#F5EAD4"
          className="dark:fill-[#FFF3D6]"
        />
        <polygon
          points="65.04,53.37 73.71,68.6 74.24,37.57"
          fill="#D4AF37"
          className="dark:fill-[#E5C158]"
        />
        <polygon
          points="73.71,68.6 65.04,53.37 47.52,53.32"
          fill="#8A6C38"
          className="dark:fill-[#851B1F]"
        />
      </g>
    </svg>
  );
};
