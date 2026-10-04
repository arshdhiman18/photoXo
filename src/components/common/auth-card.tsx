import { cn } from "@/lib/utils";

export function AuthCard({
  title,
  description,
  children,
  footer,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-2xl border bg-card shadow-sm", className)}>
      <div className="px-6 pt-6 sm:px-7 sm:pt-7">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-pretty text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="px-6 pt-5 pb-6 sm:px-7 sm:pb-7">{children}</div>
      {footer && <div className="border-t px-6 py-4 text-sm sm:px-7">{footer}</div>}
    </div>
  );
}
