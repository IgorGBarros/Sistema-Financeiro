import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRightLeft, Check, ChevronDown, Info, Receipt } from "lucide-react";

import { api, ApiError, type Holerite } from "@/shared/lib/api";
import { formatarCompetencia, formatarMoeda } from "@/features/fiscal/nfce";
import { CabecalhoPagina } from "@/shared/components/CabecalhoPagina";
import { Kpi } from "@/shared/components/Kpi";
import { Selo } from "@/shared/components/Selo";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { useToast } from "@/shared/ui/use-toast";
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
  const [integrando, setIntegrando] = useState<Holerite | null>(null);

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

      {/* O alerta explica por que a integração é manual: garantir que quem integra
          já revisou o holerite e aceitou a divergência contra o contrato previsto. */}
      <Card className="mb-container-padding">
        <CardContent className="flex items-start gap-3 pt-6">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-secondary" />
          <div className="text-body-sm">
            <p className="font-medium">A integração é manual</p>
            <p className="text-on-surface-variant">
              O fluxo usa o contrato de salário previsto até que você integre o
              holerite. Confira o recibo antes — integrar cria um lançamento
              realizado que substitui o previsto pelo líquido real.
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
              onIntegrar={() => setIntegrando(holerite)}
            />
          ))}
        </div>
      )}

      <DialogIntegrar holerite={integrando} onFechar={() => setIntegrando(null)} />
    </div>
  );
}

function DialogIntegrar({ holerite, onFechar }: { holerite: Holerite | null; onFechar: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [categoriaId, setCategoriaId] = useState("");
  const [dataPgto, setDataPgto] = useState("");

  const categorias = useQuery({
    queryKey: ["categorias", "RECEITA"],
    queryFn: () => api.categorias("RECEITA"),
    enabled: Boolean(holerite),
  });

  const integrar = useMutation({
    mutationFn: () => api.integrarHolerite(holerite!.id, categoriaId, dataPgto || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["holerites"] });
      queryClient.invalidateQueries({ queryKey: ["realizados"] });
      queryClient.invalidateQueries({ queryKey: ["fluxo-caixa"] });
      toast({ title: "Holerite integrado ao fluxo de caixa" });
      onFechar();
    },
    onError: (e: ApiError) =>
      toast({ variant: "destructive", title: "Erro ao integrar", description: e.message }),
  });

  return (
    <Dialog open={Boolean(holerite)} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Integrar ao fluxo de caixa</DialogTitle>
        </DialogHeader>
        {holerite && (
          <div className="space-y-4">
            <div className="rounded-lg border border-outline-variant bg-surface-container-low p-stack-sm text-body-sm">
              <p className="font-medium text-on-surface">
                {formatarCompetencia(holerite.competencia)} · {holerite.empregador_nome}
              </p>
              <p className="text-on-surface-variant">
                Líquido: {formatarMoeda(holerite.valor_liquido)}
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Categoria de receita</label>
              <select
                className="h-10 w-full rounded-md border border-outline-variant bg-background px-3 text-sm"
                value={categoriaId}
                onChange={(e) => setCategoriaId(e.target.value)}
              >
                <option value="">Escolha…</option>
                {(categorias.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Data de pagamento (opcional)</label>
              <Input type="date" value={dataPgto} onChange={(e) => setDataPgto(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={onFechar}>Cancelar</Button>
              <Button
                disabled={!categoriaId || integrar.isPending}
                onClick={() => integrar.mutate()}
              >
                <ArrowRightLeft className="mr-2 h-4 w-4" />
                {integrar.isPending ? "Integrando…" : "Integrar"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LinhaHolerite({
  holerite,
  aberto,
  onAlternar,
  onIntegrar,
}: {
  holerite: Holerite;
  aberto: boolean;
  onAlternar: () => void;
  onIntegrar: () => void;
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
          {holerite.integrado ? (
            <Selo tom="sucesso">
              <Check className="h-3 w-3" />
              Integrado
            </Selo>
          ) : holerite.conferencia_ok ? (
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => { e.stopPropagation(); onIntegrar(); }}
            >
              <ArrowRightLeft className="mr-1.5 h-3.5 w-3.5" />
              Integrar
            </Button>
          ) : null}
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
