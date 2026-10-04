import { Logo } from "@/components/brand/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-subtle">
      <header className="pt-safe flex h-16 items-center px-5 sm:px-8">
        <Logo />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-6 pb-16 sm:items-center sm:pt-0">
        <div className="w-full max-w-[400px]">{children}</div>
      </main>
      <footer className="pb-safe px-5 pb-6 text-center text-xs text-muted-foreground">
        Access is by invitation only.
      </footer>
    </div>
  );
}
