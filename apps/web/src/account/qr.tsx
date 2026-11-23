// A QR code drawn in this browser: what it says (an authenticator's key) is sent to no one.

import { useEffect, useState } from "react";

export function QrCode({ text, label }: { text: string; label: string }) {
  const [drawn, setDrawn] = useState<{ size: number; path: string } | null>(null);
  useEffect(() => {
    let here = true;
    import("qrcode-generator")
      .then(({ default: qrcode }) => {
        const qr = qrcode(0, "M");
        qr.addData(text);
        qr.make();
        const size = qr.getModuleCount();
        let path = "";
        for (let y = 0; y < size; y += 1)
          for (let x = 0; x < size; x += 1) if (qr.isDark(y, x)) path += `M${x} ${y}h1v1h-1z`;
        if (here) setDrawn({ size, path });
      })
      // Not loaded: the key under it still sets the app up.
      .catch(() => undefined);
    return () => {
      here = false;
    };
  }, [text]);

  if (!drawn) return <div className="size-60 shrink-0 animate-pulse rounded-lg bg-slate-100" />;
  return (
    <svg
      role="img"
      aria-label={label}
      // The four empty squares round it that readers need.
      viewBox={`-4 -4 ${drawn.size + 8} ${drawn.size + 8}`}
      shapeRendering="crispEdges"
      className="size-60 shrink-0 rounded-lg border border-slate-200 bg-white"
    >
      <path d={drawn.path} fill="#0f172a" />
    </svg>
  );
}
