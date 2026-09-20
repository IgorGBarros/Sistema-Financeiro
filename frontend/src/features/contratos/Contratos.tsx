import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle, ArrowDownToLine, ArrowUpFromLine, Copy, ExternalLink, List,
  ListChecks, Plus, Scale, SlidersHorizontal, Table2, TrendingUp, XCircle,
} from "lucide-react";

import { api, type Contrato, type TipoLancamento } from "@/shared/lib/api";
import { formatarMoeda } from "@/features/fiscal/nfce";
import { FormularioContrato } from "@/features/contratos/components/FormularioContrato";
import { ModalRescindir } from "@/features/contratos/components/ModalRescindir";
import { PainelProjecao } from "@/features/contratos/components/PainelProjecao";
import { CabecalhoPagina } from "@/shared/components/CabecalhoPagina";
import { Confronto } from "@/features/contratos/components/Confronto";
import { MatrizContratos } from "@/features/contratos/components/MatrizContratos";
import { Kpi } from "@/shared/components/Kpi";
import { Selo } from "@/shared/components/Selo";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";

type Filtro = "TODOS" | TipoLancamento;
type Visao = "lista" | "matriz" | "confronto";

const FREQUENCIAS: Record<string, string> = {
  M: "Mensal", B: "Bimestral", T: "Trimestral",
  S: "Semestral", A: "Anual", U: "Única",
};

const vigencia = (inicio: string, fim: string) => {
  const curto = (d: string) => {
    const [ano, mes] = d.split("-");
    return `${mes}/${ano.slice(2)}`;
  };
  return `${curto(inicio)} - ${curto(fim)}`;
};

export default function Contratos() {
  const [filtro, setFiltro] = useState<Filtro>("TODOS");
  const [visao, setVisao] = useState<Visao>("lista");
  const [formularioAberto, setFormularioAberto] = useState(false);
  const [emEdicao, setEmEdicao] = useState<Contrato | null>(null);
  const [dadosDuplicacao, setDadosDuplicacao] = useState<Partial<Contrato> | undefined>();
  const [rescindirAberto, setRescindirAberto] = useState(false);
  const [emRescisao, setEmRescisao] = useState<Contrato | null>(null);

  const contratos = useQuery({
    queryKey: ["contratos", filtro],
    queryFn: () => api.contratos(filtro === "TODOS" ? {} : { tipo: filtro }),
  });

  // Os KPIs saem dos contratos já carregados, sem uma segunda requisição.
  const indicadores = useMemo(() => {
    const lista = contratos.data ?? [];
    const mensal = (tipo: TipoLancamento) =>
      lista
        .filter((c) => c.tipo === tipo && c.status === "ATIVO" && c.frequencia === "M")
        .reduce((total, c) => total + Number(c.valor_unitario), 0);

    const receitas = mensal("RECEITA");
    const despesas = mensal("DESPESA");
    return {
      receitas,
      despesas,
      sobra: receitas - despesas,
      ativos: lista.filter((c) => c.status === "ATIVO").length,
    };
  }, [contratos.data]);

  const lista = contratos.data ?? [];

  function abrir(contrato: Contrato | null) {
    setDadosDuplicacao(undefined);
    setEmEdicao(contrato);
    setFormularioAberto(true);
  }

  function duplicar(contrato: Contrato) {
    setEmEdicao(null);
    setDadosDuplicacao({ ...contrato, id: undefined });
    setFormularioAberto(true);
  }

  function abrirRescindir(contrato: Contrato) {
    setEmRescisao(contrato);
    setRescindirAberto(true);
  }

  return (
    <div className="p-container-padding">
      <CabecalhoPagina
        titulo="Contratos"
        descricao="Entradas e saídas com vigência própria, e a projeção que nasce delas."
        acoes={
          <>
            <Button variant="outline" disabled title="Filtros avançados em breve">
              <SlidersHorizontal className="mr-2 h-4 w-4" />
              Filtros
            </Button>
            <Button onClick={() => abrir(null)}>
              <Plus className="mr-2 h-4 w-4" />
              Novo contrato
            </Button>
          </>
        }
      />

      <div className="mb-container-padding grid grid-cols-1 gap-container-padding md:grid-cols-3">
        <Kpi
          rotulo="Receitas mensais"
          valor={formatarMoeda(indicadores.receitas)}
          icone={ArrowDownToLine}
          tom="receita"
          apoio="Soma dos contratos mensais ativos"
          carregando={contratos.isLoading}
        />
        <Kpi
          rotulo="Despesas mensais"
          valor={formatarMoeda(indicadores.despesas)}
          icone={ArrowUpFromLine}
          tom="despesa"
          apoio={`${indicadores.ativos} contrato(s) ativo(s)`}
          carregando={contratos.isLoading}
        />
        <Kpi
          rotulo="Sobra por mês"
          valor={formatarMoeda(indicadores.sobra)}
          icone={TrendingUp}
          tom={indicadores.sobra >= 0 ? "receita" : "despesa"}
          apoio={
            indicadores.sobra >= 0
              ? "O recorrente fecha no positivo"
              : "O recorrente já fecha no negativo"
          }
          carregando={contratos.isLoading}
        />
      </div>

      <div className="grid grid-cols-1 gap-container-padding xl:grid-cols-3">
        <div className="cartao flex flex-col overflow-hidden xl:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-stack-sm border-b border-outline-variant bg-surface p-stack-md">
            <div className="flex items-center gap-stack-md">
              <h2 className="text-headline-sm text-on-surface">
                {visao === "lista"
                  ? "Lista de contratos"
                  : visao === "matriz"
                    ? "Previsto por mês"
                    : "Previsto × realizado"}
              </h2>
              <div className="flex gap-1 rounded-lg bg-surface-container-low p-1">
                {(["lista", "matriz", "confronto"] as const).map((valor) => (
                  <button
                    key={valor}
                    onClick={() => setVisao(valor)}
                    className={cn(
                      "flex items-center gap-1.5 rounded px-3 py-1 text-body-sm transition-colors",
                      visao === valor
                        ? "bg-surface-container-lowest font-semibold text-on-surface shadow-sm"
                        : "text-on-surface-variant hover:text-on-surface",
                    )}
                  >
                    {valor === "lista" ? (
                      <><List className="h-3.5 w-3.5" /> Lista</>
                    ) : valor === "matriz" ? (
                      <><Table2 className="h-3.5 w-3.5" /> Matriz</>
                    ) : (
                      <><Scale className="h-3.5 w-3.5" /> Confronto</>
                    )}
                  </button>
                ))}
              </div>
            </div>
            <div
              className={cn(
                "flex gap-1 rounded-lg bg-surface-container-low p-1",
                visao !== "lista" && "hidden",
              )}
            >
              {(["TODOS", "RECEITA", "DESPESA"] as const).map((valor) => (
                <button
                  key={valor}
                  onClick={() => setFiltro(valor)}
                  className={cn(
                    "rounded px-3 py-1 text-body-sm transition-colors",
                    filtro === valor
                      ? "bg-surface-container-lowest font-semibold text-on-surface shadow-sm"
                      : "text-on-surface-variant hover:text-on-surface",
                  )}
                >
                  {valor === "TODOS" ? "Todos" : valor === "RECEITA" ? "Entradas" : "Saídas"}
                </button>
              ))}
            </div>
          </div>

          {visao === "confronto" ? (
            <Confronto />
          ) : visao === "matriz" ? (
            <MatrizContratos />
          ) : contratos.isLoading ? (
            <p className="p-stack-lg text-center text-body-sm text-on-surface-variant">
              Carregando…
            </p>
          ) : contratos.isError ? (
            <div className="flex items-start gap-3 p-stack-md">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-error" />
              <div>
                <p className="text-body-md font-medium">A lista não carregou.</p>
                <p className="text-body-sm text-on-surface-variant">
                  {(contratos.error as Error).message}
                </p>
              </div>
            </div>
          ) : lista.length === 0 ? (
            <div className="flex flex-col items-center gap-3 p-stack-lg text-center">
              <p className="text-body-sm text-on-surface-variant">
                Nenhum contrato cadastrado ainda.
              </p>
              <Button variant="outline" onClick={() => abrir(null)}>
                Cadastrar o primeiro
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-outline-variant bg-surface-container-low">
                    <th className="rotulo px-gutter-table py-2">Descrição</th>
                    <th className="rotulo px-gutter-table py-2">Vigência</th>
                    <th className="rotulo px-gutter-table py-2">Frequência</th>
                    <th className="rotulo px-gutter-table py-2 text-right">Parcela</th>
                    <th className="rotulo px-gutter-table py-2 text-right">Total</th>
                    <th className="rotulo px-gutter-table py-2 text-center">Ações</th>
                  </tr>
                </thead>
                <tbody className="text-body-sm">
                  {lista.map((contrato) => {
                    const receita = contrato.tipo === "RECEITA";
                    return (
                      <tr
                        key={contrato.id}
                        onClick={() => abrir(contrato)}
                        className={cn(
                          "group h-[40px] cursor-pointer border-b border-outline-variant transition-colors hover:bg-surface-container-low",
                          contrato.status === "RESCINDIDO" && "border-l-2 border-l-error",
                        )}
                      >
                        <td className="px-gutter-table py-2">
                          <div className="flex items-center gap-2 font-medium text-on-surface">
                            <span
                              className={cn(
                                "h-2 w-2 shrink-0 rounded-full",
                                receita ? "bg-receita" : "bg-despesa",
                              )}
                            />
                            <span className="truncate">{contrato.descricao}</span>
                          </div>
                          <div className="ml-4 truncate text-[11px] text-on-surface-variant">
                            {contrato.estabelecimento_nome} · {contrato.classificacao_nome}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-gutter-table py-2 tabular text-on-surface-variant">
                          {vigencia(contrato.data_inicio, contrato.data_fim)}
                        </td>
                        <td className="px-gutter-table py-2">
                          <Selo>{FREQUENCIAS[contrato.frequencia] ?? contrato.frequencia}</Selo>
                        </td>
                        <td
                          className={cn(
                            "px-gutter-table py-2 text-right tabular",
                            receita ? "text-receita" : "text-despesa",
                          )}
                        >
                          {receita ? "+" : "−"} {formatarMoeda(contrato.valor_unitario)}
                        </td>
                        <td className="px-gutter-table py-2 text-right tabular text-on-surface-variant">
                          {formatarMoeda(contrato.valor_total_contrato)}
                          <span className="ml-1 text-[10px]">
                            ({contrato.quantidade_parcelas}x)
                          </span>
                        </td>
                        <td className="px-gutter-table py-2 text-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                          <div className="flex justify-center gap-1">
                            <button
                              className="rounded p-1 text-on-surface-variant hover:bg-surface-container-high hover:text-secondary"
                              title="Editar e ver parcelas"
                              onClick={(e) => {
                                e.stopPropagation();
                                abrir(contrato);
                              }}
                            >
                              <ListChecks className="h-4 w-4" />
                            </button>
                            <Link
                              to={`/contratos/${contrato.id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="rounded p-1 text-on-surface-variant hover:bg-surface-container-high hover:text-secondary"
                              title="Ver detalhes e linha do tempo"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </Link>
                            <button
                              className="rounded p-1 text-on-surface-variant hover:bg-surface-container-high hover:text-secondary"
                              title="Duplicar contrato"
                              onClick={(e) => {
                                e.stopPropagation();
                                duplicar(contrato);
                              }}
                            >
                              <Copy className="h-4 w-4" />
                            </button>
                            {contrato.status === "ATIVO" && (
                              <button
                                className="rounded p-1 text-on-surface-variant hover:bg-error-container hover:text-on-error-container"
                                title="Rescindir"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  abrirRescindir(contrato);
                                }}
                              >
                                <XCircle className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {visao === "lista" && lista.length > 0 && (
            <div className="flex items-center justify-between border-t border-outline-variant bg-surface-container-low p-stack-sm text-body-sm text-on-surface-variant">
              <span>
                {lista.length} contrato{lista.length === 1 ? "" : "s"}
              </span>
            </div>
          )}
        </div>

        <PainelProjecao />
      </div>

      <FormularioContrato
        aberto={formularioAberto}
        contrato={emEdicao}
        dadosIniciais={dadosDuplicacao}
        onFechar={() => { setFormularioAberto(false); setDadosDuplicacao(undefined); }}
      />

      <ModalRescindir
        aberto={rescindirAberto}
        contrato={emRescisao}
        onFechar={() => { setRescindirAberto(false); setEmRescisao(null); }}
      />

      <ModalRescindir
        aberto={rescindirAberto}
        contrato={emRescisao}
        onFechar={() => { setRescindirAberto(false); setEmRescisao(null); }}
      />
    </div>
  );
}
