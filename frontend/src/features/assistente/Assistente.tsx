import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, MessageSquarePlus, Send, Trash2, Wrench } from "lucide-react";

import { api, ApiError } from "@/shared/lib/api";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { CabecalhoPagina } from "@/shared/components/CabecalhoPagina";
import { Input } from "@/shared/ui/input";

interface Fala {
  papel: "user" | "assistant";
  texto: string;
  ferramentas?: { nome: string; erro: boolean }[];
}

/**
 * O assistente responde apenas a partir de ferramentas que consultam o banco
 * financeiro do próprio workspace. Ele não escreve SQL e não tem acesso a
 * dados de terceiros — a lista de capacidades vem do backend justamente para
 * a pessoa saber o que dá para perguntar, em vez de adivinhar.
 */
export default function Assistente() {
  const [falas, setFalas] = useState<Fala[]>([]);
  const [texto, setTexto] = useState("");
  const [conversa, setConversa] = useState<string | null>(null);
  const fimRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const capacidades = useQuery({
    queryKey: ["assistente", "capacidades"],
    queryFn: () => api.capacidadesAssistente(),
  });

  const historicoConversas = useQuery({
    queryKey: ["assistente", "conversas"],
    queryFn: () => api.conversas(),
  });

  const deletarConversa = useMutation({
    mutationFn: (id: string) => api.deletarConversa(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["assistente", "conversas"] });
      if (conversa === id) {
        setConversa(null);
        setFalas([]);
      }
    },
  });

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [falas]);

  const perguntar = useMutation({
    mutationFn: (pergunta: string) => api.perguntarAssistente(pergunta, conversa),
    onSuccess: (resposta) => {
      setConversa(resposta.conversa);
      setFalas((atuais) => [
        ...atuais,
        {
          papel: "assistant",
          texto: resposta.resposta,
          ferramentas: resposta.ferramentas_usadas,
        },
      ]);
      // Uma pergunta pode revelar dado desatualizado nas outras telas.
      queryClient.invalidateQueries({ queryKey: ["fluxo-caixa"] });
    },
  });

  function enviar(pergunta: string) {
    const limpo = pergunta.trim();
    if (!limpo || perguntar.isPending) return;
    setFalas((atuais) => [...atuais, { papel: "user", texto: limpo }]);
    setTexto("");
    perguntar.mutate(limpo);
  }

  function novaConversa() {
    setConversa(null);
    setFalas([]);
  }

  const erro = perguntar.error as ApiError | null;
  const naoConfigurado = erro?.status === 503;
  const conversas = historicoConversas.data ?? [];

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-container-padding p-container-padding">
      {conversas.length > 0 && (
        <div className="hidden w-56 shrink-0 flex-col gap-1 overflow-y-auto lg:flex">
          <button
            onClick={novaConversa}
            className="flex items-center gap-2 rounded-md px-3 py-2 text-body-sm text-on-surface-variant hover:bg-surface-container-high"
          >
            <MessageSquarePlus className="h-4 w-4" />
            Nova conversa
          </button>
          <p className="rotulo px-3 pt-2">Anteriores</p>
          {conversas.map((c) => (
            <div
              key={c.id}
              className={cn(
                "group flex items-center justify-between gap-1 rounded-md px-3 py-2 text-body-sm",
                conversa === c.id
                  ? "bg-secondary-container text-on-secondary-container"
                  : "text-on-surface hover:bg-surface-container-high cursor-pointer",
              )}
              onClick={() => { if (conversa !== c.id) { setConversa(c.id); setFalas([]); } }}
            >
              <span className="truncate">{c.titulo}</span>
              <button
                onClick={(e) => { e.stopPropagation(); deletarConversa.mutate(c.id); }}
                className="shrink-0 rounded p-0.5 opacity-0 hover:bg-error-container hover:text-on-error-container group-hover:opacity-100"
                title="Apagar"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
      <CabecalhoPagina
        titulo="Assistente"
        descricao="Pergunte sobre seus contratos, cartões e cupons. As respostas saem dos seus próprios dados."
      />

      <div className="flex-1 space-y-4 overflow-y-auto pb-4">
        {falas.length === 0 && (
          <Card>
            <CardContent className="space-y-3 pt-6">
              <p className="text-body-md font-medium">Por onde começar</p>
              <div className="flex flex-wrap gap-2">
                {(capacidades.data?.exemplos ?? []).map((exemplo) => (
                  <button
                    key={exemplo}
                    onClick={() => enviar(exemplo)}
                    className="rounded-full border px-3 py-1.5 text-body-sm text-on-surface-variant transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    {exemplo}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {falas.map((fala, indice) => (
          <div
            key={indice}
            className={fala.papel === "user" ? "flex justify-end" : "flex justify-start"}
          >
            <div
              className={
                fala.papel === "user"
                  ? "max-w-[85%] rounded-lg bg-secondary-container px-4 py-2.5 text-body-sm text-on-secondary-container"
                  : "max-w-[85%] space-y-2 rounded-lg border border-outline-variant bg-surface-container-lowest px-4 py-2.5 text-body-sm"
              }
            >
              <p className="whitespace-pre-wrap">{fala.texto}</p>
              {fala.ferramentas && fala.ferramentas.length > 0 && (
                <p className="flex items-center gap-1.5 text-[11px] text-on-surface-variant">
                  <Wrench className="h-3 w-3" />
                  {/* Procedência do número: de onde o assistente tirou o dado. */}
                  {[...new Set(fala.ferramentas.map((f) => f.nome))].join(", ")}
                </p>
              )}
            </div>
          </div>
        ))}

        {perguntar.isPending && (
          <p className="text-body-sm text-on-surface-variant">Consultando seus dados…</p>
        )}

        {erro && !perguntar.isPending && (
          <Card className="border-destructive">
            <CardContent className="flex items-start gap-3 pt-6">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-error" />
              <div className="text-body-sm">
                <p>{erro.message}</p>
                {naoConfigurado && (
                  <p className="mt-1 text-on-surface-variant">
                    Adicione ANTHROPIC_API_KEY ao backend/.env e reinicie a API.
                    O resto do sistema funciona normalmente sem ela.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <div ref={fimRef} />
      </div>

      <div className="flex gap-2 border-t pt-4">
        <Input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && enviar(texto)}
          placeholder="Em que mês meu saldo fica negativo?"
          disabled={perguntar.isPending}
        />
        <Button onClick={() => enviar(texto)} disabled={!texto.trim() || perguntar.isPending}>
          <Send className="h-4 w-4" />
          <span className="sr-only">Enviar</span>
        </Button>
      </div>
      </div>
    </div>
  );
}
