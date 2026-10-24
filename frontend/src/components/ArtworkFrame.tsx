import React, { useMemo, useState } from "react";

interface ArtworkFrameProps {
  imageUrl: string;
  title: string;
  artist: string;
  aspectClassName?: string;
}

const KNOWN_ARTWORK_MAP: Array<{ match: string; path: string }> = [
  { match: "nighthawks", path: "/artworks/nighthawks.svg" },
  { match: "831a05de", path: "/artworks/nighthawks.svg" },
  { match: "bedroom", path: "/artworks/the-bedroom.svg" },
  { match: "25c31d8d", path: "/artworks/the-bedroom.svg" },
  { match: "grande jatte", path: "/artworks/grande-jatte.svg" },
  { match: "1adf2696", path: "/artworks/grande-jatte.svg" },
  { match: "water lilies", path: "/artworks/water-lilies.svg" },
  { match: "3c27b499", path: "/artworks/water-lilies.svg" },
  { match: "american gothic", path: "/artworks/american-gothic.svg" },
  { match: "b272df73", path: "/artworks/american-gothic.svg" },
  { match: "great wave", path: "/artworks/great-wave.svg" },
  { match: "25567b36", path: "/artworks/great-wave.svg" },
  { match: "paris street", path: "/artworks/paris-street.svg" },
];

function resolveLocalOrExternalImage(imageUrl: string, title: string): string {
  const combined = `${title} ${imageUrl}`.toLowerCase();
  for (const item of KNOWN_ARTWORK_MAP) {
    if (combined.includes(item.match)) {
      return item.path;
    }
  }
  return imageUrl || "/artworks/water-lilies.svg";
}

export const ArtworkFrame: React.FC<ArtworkFrameProps> = ({
  imageUrl,
  title,
  artist,
  aspectClassName = "h-64",
}) => {
  const resolvedSrc = useMemo(
    () => resolveLocalOrExternalImage(imageUrl, title),
    [imageUrl, title],
  );
  const [fallbackTriggered, setFallbackTriggered] = useState(false);

  const finalSrc = fallbackTriggered ? "/artworks/paris-street.svg" : resolvedSrc;

  return (
    <div
      className={`passe-partout relative flex items-center justify-center overflow-hidden rounded-sm ${aspectClassName}`}
    >
      <img
        src={finalSrc}
        alt={`${title} - ${artist}`}
        loading="lazy"
        onError={() => {
          if (!fallbackTriggered) {
            setFallbackTriggered(true);
          }
        }}
        className="max-h-full max-w-full object-contain transition-opacity duration-200"
      />
    </div>
  );
};
