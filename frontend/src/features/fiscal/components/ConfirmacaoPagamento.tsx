import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, CreditCard, ShoppingCart, Sparkles } from "lucide-react";

import { api, ApiError, type NotaFiscal } from "@/shared/lib/api";
import { formatarMoeda } from "@/features/fiscal/nfce";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { useToast } from "@/shared/ui/use-toast";
import { cn } from "@/shared/lib/utils";

const FORMAS = [
  { valor: "CREDITO", rotulo: "Crédito" },
  { valor: "DEBITO", rotulo: "Débito" },
  { valor: "PIX", rotulo: "PIX" },
  { valor: "DINHEIRO", rotulo: "Dinheiro" },
  { valor: "VALE_ALIMENTACAO", rotulo: "Vale alimentação" },
  { valor: "CREDITO_LOJA", rotulo: "Crédito da loja" },
] as const;

const ORIGEM_SUGESTAO: Record<string, string> = {
  nota: "A forma veio da própria nota fiscal.",
  historico: "Preenchido pelas suas compras anteriores neste estabelecimento.",
  estabelecimento: "Categoria sugerida pelo estabelecimento.",
  nenhuma: "",
};

/**
 * Confirmação do pagamento, depois do scan.
 *
 * Perguntar **depois** e não antes é decisão de projeto: a pessoa está no
 * caixa, e ler o QR precisa ser instantâneo. A nota já está salva quando este
 * diálogo abre; fechar sem responder deixa a nota na fila de pendências, o que
 * é melhor que travar a leitura.
 *
 * A NFC-e traz a forma de pagamento, mas **não traz o número de parcelas** —
 * daí a pergunta.
 */
export function ConfirmacaoPagamento({
  nota,
  onFechar,
}: {
  nota: NotaFiscal | null;
  onFechar: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [forma, setForma] = useState("CREDITO");
  const [cartao, setCartao] = useState("");
  const [parcelas, setParcelas] = useState(1);
  const [categoria, setCategoria] = useState("");
  const [itensAbertos, setItensAbertos] = useState(false);

  const sugestao = useQuery({
    queryKey: ["nota", nota?.id, "pagamento"],
    queryFn: () => api.sugestaoPagamento(nota!.id),
    enabled: Boolean(nota),
  });

  const cartoes = useQuery({
    queryKey: ["cartoes"],
    queryFn: () => api.cartoes(),
    enabled: Boolean(nota),
  });

  const categorias = useQuery({
    queryKey: ["categorias", "DESPESA"],
    queryFn: () => api.categorias("DESPESA"),
    enabled: Boolean(nota),
  });

  useEffect(() => {
    if (!sugestao.data) return;
    setForma(sugestao.data.forma === "OUTRO" ? "CREDITO" : sugestao.data.forma);
    setCartao(sugestao.data.cartao ?? "");
    setParcelas(sugestao.data.parcelas);
    setCategoria(sugestao.data.categoria ?? "");
  }, [sugestao.data]);

  const registrar = useMutation({
    mutationFn: () =>
      api.registrarPagamento(nota!.id, {
        forma,
        cartao: forma === "CREDITO" ? cartao : null,
        parcelas: forma === "CREDITO" ? parcelas : 1,
        categoria: categoria || null,
      }),
    onSuccess: (resposta) => {
      for (const chave of ["notas", "cartoes", "realizados", "fluxo-caixa", "parcelas", "mercado"]) {
        queryClient.invalidateQueries({ queryKey: [chave] });
      }
      toast({
        title: "Pagamento registrado",
        description:
          resposta.parcelas_geradas > 1
            ? `Dividido em ${resposta.parcelas_geradas} parcelas na fatura.`
            : "Lançado no fluxo de caixa.",
      });
      onFechar();
    },
    onError: (erro: ApiError) =>
      toast({ variant: "destructive", title: "Não deu para registrar", description: erro.message }),
  });

  const listaCartoes = cartoes.data ?? [];
  const semCartao = forma === "CREDITO" && listaCartoes.length === 0;
  const dica = ORIGEM_SUGESTAO[sugestao.data?.origem_da_sugestao ?? "nenhuma"];

  return (
    <Dialog open={Boolean(nota)} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Como você pagou?</DialogTitle>
        </DialogHeader>

        {nota && (
          <div className="space-y-stack-md">
            <div className="rounded-lg border border-outline-variant bg-surface-container-low p-stack-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-on-surface">
                    {nota.nome_emitente || "Cupom"}
                  </p>
                  <p className="tabular text-headline-sm text-despesa">
                    {formatarMoeda(nota.valor_total)}
                  </p>
                </div>
                {(nota.itens ?? []).length > 0 && (
                  <button
                    type="button"
                    onClick={() => setItensAbertos((v) => !v)}
                    className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-on-surface-variant hover:bg-surface-container-high"
                  >
                    <ShoppingCart className="h-3 w-3" />
                    {nota.quantidade_itens} iten(s)
                    {itensAbertos ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </button>
                )}
              </div>

              {itensAbertos && (nota.itens ?? []).length > 0 && (
                <div className="mt-2 space-y-1 border-t border-outline-variant pt-2">
                  {(nota.itens ?? []).map((item) => (
                    <div key={item.id} className="flex justify-between text-[11px] text-on-surface-variant">
                      <span className="min-w-0 flex-1 truncate pr-2">{item.descricao}</span>
                      <span className="shrink-0 tabular">
                        {item.quantidade !== "1.0000" && `${item.quantidade}× `}
                        {formatarMoeda(item.valor_total)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {dica && (
              <p className="flex items-start gap-2 text-[11px] text-on-surface-variant">
                <Sparkles className="mt-0.5 h-3 w-3 shrink-0" />
                {dica}
              </p>
            )}

            <div className="grid grid-cols-3 gap-2">
              {FORMAS.map((opcao) => (
                <button
                  key={opcao.valor}
                  onClick={() => {
                    setForma(opcao.valor);
                    if (opcao.valor !== "CREDITO") setParcelas(1);
                  }}
                  className={cn(
                    "rounded-md border px-2 py-2 text-body-sm transition-colors",
                    forma === opcao.valor
                      ? "border-secondary bg-secondary-container text-on-secondary-container"
                      : "border-outline-variant text-on-surface-variant hover:bg-surface-container-high",
                  )}
                >
                  {opcao.rotulo}
                </button>
              ))}
            </div>

            {forma === "CREDITO" && (
              <>
                <div className="space-y-1.5">
                  <label className="text-body-sm font-medium">Cartão</label>
                  {semCartao ? (
                    <p className="rounded-md bg-error-container p-stack-sm text-body-sm text-on-error-container">
                      Nenhum cartão cadastrado. Cadastre um em Cartões antes de
                      registrar compra no crédito.
                    </p>
                  ) : (
                    <select
                      className="h-10 w-full rounded-md border border-outline-variant bg-surface-container-lowest px-3 text-body-sm"
                      value={cartao}
                      onChange={(e) => setCartao(e.target.value)}
                    >
                      <option value="">Escolha…</option>
                      {listaCartoes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.apelido}
                          {c.ultimos_digitos && ` ••${c.ultimos_digitos}`}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-body-sm font-medium">Parcelas</label>
                  <div className="flex flex-wrap gap-1">
                    {[1, 2, 3, 4, 6, 10, 12].map((n) => (
                      <button
                        key={n}
                        onClick={() => setParcelas(n)}
                        className={cn(
                          "min-w-10 rounded-md border px-2 py-1.5 text-body-sm transition-colors",
                          parcelas === n
                            ? "border-secondary bg-secondary-container text-on-secondary-container"
                            : "border-outline-variant text-on-surface-variant hover:bg-surface-container-high",
                        )}
                      >
                        {n}x
                      </button>
                    ))}
                    <Input
                      type="number"
                      min={1}
                      max={36}
                      className="w-20"
                      value={parcelas}
                      onChange={(e) => setParcelas(Math.max(1, Number(e.target.value)))}
                    />
                  </div>
                  {parcelas > 1 && (
                    <p className="text-[11px] text-on-surface-variant">
                      {parcelas}× de{" "}
                      {formatarMoeda(Number(nota.valor_total) / parcelas)} — a
                      primeira absorve a sobra de centavos.
                    </p>
                  )}
                </div>
              </>
            )}

            <div className="space-y-1.5">
              <label className="text-body-sm font-medium">Categoria</label>
              <select
                className="h-10 w-full rounded-md border border-outline-variant bg-surface-container-lowest px-3 text-body-sm"
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
              >
                <option value="">Usar a padrão do estabelecimento</option>
                {(categorias.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-stack-sm pt-2">
              {/* Adiar é uma saída legítima: offline não dá para listar
                  cartões, e travar a leitura seria pior. */}
              <Button variant="ghost" onClick={onFechar}>
                Depois
              </Button>
              <Button
                onClick={() => registrar.mutate()}
                disabled={registrar.isPending || (forma === "CREDITO" && !cartao)}
              >
                <CreditCard className="mr-2 h-4 w-4" />
                {registrar.isPending ? "Registrando…" : "Confirmar"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
