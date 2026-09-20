import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, CheckCircle2, ChevronDown, FileText, FileUp, Loader2, RefreshCw,
} from "lucide-react";

import { api, ApiError, type DocumentoImportado } from "@/shared/lib/api";
import { formatarCompetencia, formatarMoeda } from "@/features/fiscal/nfce";
import { CabecalhoPagina } from "@/shared/components/CabecalhoPagina";
import { Selo } from "@/shared/components/Selo";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { useToast } from "@/shared/ui/use-toast";
import { cn } from "@/shared/lib/utils";

const ROTULOS: Record<string, string> = {
  FATURA_CARTAO: "Fatura de cartão",
  CONTA_CONSUMO: "Conta de consumo",
  FINANCIAMENTO: "Financiamento",
  HOLERITE: "Holerite",
  DESCONHECIDO: "Não reconhecido",
};

/**
 * Central de importação.
 *
 * Antes, o envio de PDF vivia escondido dentro da tela de cartões — o que fazia
 * sentido para a fatura e nenhum para holerite ou conta de luz. Aqui todo
 * documento entra pelo mesmo lugar, e o histórico mostra o que foi lido, com
 * quais ressalvas.
 */
export default function Documentos() {
  const documentos = useQuery({ queryKey: ["documentos"], queryFn: () => api.documentos() });
  const tipos = useQuery({ queryKey: ["documentos", "tipos"], queryFn: () => api.tiposDocumento() });

  const lista = documentos.data ?? [];
  const comAviso = lista.filter((d) => d.avisos?.length);
  const comErro = lista.filter((d) => d.status === "ERRO");

  return (
    <div className="p-container-padding">
      <CabecalhoPagina
        titulo="Documentos"
        descricao="Fatura, conta de luz, demonstrativo de financiamento e holerite viram dado estruturado."
      />

      <div className="grid grid-cols-1 gap-container-padding lg:grid-cols-3">
        <div className="lg:col-span-1">
          <Envio tipos={tipos.data ?? []} />
        </div>

        <div className="lg:col-span-2">
          {(comErro.length > 0 || comAviso.length > 0) && (
            <Card className="mb-container-padding border-warning/60">
              <CardContent className="flex items-start gap-3 pt-6">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
                <div className="text-body-sm">
                  <p className="font-medium">
                    {comErro.length > 0 && `${comErro.length} documento(s) com erro`}
                    {comErro.length > 0 && comAviso.length > 0 && " · "}
                    {comAviso.length > 0 && `${comAviso.length} com ressalva`}
                  </p>
                  <p className="text-on-surface-variant">
                    Ressalva quer dizer que a conferência do próprio documento
                    não fechou. O valor foi lido, mas pode estar incompleto.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="cartao overflow-hidden">
            <div className="border-b border-outline-variant bg-surface p-stack-md">
              <h2 className="text-headline-sm text-on-surface">Histórico</h2>
            </div>
            {documentos.isLoading ? (
              <p className="p-stack-lg text-center text-body-sm text-on-surface-variant">
                Carregando…
              </p>
            ) : lista.length === 0 ? (
              <div className="flex flex-col items-center gap-2 p-stack-lg text-center">
                <FileText className="h-8 w-8 text-on-surface-variant" />
                <p className="text-body-sm text-on-surface-variant">
                  Nenhum documento importado ainda.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-outline-variant">
                {lista.map((documento) => (
                  <LinhaDocumento key={documento.id} documento={documento} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Envio({ tipos }: { tipos: { tipo: string; nome: string }[] }) {
  const [senha, setSenha] = useState("");
  const arquivoRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const importar = useMutation({
    mutationFn: ({ arquivo, simular }: { arquivo: File; simular: boolean }) =>
      api.importarDocumento(arquivo, { senha, simular }),
    onSuccess: (documento, variaveis) => {
      for (const chave of ["documentos", "financiamentos", "holerites", "contas-consumo", "faturas", "cartoes"]) {
        queryClient.invalidateQueries({ queryKey: [chave] });
      }
      toast({
        title: variaveis.simular ? "Simulação concluída" : "Documento importado",
        description: documento.avisos?.[0] ?? `${ROTULOS[documento.tipo] ?? documento.tipo} reconhecido.`,
      });
    },
    onError: (erro: ApiError) =>
      toast({ variant: "destructive", title: "Não deu para importar", description: erro.message }),
  });

  function enviar(simular: boolean) {
    const arquivo = arquivoRef.current?.files?.[0];
    if (!arquivo) {
      toast({ title: "Escolha um PDF primeiro" });
      return;
    }
    importar.mutate({ arquivo, simular });
  }

  return (
    <div className="cartao p-container-padding">
      <h2 className="flex items-center gap-2 text-headline-sm text-on-surface">
        <FileUp className="h-5 w-5 text-secondary" />
        Enviar PDF
      </h2>
      <p className="mt-1 text-body-sm text-on-surface-variant">
        O tipo é reconhecido pelo conteúdo — não precisa escolher.
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
          <Button variant="outline" className="flex-1" onClick={() => enviar(true)} disabled={importar.isPending}>
            {importar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Simular
          </Button>
          <Button className="flex-1" onClick={() => enviar(false)} disabled={importar.isPending}>
            Importar
          </Button>
        </div>
        <p className="text-[11px] text-on-surface-variant">
          Use <strong>Simular</strong> na primeira vez com um emissor novo: mostra o
          que o leitor entendeu sem gravar nada.
        </p>
      </div>

      <p className="rotulo mt-stack-lg border-b border-outline-variant pb-1">
        Tipos reconhecidos
      </p>
      <ul className="mt-stack-sm space-y-1 text-body-sm text-on-surface-variant">
        {tipos.map((tipo) => (
          <li key={tipo.tipo}>{tipo.nome}</li>
        ))}
      </ul>
    </div>
  );
}

function LinhaDocumento({ documento }: { documento: DocumentoImportado }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [expandido, setExpandido] = useState(false);

  const detalhe = useQuery({
    queryKey: ["documentos", documento.id],
    queryFn: () => api.documento(documento.id),
    enabled: expandido,
  });

  const reprocessar = useMutation({
    mutationFn: () => api.reprocessarDocumento(documento.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documentos"] });
      toast({ title: "Documento reprocessado" });
    },
    onError: (erro: ApiError) =>
      toast({ variant: "destructive", title: "Falhou", description: erro.message }),
  });

  const linhas = detalhe.data?.linhas ?? [];

  return (
    <div>
      <div className="flex items-start justify-between gap-stack-md p-stack-md">
        <button
          onClick={() => setExpandido((v) => !v)}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-medium text-on-surface">
              {ROTULOS[documento.tipo] ?? documento.tipo}
            </p>
            {documento.competencia && <Selo>{formatarCompetencia(documento.competencia)}</Selo>}
            {documento.status === "ERRO" ? (
              <Selo tom="erro">
                <AlertTriangle className="h-3 w-3" />
                erro
              </Selo>
            ) : documento.avisos?.length ? (
              <Selo tom="aviso">
                <AlertTriangle className="h-3 w-3" />
                ressalva
              </Selo>
            ) : (
              <Selo tom="sucesso">
                <CheckCircle2 className="h-3 w-3" />
                ok
              </Selo>
            )}
          </div>
          <p className="truncate text-body-sm text-on-surface-variant">
            {documento.nome_arquivo}
            {documento.emitente && ` · ${documento.emitente}`}
          </p>
          {documento.erro && (
            <p className="mt-1 text-[11px] text-error">{documento.erro}</p>
          )}
          {documento.avisos?.map((aviso) => (
            <p key={aviso} className="mt-1 text-[11px] text-warning">
              {aviso}
            </p>
          ))}
        </button>

        <div className="flex shrink-0 items-center gap-stack-sm">
          {documento.valor_total && (
            <span className="tabular font-medium">{formatarMoeda(documento.valor_total)}</span>
          )}
          <Button
            size="sm"
            variant="ghost"
            title="Reinterpretar com a versão atual do leitor"
            onClick={() => reprocessar.mutate()}
            disabled={reprocessar.isPending}
          >
            <RefreshCw className={cn("h-4 w-4", reprocessar.isPending && "animate-spin")} />
          </Button>
          <button
            onClick={() => setExpandido((v) => !v)}
            className="rounded p-1 text-on-surface-variant hover:bg-surface-container-high"
            title={expandido ? "Recolher itens" : "Ver itens extraídos"}
          >
            <ChevronDown className={cn("h-4 w-4 transition-transform", expandido && "rotate-180")} />
          </button>
        </div>
      </div>

      {expandido && (
        <div className="border-t border-outline-variant bg-surface-container-lowest px-stack-md pb-stack-md">
          {detalhe.isLoading ? (
            <p className="pt-stack-sm text-body-sm text-on-surface-variant">Carregando itens…</p>
          ) : linhas.length === 0 ? (
            <p className="pt-stack-sm text-body-sm text-on-surface-variant">
              Nenhum item extraído.
            </p>
          ) : (
            <div className="mt-stack-sm divide-y divide-outline-variant rounded-md border border-outline-variant">
              {linhas.map((linha) => (
                <div key={linha.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-body-sm">
                  <span className="truncate text-on-surface">{linha.descricao}</span>
                  <div className="flex shrink-0 items-center gap-3">
                    {linha.data && (
                      <span className="text-on-surface-variant">
                        {new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(
                          new Date(`${linha.data}T12:00:00`),
                        )}
                      </span>
                    )}
                    <span className="tabular font-medium">{formatarMoeda(linha.valor)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
