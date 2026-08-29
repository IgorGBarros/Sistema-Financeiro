import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { CloudOff, Loader2, RefreshCw, Upload } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { useSincronizacaoCupons } from "@/features/fiscal/hooks/useSincronizacao";

/**
 * Faixa fina abaixo da navegação, com o que a pessoa precisa saber sobre o
 * estado do app: se está offline, se há cupons esperando envio e se existe
 * versão nova.
 *
 * A faixa só aparece quando tem algo a dizer. Um indicador permanente de
 * "online" ocuparia espaço para confirmar o caso normal.
 */
export function BarraStatus() {
  const { online, pendentes, sincronizando, sincronizar } = useSincronizacaoCupons();
  const [dispensouAtualizacao, setDispensouAtualizacao] = useState(false);

  const {
    needRefresh: [precisaAtualizar, setPrecisaAtualizar],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(erro) {
      console.error("Falha ao registrar o service worker", erro);
    },
  });

  // Fecha o aviso de atualização se a pessoa recarregar por conta própria.
  useEffect(() => {
    if (!precisaAtualizar) setDispensouAtualizacao(false);
  }, [precisaAtualizar]);

  const mostrarAtualizacao = precisaAtualizar && !dispensouAtualizacao;
  if (online && pendentes === 0 && !mostrarAtualizacao) return null;

  return (
    <div className="border-b bg-muted/60">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 text-sm">
        {!online && (
          <span className="flex items-center gap-2 text-muted-foreground">
            <CloudOff className="h-4 w-4" />
            Sem conexão. Você ainda pode ler cupons.
          </span>
        )}

        {pendentes > 0 && (
          <span className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-muted-foreground" />
            {pendentes} cupom{pendentes === 1 ? "" : "s"} aguardando envio
            {online && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void sincronizar()}
                disabled={sincronizando}
              >
                {sincronizando ? (
                  <>
                    <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                    Enviando
                  </>
                ) : (
                  "Enviar agora"
                )}
              </Button>
            )}
          </span>
        )}

        {mostrarAtualizacao && (
          <span className="ml-auto flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-muted-foreground" />
            Versão nova disponível
            <Button size="sm" onClick={() => void updateServiceWorker(true)}>
              Atualizar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDispensouAtualizacao(true);
                setPrecisaAtualizar(false);
              }}
            >
              Depois
            </Button>
          </span>
        )}
      </div>
    </div>
  );
}
