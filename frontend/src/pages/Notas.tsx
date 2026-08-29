import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, CheckCircle2, Clock, QrCode, RefreshCw, ScanLine, Upload,
} from "lucide-react";

import { api } from "@/shared/lib/api";
import { formatarCnpj, formatarMoeda } from "@/features/fiscal/nfce";
import { listarPendentes } from "@/features/fiscal/fila";
import { usePendentes, useSincronizacaoCupons } from "@/features/fiscal/hooks/useSincronizacao";
import { PainelCupom } from "@/features/fiscal/components/PainelCupom";
import { CabecalhoPagina } from "@/shared/components/CabecalhoPagina";
import { Selo } from "@/shared/components/Selo";
import { Button } from "@/shared/ui/button";
import { useToast } from "@/shared/ui/use-toast";
import { cn } from "@/shared/lib/utils";

const ScannerNota = lazy(() =>
  import("@/features/fiscal/components/ScannerNota").then((m) => ({ default: m.ScannerNota })),
);

const horaCurta = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(
        new Date(iso),
      )
    : "—";

const dataCurta = (iso: string | null) => {
  if (!iso) return "—";
  const data = new Date(iso);
  const hoje = new Date();
  const mesmoDia = data.toDateString() === hoje.toDateString();
  if (mesmoDia) return horaCurta(iso);
  const ontem = new Date(hoje);
  ontem.setDate(hoje.getDate() - 1);
  if (data.toDateString() === ontem.toDateString()) return "Ontem";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(data);
};

export default function Notas() {
  const [scannerAberto, setScannerAberto] = useState(false);
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [parametros, setParametros] = useSearchParams();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { online, sincronizando, sincronizar } = useSincronizacaoCupons();
  const pendentes = usePendentes();

  // Atalho do PWA (segurar o ícone -> "Ler cupom") entra por /notas?scan=1.
  useEffect(() => {
    if (parametros.get("scan") === "1") {
      setScannerAberto(true);
      parametros.delete("scan");
      setParametros(parametros, { replace: true });
    }
  }, [parametros, setParametros]);

  const notas = useQuery({ queryKey: ["notas"], queryFn: () => api.notas() });

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

  // Cupons na fila local aparecem junto dos cadastrados: para quem leu, os
  // dois são "notas que eu escaneei". Esconder os pendentes daria a impressão
  // de que a leitura se perdeu.
  const linhas = useMemo(() => {
    const daFila = listarPendentes().map((c) => ({
      tipo: "fila" as const,
      id: c.chave,
      quando: c.lidoEm,
      titulo: "Aguardando envio",
      valor: null,
      chave: c.chave,
    }));
    const daApi = (notas.data ?? []).map((n) => ({
      tipo: "nota" as const,
      id: n.id,
      quando: n.data_emissao,
      titulo: n.nome_emitente || formatarCnpj(n.cnpj_emitente) || "Emitente não lido",
      valor: n.valor_total,
      status: n.status,
      nota: n,
    }));
    return [...daFila, ...daApi];
  }, [notas.data, pendentes]);

  return (
    <div className="p-container-padding">
      <CabecalhoPagina
        titulo="Notas fiscais"
        descricao="Leitura de cupons por QR Code e consulta na SEFAZ-BA."
        acoes={
          <>
            <Button
              variant="outline"
              onClick={() => void sincronizar()}
              disabled={pendentes === 0 || !online || sincronizando}
              title={
                pendentes === 0
                  ? "Nenhum cupom na fila"
                  : !online
                    ? "Sem conexão"
                    : "Enviar os cupons guardados"
              }
            >
              <Upload className={cn("mr-2 h-4 w-4", sincronizando && "animate-pulse")} />
              Sincronizar fila{pendentes > 0 && ` (${pendentes})`}
            </Button>
            <Button onClick={() => setScannerAberto(true)}>
              <ScanLine className="mr-2 h-4 w-4" />
              Ler cupom
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-container-padding lg:grid-cols-12">
        <div className="flex flex-col gap-container-padding lg:col-span-7">
          <div className="cartao flex flex-col gap-stack-md p-container-padding">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-headline-sm text-on-surface">
                <QrCode className="h-5 w-5 text-secondary" />
                Leitor de câmera
              </h2>
              <Selo tom={online ? "sucesso" : "aviso"}>
                {online ? (
                  <>
                    <CheckCircle2 className="h-3 w-3" />
                    Pronto para ler
                  </>
                ) : (
                  <>
                    <Clock className="h-3 w-3" />
                    Offline — leituras vão para a fila
                  </>
                )}
              </Selo>
            </div>

            {/* Área da câmera. A câmera real só liga ao abrir o scanner: manter
                o vídeo rodando em segundo plano gasta bateria e mantém o LED
                aceso sem motivo. */}
            <button
              onClick={() => setScannerAberto(true)}
              className="group relative aspect-video w-full overflow-hidden rounded-lg border border-outline-variant bg-primary-container"
            >
              <span className="mira mira-se" />
              <span className="mira mira-sd" />
              <span className="mira mira-ie" />
              <span className="mira mira-id" />
              <span className="absolute left-[5%] h-0.5 w-[90%] animate-varredura bg-receita/70 shadow-[0_0_8px_var(--receita)]" />

              <span className="absolute inset-x-0 bottom-4 text-center">
                <span className="rounded-full bg-black/60 px-4 py-1.5 text-body-sm text-white backdrop-blur-sm">
                  Toque para abrir a câmera
                </span>
              </span>
            </button>
          </div>

          <div className="cartao overflow-hidden">
            <div className="flex items-center justify-between border-b border-outline-variant bg-surface p-stack-md">
              <h2 className="text-headline-sm text-on-surface">Leituras recentes</h2>
            </div>

            {notas.isLoading ? (
              <p className="p-stack-lg text-center text-body-sm text-on-surface-variant">
                Carregando…
              </p>
            ) : linhas.length === 0 ? (
              <div className="flex flex-col items-center gap-3 p-stack-lg text-center">
                <ScanLine className="h-8 w-8 text-on-surface-variant" />
                <p className="text-body-sm text-on-surface-variant">
                  Nenhum cupom lido ainda.
                </p>
                <Button variant="outline" onClick={() => setScannerAberto(true)}>
                  Ler o primeiro
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-outline-variant bg-surface-container-low">
                      <th className="rotulo w-24 px-gutter-table py-2">Quando</th>
                      <th className="rotulo px-gutter-table py-2">Emitente</th>
                      <th className="rotulo px-gutter-table py-2 text-right">Valor</th>
                      <th className="rotulo w-32 px-gutter-table py-2 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((linha) => (
                      <tr
                        key={linha.id}
                        onClick={() =>
                          linha.tipo === "nota" ? setSelecionada(linha.id) : undefined
                        }
                        className={cn(
                          "h-[40px] border-b border-outline-variant transition-colors",
                          linha.tipo === "nota" && "cursor-pointer hover:bg-surface-container-low",
                          selecionada === linha.id && "bg-surface-container-low",
                        )}
                      >
                        <td className="px-gutter-table tabular text-on-surface">
                          {dataCurta(linha.quando)}
                        </td>
                        <td className="max-w-[200px] truncate px-gutter-table text-body-sm text-on-surface">
                          {linha.titulo}
                        </td>
                        <td className="px-gutter-table text-right tabular text-on-surface">
                          {linha.valor === null ? "—" : formatarMoeda(linha.valor)}
                        </td>
                        <td className="px-gutter-table text-center">
                          {linha.tipo === "fila" ? (
                            <Selo>
                              <Clock className="h-3 w-3" />
                              Fila local
                            </Selo>
                          ) : linha.status === "IMPORTADA" ? (
                            <Selo tom="sucesso">Sincronizado</Selo>
                          ) : (
                            <span className="inline-flex items-center gap-1">
                              <Selo tom="erro">
                                <AlertTriangle className="h-3 w-3" />
                                Erro SEFAZ
                              </Selo>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  reconsultar.mutate(linha.id);
                                }}
                                disabled={reconsultar.isPending}
                                title="Buscar os itens de novo"
                                className="rounded p-1 text-on-surface-variant hover:bg-surface-container-high hover:text-secondary"
                              >
                                <RefreshCw
                                  className={cn(
                                    "h-3.5 w-3.5",
                                    reconsultar.isPending &&
                                      reconsultar.variables === linha.id &&
                                      "animate-spin",
                                  )}
                                />
                              </button>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-5">
          <PainelCupom notaId={selecionada} onFechar={() => setSelecionada(null)} />
        </div>
      </div>

      <Suspense fallback={null}>
        {scannerAberto && (
          <ScannerNota aberto onFechar={() => setScannerAberto(false)} />
        )}
      </Suspense>
    </div>
  );
}