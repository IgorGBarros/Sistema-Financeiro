import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/shared/lib/api";
import {
  assinarFila,
  quantidadePendente,
  sincronizar,
  type ResultadoSincronizacao,
} from "@/features/fiscal/fila";

/**
 * `navigator.onLine` responde se existe interface de rede, não se a API está
 * alcançável — o Wi-Fi do mercado pode estar conectado e sem saída. Serve como
 * sinal barato para disparar a sincronização; quem decide de verdade é a
 * requisição dar certo ou não.
 */
export function useConexao(): boolean {
  return useSyncExternalStore(
    (callback) => {
      window.addEventListener("online", callback);
      window.addEventListener("offline", callback);
      return () => {
        window.removeEventListener("online", callback);
        window.removeEventListener("offline", callback);
      };
    },
    () => navigator.onLine,
    () => true, // SSR/primeiro render: assume conectado
  );
}

export function usePendentes(): number {
  return useSyncExternalStore(assinarFila, quantidadePendente, () => 0);
}

/**
 * Esvazia a fila de cupons quando a conexão volta e ao abrir o app.
 */
export function useSincronizacaoCupons() {
  const online = useConexao();
  const pendentes = usePendentes();
  const [sincronizando, setSincronizando] = useState(false);
  const [ultimo, setUltimo] = useState<ResultadoSincronizacao | null>(null);
  const queryClient = useQueryClient();

  const executar = useCallback(async () => {
    if (sincronizando || quantidadePendente() === 0) return;
    setSincronizando(true);
    try {
      const resultado = await sincronizar((conteudo) => api.scanNota(conteudo));
      setUltimo(resultado);
      if (resultado.enviados > 0) {
        queryClient.invalidateQueries({ queryKey: ["notas"] });
        queryClient.invalidateQueries({ queryKey: ["mercado"] });
        queryClient.invalidateQueries({ queryKey: ["fluxo-caixa"] });
      }
    } finally {
      setSincronizando(false);
    }
  }, [sincronizando, queryClient]);

  useEffect(() => {
    if (online && pendentes > 0) void executar();
    // `executar` é omitido de propósito: incluí-lo recria o efeito a cada
    // mudança de `sincronizando` e gera um laço de sincronização.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, pendentes]);

  return { online, pendentes, sincronizando, ultimo, sincronizar: executar };
}
