import React, { useState } from "react";

interface ArtworkFrameProps {
  imageUrl: string;
  title: string;
  artist: string;
  aspectClassName?: string;
}

export const ArtworkFrame: React.FC<ArtworkFrameProps> = ({
  imageUrl,
  title,
  artist,
  aspectClassName = "h-64",
}) => {
  const [hasError, setHasError] = useState(false);

  return (
    <div
      className={`passe-partout relative flex items-center justify-center overflow-hidden rounded-sm ${aspectClassName}`}
    >
      {!hasError && imageUrl ? (
        <img
          src={imageUrl}
          alt={`${title} — ${artist}`}
          loading="lazy"
          onError={() => setHasError(true)}
          className="max-h-full max-w-full object-contain transition-opacity duration-200"
        />
      ) : (
        <div className="flex flex-col items-center justify-center border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface px-6 py-8 text-center">
          <span className="font-mono text-xs uppercase tracking-widest text-paper-subtext dark:text-charcoal-subtext">
            Acervo Catalografico
          </span>
          <p className="mt-2 font-serif text-lg font-semibold text-paper-text dark:text-charcoal-text">
            {title}
          </p>
          <p className="mt-1 text-xs text-paper-subtext dark:text-charcoal-subtext">
            {artist}
          </p>
        </div>
      )}
    </div>
  );
};
