import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** Deterministic, muted hue per person so avatars are distinguishable without being loud. */
function hueOf(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

export function UserAvatar({
  name,
  image,
  seed,
  className,
}: {
  name: string;
  image?: string | null;
  seed?: string;
  className?: string;
}) {
  const hue = hueOf(seed ?? name);
  return (
    <Avatar className={cn("size-7 rounded-full", className)}>
      {image && <AvatarImage src={image} alt="" />}
      <AvatarFallback
        className="text-[11px] font-medium"
        style={{
          background: `oklch(0.94 0.03 ${hue})`,
          color: `oklch(0.38 0.08 ${hue})`,
        }}
      >
        {initialsOf(name)}
      </AvatarFallback>
    </Avatar>
  );
}
