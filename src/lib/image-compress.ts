/**
 * Browser-side image compression before upload: downscale so the long edge
 * is ≤ maxEdge and re-encode (JPEG for photos, WebP when transparency may
 * matter). Returns the original file when compression wouldn't help, the
 * type isn't a raster image, or the browser can't decode it. Cloudinary
 * compresses again on arrival, so this mainly cuts upload time and data.
 */
export async function compressImage(
  file: File,
  { maxEdge = 2560, quality = 0.82 }: { maxEdge?: number; quality?: number } = {},
): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || typeof createImageBitmap !== "function") return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const mayHaveAlpha = file.type !== "image/jpeg";
  const wanted = mayHaveAlpha ? "image/webp" : "image/jpeg";
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, wanted, quality));
  // Browsers that can't encode WebP fall back to PNG; keep whichever is smaller.
  if (!blob || blob.size >= file.size) return file;
  const ext = blob.type === "image/jpeg" ? "jpg" : blob.type.split("/")[1] ?? "img";
  const name = file.name.replace(/\.[^.]+$/, "") + "." + ext;
  return new File([blob], name, { type: blob.type, lastModified: file.lastModified });
}
