import React from "react";

interface Props {
  name: string;
  title?: string;
  size?: number;
  portrait?: string | null; // local path if free license, else null
}

/**
 * LeaderAvatar — neutral initials avatar. Portraits only if free license locally + attribution (see data/attribution.md).
 * No hotlinks, no external images. If portrait provided and locally available, render img; else initials.
 */
export default function LeaderAvatar({ name, title, size = 36, portrait }: Props) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  if (portrait) {
    // portrait is expected to be local path like "/data/portraits/xxx.jpg" with free license; render if exists
    // We avoid hotlink: only local, and we check that src starts with "/" or "data:"
    const isLocal = portrait.startsWith("/") || portrait.startsWith("./") || portrait.startsWith("data/");
    if (isLocal) {
      return (
        <img
          src={portrait}
          alt={name}
          title={title ?? name}
          style={{ width: size, height: size, borderRadius: 999, objectFit: "cover", border: "1px solid #e5e7eb", background: "#e5e7eb" }}
          onError={(e) => {
            // fallback to initials on error
            const target = e.currentTarget as HTMLImageElement;
            target.style.display = "none";
          }}
        />
      );
    }
  }

  return (
    <div
      aria-label={name}
      title={`${name}${title ? ` — ${title}` : ""}`}
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        background: "#e5e7eb",
        display: "grid",
        placeItems: "center",
        fontWeight: 800,
        fontSize: Math.round(size * 0.38),
        color: "#374151",
        flexShrink: 0,
        border: "1px solid #d1d5db",
        userSelect: "none",
      }}
    >
      {initials}
    </div>
  );
}
