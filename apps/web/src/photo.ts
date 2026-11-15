// Papers sent from a phone: a photo is made smaller before it goes (longest side 1600 px,
// WebP 60: the writing on a prescription stays readable); a PDF, or anything the browser can't redraw, goes as it is.

import type { PaperKind } from "@2mg/api/types";
import { api } from "./api";

export async function smaller(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.6),
    );
    if (!blob || blob.type !== "image/webp" || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".webp", { type: "image/webp" });
  } catch {
    return file;
  }
}

/** Puts one paper on an order; answers its id. */
export async function uploadPaper(orderId: number, kind: PaperKind, file: File): Promise<number> {
  const form = new FormData();
  form.set("kind", kind);
  form.set("file", await smaller(file));
  return (await api<{ id: number }>(`/api/orders/${orderId}/papers`, { body: form })).id;
}

export const PAPER_ACCEPT = "image/*,application/pdf";
