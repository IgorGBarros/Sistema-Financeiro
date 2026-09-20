import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronLeft, Clock, Link2, Sparkles } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { api, type LancamentoFatura } from "@/shared/lib/api";
import { useToast } from "@/shared/ui/use-toast";
import { formatarCompetencia, formatarMoeda } from "@/features/fiscal/nfce";
import { CabecalhoPagina } from "@/shared/components/CabecalhoPagina";
import { Kpi } from "@/shared/components/Kpi";
import { Selo } from "@/shared/components/Selo";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { cn } from "@/shared/lib/utils";

const METODOS: Record<string, string> = {
  VALOR_PARCELA_DATA: "valor, parcela e data",
  VALOR_DATA: "valor e data",
  VALOR_ESTABELECIMENTO: "valor e estabelecimento",
};

const dataCurta = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(
        new Date(`${iso}T12:00:00`),
      )
    : "—";

/**
 * Conciliação de uma fatura.
 *
 * A ideia que organiza a tela: o trabalho é olhar as exceções, não conferir as
 * linhas óbvias. Por isso as pendências vêm primeiro e em destaque, e o que já
 * casou fica recolhido embaixo, em cinza.
 */
export default function Fatura() {
  const { id } = useParams<{ id: string }>();
  const [mostrarConciliados, setMostrarConciliados] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const autoConciliar = useMutation({
    mutationFn: () => api.autoConciliarFatura(id!),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["fatura", id] });
      toast({
        title: `${res.conciliados} lançamento(s) conciliado(s)`,
        description: res.pendentes_restantes > 0
          ? `${res.pendentes_restantes} ainda sem correspondência.`
          : "Tudo conciliado nesta fatura.",
      });
    },
    onError: (e: Error) =>
      toast({ variant: "destructive", title: "Erro ao conciliar", description: e.message }),
  });

  const fatura = useQuery({
    queryKey: ["fatura", id],
    queryFn: () => api.fatura(id!),
    enabled: Boolean(id),
  });

  const pendencias = useQuery({
    queryKey: ["fatura-pendencias", id],
    queryFn: () => api.pendenciasFatura(id!),
    enabled: Boolean(id),
  });

  const { pendentes, conciliados, futuros, soma } = useMemo(() => {
    const linhas = fatura.data?.lancamentos ?? [];
    const correntes = linhas.filter((l) => l.secao === "CORRENTE");
    return {
      pendentes: correntes.filter((l) => !l.conciliado),
      conciliados: correntes.filter((l) => l.conciliado),
      futuros: linhas.filter((l) => l.secao === "FUTURA"),
      soma: correntes.reduce((total, l) => total + Number(l.valor), 0),
    };
  }, [fatura.data]);

  const informado = Number(fatura.data?.valor_total_informado ?? 0);
  const divergencia = informado ? soma - informado : 0;

  if (fatura.isLoading) {
    return (
      <p className="p-container-padding text-center text-body-sm text-on-surface-variant">
        Carregando fatura…
      </p>
    );
  }

  if (!fatura.data) {
    return (
      <div className="p-container-padding text-center">
        <p className="text-body-sm text-on-surface-variant">Fatura não encontrada.</p>
        <Button variant="outline" className="mt-stack-md" asChild>
          <Link to="/cartoes">Voltar para cartões</Link>
        </Button>
      </div>
    );
  }

  const dados = fatura.data;

  return (
    <div className="p-container-padding">
      <Button variant="ghost" size="sm" className="mb-stack-sm" asChild>
        <Link to="/cartoes">
          <ChevronLeft className="mr-1 h-4 w-4" />
          Cartões
        </Link>
      </Button>

      <CabecalhoPagina
        titulo={`${dados.cartao_apelido} — ${formatarCompetencia(dados.competencia)}`}
        descricao={`Vence em ${dataCurta(dados.data_vencimento)}. Confira as linhas que não casaram sozinhas.`}
        acoes={
          pendentes.length > 0 ? (
            <Button
              variant="outline"
              onClick={() => autoConciliar.mutate()}
              disabled={autoConciliar.isPending}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              {autoConciliar.isPending ? "Conciliando…" : `Conciliar todos (${pendentes.length})`}
            </Button>
          ) : undefined
        }
      />

      <div className="mb-container-padding grid grid-cols-1 gap-container-padding md:grid-cols-3">
        <Kpi
          rotulo="Total da fatura"
          valor={formatarMoeda(informado || soma)}
          icone={Clock}
          apoio={`${pendentes.length + conciliados.length} lançamento(s)`}
        />
        <Kpi
          rotulo="Conciliados"
          valor={String(conciliados.length)}
          icone={Check}
          tom="receita"
          apoio="Casaram com uma compra já registrada"
        />
        <Kpi
          rotulo="Precisam de revisão"
          valor={String(pendentes.length)}
          icone={AlertTriangle}
          tom={pendentes.length ? "despesa" : "neutro"}
          apoio={
            pendencias.data
              ? `${pendencias.data.sem_categoria} sem categoria definida`
              : "Compras sem cupom escaneado"
          }
        />
      </div>

      {Math.abs(divergencia) > 0.02 && (
        <Card className="mb-container-padding border-warning/60">
          <CardContent className="flex items-start gap-3 pt-6">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
            <div className="text-body-sm">
              <p className="font-medium">
                A soma dos lançamentos não bate com o total da fatura
              </p>
              <p className="text-on-surface-variant">
                Lidos {formatarMoeda(soma)}, fatura informa {formatarMoeda(informado)} —
                diferença de {formatarMoeda(Math.abs(divergencia))}. Alguma linha não
                foi reconhecida pelo leitor, ou a separação entre fatura corrente e
                parcelas futuras errou.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <section className="cartao mb-container-padding overflow-hidden">
        <div className="border-b border-outline-variant bg-surface p-stack-md">
          <h2 className="text-headline-sm text-on-surface">
            Sem compra correspondente ({pendentes.length})
          </h2>
          <p className="mt-1 text-body-sm text-on-surface-variant">
            Compras que entraram na fatura mas cujo cupom não foi escaneado.
            Precisam de categoria para virarem despesa classificada.
          </p>
        </div>
        {pendentes.length === 0 ? (
          <p className="p-stack-lg text-center text-body-sm text-on-surface-variant">
            Tudo casou. Nada para revisar nesta fatura.
          </p>
        ) : (
          <TabelaLancamentos linhas={pendentes} destacar />
        )}
      </section>

      {conciliados.length > 0 && (
        <section className="cartao mb-container-padding overflow-hidden">
          <button
            className="flex w-full items-center justify-between border-b border-outline-variant bg-surface p-stack-md text-left"
            onClick={() => setMostrarConciliados((v) => !v)}
          >
            <div>
              <h2 className="text-headline-sm text-on-surface">
                Já conciliados ({conciliados.length})
              </h2>
              <p className="mt-1 text-body-sm text-on-surface-variant">
                Casaram com uma compra registrada. Não precisam de atenção.
              </p>
            </div>
            <span className="text-body-sm text-secondary">
              {mostrarConciliados ? "Ocultar" : "Mostrar"}
            </span>
          </button>
          {mostrarConciliados && <TabelaLancamentos linhas={conciliados} />}
        </section>
      )}

      {futuros.length > 0 && (
        <section className="cartao overflow-hidden">
          <div className="border-b border-outline-variant bg-surface p-stack-md">
            <h2 className="text-headline-sm text-on-surface">
              Parcelas de faturas futuras ({futuros.length})
            </h2>
            <p className="mt-1 text-body-sm text-on-surface-variant">
              Informativo. Estas parcelas ainda vão aparecer na fatura do mês
              delas — não entram na despesa deste mês.
            </p>
          </div>
          <TabelaLancamentos linhas={futuros} esmaecer />
        </section>
      )}
    </div>
  );
}

function TabelaLancamentos({
  linhas,
  destacar,
  esmaecer,
}: {
  linhas: LancamentoFatura[];
  destacar?: boolean;
  esmaecer?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-outline-variant bg-surface-container-low">
            <th className="rotulo w-20 px-gutter-table py-2">Data</th>
            <th className="rotulo px-gutter-table py-2">Descrição</th>
            <th className="rotulo w-24 px-gutter-table py-2 text-center">Parcela</th>
            <th className="rotulo px-gutter-table py-2 text-right">Valor</th>
            <th className="rotulo w-44 px-gutter-table py-2">Situação</th>
          </tr>
        </thead>
        <tbody className={cn("text-body-sm", esmaecer && "opacity-60")}>
          {linhas.map((linha) => (
            <tr
              key={linha.id}
              className={cn(
                "h-[40px] border-b border-outline-variant",
                destacar && "bg-warning-container/30",
              )}
            >
              <td className="px-gutter-table tabular text-on-surface-variant">
                {dataCurta(linha.data_compra)}
              </td>
              <td className="px-gutter-table">
                <p className="truncate text-on-surface">{linha.descricao}</p>
                {linha.estabelecimento_nome && (
                  <p className="truncate text-[11px] text-on-surface-variant">
                    {linha.estabelecimento_nome}
                  </p>
                )}
              </td>
              <td className="px-gutter-table text-center tabular text-on-surface-variant">
                {linha.parcela_atual
                  ? `${linha.parcela_atual}/${linha.parcela_total}`
                  : "—"}
              </td>
              <td className="px-gutter-table text-right tabular text-despesa">
                {formatarMoeda(linha.valor)}
              </td>
              <td className="px-gutter-table">
                {linha.conciliado ? (
                  <Selo tom="sucesso">
                    <Link2 className="h-3 w-3" />
                    {METODOS[linha.metodo_conciliacao] ?? "conciliado"}
                  </Selo>
                ) : linha.secao === "FUTURA" ? (
                  <Selo>Fatura futura</Selo>
                ) : (
                  <Selo tom="aviso">
                    <AlertTriangle className="h-3 w-3" />
                    Sem compra
                  </Selo>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
