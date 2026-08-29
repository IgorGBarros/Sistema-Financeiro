import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Send, Sparkles, Wrench } from "lucide-react";

import { api, ApiError } from "@/shared/lib/api";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
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

  const erro = perguntar.error as ApiError | null;
  const naoConfigurado = erro?.status === 503;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col p-6">
      <header className="mb-4">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Sparkles className="h-5 w-5" />
          Assistente
        </h1>
        <p className="text-sm text-muted-foreground">
          Pergunte sobre seus contratos, seu fluxo de caixa e seus cupons. As
          respostas saem dos seus próprios dados.
        </p>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto pb-4">
        {falas.length === 0 && (
          <Card>
            <CardContent className="space-y-3 pt-6">
              <p className="text-sm font-medium">Por onde começar</p>
              <div className="flex flex-wrap gap-2">
                {(capacidades.data?.exemplos ?? []).map((exemplo) => (
                  <button
                    key={exemplo}
                    onClick={() => enviar(exemplo)}
                    className="rounded-full border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
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
                  ? "max-w-[85%] rounded-lg bg-primary px-4 py-2.5 text-sm text-primary-foreground"
                  : "max-w-[85%] space-y-2 rounded-lg border bg-card px-4 py-2.5 text-sm"
              }
            >
              <p className="whitespace-pre-wrap">{fala.texto}</p>
              {fala.ferramentas && fala.ferramentas.length > 0 && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Wrench className="h-3 w-3" />
                  {/* Procedência do número: de onde o assistente tirou o dado. */}
                  {[...new Set(fala.ferramentas.map((f) => f.nome))].join(", ")}
                </p>
              )}
            </div>
          </div>
        ))}

        {perguntar.isPending && (
          <p className="text-sm text-muted-foreground">Consultando seus dados…</p>
        )}

        {erro && !perguntar.isPending && (
          <Card className="border-destructive">
            <CardContent className="flex items-start gap-3 pt-6">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div className="text-sm">
                <p>{erro.message}</p>
                {naoConfigurado && (
                  <p className="mt-1 text-muted-foreground">
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
  );
}
