import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, CreditCard, FileUp, Landmark, Loader2, Plus, TrendingUp,
} from "lucide-react";

import { Link } from "react-router-dom";

import { api, ApiError, type Cartao } from "@/shared/lib/api";
import { formatarCompetencia, formatarMoeda } from "@/features/fiscal/nfce";
import { FormularioCartao } from "@/features/cartoes/components/FormularioCartao";
import { CabecalhoPagina } from "@/shared/components/CabecalhoPagina";
import { Kpi } from "@/shared/components/Kpi";
import { Selo } from "@/shared/components/Selo";
import { TabelaMatriz } from "@/shared/components/TabelaMatriz";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { useToast } from "@/shared/ui/use-toast";
import { cn } from "@/shared/lib/utils";

const HORIZONTES = [6, 12, 24];

function iso(data: Date) {
  return data.toISOString().slice(0, 10);
}

export default function Cartoes() {
  const [meses, setMeses] = useState(6);
  const [formularioAberto, setFormularioAberto] = useState(false);
  const [emEdicao, setEmEdicao] = useState<Cartao | null>(null);
  const hoje = new Date();
  const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const fim = new Date(hoje.getFullYear(), hoje.getMonth() + meses - 1, 1);

  const painel = useQuery({
    queryKey: ["cartoes", "painel", meses],
    queryFn: () => api.painelCartoes(iso(inicio), iso(fim)),
  });

  const dados = painel.data;

  const linhas = useMemo(
    () =>
      (dados?.linhas ?? []).map((cartao) => ({
        id: cartao.id,
        nome: cartao.apelido + (cartao.ultimos_digitos ? ` ••${cartao.ultimos_digitos}` : ""),
        // A fatura sai da conta como despesa; o sinal negativo mantém a
        // leitura igual à do resto do sistema.
        valores: Object.fromEntries(
          Object.entries(cartao.valores).map(([mes, valor]) => [mes, -Number(valor)]),
        ),
        extras: {
          fechamento: `dia ${cartao.dia_fechamento}`,
          vencimento: `dia ${cartao.dia_vencimento}`,
          limite: cartao.limite ? formatarMoeda(cartao.limite) : "—",
          disponivel: cartao.disponivel !== null ? formatarMoeda(cartao.disponivel) : "—",
          uso: cartao.utilizacao_pct !== null ? `${cartao.utilizacao_pct}%` : "—",
        },
      })),
    [dados],
  );

  const resumo = dados?.resumo;
  const apertados = (dados?.linhas ?? []).filter(
    (c) => c.utilizacao_pct !== null && Number(c.utilizacao_pct) >= 70,
  );

  return (
    <div className="p-container-padding">
      <CabecalhoPagina
        titulo="Cartões de crédito"
        descricao="Quanto cada cartão já tem comprometido nos próximos meses, e quanto de limite sobra."
        acoes={
          <div className="flex items-center gap-stack-sm">
            <div className="flex gap-1 rounded-lg bg-surface-container-low p-1">
              {HORIZONTES.map((n) => (
                <button
                  key={n}
                  onClick={() => setMeses(n)}
                  className={cn(
                    "rounded px-3 py-1 text-body-sm transition-colors",
                    meses === n
                      ? "bg-surface-container-lowest font-semibold text-on-surface shadow-sm"
                      : "text-on-surface-variant hover:text-on-surface",
                  )}
                >
                  {n}m
                </button>
              ))}
            </div>
            <Button
              variant="outline"
              onClick={() => {
                setEmEdicao(null);
                setFormularioAberto(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Novo cartão
            </Button>
          </div>
        }
      />

      <div className="mb-container-padding grid grid-cols-1 gap-container-padding md:grid-cols-3">
        <Kpi
          rotulo="Limite total"
          valor={resumo ? formatarMoeda(resumo.limite_total) : "—"}
          icone={CreditCard}
          apoio={`${resumo?.cartoes_ativos ?? 0} cartão(ões) ativo(s)`}
          carregando={painel.isLoading}
        />
        <Kpi
          rotulo="Comprometido"
          valor={resumo ? formatarMoeda(resumo.comprometido_total) : "—"}
          icone={TrendingUp}
          tom="despesa"
          apoio="Inclui parcelas de compras antigas ainda por vencer"
          carregando={painel.isLoading}
        />
        <Kpi
          rotulo="Disponível"
          valor={resumo ? formatarMoeda(resumo.disponivel_total) : "—"}
          icone={Landmark}
          tom={
            resumo?.utilizacao_pct && Number(resumo.utilizacao_pct) >= 70
              ? "despesa"
              : "receita"
          }
          apoio={
            resumo?.utilizacao_pct !== null && resumo?.utilizacao_pct !== undefined
              ? `${resumo.utilizacao_pct}% do limite em uso`
              : "Cadastre o limite dos cartões"
          }
          carregando={painel.isLoading}
        />
      </div>

      {apertados.length > 0 && (
        <Card className="mb-container-padding border-amber-500/60">
          <CardContent className="flex items-start gap-3 pt-6">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="text-body-sm">
              <p className="font-medium">
                {apertados.length === 1 ? "Um cartão está" : `${apertados.length} cartões estão`}{" "}
                acima de 70% do limite
              </p>
              <p className="text-on-surface-variant">
                {apertados.map((c) => `${c.apelido} (${c.utilizacao_pct}%)`).join(", ")}.
                Utilização alta pesa no score de crédito mesmo com a fatura em dia.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="cartao mb-container-padding overflow-hidden">
        <div className="border-b border-outline-variant bg-surface p-stack-md">
          <h2 className="text-headline-sm text-on-surface">Comprometido por mês</h2>
          <p className="mt-1 text-body-sm text-on-surface-variant">
            Soma das parcelas que caem na fatura de cada mês. É esta soma que
            forma a fatura — a fatura não é contada de novo como despesa.
          </p>
        </div>

        {painel.isLoading ? (
          <p className="p-stack-lg text-center text-body-sm text-on-surface-variant">
            Carregando…
          </p>
        ) : (
          <TabelaMatriz
            meses={dados?.meses ?? []}
            linhas={linhas}
            totais={Object.fromEntries(
              Object.entries(dados?.totais ?? {}).map(([m, v]) => [m, -Number(v)]),
            )}
            rotuloPrimeiraColuna="Cartão"
            colunasAntes={[
              { chave: "fechamento", rotulo: "Fecha" },
              { chave: "vencimento", rotulo: "Vence" },
            ]}
            colunasDepois={[
              { chave: "limite", rotulo: "Limite" },
              { chave: "disponivel", rotulo: "Disponível" },
              { chave: "uso", rotulo: "Uso" },
            ]}
            vazio="Nenhum cartão cadastrado. Sem ao menos um, a importação de fatura não consegue identificar de qual cartão ela é."
          />
        )}
      </div>

      <ListaCompras />

      <ListaFaturas />

      <div className="mt-container-padding">
        <ImportacaoFatura />
      </div>

      <FormularioCartao
        aberto={formularioAberto}
        cartao={emEdicao}
        onFechar={() => setFormularioAberto(false)}
      />
    </div>
  );
}

/**
 * Compras no cartão, com o parcelamento visível.
 *
 * Elas nascem do scan do cupom, então sem esta lista a pessoa não tem como
 * conferir se o parcelamento foi registrado certo — e parcelamento errado
 * espalha erro por doze meses da projeção.
 */
function ListaCompras() {
  const compras = useQuery({
    queryKey: ["compras", { page_size: "50" }],
    queryFn: () => api.compras({ page_size: "50" }),
  });
  const lista = compras.data ?? [];

  if (compras.isLoading) return null;

  return (
    <div className="cartao mb-container-padding overflow-hidden">
      <div className="border-b border-outline-variant bg-surface p-stack-md">
        <h2 className="text-headline-sm text-on-surface">Compras registradas</h2>
        <p className="mt-1 text-body-sm text-on-surface-variant">
          Vêm do cupom escaneado. Cada parcela entra na fatura do mês dela.
        </p>
      </div>
      {lista.length === 0 ? (
        <p className="p-stack-lg text-center text-body-sm text-on-surface-variant">
          Nenhuma compra registrada. Escaneie um cupom fiscal para registrar a primeira.
        </p>
      ) : (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-outline-variant bg-surface-container-low">
              <th className="rotulo px-gutter-table py-2">Descrição</th>
              <th className="rotulo px-gutter-table py-2">Cartão</th>
              <th className="rotulo w-20 px-gutter-table py-2">Data</th>
              <th className="rotulo w-24 px-gutter-table py-2 text-center">Parcelas</th>
              <th className="rotulo px-gutter-table py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="text-body-sm">
            {lista.slice(0, 20).map((compra) => (
              <tr key={compra.id} className="h-[38px] border-b border-outline-variant">
                <td className="px-gutter-table">
                  <p className="truncate text-on-surface">{compra.descricao}</p>
                  <p className="truncate text-[11px] text-on-surface-variant">
                    {compra.categoria_nome}
                  </p>
                </td>
                <td className="px-gutter-table text-on-surface-variant">
                  {compra.cartao_apelido}
                </td>
                <td className="px-gutter-table tabular text-on-surface-variant">
                  {new Intl.DateTimeFormat("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                  }).format(new Date(`${compra.data_compra}T12:00:00`))}
                </td>
                <td className="px-gutter-table text-center">
                  {compra.parcelas_total > 1 ? (
                    <Selo>{compra.parcelas_total}x</Selo>
                  ) : (
                    <span className="text-on-surface-variant/40">à vista</span>
                  )}
                </td>
                <td className="px-gutter-table text-right tabular text-despesa">
                  {formatarMoeda(compra.valor_total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}

/** Faturas importadas, com atalho para a tela de conciliação. */
function ListaFaturas() {
  const faturas = useQuery({
    queryKey: ["faturas", { page_size: "50" }],
    queryFn: () => api.faturas({ page_size: "50" }),
  });
  const lista = faturas.data ?? [];

  if (faturas.isLoading) return null;

  return (
    <div className="cartao mb-container-padding overflow-hidden">
      <div className="border-b border-outline-variant bg-surface p-stack-md">
        <h2 className="text-headline-sm text-on-surface">Faturas importadas</h2>
        <p className="mt-1 text-body-sm text-on-surface-variant">
          Abra para revisar as linhas que não casaram com uma compra registrada.
        </p>
      </div>
      {lista.length === 0 ? (
        <p className="p-stack-lg text-center text-body-sm text-on-surface-variant">
          Nenhuma fatura importada. Use o formulário abaixo para enviar o PDF da fatura.
        </p>
      ) : (
      <div className="divide-y divide-outline-variant">
        {lista.map((fatura) => {
          const pendentes = fatura.lancamentos.filter(
            (l) => l.secao === "CORRENTE" && !l.conciliado,
          ).length;
          return (
            <Link
              key={fatura.id}
              to={`/faturas/${fatura.id}`}
              className="flex items-center justify-between gap-stack-md p-stack-md transition-colors hover:bg-surface-container-low"
            >
              <div className="min-w-0">
                <p className="font-medium text-on-surface">
                  {fatura.cartao_apelido} · {formatarCompetencia(fatura.competencia)}
                </p>
                <p className="text-body-sm text-on-surface-variant">
                  {fatura.lancamentos.length} lançamento(s)
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-stack-md">
                {pendentes > 0 && (
                  <Selo tom="aviso">
                    <AlertTriangle className="h-3 w-3" />
                    {pendentes} para revisar
                  </Selo>
                )}
                <span className="tabular font-semibold">
                  {formatarMoeda(fatura.valor_total_informado)}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
      )}
    </div>
  );
}

/**
 * Duas entradas para os dados da fatura: o PDF, que funciona hoje, e o Open
 * Finance, que depende de coisas fora do nosso controle.
 */
function ImportacaoFatura() {
  const [senha, setSenha] = useState("");
  const arquivoRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const importar = useMutation({
    mutationFn: ({ arquivo, simular }: { arquivo: File; simular: boolean }) =>
      api.importarDocumento(arquivo, { senha, simular }),
    onSuccess: (documento) => {
      queryClient.invalidateQueries({ queryKey: ["cartoes"] });
      queryClient.invalidateQueries({ queryKey: ["documentos"] });
      if (documento.avisos?.length) {
        toast({
          title: "Importado com ressalvas",
          description: documento.avisos[0],
        });
      } else {
        toast({
          title: "Fatura importada",
          description: `${documento.tipo} — ${documento.competencia ?? "sem competência"}.`,
        });
      }
    },
    onError: (erro: ApiError) =>
      toast({ variant: "destructive", title: "Não deu para importar", description: erro.message }),
  });

  function enviar(simular: boolean) {
    const arquivo = arquivoRef.current?.files?.[0];
    if (!arquivo) {
      toast({ title: "Escolha o PDF da fatura primeiro" });
      return;
    }
    importar.mutate({ arquivo, simular });
  }

  return (
    <div className="grid grid-cols-1 gap-container-padding lg:grid-cols-2">
      <div className="cartao p-container-padding">
        <h2 className="flex items-center gap-2 text-headline-sm text-on-surface">
          <FileUp className="h-5 w-5 text-secondary" />
          Importar PDF da fatura
        </h2>
        <p className="mt-1 text-body-sm text-on-surface-variant">
          O sistema lê os lançamentos, separa as parcelas de faturas futuras e
          concilia com as compras que você já registrou.
        </p>

        <div className="mt-stack-md space-y-stack-sm">
          <input
            ref={arquivoRef}
            type="file"
            accept="application/pdf"
            className="block w-full text-body-sm file:mr-3 file:rounded-md file:border file:border-outline-variant file:bg-surface-container file:px-3 file:py-1.5 file:text-body-sm"
          />
          <Input
            type="password"
            placeholder="Senha do PDF, se houver"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
          />
          <div className="flex gap-stack-sm">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => enviar(true)}
              disabled={importar.isPending}
            >
              {importar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Simular
            </Button>
            <Button className="flex-1" onClick={() => enviar(false)} disabled={importar.isPending}>
              Importar
            </Button>
          </div>
          <p className="text-[11px] text-on-surface-variant">
            Use <strong>Simular</strong> na primeira vez com um emissor novo: mostra
            o que o leitor entendeu sem gravar nada.
          </p>
        </div>

        {importar.data && (
          <div className="mt-stack-md rounded-lg border border-outline-variant bg-surface-container-low p-stack-sm text-body-sm">
            <p className="font-medium">
              {importar.data.tipo} · {importar.data.linhas?.length ?? 0} linha(s)
            </p>
            {importar.data.avisos?.map((aviso) => (
              <p key={aviso} className="mt-1 text-[12px] text-amber-700 dark:text-amber-400">
                {aviso}
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="cartao p-container-padding">
        <div className="flex items-start justify-between gap-2">
          <h2 className="flex items-center gap-2 text-headline-sm text-on-surface">
            <Landmark className="h-5 w-5 text-on-surface-variant" />
            Open Finance
          </h2>
          <Selo>Ainda não disponível</Selo>
        </div>

        {/* Ser honesto sobre a barreira aqui evita meses de expectativa: o
            obstáculo não é código. */}
        <p className="mt-1 text-body-sm text-on-surface-variant">
          Puxar fatura e extrato direto do banco, sem PDF e sem senha.
        </p>
        <div className="mt-stack-md space-y-stack-sm text-body-sm text-on-surface-variant">
          <p>
            O acesso ao Open Finance é restrito a instituições autorizadas pelo
            Banco Central. Uma pessoa física não consegue se conectar
            diretamente, mesmo aos próprios dados.
          </p>
          <p>
            O caminho viável é um agregador já autorizado — Pluggy, Belvo e
            Klavi são os mais usados no Brasil. Eles cobram por conexão ativa
            e exigem contrato.
          </p>
          <p className="rounded-lg border border-outline-variant bg-surface-container-low p-stack-sm">
            <strong className="text-on-surface">O que já está pronto:</strong> a
            importação grava a origem de cada documento, e o modelo aceita
            lançamento vindo de outra fonte sem mudança. Quando um agregador
            entrar, é um extrator novo — o resto do caminho não muda.
          </p>
        </div>
      </div>
    </div>
  );
}
