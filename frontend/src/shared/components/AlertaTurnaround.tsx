/**
 * Alerta global que aparece quando a projeção de caixa fica negativa nos
 * próximos meses. Aciona o turnaround proativamente — o usuário não precisa
 * descobrir o problema sozinho.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingDown, X } from "lucide-react";
import { Link } from "react-router-dom";

import { api } from "@/shared/lib/api";
import { formatarMoeda } from "@/features/fiscal/nfce";

function mesAtual(): string {
  const hoje = new Date();
  return new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0, 10);
}

function mes3Meses(): string {
  const hoje = new Date();
  return new Date(hoje.getFullYear(), hoje.getMonth() + 3, 1).toISOString().slice(0, 10);
}

export function AlertaTurnaround() {
  const [dispensado, setDispensado] = useState(false);

  const fluxo = useQuery({
    queryKey: ["fluxo-caixa", mesAtual(), mes3Meses()],
    queryFn: () => api.fluxoCaixa(mesAtual(), mes3Meses()),
    staleTime: 5 * 60_000,
  });

  if (dispensado || !fluxo.data) return null;

  // Encontra o primeiro mês com saldo acumulado negativo
  const linhasCriticas = fluxo.data.linhas.filter(
    (l) => Number(l.saldo_acumulado) < 0,
  );

  if (linhasCriticas.length === 0) return null;

  const pior = linhasCriticas.reduce((a, b) =>
    Number(a.saldo_acumulado) < Number(b.saldo_acumulado) ? a : b,
  );

  const nomeMes = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
  }).format(new Date(`${pior.competencia}T12:00:00`));

  return (
    <div className="flex items-start gap-3 border-b border-error/30 bg-error-container px-container-padding py-2.5">
      <TrendingDown className="mt-0.5 h-4 w-4 shrink-0 text-error" />
      <p className="flex-1 text-body-sm text-on-error-container">
        <span className="font-semibold">Projeção negativa:</span> o saldo chega a{" "}
        <span className="font-semibold tabular">{formatarMoeda(pior.saldo_acumulado)}</span>{" "}
        em {nomeMes}.{" "}
        <Link
          to="/turnaround"
          className="font-semibold underline hover:opacity-80"
        >
          Iniciar recuperação →
        </Link>
      </p>
      <button
        onClick={() => setDispensado(true)}
        className="shrink-0 text-error hover:opacity-80"
        aria-label="Dispensar alerta"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
