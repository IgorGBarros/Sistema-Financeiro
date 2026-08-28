import { useEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, Keyboard, Loader2, RotateCcw } from "lucide-react";

import { api, ApiError, type NotaFiscal } from "@/lib/api";
import { validarChaveAcesso } from "@/lib/nfce";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";

const ID_LEITOR = "leitor-qrcode";

type Modo = "camera" | "digitar";

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
  const [chaveDigitada, setChaveDigitada] = useState("");
  const [erroCamera, setErroCamera] = useState<string | null>(null);
  const leitorRef = useRef<Html5Qrcode | null>(null);
  const processandoRef = useRef(false);
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
    onError: (erro: ApiError) => {
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
    try {
      if (leitor.getState() === 2) await leitor.stop();
      leitor.clear();
    } catch {
      // câmera já liberada
    }
    leitorRef.current = null;
  }

  function fechar() {
    void pararCamera();
    setChaveDigitada("");
    setErroCamera(null);
    processandoRef.current = false;
    onFechar();
  }

  useEffect(() => {
    if (!aberto || modo !== "camera") {
      void pararCamera();
      return;
    }

    const leitor = new Html5Qrcode(ID_LEITOR, {
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
      verbose: false,
    });
    leitorRef.current = leitor;

    leitor
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 260, height: 260 }, aspectRatio: 1 },
        (texto) => {
          // O leitor dispara várias vezes com o mesmo código.
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
        setErroCamera(
          erro.name === "NotAllowedError"
            ? "Permita o acesso à câmera nas configurações do navegador para ler o cupom."
            : "Não foi possível abrir a câmera neste aparelho. Digite a chave abaixo.",
        );
        setModo("digitar");
      });

    return () => {
      void pararCamera();
    };
  }, [aberto, modo]);

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
            <div
              id={ID_LEITOR}
              className="overflow-hidden rounded-lg border bg-muted aspect-square"
            />
            <p className="text-sm text-muted-foreground">
              Aponte para o QR Code impresso no rodapé do cupom.
            </p>
            <Button variant="ghost" className="w-full" onClick={() => setModo("digitar")}>
              <Keyboard className="mr-2 h-4 w-4" />
              Digitar a chave
            </Button>
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
                disabled={!chaveValida}
                onClick={() => cadastrar.mutate(chaveLimpa)}
              >
                Cadastrar nota
              </Button>
              <Button variant="outline" onClick={() => { setErroCamera(null); setModo("camera"); }}>
                <Camera className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {cadastrar.isError && !cadastrar.isPending && (
          <Button variant="outline" className="w-full" onClick={() => setModo("camera")}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Tentar de novo
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
