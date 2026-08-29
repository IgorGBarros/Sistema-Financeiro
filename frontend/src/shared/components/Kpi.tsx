import { type LucideIcon } from "lucide-react";

import { cn } from "@/shared/lib/utils";

interface Props {
  rotulo: string;
  valor: string;
  icone: LucideIcon;
  /** Linha de apoio: variação, contagem, o que der contexto ao número. */
  apoio?: string;
  tom?: "neutro" | "receita" | "despesa";
  carregando?: boolean;
}

const TONS = {
  neutro: "text-on-surface-variant bg-surface-container-high",
  receita: "text-receita bg-receita-surface",
  despesa: "text-despesa bg-despesa-surface",
};

export function Kpi({ rotulo, valor, icone: Icone, apoio, tom = "neutro", carregando }: Props) {
  return (
    <div className="cartao flex flex-col justify-between p-stack-md transition-colors hover:border-secondary">
      <div className="flex items-start justify-between gap-stack-sm">
        <span className="rotulo">{rotulo}</span>
        <span className={cn("shrink-0 rounded p-1", TONS[tom])}>
          <Icone className="h-4 w-4" />
        </span>
      </div>
      <p
        className={cn(
          "mt-stack-sm text-headline-md font-bold tabular",
          carregando && "animate-pulse text-on-surface-variant",
        )}
      >
        {carregando ? "—" : valor}
      </p>
      {apoio && <p className="mt-unit text-body-sm text-on-surface-variant">{apoio}</p>}
    </div>
  );
}
