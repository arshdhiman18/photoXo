import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  tone = "default",
}: {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  tone?: "default" | "plain";
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 py-12 text-center",
        tone === "default" && "rounded-xl border border-dashed bg-subtle",
        className,
      )}
    >
      {Icon && (
        <span className="mb-3 inline-flex size-10 items-center justify-center rounded-lg border bg-card text-muted-foreground shadow-xs">
          <Icon className="size-[18px]" strokeWidth={1.75} />
        </span>
      )}
      <p className="text-sm font-medium">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-pretty text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
