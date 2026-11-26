// A person's own signature: drawn once with a finger or the mouse, kept as a PNG, shown on the
// printouts of their leave and forms once they sign. Drawing again replaces it (the old one stays
// on record for papers already signed).

import type { MySignature } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PenLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Button, CARD, Dialog, Problem, useAction } from "../ui";

/** The person's signature box: theirs as drawn, and a button to draw (again). */
export function MySignatureCard() {
  const query = useQuery({
    queryKey: ["signature"],
    queryFn: () => api<MySignature>("/api/hr/signature"),
  });
  const [drawing, setDrawing] = useState(false);
  const signature = query.data?.signature ?? null;
  return (
    <section className={`${CARD} flex flex-wrap items-center justify-between gap-3 p-4`}>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-slate-900">Your signature</div>
        <div className="text-xs text-slate-500">
          {signature
            ? "On the printouts of your leave and forms."
            : "Draw it once: it goes on the printouts of your leave and forms."}
        </div>
      </div>
      <div className="flex items-center gap-3">
        {signature && (
          <img
            src={signature.image}
            alt="Your signature"
            className="h-12 max-w-48 rounded-lg border border-slate-200 bg-white object-contain"
          />
        )}
        <Button small onClick={() => setDrawing(true)}>
          <PenLine size={14} /> {signature ? "Draw again" : "Draw my signature"}
        </Button>
      </div>
      {drawing && <SignatureDialog onClose={() => setDrawing(false)} />}
    </section>
  );
}

function SignatureDialog({ onClose }: { onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    context.lineWidth = 2.5;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#0f172a";
  }, []);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) / box.width) * event.currentTarget.width,
      y: ((event.clientY - box.top) / box.height) * event.currentTarget.height,
    };
  };
  const clear = () => {
    const element = canvas.current;
    element?.getContext("2d")?.clearRect(0, 0, element.width, element.height);
    setDrawn(false);
  };
  const save = () =>
    action.run(async () => {
      const element = canvas.current;
      if (!element) return;
      const blob = await new Promise<Blob | null>((done) => element.toBlob(done, "image/png"));
      if (!blob) throw new Error("The drawing couldn't be read.");
      const body = new FormData();
      body.set("file", new File([blob], "signature.png", { type: "image/png" }));
      await api("/api/hr/signature", { body });
      await queries.invalidateQueries({ queryKey: ["signature"] });
      onClose();
    });

  return (
    <Dialog title="Draw your signature" sub="Sign inside the box." onClose={onClose} busy={action.busy}>
      <div className="flex flex-col gap-3">
        <canvas
          ref={canvas}
          width={600}
          height={200}
          aria-label="Signature box"
          className="h-40 w-full touch-none rounded-xl border border-dashed border-slate-300 bg-white"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            last.current = point(event);
          }}
          onPointerMove={(event) => {
            const from = last.current;
            const context = event.currentTarget.getContext("2d");
            if (!from || !context) return;
            const to = point(event);
            context.beginPath();
            context.moveTo(from.x, from.y);
            context.lineTo(to.x, to.y);
            context.stroke();
            last.current = to;
            setDrawn(true);
          }}
          onPointerUp={() => {
            last.current = null;
          }}
          onPointerLeave={() => {
            last.current = null;
          }}
        />
        <Problem message={action.problem?.message} />
        <div className="flex justify-between gap-2 border-t border-slate-100 pt-4">
          <Button variant="quiet" onClick={clear} disabled={action.busy || !drawn}>
            Clear
          </Button>
          <div className="flex gap-2">
            <Button onClick={onClose} disabled={action.busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save} disabled={action.busy || !drawn}>
              {action.busy ? "Saving…" : "Save signature"}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
