import { Suspense, lazy, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw, ScanLine } from "lucide-react";

import { api, type NotaFiscal } from "@/shared/lib/api";
import { formatarChave, formatarCnpj, formatarCompetencia, formatarMoeda } from "@/features/fiscal/nfce";

import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { useToast } from "@/shared/ui/use-toast";

// Carregado sob demanda: a biblioteca de leitura de QR pesa mais que o
// restante da tela somado.
const ScannerNota = lazy(() =>
  import("@/features/fiscal/components/ScannerNota").then((m) => ({ default: m.ScannerNota })),
);

export default function Notas() {
  const [scannerAberto, setScannerAberto] = useState(false);
  const [parametros, setParametros] = useSearchParams();

  // Atalho do PWA (segurar o ícone → "Ler cupom") entra por /notas?scan=1.
  useEffect(() => {
    if (parametros.get("scan") === "1") {
      setScannerAberto(true);
      // Limpa o parâmetro para o scanner não reabrir ao voltar de outra tela.
      parametros.delete("scan");
      setParametros(parametros, { replace: true });
    }
  }, [parametros, setParametros]);
  const [notaAberta, setNotaAberta] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const notas = useQuery({ queryKey: ["notas"], queryFn: () => api.notas() });
  const consolidado = useQuery({
    queryKey: ["mercado", "consolidado"],
    queryFn: () => api.consolidadoMercado(),
  });

  const detalhe = useQuery({
    queryKey: ["nota", notaAberta],
    queryFn: () => api.nota(notaAberta!),
    enabled: Boolean(notaAberta),
  });

  const reconsultar = useMutation({
    mutationFn: (id: string) => api.reconsultarNota(id),
    onSuccess: (nota) => {
      queryClient.invalidateQueries({ queryKey: ["notas"] });
      toast(
        nota.status === "IMPORTADA"
          ? { title: "Itens carregados", description: `${nota.quantidade_itens} produto(s).` }
          : {
              title: "A SEFAZ segue sem responder",
              description: "A nota continua salva. Tente de novo mais tarde.",
              variant: "destructive" as const,
            },
      );
    },
  });

  const lista = notas.data ?? [];

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cupons fiscais</h1>
          <p className="text-sm text-muted-foreground">
            Cada cupom lido entra no total do mês, que vira uma linha de despesa
            no fluxo de caixa.
          </p>
        </div>
        <Button onClick={() => setScannerAberto(true)}>
          <ScanLine className="mr-2 h-4 w-4" />
          Ler cupom
        </Button>
      </header>

      {(consolidado.data ?? []).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Consolidado por mês</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-6">
            {consolidado.data!.map((mes) => (
              <div key={mes.competencia}>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {formatarCompetencia(mes.competencia)}
                </p>
                <p className="text-xl font-semibold tabular-nums">
                  {formatarMoeda(mes.valor_total)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {mes.quantidade_notas} cupom(ns) · média {formatarMoeda(mes.ticket_medio)}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {notas.isLoading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Carregando…</p>
      ) : lista.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <ScanLine className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Nenhum cupom lido ainda. Aponte a câmera para o QR Code do próximo.
            </p>
            <Button variant="outline" onClick={() => setScannerAberto(true)}>
              Ler o primeiro cupom
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {lista.map((nota) => (
            <LinhaNota
              key={nota.id}
              nota={nota}
              onAbrir={() => setNotaAberta(nota.id)}
              onReconsultar={() => reconsultar.mutate(nota.id)}
              reconsultando={reconsultar.isPending && reconsultar.variables === nota.id}
            />
          ))}
        </div>
      )}

      <Dialog open={Boolean(notaAberta)} onOpenChange={(v) => !v && setNotaAberta(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{detalhe.data?.nome_emitente ?? "Cupom"}</DialogTitle>
          </DialogHeader>
          {detalhe.data && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3 text-muted-foreground">
                <p>CNPJ: {formatarCnpj(detalhe.data.cnpj_emitente)}</p>
                <p>Total: {formatarMoeda(detalhe.data.valor_total)}</p>
              </div>
              <p className="break-all font-mono text-xs text-muted-foreground">
                {formatarChave(detalhe.data.chave_acesso)}
              </p>
              {(detalhe.data.itens ?? []).length > 0 ? (
                <table className="w-full">
                  <tbody className="divide-y">
                    {detalhe.data.itens!.map((item) => (
                      <tr key={item.id}>
                        <td className="py-2 pr-2">
                          <p>{item.descricao}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.quantidade} {item.unidade} ×{" "}
                            {formatarMoeda(item.valor_unitario)}
                          </p>
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {formatarMoeda(item.valor_total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-muted-foreground">
                  Os itens ainda não foram carregados da SEFAZ.
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Suspense fallback={null}>
        {scannerAberto && (
          <ScannerNota aberto onFechar={() => setScannerAberto(false)} />
        )}
      </Suspense>
    </div>
  );
}

function LinhaNota({
  nota,
  onAbrir,
  onReconsultar,
  reconsultando,
}: {
  nota: NotaFiscal;
  onAbrir: () => void;
  onReconsultar: () => void;
  reconsultando: boolean;
}) {
  return (
    <Card className={nota.status === "ERRO" ? "border-amber-500/60" : undefined}>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
        <button className="min-w-0 flex-1 text-left" onClick={onAbrir}>
          <p className="truncate font-medium">
            {nota.nome_emitente || formatarCnpj(nota.cnpj_emitente) || "Emitente não lido"}
          </p>
          <p className="text-xs text-muted-foreground">
            {nota.data_emissao
              ? new Date(nota.data_emissao).toLocaleString("pt-BR")
              : "Sem data"}{" "}
            · {nota.quantidade_itens} item(ns)
          </p>
        </button>

        <div className="flex items-center gap-3">
          {nota.status === "ERRO" && (
            <>
              <Badge variant="outline" className="gap-1 border-amber-500 text-amber-600">
                <AlertTriangle className="h-3 w-3" />
                Sem itens
              </Badge>
              <Button size="sm" variant="ghost" onClick={onReconsultar} disabled={reconsultando}>
                <RefreshCw className={reconsultando ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                <span className="ml-2 hidden sm:inline">Buscar de novo</span>
              </Button>
            </>
          )}
          <p className="font-semibold tabular-nums">{formatarMoeda(nota.valor_total)}</p>
        </div>
      </CardContent>
    </Card>
  );
}
