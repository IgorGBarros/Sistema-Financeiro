import { useCallback, useEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, Keyboard, Loader2, RotateCcw, VideoOff } from "lucide-react";

import { api, ApiError, type NotaFiscal } from "@/shared/lib/api";
import { extrairChave, validarChaveAcesso } from "@/features/fiscal/nfce";
import { enfileirar } from "@/features/fiscal/fila";
import { useConexao } from "@/features/fiscal/hooks/useSincronizacao";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { useToast } from "@/shared/ui/use-toast";

const ID_LEITOR = "leitor-qrcode";

type Modo = "camera" | "digitar";
// Estado da câmera separado de `modo` para exibir o spinner enquanto o
// navegador mostra o diálogo de permissão.
type EstadoCamera = "solicitando" | "ativa" | "negada" | "erro";

interface Props {
  aberto: boolean;
  onFechar: () => void;
  onNotaCadastrada?: (nota: NotaFiscal) => void;
}

/**
 * Leitura do cupom fiscal.
 *
 * A câmera só extrai o texto do QR. Todo o resto — validar a chave, consultar
 * a SEFAZ e gravar — acontece no backend: o portal da SEFAZ não envia
 * cabeçalhos CORS, então o navegador não consegue ler a página de jeito nenhum.
 *
 * Quando a câmera não coopera (cupom amassado, pouca luz), o campo de digitação
 * aceita os 44 dígitos impressos abaixo do QR.
 */
export function ScannerNota({ aberto, onFechar, onNotaCadastrada }: Props) {
  const [modo, setModo] = useState<Modo>("camera");
  const [estadoCamera, setEstadoCamera] = useState<EstadoCamera>("solicitando");
  const [chaveDigitada, setChaveDigitada] = useState("");
  const [erroCamera, setErroCamera] = useState<string | null>(null);
  // Incrementado em "Tentar de novo" para forçar o useEffect a re-executar
  // mesmo quando `modo` já é "camera" (estado não mudaria).
  const [tentativa, setTentativa] = useState(0);
  // O Dialog do Radix usa portal — o div#leitor-qrcode só existe no DOM depois
  // que o portal é inserido, que pode ser depois do primeiro useEffect.
  // O useCallback ref notifica o effect exatamente quando o elemento está pronto.
  const [divPronta, setDivPronta] = useState(false);
  const refContainer = useCallback((node: HTMLDivElement | null) => {
    setDivPronta(node !== null);
  }, []);

  const online = useConexao();
  const leitorRef = useRef<Html5Qrcode | null>(null);
  const processandoRef = useRef(false);
  // Evita que callbacks de tentativas anteriores (promise em voo) afetem
  // uma instância já fechada ou reaberta do scanner.
  const ativoRef = useRef(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const cadastrar = useMutation({
    mutationFn: (conteudo: string) => api.scanNota(conteudo),
    onSuccess: (nota) => {
      queryClient.invalidateQueries({ queryKey: ["notas"] });
      queryClient.invalidateQueries({ queryKey: ["mercado"] });
      queryClient.invalidateQueries({ queryKey: ["fluxo-caixa"] });

      if (nota.status === "ERRO") {
        toast({
          title: "Nota cadastrada sem os itens",
          description:
            "A SEFAZ não respondeu agora. A chave está salva — use 'Buscar de novo' mais tarde para trazer os produtos.",
        });
      } else {
        toast({
          title: "Nota cadastrada",
          description: `${nota.nome_emitente} — R$ ${nota.valor_total} em ${nota.quantidade_itens} item(ns).`,
        });
      }
      onNotaCadastrada?.(nota);
      fechar();
    },
    onError: (erro: ApiError, conteudo: string) => {
      // Falha de rede (status 0) não pode custar o cupom: o papel vai para o
      // lixo na saída da loja. Guardamos e reenviamos quando a conexão voltar.
      // Erro do servidor (4xx/5xx) é outra história — reenviar não resolveria.
      const chave = extrairChave(conteudo);
      if (erro.offline && chave && enfileirar(conteudo, chave)) {
        toast({
          title: "Cupom guardado",
          description:
            "Sem conexão agora. Ele é enviado sozinho assim que a internet voltar.",
        });
        fechar();
        return;
      }

      // Só agora libera o guard — depois de descartar o caminho offline.
      processandoRef.current = false;

      toast({
        variant: "destructive",
        title: "Não deu para cadastrar",
        description: erro.message,
      });
    },
  });

  async function pararCamera() {
    const leitor = leitorRef.current;
    if (!leitor) return;
    leitorRef.current = null;
    try {
      // Estado >= 2 cobre tanto SCANNING (2) quanto PAUSED (3); em ambos os
      // casos o stream de hardware ainda está ativo e precisa de stop().
      if (leitor.getState() >= 2) await leitor.stop();
      leitor.clear();
    } catch {
      // câmera já liberada ou elemento removido do DOM
    }
  }

  function fechar() {
    ativoRef.current = false;
    void pararCamera();
    setModo("camera");
    setEstadoCamera("solicitando");
    setChaveDigitada("");
    setErroCamera(null);
    setDivPronta(false);
    processandoRef.current = false;
    onFechar();
  }

  useEffect(() => {
    if (!aberto || modo !== "camera" || !divPronta) {
      void pararCamera();
      return;
    }

    ativoRef.current = true;
    processandoRef.current = false;
    setEstadoCamera("solicitando");

    // Solicitar permissão explicitamente antes de criar o Html5Qrcode.
    // getUserMedia exibe o diálogo "Permitir câmera?" do navegador e permite
    // que a UI mostre o spinner enquanto o usuário decide. O stream é liberado
    // imediatamente — o Html5Qrcode cria o próprio stream ao chamar .start().
    // Isso também garante que o elemento #leitor-qrcode já existe no DOM
    // (divPronta=true) antes de qualquer chamada a getElementById.
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((stream) => {
        stream.getTracks().forEach((t) => t.stop());

        if (!ativoRef.current) return;

        let leitor: Html5Qrcode;
        try {
          leitor = new Html5Qrcode(ID_LEITOR, {
            formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
            verbose: false,
          });
        } catch {
          if (!ativoRef.current) return;
          setErroCamera("Não foi possível inicializar o leitor. Digite a chave abaixo.");
          setEstadoCamera("erro");
          setModo("digitar");
          return;
        }
        leitorRef.current = leitor;
        setEstadoCamera("ativa");

        leitor
          .start(
            { facingMode: "environment" },
            { fps: 10, qrbox: { width: 260, height: 260 }, aspectRatio: 1 },
            (texto) => {
              if (processandoRef.current) return;
              processandoRef.current = true;
              void pararCamera();
              cadastrar.mutate(texto);
            },
            () => {
              // silencia os "não encontrei QR neste frame"
            },
          )
          .catch((erro: Error) => {
            if (!ativoRef.current) return;
            setErroCamera(
              "Não foi possível abrir a câmera neste aparelho. Digite a chave abaixo.",
            );
            setEstadoCamera("erro");
            setModo("digitar");
          });
      })
      .catch((erro: Error) => {
        if (!ativoRef.current) return;
        if (erro.name === "NotAllowedError" || erro.name === "PermissionDeniedError") {
          // Permissão negada: não muda para "digitar" automaticamente — o usuário
          // pode desbloquear nas configurações do navegador e tentar de novo.
          setEstadoCamera("negada");
        } else if (erro.name === "NotFoundError") {
          setErroCamera("Nenhuma câmera encontrada neste aparelho. Digite a chave abaixo.");
          setEstadoCamera("erro");
          setModo("digitar");
        } else {
          setErroCamera("Não foi possível abrir a câmera. Digite a chave abaixo.");
          setEstadoCamera("erro");
          setModo("digitar");
        }
      });

    return () => {
      ativoRef.current = false;
      void pararCamera();
    };
    // `tentativa` força re-execução quando modo já é "camera".
    // `divPronta` garante que o portal do Dialog já inseriu o elemento no DOM.
  }, [aberto, modo, tentativa, divPronta]); // eslint-disable-line react-hooks/exhaustive-deps

  const chaveLimpa = chaveDigitada.replace(/\D/g, "");
  const chaveValida = validarChaveAcesso(chaveLimpa);

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && fechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ler cupom fiscal</DialogTitle>
        </DialogHeader>

        {cadastrar.isPending ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Consultando a nota na SEFAZ-BA…
            </p>
          </div>
        ) : modo === "camera" ? (
          <div className="space-y-3">
            {/* O div do leitor fica sempre no DOM enquanto modo === "camera".
                refContainer notifica o effect quando o portal já inseriu o
                elemento, evitando o race condition com getElementById. */}
            <div
              id={ID_LEITOR}
              ref={refContainer}
              className="relative overflow-hidden rounded-lg border bg-muted aspect-square"
            >
              {estadoCamera === "solicitando" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Aguardando permissão da câmera…
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Se o navegador perguntar, clique em <strong>Permitir</strong>.
                  </p>
                </div>
              )}
              {estadoCamera === "negada" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center">
                  <VideoOff className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm font-medium">Câmera bloqueada</p>
                  <p className="text-xs text-muted-foreground">
                    Clique no ícone de câmera na barra de endereço e escolha{" "}
                    <strong>Permitir</strong>, depois tente novamente.
                  </p>
                </div>
              )}
            </div>

            <p className="text-sm text-muted-foreground">
              {online
                ? "Aponte para o QR Code impresso no rodapé do cupom."
                : "Sem conexão: os cupons ficam guardados e são enviados quando a internet voltar."}
            </p>

            {estadoCamera === "negada" ? (
              <Button
                className="w-full"
                onClick={() => {
                  cadastrar.reset();
                  setEstadoCamera("solicitando");
                  setTentativa((n) => n + 1);
                }}
              >
                <Camera className="mr-2 h-4 w-4" />
                Tentar novamente
              </Button>
            ) : (
              <Button variant="ghost" className="w-full" onClick={() => setModo("digitar")}>
                <Keyboard className="mr-2 h-4 w-4" />
                Digitar a chave
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {erroCamera && (
              <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {erroCamera}
              </p>
            )}
            <label className="block text-sm font-medium" htmlFor="chave">
              Chave de acesso
            </label>
            <Input
              id="chave"
              inputMode="numeric"
              autoComplete="off"
              placeholder="44 dígitos impressos abaixo do QR Code"
              value={chaveDigitada}
              onChange={(e) => setChaveDigitada(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {chaveLimpa.length}/44 dígitos
              {chaveLimpa.length === 44 && !chaveValida && (
                <span className="ml-2 text-destructive">
                  Confira os números: o dígito verificador não bate.
                </span>
              )}
            </p>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                disabled={!chaveValida || cadastrar.isPending}
                onClick={() => cadastrar.mutate(chaveLimpa)}
              >
                Cadastrar nota
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setErroCamera(null);
                  cadastrar.reset();
                  setEstadoCamera("solicitando");
                  setModo("camera");
                }}
              >
                <Camera className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {cadastrar.isError && !cadastrar.isPending && (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              cadastrar.reset();
              setEstadoCamera("solicitando");
              setModo("camera");
              setTentativa((n) => n + 1);
            }}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Tentar de novo
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
