// F-09.1: shrink before upload — longest side ≤ 1568 px, JPEG quality 0,85, < 5 MB.
export const MAX_SIDE = 1568;
export const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

export function fitSize(w: number, h: number, max = MAX_SIDE): { w: number; h: number } {
  const s = Math.min(1, max / Math.max(w, h));
  return { w: Math.round(w * s), h: Math.round(h * s) };
}

/** Returns the resized JPEG, or an error message in Indonesian. */
export async function prepareReceiptImage(file: File): Promise<Blob | string> {
  if (!ACCEPTED.includes(file.type)) return "Pilih foto JPEG, PNG, atau WebP.";
  if (file.size > 15 * 1024 * 1024) return "Foto lebih dari 15 MB. Pilih foto yang lebih kecil.";
  const bmp = await createImageBitmap(file);
  const { w, h } = fitSize(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  for (const q of [0.85, 0.75, 0.65]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", q));
    if (blob && blob.size < 5 * 1024 * 1024) return blob;
  }
  return "Foto masih terlalu besar setelah dikecilkan.";
}
