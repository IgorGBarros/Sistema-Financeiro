import { cn } from "@/shared/lib/utils";

type Tom = "neutro" | "sucesso" | "erro" | "aviso" | "receita" | "despesa";

const TONS: Record<Tom, string> = {
  neutro: "bg-surface-container text-on-surface-variant",
  sucesso: "bg-receita-surface text-receita-on",
  erro: "bg-error-container text-on-error-container",
  aviso: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  receita: "bg-receita-surface text-receita-on",
  despesa: "bg-despesa-surface text-despesa-on",
};

export function Selo({
  children,
  tom = "neutro",
  className,
}: {
  children: React.ReactNode;
  tom?: Tom;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        TONS[tom],
        className,
      )}
    >
      {children}
    </span>
  );
}
