import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  ClipboardList,
  Plus,
  RefreshCw,
  TrendingDown,
  XCircle,
} from "lucide-react";

import {
  api,
  type ClassificacaoContrato,
  type Contrato,
  type PlanoTurnaround,
  type TipoClassificacao,
} from "@/shared/lib/api";
import { formatarMoeda } from "@/features/fiscal/nfce";
import { CabecalhoPagina } from "@/shared/components/CabecalhoPagina";
import { Kpi } from "@/shared/components/Kpi";
import { Selo } from "@/shared/components/Selo";
import { Button } from "@/shared/ui/button";
import { useToast } from "@/shared/ui/use-toast";
import { cn } from "@/shared/lib/utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatarPct(valor: string) {
  return `${Number(valor).toFixed(1)}%`;
}

function corComprometimento(pct: number) {
  if (pct <= 50) return "text-receita";
  if (pct <= 75) return "text-amber-500";
  return "text-despesa";
}

const ROTULO_CLASSIFICACAO: Record<TipoClassificacao, string> = {
  ESSENCIAL: "Essencial",
  BOM: "Bom",
  RUIM: "Ruim",
};

const TOM_CLASSIFICACAO: Record<TipoClassificacao, "sucesso" | "aviso" | "erro"> = {
  ESSENCIAL: "sucesso",
  BOM: "aviso",
  RUIM: "erro",
};

// ---------------------------------------------------------------------------
// Painel de diagnóstico
// ---------------------------------------------------------------------------

function PainelDiagnostico({ saldoAtual }: { saldoAtual: string }) {
  const diag = useQuery({
    queryKey: ["turnaround", "diagnostico", saldoAtual],
    queryFn: () => api.diagnosticoTurnaround(saldoAtual),
    staleTime: 60_000,
  });

  const d = diag.data;

  const semaforo = {
    verde: { icone: CheckCircle2, cor: "text-receita", texto: "Saudável" },
    amarelo: { icone: AlertTriangle, cor: "text-amber-500", texto: "Atenção" },
    vermelho: { icone: XCircle, cor: "text-despesa", texto: "Crítico" },
  };

  const tom = d ? semaforo[d.semaforo] : semaforo.verde;
  const Icone = tom.icone;

  return (
    <div className="cartao p-container-padding">
      <div className="mb-stack-md flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-headline-sm text-on-surface">
          <ClipboardList className="h-5 w-5 text-secondary" />
          Diagnóstico financeiro
        </h2>
        {d && (
          <div className={cn("flex items-center gap-1.5 text-body-sm font-medium", tom.cor)}>
            <Icone className="h-4 w-4" />
            {tom.texto}
          </div>
        )}
      </div>

      <div className="mb-container-padding grid grid-cols-2 gap-container-padding md:grid-cols-4">
        <Kpi
          rotulo="Renda mensal média"
          valor={d ? formatarMoeda(d.renda_mensal_media) : "—"}
          icone={TrendingDown}
          tom="receita"
          carregando={diag.isLoading}
        />
        <Kpi
          rotulo="Despesa mensal média"
          valor={d ? formatarMoeda(d.despesa_mensal_media) : "—"}
          icone={TrendingDown}
          tom="despesa"
          carregando={diag.isLoading}
        />
        <Kpi
          rotulo="% comprometida"
          valor={d ? formatarPct(d.comprometimento_pct) : "—"}
          icone={Circle}
          apoio={`Meta: ${d?.regras.comprometimento_meta ?? "30"}%`}
          carregando={diag.isLoading}
        />
        <Kpi
          rotulo="Score de saúde"
          valor={d ? `${d.score_saude}/100` : "—"}
          icone={CheckCircle2}
          carregando={diag.isLoading}
        />
      </div>

      {d && (
        <>
          <div className="mb-stack-md">
            <p className="rotulo mb-2">Comprometimento da renda</p>
            <div className="h-3 w-full overflow-hidden rounded-full bg-surface-container-low">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  Number(d.comprometimento_pct) <= 50
                    ? "bg-receita"
                    : Number(d.comprometimento_pct) <= 75
                      ? "bg-amber-500"
                      : "bg-despesa",
                )}
                style={{ width: `${Math.min(100, Number(d.comprometimento_pct))}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-on-surface-variant">
              <span>0%</span>
              <span className={cn("font-semibold tabular", corComprometimento(Number(d.comprometimento_pct)))}>
                {formatarPct(d.comprometimento_pct)}
              </span>
              <span>100%</span>
            </div>
          </div>

          <div>
            <p className="rotulo mb-2">Projeção — próximos 3 meses</p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-body-sm">
                <thead>
                  <tr className="border-b border-outline-variant bg-surface-container-low">
                    <th className="rotulo px-gutter-table py-2">Mês</th>
                    <th className="rotulo px-gutter-table py-2 text-right">Receita</th>
                    <th className="rotulo px-gutter-table py-2 text-right">Despesa</th>
                    <th className="rotulo px-gutter-table py-2 text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {d.projecao_3_meses.map((m) => (
                    <tr key={m.competencia} className="border-b border-outline-variant">
                      <td className="px-gutter-table py-2 tabular text-on-surface">
                        {new Intl.DateTimeFormat("pt-BR", {
                          month: "short",
                          year: "numeric",
                        }).format(new Date(`${m.competencia}T12:00:00`))}
                      </td>
                      <td className="px-gutter-table py-2 text-right tabular text-receita">
                        {formatarMoeda(m.receita)}
                      </td>
                      <td className="px-gutter-table py-2 text-right tabular text-despesa">
                        {formatarMoeda(m.despesa)}
                      </td>
                      <td
                        className={cn(
                          "px-gutter-table py-2 text-right tabular font-semibold",
                          Number(m.saldo) >= 0 ? "text-receita" : "text-despesa",
                        )}
                      >
                        {formatarMoeda(m.saldo)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Classificação de contratos
// ---------------------------------------------------------------------------

const OPCOES_CLASSIFICACAO: {
  tipo: TipoClassificacao;
  rotulo: string;
  descricao: string;
}[] = [
  {
    tipo: "ESSENCIAL",
    rotulo: "Essencial",
    descricao: "Mantém a vida funcionando — nunca cortar",
  },
  {
    tipo: "BOM",
    rotulo: "Bom",
    descricao: "Aumenta previsibilidade ou capacidade produtiva",
  },
  {
    tipo: "RUIM",
    rotulo: "Ruim",
    descricao: "Juros altos, consumo emocional ou sem retorno — eliminar ou renegociar",
  },
];

function LinhaContrato({
  contrato,
  classificacao,
  planoId,
  onSalvo,
}: {
  contrato: Contrato;
  classificacao?: ClassificacaoContrato;
  planoId: string;
  onSalvo: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [justificativa, setJustificativa] = useState(classificacao?.justificativa ?? "");
  const { toast } = useToast();

  const salvar = useMutation({
    mutationFn: (tipo: TipoClassificacao) =>
      api.salvarClassificacao(
        { plano: planoId, contrato: contrato.id, tipo, justificativa },
        classificacao?.id,
      ),
    onSuccess: () => {
      onSalvo();
      setAberto(false);
      toast({ title: "Classificação salva" });
    },
    onError: () => toast({ title: "Erro ao salvar", variant: "destructive" }),
  });

  const remover = useMutation({
    mutationFn: () => api.deletarClassificacao(classificacao!.id),
    onSuccess: () => {
      onSalvo();
      toast({ title: "Classificação removida" });
    },
  });

  return (
    <div className="border-b border-outline-variant last:border-0">
      <button
        className="flex w-full items-center gap-3 px-gutter-table py-3 text-left hover:bg-surface-container-low"
        onClick={() => setAberto((v) => !v)}
      >
        <div className="flex-1 min-w-0">
          <p className="truncate text-body-sm font-medium text-on-surface">
            {contrato.descricao}
          </p>
          <p className="text-[11px] text-on-surface-variant">
            {contrato.classificacao_nome} · {formatarMoeda(contrato.valor_unitario)}/mês
          </p>
        </div>
        {classificacao ? (
          <Selo tom={TOM_CLASSIFICACAO[classificacao.tipo]}>
            {ROTULO_CLASSIFICACAO[classificacao.tipo]}
          </Selo>
        ) : (
          <span className="text-[11px] text-on-surface-variant italic">sem classificação</span>
        )}
        {aberto ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-on-surface-variant" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-on-surface-variant" />
        )}
      </button>

      {aberto && (
        <div className="border-t border-outline-variant bg-surface-container-lowest px-gutter-table py-4">
          <p className="rotulo mb-3">Classificar como</p>
          <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {OPCOES_CLASSIFICACAO.map((op) => (
              <button
                key={op.tipo}
                onClick={() => salvar.mutate(op.tipo)}
                disabled={salvar.isPending}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors",
                  classificacao?.tipo === op.tipo
                    ? op.tipo === "ESSENCIAL"
                      ? "border-receita bg-receita/10"
                      : op.tipo === "BOM"
                        ? "border-amber-500 bg-amber-500/10"
                        : "border-despesa bg-despesa/10"
                    : "border-outline-variant hover:border-outline hover:bg-surface-container-low",
                )}
              >
                <p className="text-body-sm font-semibold text-on-surface">{op.rotulo}</p>
                <p className="mt-0.5 text-[11px] text-on-surface-variant">{op.descricao}</p>
              </button>
            ))}
          </div>
          <div className="flex items-start gap-2">
            <textarea
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-body-sm placeholder:text-on-surface-variant/60 focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="Justificativa (opcional)"
              rows={2}
              value={justificativa}
              onChange={(e) => setJustificativa(e.target.value)}
            />
            {classificacao && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => remover.mutate()}
                disabled={remover.isPending}
              >
                Remover
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PainelClassificacao({ plano }: { plano: PlanoTurnaround }) {
  const qc = useQueryClient();
  const contratos = useQuery({
    queryKey: ["contratos"],
    queryFn: () => api.contratos(),
  });
  const classificacoes = useQuery({
    queryKey: ["turnaround", "classificacoes", plano.id],
    queryFn: () => api.classificacoesTurnaround(plano.id),
  });

  const mapaClassificacoes = new Map(
    (classificacoes.data ?? []).map((c) => [c.contrato, c]),
  );

  const contratosAtivos = (contratos.data ?? []).filter((c) => c.status === "ATIVO");
  const despesas = contratosAtivos.filter((c) => c.tipo === "DESPESA");

  const totalRuim = [...mapaClassificacoes.values()].filter((c) => c.tipo === "RUIM").length;
  const semClassificacao = despesas.filter((c) => !mapaClassificacoes.has(c.id)).length;

  const recarregar = () => {
    void qc.invalidateQueries({ queryKey: ["turnaround", "classificacoes", plano.id] });
  };

  return (
    <div className="cartao overflow-hidden">
      <div className="flex items-center justify-between border-b border-outline-variant bg-surface p-stack-md">
        <div>
          <h2 className="text-headline-sm text-on-surface">Classificação de contratos</h2>
          <p className="mt-0.5 text-body-sm text-on-surface-variant">
            Classifique cada despesa ativa como Essencial, Boa ou Ruim.
          </p>
        </div>
        <div className="flex gap-2">
          {totalRuim > 0 && (
            <Selo tom="erro">
              {totalRuim} ruim{totalRuim > 1 ? "s" : ""}
            </Selo>
          )}
          {semClassificacao > 0 && (
            <Selo>{semClassificacao} sem classificar</Selo>
          )}
        </div>
      </div>

      {contratos.isLoading || classificacoes.isLoading ? (
        <p className="p-stack-lg text-center text-body-sm text-on-surface-variant">
          Carregando…
        </p>
      ) : despesas.length === 0 ? (
        <p className="p-stack-lg text-center text-body-sm text-on-surface-variant">
          Nenhum contrato de despesa ativo.
        </p>
      ) : (
        <div>
          {despesas.map((c) => (
            <LinhaContrato
              key={c.id}
              contrato={c}
              classificacao={mapaClassificacoes.get(c.id)}
              planoId={plano.id}
              onSalvo={recarregar}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formulário de plano
// ---------------------------------------------------------------------------

function FormularioPlano({
  plano,
  onFechar,
}: {
  plano?: PlanoTurnaround;
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [nome, setNome] = useState(plano?.nome ?? "");
  const [dataInicio, setDataInicio] = useState(
    plano?.data_inicio ?? new Date().toISOString().slice(0, 10),
  );
  const [metaComprometimento, setMetaComprometimento] = useState(
    plano?.meta_comprometimento_pct ?? "30",
  );
  const [observacao, setObservacao] = useState(plano?.observacao ?? "");

  const salvar = useMutation({
    mutationFn: () =>
      api.salvarPlanoTurnaround(
        {
          nome,
          data_inicio: dataInicio,
          meta_comprometimento_pct: metaComprometimento || undefined,
          observacao,
          status: plano?.status ?? "RASCUNHO",
        },
        plano?.id,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["turnaround", "planos"] });
      toast({ title: plano ? "Plano atualizado" : "Plano criado" });
      onFechar();
    },
    onError: () => toast({ title: "Erro ao salvar plano", variant: "destructive" }),
  });

  return (
    <div className="cartao p-container-padding">
      <h3 className="mb-stack-md text-headline-sm text-on-surface">
        {plano ? "Editar plano" : "Novo plano de turnaround"}
      </h3>
      <div className="grid grid-cols-1 gap-stack-md md:grid-cols-2">
        <div className="col-span-full">
          <label className="rotulo mb-1 block">Nome do plano</label>
          <input
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-body-sm focus:outline-none focus:ring-1 focus:ring-ring"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Ex.: Turnaround 2026"
          />
        </div>
        <div>
          <label className="rotulo mb-1 block">Data de início</label>
          <input
            type="date"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-body-sm focus:outline-none focus:ring-1 focus:ring-ring"
            value={dataInicio}
            onChange={(e) => setDataInicio(e.target.value)}
          />
        </div>
        <div>
          <label className="rotulo mb-1 block">Meta de comprometimento (%)</label>
          <input
            type="number"
            min="0"
            max="100"
            step="1"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-body-sm focus:outline-none focus:ring-1 focus:ring-ring"
            value={metaComprometimento}
            onChange={(e) => setMetaComprometimento(e.target.value)}
            placeholder="30"
          />
        </div>
        <div className="col-span-full">
          <label className="rotulo mb-1 block">Observações</label>
          <textarea
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-body-sm focus:outline-none focus:ring-1 focus:ring-ring"
            rows={3}
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="Contexto, estratégia, comprometimentos…"
          />
        </div>
      </div>
      <div className="mt-stack-md flex justify-end gap-stack-sm">
        <Button variant="outline" onClick={onFechar}>
          Cancelar
        </Button>
        <Button onClick={() => salvar.mutate()} disabled={!nome || salvar.isPending}>
          {salvar.isPending ? "Salvando…" : "Salvar plano"}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------

const STATUS_ROTULO: Record<PlanoTurnaround["status"], string> = {
  RASCUNHO: "Rascunho",
  ATIVO: "Em execução",
  CONCLUIDO: "Concluído",
  PAUSADO: "Pausado",
};

const STATUS_TOM: Record<
  PlanoTurnaround["status"],
  "sucesso" | "aviso" | "erro" | undefined
> = {
  RASCUNHO: undefined,
  ATIVO: "sucesso",
  CONCLUIDO: undefined,
  PAUSADO: "aviso",
};

export default function Turnaround() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [criandoPlano, setCriandoPlano] = useState(false);
  const [editandoPlano, setEditandoPlano] = useState<PlanoTurnaround | null>(null);
  const [planoSelecionado, setPlanoSelecionado] = useState<string | null>(null);

  const planos = useQuery({
    queryKey: ["turnaround", "planos"],
    queryFn: () => api.planosTurnaround(),
  });

  const plano = planos.data?.find((p) => p.id === planoSelecionado)
    ?? planos.data?.find((p) => p.status === "ATIVO")
    ?? planos.data?.[0];

  const ativarPlano = useMutation({
    mutationFn: (id: string) =>
      api.salvarPlanoTurnaround({ status: "ATIVO" }, id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["turnaround", "planos"] });
      toast({ title: "Plano ativado" });
    },
    onError: (e: unknown) => {
      const msg =
        e instanceof Error ? e.message : "Pause ou conclua o plano ativo antes de ativar outro.";
      toast({ title: "Erro", description: msg, variant: "destructive" });
    },
  });

  const pausarPlano = useMutation({
    mutationFn: (id: string) =>
      api.salvarPlanoTurnaround({ status: "PAUSADO" }, id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["turnaround", "planos"] });
      toast({ title: "Plano pausado" });
    },
  });

  const concluirPlano = useMutation({
    mutationFn: (id: string) =>
      api.salvarPlanoTurnaround({ status: "CONCLUIDO" }, id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["turnaround", "planos"] });
      toast({ title: "Plano concluído" });
    },
  });

  return (
    <div className="p-container-padding">
      <CabecalhoPagina
        titulo="Turnaround"
        descricao="Recuperação financeira — diagnóstico, classificação de contratos e plano de ação."
        acoes={
          <Button onClick={() => setCriandoPlano(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Novo plano
          </Button>
        }
      />

      {criandoPlano && (
        <div className="mb-container-padding">
          <FormularioPlano onFechar={() => setCriandoPlano(false)} />
        </div>
      )}

      {editandoPlano && (
        <div className="mb-container-padding">
          <FormularioPlano
            plano={editandoPlano}
            onFechar={() => setEditandoPlano(null)}
          />
        </div>
      )}

      <PainelDiagnostico saldoAtual="0" />

      {/* Lista de planos */}
      {(planos.data?.length ?? 0) > 0 && (
        <div className="mt-container-padding cartao overflow-hidden">
          <div className="border-b border-outline-variant bg-surface p-stack-md">
            <h2 className="text-headline-sm text-on-surface">Planos de recuperação</h2>
          </div>
          <div className="divide-y divide-outline-variant">
            {planos.data!.map((p) => (
              <div
                key={p.id}
                className={cn(
                  "flex flex-wrap items-center justify-between gap-3 px-gutter-table py-3",
                  plano?.id === p.id && "bg-surface-container-lowest",
                )}
              >
                <div
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-3"
                  onClick={() => setPlanoSelecionado(p.id)}
                >
                  <div className="min-w-0">
                    <p className="truncate text-body-sm font-medium text-on-surface">
                      {p.nome}
                    </p>
                    <p className="text-[11px] text-on-surface-variant">
                      Início:{" "}
                      {new Intl.DateTimeFormat("pt-BR").format(
                        new Date(`${p.data_inicio}T12:00:00`),
                      )}
                      {p.meta_comprometimento_pct &&
                        ` · Meta: ${p.meta_comprometimento_pct}% comprometido`}
                    </p>
                  </div>
                  <Selo tom={STATUS_TOM[p.status]}>{STATUS_ROTULO[p.status]}</Selo>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditandoPlano(p)}
                  >
                    Editar
                  </Button>
                  {p.status === "RASCUNHO" && (
                    <Button
                      size="sm"
                      onClick={() => ativarPlano.mutate(p.id)}
                      disabled={ativarPlano.isPending}
                    >
                      Ativar
                    </Button>
                  )}
                  {p.status === "ATIVO" && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => pausarPlano.mutate(p.id)}
                        disabled={pausarPlano.isPending}
                      >
                        Pausar
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => concluirPlano.mutate(p.id)}
                        disabled={concluirPlano.isPending}
                      >
                        Concluir
                      </Button>
                    </>
                  )}
                  {p.status === "PAUSADO" && (
                    <Button
                      size="sm"
                      onClick={() => ativarPlano.mutate(p.id)}
                      disabled={ativarPlano.isPending}
                    >
                      <RefreshCw className="mr-1 h-3.5 w-3.5" />
                      Reativar
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Classificação de contratos do plano selecionado */}
      {plano && (
        <div className="mt-container-padding">
          <p className="rotulo mb-stack-sm">
            Classificando contratos do plano:{" "}
            <span className="text-on-surface font-semibold">{plano.nome}</span>
          </p>
          <PainelClassificacao plano={plano} />
        </div>
      )}

      {!planos.isLoading && (planos.data?.length ?? 0) === 0 && (
        <div className="mt-container-padding cartao flex flex-col items-center gap-4 p-container-padding text-center">
          <ClipboardList className="h-10 w-10 text-on-surface-variant" />
          <div>
            <p className="font-medium text-on-surface">Nenhum plano criado ainda</p>
            <p className="text-body-sm text-on-surface-variant">
              Crie um plano para começar a classificar seus contratos e definir metas de recuperação.
            </p>
          </div>
          <Button onClick={() => setCriandoPlano(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Criar primeiro plano
          </Button>
        </div>
      )}

      {/* Regras do turnaround */}
      <div className="mt-container-padding cartao p-container-padding">
        <h2 className="mb-stack-md text-headline-sm text-on-surface">
          Regras do turnaround
        </h2>
        <div className="grid grid-cols-1 gap-stack-md md:grid-cols-3">
          {[
            {
              cor: "border-l-receita",
              titulo: "Essencial",
              texto:
                "Mantém a vida funcionando — moradia, alimentação, saúde, transporte. Nunca cortar.",
            },
            {
              cor: "border-l-amber-500",
              titulo: "Bom",
              texto:
                "Aumenta previsibilidade ou capacidade produtiva. Manter e monitorar.",
            },
            {
              cor: "border-l-despesa",
              titulo: "Ruim",
              texto:
                "Juros altos, consumo emocional ou sem retorno. Eliminar ou renegociar — alvo prioritário.",
            },
          ].map((r) => (
            <div
              key={r.titulo}
              className={cn("border-l-4 pl-4", r.cor)}
            >
              <p className="font-semibold text-on-surface">{r.titulo}</p>
              <p className="mt-1 text-body-sm text-on-surface-variant">{r.texto}</p>
            </div>
          ))}
        </div>
        <div className="mt-stack-md rounded-lg border border-outline-variant bg-surface-container-lowest p-stack-md">
          <p className="text-body-sm font-semibold text-on-surface">
            Bloqueio de crédito durante o turnaround:
          </p>
          <ul className="mt-2 space-y-1 text-body-sm text-on-surface-variant">
            <li>❌ Nada de parcelar consumo</li>
            <li>❌ Nada de rotativo</li>
            <li>❌ Nada de "só dessa vez"</li>
            <li>✅ Exceção: contratos essenciais com prazo fixo e impacto calculado</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
