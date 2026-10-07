"use client";

import { useRef, useState } from "react";
import { FileUp, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createUploadIntentAction, finalizeUploadAction } from "@/features/media/actions";
import { compressImage } from "@/lib/image-compress";
import { UPLOAD_TYPES, type UploadMimeType } from "@/lib/domain/media";

const mb = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`);

export interface UploadedFile {
  assetId: string;
  filename: string;
  /** Signed logo URL (BRAND_LOGO uploads only). */
  logoUrl?: string | null;
}

/** Upload one (already compressed) file straight to Cloudinary with progress. */
function putToCloudinary(url: string, fields: Record<string, string | number>, file: File, onProgress: (pct: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const body = new FormData();
    for (const [k, v] of Object.entries(fields)) body.append(k, String(v));
    body.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("Upload failed")));
    xhr.onerror = () => reject(new Error("Upload failed — check your connection"));
    xhr.send(body);
  });
}

/**
 * Server-authorised uploads: images are compressed in the browser first, the
 * server issues a single-use, signed upload (public id + compression chosen
 * server-side), the file goes directly to Cloudinary, which compresses it
 * again on arrival, and the server verifies and records what was stored.
 */
export function MediaUploader({
  purpose,
  contentId = null,
  accept,
  multiple,
  value,
  onChange,
  label = "Upload file",
  tooBigHint,
}: {
  purpose: "VERSION_MEDIA" | "RECEIPT" | "BRAND_LOGO";
  contentId?: string | null;
  accept: string;
  multiple?: boolean;
  value: UploadedFile[];
  onChange: (files: UploadedFile[]) => void;
  label?: string;
  /** Shown when a picked file is over the size limit (e.g. "share a Drive link instead"). */
  tooBigHint?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ name: string; pct: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handle(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    const added: UploadedFile[] = [];
    // Check sizes before uploading anything, so a 2 GB video fails instantly, not after minutes.
    const tooBig = Array.from(files).find((f) => {
      const t = UPLOAD_TYPES[f.type as UploadMimeType];
      // Photos are compressed before the limit applies; videos and PDFs are not.
      return t && !/^image\/(jpeg|png|webp)$/.test(f.type) && f.size > t.maxBytes;
    });
    if (tooBig) {
      const max = UPLOAD_TYPES[tooBig.type as UploadMimeType].maxBytes;
      setError(`${tooBig.name} is ${mb(tooBig.size)} — the upload limit is ${mb(max)}.${tooBigHint ? ` ${tooBigHint}` : ""}`);
      if (input.current) input.current.value = "";
      return;
    }
    for (const picked of Array.from(files)) {
      setProgress({ name: picked.name, pct: 0 });
      const file = await compressImage(picked, purpose === "BRAND_LOGO" ? { maxEdge: 512 } : undefined);
      const intent = await createUploadIntentAction({ purpose, contentId, filename: file.name, mimeType: file.type, bytes: file.size });
      if (!intent.ok) {
        setError(intent.error.fieldErrors ? Object.values(intent.error.fieldErrors).flat().join(" ") : intent.error.message);
        break;
      }
      try {
        await putToCloudinary(intent.data.uploadUrl, intent.data.fields, file, (pct) => setProgress({ name: file.name, pct }));
      } catch (e) {
        setError((e as Error).message);
        break;
      }
      const done = await finalizeUploadAction({ intentId: intent.data.intentId });
      if (!done.ok) {
        setError(done.error.message);
        break;
      }
      added.push({ assetId: done.data.assetId, filename: done.data.filename, logoUrl: done.data.logoUrl });
    }
    setProgress(null);
    if (input.current) input.current.value = "";
    if (added.length) onChange(multiple ? [...value, ...added] : added.slice(-1));
  }

  return (
    <div className="flex flex-col gap-2">
      <input ref={input} type="file" accept={accept} multiple={multiple} className="sr-only" onChange={(e) => void handle(e.target.files)} aria-label={label} tabIndex={-1} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={Boolean(progress)} onClick={() => input.current?.click()}>
          {progress ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <FileUp data-icon="inline-start" />}
          {progress ? `Uploading ${progress.pct}%` : label}
        </Button>
        {progress && <span className="min-w-0 truncate text-xs text-muted-foreground">{progress.name}</span>}
      </div>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((f) => (
            <li key={f.assetId} className="inline-flex h-7 max-w-full items-center gap-1 rounded-md border bg-subtle pr-1 pl-2 text-xs">
              <span className="truncate">{f.filename}</span>
              <button type="button" aria-label={`Remove ${f.filename}`} className="rounded p-0.5 hover:bg-muted" onClick={() => onChange(value.filter((x) => x.assetId !== f.assetId))}>
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
