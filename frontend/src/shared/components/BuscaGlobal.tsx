import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FileText, Receipt, Search, Wallet, X } from "lucide-react";

import { api } from "@/shared/lib/api";
import { formatarMoeda } from "@/features/fiscal/nfce";
import { cn } from "@/shared/lib/utils";

const DEBOUNCE_MS = 300;

function useDebounce(valor: string, ms: number) {
  const [debouncado, setDebouncado] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setDebouncado(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return debouncado;
}

export function BuscaGlobal({ aoFechar }: { aoFechar: () => void }) {
  const [termo, setTermo] = useState("");
  const termoDebounced = useDebounce(termo, DEBOUNCE_MS);
  const inputRef = useRef<HTMLInputElement>(null);
  const navegar = useNavigate();

  useEffect(() => {
    inputRef.current?.focus();
    const sair = (e: KeyboardEvent) => e.key === "Escape" && aoFechar();
    window.addEventListener("keydown", sair);
    return () => window.removeEventListener("keydown", sair);
  }, [aoFechar]);

  const ativo = termoDebounced.length >= 2;

  const contratos = useQuery({
    queryKey: ["busca-contratos", termoDebounced],
    queryFn: () => api.contratos({ search: termoDebounced }),
    enabled: ativo,
  });

  const realizados = useQuery({
    queryKey: ["busca-realizados", termoDebounced],
    queryFn: () => api.realizados({ search: termoDebounced }),
    enabled: ativo,
  });

  const notas = useQuery({
    queryKey: ["busca-notas", termoDebounced],
    queryFn: () => api.notas({ search: termoDebounced }),
    enabled: ativo,
  });

  const carregando = contratos.isLoading || realizados.isLoading || notas.isLoading;

  type Item = { tipo: string; id: string; descricao: string; subtitulo: string; valor: string | null; rota: string };

  const resultados: Item[] = [
    ...(contratos.data ?? []).slice(0, 5).map((c) => ({
      tipo: "contrato",
      id: c.id,
      descricao: c.descricao,
      subtitulo: `${c.estabelecimento_nome} · ${c.tipo === "RECEITA" ? "Receita" : "Despesa"}`,
      valor: c.valor_unitario,
      rota: "/contratos",
    })),
    ...(realizados.data ?? []).slice(0, 5).map((r) => ({
      tipo: "realizado",
      id: r.id,
      descricao: r.descricao,
      subtitulo: `${r.categoria_nome} · ${r.data_pagamento}`,
      valor: r.valor,
      rota: "/lancamentos",
    })),
    ...(notas.data ?? []).slice(0, 5).map((n) => ({
      tipo: "nota",
      id: n.id,
      descricao: n.nome_emitente,
      subtitulo: `NFC-e · ${n.data_emissao ?? "sem data"}`,
      valor: n.valor_total,
      rota: "/notas",
    })),
  ];

  function ir(rota: string) {
    navegar(rota);
    aoFechar();
  }

  const icone = { contrato: FileText, realizado: Wallet, nota: Receipt };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[10vh]">
      <div className="absolute inset-0 bg-black/50" onClick={aoFechar} />
      <div className="relative w-full max-w-xl rounded-2xl border border-outline-variant bg-surface-container-lowest shadow-2xl">
        <div className="flex items-center gap-3 p-stack-md">
          <Search className="h-5 w-5 shrink-0 text-on-surface-variant" />
          <input
            ref={inputRef}
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="Buscar contratos, lançamentos, notas…"
            className="flex-1 bg-transparent text-body-md text-on-surface outline-none placeholder:text-on-surface-variant"
          />
          {termo && (
            <button onClick={() => setTermo("")} className="text-on-surface-variant hover:text-on-surface">
              <X className="h-4 w-4" />
            </button>
          )}
          <button onClick={aoFechar} className="text-body-sm text-on-surface-variant hover:text-on-surface">
            Esc
          </button>
        </div>

        {ativo && (
          <div className="border-t border-outline-variant pb-2">
            {carregando && (
              <p className="px-stack-md py-stack-sm text-body-sm text-on-surface-variant">
                Buscando…
              </p>
            )}
            {!carregando && resultados.length === 0 && (
              <p className="px-stack-md py-stack-sm text-body-sm text-on-surface-variant">
                Nenhum resultado para &ldquo;{termoDebounced}&rdquo;.
              </p>
            )}
            {!carregando && resultados.length > 0 && (
              <ul>
                {resultados.map((item) => {
                  const Icone = icone[item.tipo as keyof typeof icone] ?? Search;
                  return (
                    <li key={`${item.tipo}-${item.id}`}>
                      <button
                        onClick={() => ir(item.rota)}
                        className="flex w-full items-center gap-3 px-stack-md py-stack-sm text-left hover:bg-surface-container-low"
                      >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-container">
                          <Icone className="h-4 w-4 text-on-surface-variant" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-body-md text-on-surface">{item.descricao}</p>
                          <p className="truncate text-body-sm text-on-surface-variant">{item.subtitulo}</p>
                        </div>
                        {item.valor && (
                          <span className={cn(
                            "shrink-0 tabular text-body-sm font-semibold",
                          )}>
                            {formatarMoeda(item.valor)}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {!ativo && (
          <div className="border-t border-outline-variant px-stack-md py-stack-sm text-body-sm text-on-surface-variant">
            Digite ao menos 2 caracteres para buscar.
          </div>
        )}
      </div>
    </div>
  );
}
