"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Copies the approved caption + hashtags exactly (the uploader never edits them). */
export function CopyButton({ text, label = "Copy caption" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          setDone(false);
        }
      }}
    >
      {done ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
      {done ? "Copied" : label}
    </Button>
  );
}
