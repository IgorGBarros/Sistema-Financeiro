import { useEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, ImagePlus, Keyboard, Loader2, RotateCcw, VideoOff, X, Zap, ZapOff } from "lucide-react";

import { api, ApiError, type NotaFiscal } from "@/shared/lib/api";
import { extrairChave, validarChaveAcesso } from "@/features/fiscal/nfce";
import { enfileirar } from "@/features/fiscal/fila";
import { useConexao } from "@/features/fiscal/hooks/useSincronizacao";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { useToast } from "@/shared/ui/use-toast";

const ID_LEITOR = "scanner-nota-leitor";
const ID_LEITOR_ARQUIVO = "scanner-nota-leitor-arquivo";

// iOS/Safari não implementa getCapabilities() da câmera — várias
// verificações de "o aparelho suporta isso?" retornam sempre vazio.
// A flag garante que aplicamos os ajustes direto, sem checagem prévia.
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

type Modo = "camera" | "digitar";
type EstadoCamera = "iniciando" | "ativa" | "negada" | "erro";

interface Props {
  aberto: boolean;
  onFechar: () => void;
  onNotaCadastrada?: (nota: NotaFiscal) => void;
}

/**
 * Scanner de QR Code do cupom fiscal, renderizado como overlay full-screen.
 *
 * Renderizar diretamente no DOM (sem portal de Dialog) garante que
 * div#ID_LEITOR já existe quando o useEffect roda — sem race condition.
 *
 * A câmera só extrai o texto do QR. Todo o resto (SEFAZ, gravação) é
 * feito no backend: o portal da SEFAZ não envia cabeçalhos CORS.
 */
export function ScannerNota({ aberto, onFechar, onNotaCadastrada }: Props) {
  const [modo, setModo] = useState<Modo>("camera");
  const [estadoCamera, setEstadoCamera] = useState<EstadoCamera>("iniciando");
  const [chaveDigitada, setChaveDigitada] = useState("");
  const [erroCamera, setErroCamera] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const [tentativa, setTentativa] = useState(0);

  const online = useConexao();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const processandoRef = useRef(false);
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
            "A SEFAZ não respondeu agora. A chave está salva — use 'Buscar de novo' mais tarde.",
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
      const chave = extrairChave(conteudo);
      if (erro.offline && chave && enfileirar(conteudo, chave)) {
        toast({
          title: "Cupom guardado",
          description: "Sem conexão. Ele é enviado assim que a internet voltar.",
        });
        fechar();
        return;
      }
      processandoRef.current = false;
      toast({
        variant: "destructive",
        title: "Não deu para cadastrar",
        description: erro.message,
      });
    },
  });

  async function pararCamera() {
    const scanner = scannerRef.current;
    if (!scanner) return;
    scannerRef.current = null;
    try {
      if (scanner.isScanning) await scanner.stop();
      scanner.clear();
    } catch {
      // câmera já liberada
    }
  }

  function fechar() {
    ativoRef.current = false;
    void pararCamera();
    setModo("camera");
    setEstadoCamera("iniciando");
    setChaveDigitada("");
    setErroCamera(null);
    setTorchOn(false);
    setHasTorch(false);
    processandoRef.current = false;
    onFechar();
  }

  useEffect(() => {
    if (!aberto || modo !== "camera") {
      void pararCamera();
      return;
    }

    ativoRef.current = true;
    processandoRef.current = false;
    setEstadoCamera("iniciando");
    setTorchOn(false);
    setHasTorch(false);

    // Delay antes de iniciar: dá tempo ao React de inserir o div no DOM
    // antes de Html5Qrcode chamar getElementById (mesmo padrão do código
    // de referência enviado pelo usuário, que usava 100ms no Android e
    // 200ms no iOS).
    const delay = isIOS ? 200 : 100;
    const timer = setTimeout(async () => {
      if (!ativoRef.current) return;

      let scanner: Html5Qrcode;
      try {
        scanner = new Html5Qrcode(ID_LEITOR, {
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
      scannerRef.current = scanner;

      try {
        await scanner.start(
          { facingMode: "environment" },
          {
            fps: isIOS ? 12 : 15,
            qrbox: isIOS ? { width: 240, height: 240 } : { width: 260, height: 260 },
            aspectRatio: 1.0,
          },
          (texto) => {
            if (!ativoRef.current || processandoRef.current) return;
            processandoRef.current = true;
            void pararCamera();
            cadastrar.mutate(texto);
          },
          () => {
            // silencia os "não encontrei QR neste frame"
          },
        );

        if (!ativoRef.current) return;
        setEstadoCamera("ativa");

        // Ajustes de câmera após o start() — delay porque o stream
        // ainda está estabilizando (mesmo padrão do código de referência:
        // 500ms Android / 1000ms iOS).
        const ajusteDelay = isIOS ? 1000 : 500;
        setTimeout(async () => {
          if (!ativoRef.current) return;

          // Foco contínuo — tenta direto sem checagem prévia.
          try {
            await scanner.applyVideoConstraints({
              advanced: [{ focusMode: "continuous" }],
            } as MediaTrackConstraints);
          } catch {
            // não suportado neste aparelho
          }

          // Torch — tenta ligar direto, SEM checar capabilities antes.
          // No iOS, getCapabilities() retorna vazio mesmo com flash real;
          // tentar direto e observar se funcionou é a única forma confiável.
          try {
            await scanner.applyVideoConstraints({
              advanced: [{ torch: true }],
            } as MediaTrackConstraints);
            setTorchOn(true);
            setHasTorch(true);
          } catch {
            setHasTorch(false);
          }
        }, ajusteDelay);

      } catch (err: unknown) {
        if (!ativoRef.current) return;
        const name = err instanceof Error ? err.name : "";
        if (name === "NotAllowedError" || name === "PermissionDeniedError") {
          setEstadoCamera("negada");
        } else if (name === "NotFoundError") {
          setErroCamera("Nenhuma câmera encontrada neste aparelho. Digite a chave abaixo.");
          setEstadoCamera("erro");
          setModo("digitar");
        } else if (name === "NotReadableError") {
          setErroCamera(
            isIOS
              ? "Câmera ocupada por outro aplicativo. Digite a chave abaixo."
              : "Câmera não disponível. Digite a chave abaixo.",
          );
          setEstadoCamera("erro");
          setModo("digitar");
        } else {
          setErroCamera("Não foi possível abrir a câmera. Digite a chave abaixo.");
          setEstadoCamera("erro");
          setModo("digitar");
        }
      }
    }, delay);

    return () => {
      ativoRef.current = false;
      clearTimeout(timer);
      void pararCamera();
    };
  }, [aberto, modo, tentativa]); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleTorch() {
    if (!scannerRef.current || !hasTorch) return;
    try {
      await scannerRef.current.applyVideoConstraints({
        advanced: [{ torch: !torchOn }],
      } as MediaTrackConstraints);
      setTorchOn((v) => !v);
    } catch {
      // flash não controlável
    }
  }

  async function handleArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    try {
      setErroCamera(null);
      const leitorArquivo = new Html5Qrcode(ID_LEITOR_ARQUIVO);
      const texto = await leitorArquivo.scanFile(arquivo, true);
      cadastrar.mutate(texto);
    } catch {
      setErroCamera("QR Code não identificado na imagem. Tente uma foto mais nítida e de frente.");
    } finally {
      // Limpa o input para permitir reenvio do mesmo arquivo
      if (e.target) e.target.value = "";
    }
  }

  const chaveLimpa = chaveDigitada.replace(/\D/g, "");
  const chaveValida = validarChaveAcesso(chaveLimpa);

  if (!aberto) return null;

  return (
    // Overlay full-screen renderizado direto no DOM — sem portal do
    // Dialog. Isso garante que div#ID_LEITOR já existe quando o useEffect
    // chama Html5Qrcode(ID_LEITOR), eliminando o race condition.
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between bg-zinc-900 px-4 py-3">
        <h2 className="text-sm font-semibold">Ler cupom fiscal</h2>
        <div className="flex items-center gap-2">
          {hasTorch && (
            <button
              onClick={toggleTorch}
              className={`rounded-full p-2 transition-colors ${
                torchOn ? "bg-yellow-400 text-black" : "bg-zinc-700 text-white"
              }`}
              aria-label={torchOn ? "Desligar lanterna" : "Ligar lanterna"}
            >
              {torchOn ? <ZapOff size={18} /> : <Zap size={18} />}
            </button>
          )}
          {modo === "camera" && estadoCamera !== "negada" && (
            <button
              onClick={() => setModo("digitar")}
              className="rounded-full bg-zinc-700 p-2 text-white"
              aria-label="Digitar a chave"
            >
              <Keyboard size={18} />
            </button>
          )}
          <button
            onClick={fechar}
            className="rounded-full bg-zinc-700 p-2 text-white"
            aria-label="Fechar scanner"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Corpo */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {cadastrar.isPending ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <Loader2 className="h-10 w-10 animate-spin text-zinc-400" />
            <p className="text-sm text-zinc-400">Consultando a nota na SEFAZ-BA…</p>
          </div>
        ) : modo === "camera" ? (
          <div className="relative flex flex-1 flex-col">
            {/* O div deve existir sempre no DOM enquanto modo === "camera",
                independente do estadoCamera — Html5Qrcode precisa dele. */}
            <div id={ID_LEITOR} className="flex-1 bg-black" />

            {/* Mira */}
            {(estadoCamera === "iniciando" || estadoCamera === "ativa") && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="relative aspect-square w-[65%] rounded-xl border-2 border-receita shadow-[0_0_0_9999px_rgba(0,0,0,0.6)]">
                  <div className="absolute top-1/2 h-0.5 w-full -translate-y-1/2 animate-pulse bg-receita shadow-[0_0_8px_var(--receita)]" />
                  <div className="absolute left-0 top-0 h-5 w-5 rounded-tl-sm border-l-2 border-t-2 border-white" />
                  <div className="absolute right-0 top-0 h-5 w-5 rounded-tr-sm border-r-2 border-t-2 border-white" />
                  <div className="absolute bottom-0 left-0 h-5 w-5 rounded-bl-sm border-b-2 border-l-2 border-white" />
                  <div className="absolute bottom-0 right-0 h-5 w-5 rounded-br-sm border-b-2 border-r-2 border-white" />
                </div>
              </div>
            )}

            {/* Overlay de estado */}
            {estadoCamera === "iniciando" && (
              <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center">
                <div className="flex items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-xs text-zinc-300 backdrop-blur-sm">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {isIOS ? "Iniciando câmera…" : "Abrindo câmera…"}
                </div>
              </div>
            )}

            {estadoCamera === "ativa" && !erroCamera && (
              <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center">
                <div className="flex items-center gap-2 rounded-full bg-emerald-700/80 px-4 py-2 text-xs text-white backdrop-blur-sm">
                  <div className="h-2 w-2 animate-pulse rounded-full bg-emerald-300" />
                  {isIOS ? "Aproxime devagar para focar" : "Aponte para o QR Code"}
                </div>
              </div>
            )}

            {estadoCamera === "negada" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/80 px-6 text-center">
                <VideoOff className="h-12 w-12 text-zinc-500" />
                <p className="font-semibold">Câmera bloqueada</p>
                <p className="text-sm text-zinc-400">
                  Clique no ícone de câmera na barra de endereço e escolha{" "}
                  <strong className="text-white">Permitir</strong>, depois tente novamente.
                </p>
                <Button
                  className="mt-2"
                  onClick={() => {
                    setEstadoCamera("iniciando");
                    setTentativa((n) => n + 1);
                  }}
                >
                  <Camera className="mr-2 h-4 w-4" />
                  Tentar novamente
                </Button>
                <button
                  onClick={() => setModo("digitar")}
                  className="text-sm text-zinc-400 underline underline-offset-2"
                >
                  Digitar a chave manualmente
                </button>
              </div>
            )}

            {erroCamera && estadoCamera !== "negada" && (
              <div className="pointer-events-none absolute inset-x-4 bottom-20 rounded-lg bg-error/90 px-4 py-3 text-center text-sm font-medium text-on-error backdrop-blur-sm">
                {erroCamera}
              </div>
            )}

            {!online && (
              <div className="pointer-events-none absolute inset-x-4 top-14 rounded-lg bg-warning-container/90 px-4 py-2 text-center text-xs text-on-warning-container backdrop-blur-sm">
                Sem conexão — o cupom será guardado e enviado quando a internet voltar.
              </div>
            )}
          </div>
        ) : (
          /* Modo digitar */
          <div className="flex flex-1 flex-col gap-4 bg-zinc-950 p-5">
            {erroCamera && (
              <p className="rounded-lg bg-error-container/40 p-3 text-sm text-on-error-container">
                {erroCamera}
              </p>
            )}
            <label className="text-sm font-medium text-zinc-300" htmlFor="chave-acesso">
              Chave de acesso
            </label>
            <Input
              id="chave-acesso"
              inputMode="numeric"
              autoComplete="off"
              placeholder="44 dígitos impressos abaixo do QR Code"
              value={chaveDigitada}
              onChange={(e) => setChaveDigitada(e.target.value)}
              className="bg-zinc-800 text-white placeholder:text-zinc-500 border-zinc-700"
            />
            <p className="text-xs text-zinc-500">
              {chaveLimpa.length}/44 dígitos
              {chaveLimpa.length === 44 && !chaveValida && (
                <span className="ml-2 text-red-400">
                  Dígito verificador não bate — confira os números.
                </span>
              )}
            </p>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                disabled={!chaveValida || cadastrar.isPending}
                onClick={() => cadastrar.mutate(chaveLimpa)}
              >
                {cadastrar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Cadastrar nota
              </Button>
              <Button
                variant="outline"
                className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                onClick={() => {
                  setErroCamera(null);
                  cadastrar.reset();
                  setEstadoCamera("iniciando");
                  setModo("camera");
                }}
              >
                <Camera className="h-4 w-4" />
              </Button>
            </div>

            {cadastrar.isError && !cadastrar.isPending && (
              <Button
                variant="outline"
                className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                onClick={() => {
                  cadastrar.reset();
                  setEstadoCamera("iniciando");
                  setModo("camera");
                  setTentativa((n) => n + 1);
                }}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Tentar de novo com a câmera
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Rodapé — foto como alternativa */}
      {modo === "camera" && estadoCamera !== "negada" && !cadastrar.isPending && (
        <div className="bg-zinc-900 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-700 py-3 text-sm font-semibold text-white transition-all active:scale-95"
          >
            <ImagePlus size={18} />
            Enviar foto do cupom
          </button>
          <p className="mt-2 text-center text-[11px] text-zinc-500">
            {isIOS ? "📱 Otimizado para iPhone" : "Útil quando a câmera ao vivo não foca bem"}
          </p>
        </div>
      )}

      {/* Inputs ocultos */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleArquivo}
        className="hidden"
      />
      {/* Contêiner oculto usado pelo Html5Qrcode.scanFile() */}
      <div id={ID_LEITOR_ARQUIVO} className="hidden" />
    </div>
  );
}
