import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Styled native <select> for server-rendered GET filter forms (works without
 * JavaScript, fully keyboard/screen-reader accessible, mobile-native picker).
 */
export function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <span className={cn("relative inline-flex min-w-0", className)}>
      <select
        {...props}
        className="h-9 w-full min-w-0 appearance-none rounded-md border border-input bg-card pr-8 pl-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 [@media(pointer:coarse)]:h-10"
      >
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
    </span>
  );
}
