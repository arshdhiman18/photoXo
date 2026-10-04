"use client";

import { Check } from "lucide-react";
import { POSTING_PLATFORM_LABEL, POSTING_PLATFORMS, type PostingPlatform } from "@/lib/domain/postings";
import { cn } from "@/lib/utils";

/** Toggle chips for the platforms content must be posted to. */
export function PlatformPicker({
  value,
  onChange,
  disabled,
  id,
}: {
  value: PostingPlatform[];
  onChange: (v: PostingPlatform[]) => void;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <div id={id} role="group" aria-label="Platforms" className="flex flex-wrap gap-2">
      {POSTING_PLATFORMS.map((p) => {
        const on = value.includes(p);
        return (
          <button
            key={p}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== p) : POSTING_PLATFORMS.filter((x) => x === p || value.includes(x)))}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors disabled:opacity-50 [@media(pointer:coarse)]:h-10",
              on ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-subtle hover:text-foreground",
            )}
          >
            {on && <Check className="size-3.5" />}
            {POSTING_PLATFORM_LABEL[p]}
          </button>
        );
      })}
    </div>
  );
}
