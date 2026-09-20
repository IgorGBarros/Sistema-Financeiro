import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, X } from "lucide-react";
import { Link } from "react-router-dom";

import { api } from "@/shared/lib/api";

const DIAS_ALERTA = 30;

function diasAte(dataIso: string): number {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const fim = new Date(`${dataIso}T12:00:00`);
  return Math.round((fim.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
}

export function AlertasContratos() {
  const [descartado, setDescartado] = useState(false);

  const contratos = useQuery({
    queryKey: ["contratos", {}],
    queryFn: () => api.contratos({ status: "ATIVO" }),
  });

  const vencendoEmBreve = useMemo(() => {
    return (contratos.data ?? []).filter((c) => {
      const dias = diasAte(c.data_fim);
      return dias >= 0 && dias <= DIAS_ALERTA;
    });
  }, [contratos.data]);

  if (descartado || vencendoEmBreve.length === 0) return null;

  return (
    <div className="flex items-center gap-3 border-b border-amber-500/30 bg-amber-50 px-container-padding py-2 dark:bg-amber-950/20">
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
      <p className="flex-1 text-body-sm text-amber-800 dark:text-amber-200">
        {vencendoEmBreve.length === 1 ? (
          <>
            O contrato{" "}
            <Link
              to={`/contratos/${vencendoEmBreve[0].id}`}
              className="font-semibold underline"
            >
              {vencendoEmBreve[0].descricao}
            </Link>{" "}
            vence em {diasAte(vencendoEmBreve[0].data_fim)} dia(s).
          </>
        ) : (
          <>
            {vencendoEmBreve.length} contratos vencem nos próximos {DIAS_ALERTA} dias:{" "}
            {vencendoEmBreve.map((c, i) => (
              <span key={c.id}>
                <Link to={`/contratos/${c.id}`} className="font-semibold underline">
                  {c.descricao}
                </Link>
                {i < vencendoEmBreve.length - 1 && ", "}
              </span>
            ))}
            .
          </>
        )}
      </p>
      <button
        onClick={() => setDescartado(true)}
        className="shrink-0 text-amber-600 hover:text-amber-800"
        aria-label="Fechar alerta"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
