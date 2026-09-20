import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { api } from "@/shared/lib/api";
import { formatarMoeda } from "@/features/fiscal/nfce";
import { cn } from "@/shared/lib/utils";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const DIAS_ALERTA = 7;

function diasAte(data: string): number {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const alvo = new Date(`${data}T00:00:00`);
  return Math.round((alvo.getTime() - hoje.getTime()) / 86_400_000);
}

export function AlertasVencimento() {
  const [dispensado, setDispensado] = useState(false);
  const hoje = new Date();
  const mes = iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1));

  const parcelas = useQuery({
    queryKey: ["parcelas", mes],
    queryFn: () => api.parcelas({ competencia: mes }),
  });

  const faturas = useQuery({
    queryKey: ["faturas", "alertas"],
    queryFn: () => api.faturas({ competencia: mes }),
  });

  if (dispensado) return null;

  const alertasParcelas = (parcelas.data ?? [])
    .filter((p) => !p.pago && diasAte(p.data_planejada) <= DIAS_ALERTA && diasAte(p.data_planejada) >= 0)
    .slice(0, 3);

  const alertasFaturas = (faturas.data ?? [])
    .filter((f) => f.data_vencimento && diasAte(f.data_vencimento) <= DIAS_ALERTA && diasAte(f.data_vencimento) >= 0)
    .slice(0, 2);

  const total = alertasParcelas.length + alertasFaturas.length;
  if (total === 0) return null;

  return (
    <div className="border-b border-warning/30 bg-warning-container px-container-padding py-2">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <div className="flex-1 text-body-sm">
          <span className="font-semibold text-on-warning-container">
            {total} vencimento{total > 1 ? "s" : ""} nos próximos {DIAS_ALERTA} dias:
          </span>{" "}
          <span className="text-on-warning-container">
            {[
              ...alertasParcelas.map((p) => {
                const d = diasAte(p.data_planejada);
                return `${p.contrato_descricao} ${d === 0 ? "(hoje)" : `(em ${d}d)`}`;
              }),
              ...alertasFaturas.map((f) => {
                const d = diasAte(f.data_vencimento);
                return `Fatura ${f.cartao_apelido} ${d === 0 ? "(hoje)" : `(em ${d}d)`}`;
              }),
            ].join(" · ")}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link to="/lancamentos" className="text-body-sm font-medium text-on-warning-container hover:underline">
            Ver lançamentos
          </Link>
          <button
            onClick={() => setDispensado(true)}
            className="text-warning hover:opacity-80"
            aria-label="Dispensar alerta"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
