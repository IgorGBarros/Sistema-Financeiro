import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, Info, Receipt } from "lucide-react";

import { api, type Holerite } from "@/shared/lib/api";
import { formatarCompetencia, formatarMoeda } from "@/features/fiscal/nfce";
import { CabecalhoPagina } from "@/shared/components/CabecalhoPagina";
import { Kpi } from "@/shared/components/Kpi";
import { Selo } from "@/shared/components/Selo";
import { Card, CardContent } from "@/shared/ui/card";
import { cn } from "@/shared/lib/utils";

const TIPOS: Record<string, string> = {
  MENSAL: "Folha mensal",
  DECIMO_TERCEIRO_ADIANTAMENTO: "13º adiantamento",
  DECIMO_TERCEIRO_INTEGRAL: "13º integral",
  FERIAS: "Férias",
  RESCISAO: "Rescisão",
};

export default function Folha() {
  const holerites = useQuery({ queryKey: ["holerites"], queryFn: () => api.holerites() });
  const [aberto, setAberto] = useState<string | null>(null);

  const lista = holerites.data ?? [];
  const ano = new Date().getFullYear();
  const doAno = lista.filter((h) => h.competencia.startsWith(String(ano)));
  const liquidoAno = doAno.reduce((t, h) => t + Number(h.valor_liquido), 0);
  const descontosAno = doAno.reduce((t, h) => t + Number(h.total_descontos), 0);
  const suspeitos = lista.filter((h) => !h.conferencia_ok);

  return (
    <div className="p-container-padding">
      <CabecalhoPagina
        titulo="Folha de pagamento"
        descricao="Holerites importados, verba a verba."
      />

      {/* A separação é decisão de projeto, não pendência esquecida. Dizer isso
          na tela evita que alguém "conserte" o que é intencional. */}
      <Card className="mb-container-padding">
        <CardContent className="flex items-start gap-3 pt-6">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-secondary" />
          <div className="text-body-sm">
            <p className="font-medium">A folha ainda não entra no fluxo de caixa</p>
            <p className="text-on-surface-variant">
              O fluxo usa o contrato de salário previsto, que pode divergir do
              líquido real. Integrar antes de resolver a divergência
              transformaria um dado errado em dois.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="mb-container-padding grid grid-cols-1 gap-container-padding md:grid-cols-3">
        <Kpi
          rotulo={`Líquido recebido em ${ano}`}
          valor={formatarMoeda(liquidoAno)}
          icone={Receipt}
          tom="receita"
          apoio={`${doAno.length} recibo(s)`}
          carregando={holerites.isLoading}
        />
        <Kpi
          rotulo={`Descontos em ${ano}`}
          valor={formatarMoeda(descontosAno)}
          icone={AlertTriangle}
          tom="despesa"
          apoio="INSS, IR, vale-transporte e outros"
          carregando={holerites.isLoading}
        />
        <Kpi
          rotulo="Conferência"
          valor={suspeitos.length === 0 ? "Tudo confere" : `${suspeitos.length} com ressalva`}
          icone={Info}
          tom={suspeitos.length ? "despesa" : "receita"}
          apoio="Soma das verbas contra o líquido impresso"
          carregando={holerites.isLoading}
        />
      </div>

      {holerites.isLoading ? (
        <p className="py-stack-lg text-center text-body-sm text-on-surface-variant">
          Carregando…
        </p>
      ) : lista.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-stack-lg text-center">
            <Receipt className="h-8 w-8 text-on-surface-variant" />
            <p className="text-body-md">Nenhum holerite importado.</p>
            <p className="max-w-md text-body-sm text-on-surface-variant">
              Envie o recibo de pagamento em PDF pela tela de Cartões → Importar PDF.
              O leitor reconhece folha mensal, 13º e férias.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-stack-sm">
          {lista.map((holerite) => (
            <LinhaHolerite
              key={holerite.id}
              holerite={holerite}
              aberto={aberto === holerite.id}
              onAlternar={() => setAberto(aberto === holerite.id ? null : holerite.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LinhaHolerite({
  holerite,
  aberto,
  onAlternar,
}: {
  holerite: Holerite;
  aberto: boolean;
  onAlternar: () => void;
}) {
  const vencimentos = holerite.verbas.filter((v) => v.natureza === "VENCIMENTO");
  const descontos = holerite.verbas.filter((v) => v.natureza === "DESCONTO");

  return (
    <div className="cartao overflow-hidden">
      <button
        onClick={onAlternar}
        className="flex w-full items-center justify-between gap-stack-md p-stack-md text-left transition-colors hover:bg-surface-container-low"
      >
        <div className="min-w-0">
          <p className="font-medium text-on-surface">
            {formatarCompetencia(holerite.competencia)} · {TIPOS[holerite.tipo_folha] ?? holerite.tipo_folha}
          </p>
          <p className="truncate text-body-sm text-on-surface-variant">
            {holerite.empregador_nome}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-stack-md">
          {!holerite.conferencia_ok && (
            <Selo tom="aviso">
              <AlertTriangle className="h-3 w-3" />
              Conferir
            </Selo>
          )}
          <span className="tabular text-body-lg font-semibold text-receita">
            {formatarMoeda(holerite.valor_liquido)}
          </span>
          <ChevronDown
            className={cn("h-4 w-4 text-on-surface-variant transition-transform", aberto && "rotate-180")}
          />
        </div>
      </button>

      {aberto && (
        <div className="grid grid-cols-1 gap-container-padding border-t border-outline-variant p-container-padding md:grid-cols-2">
          <ListaVerbas titulo="Vencimentos" verbas={vencimentos} total={holerite.total_vencimentos} tom="receita" />
          <ListaVerbas titulo="Descontos" verbas={descontos} total={holerite.total_descontos} tom="despesa" />
          <div className="md:col-span-2 grid grid-cols-2 gap-stack-md rounded-lg border border-outline-variant bg-surface-container-low p-stack-md sm:grid-cols-4">
            {[
              ["Salário base", holerite.salario_base],
              ["Base INSS", holerite.base_inss],
              ["Base FGTS", holerite.base_fgts],
              ["FGTS do mês", holerite.fgts_mes],
            ].map(([rotulo, valor]) => (
              <div key={rotulo as string}>
                <p className="rotulo">{rotulo}</p>
                <p className="mt-1 tabular text-on-surface">
                  {valor ? formatarMoeda(valor as string) : "—"}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ListaVerbas({
  titulo,
  verbas,
  total,
  tom,
}: {
  titulo: string;
  verbas: Holerite["verbas"];
  total: string;
  tom: "receita" | "despesa";
}) {
  return (
    <div>
      <h3 className="rotulo mb-stack-sm border-b border-outline-variant pb-1">{titulo}</h3>
      <div className="space-y-1">
        {verbas.map((verba) => (
          <div key={verba.id} className="flex justify-between gap-2 text-body-sm">
            <span className="truncate text-on-surface">{verba.descricao}</span>
            <span className={cn("shrink-0 tabular", tom === "receita" ? "text-receita" : "text-despesa")}>
              {formatarMoeda(verba.valor)}
            </span>
          </div>
        ))}
        <div className="flex justify-between border-t border-outline-variant pt-1 text-body-sm font-semibold">
          <span>Total</span>
          <span className="tabular">{formatarMoeda(total)}</span>
        </div>
      </div>
    </div>
  );
}
