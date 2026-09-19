import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, FolderTree, Plus, Tags } from "lucide-react";

import {
  api,
  ApiError,
  type Categoria,
  type Classificacao,
  type Estabelecimento,
} from "@/shared/lib/api";
import { formatarCnpj } from "@/features/fiscal/nfce";
import { CabecalhoPagina } from "@/shared/components/CabecalhoPagina";
import { Selo } from "@/shared/components/Selo";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { useToast } from "@/shared/ui/use-toast";
import { cn } from "@/shared/lib/utils";

type Aba = "classificacoes" | "categorias" | "estabelecimentos";

const ABAS = [
  { valor: "classificacoes", rotulo: "Classificações", icone: FolderTree },
  { valor: "categorias", rotulo: "Categorias", icone: Tags },
  { valor: "estabelecimentos", rotulo: "Estabelecimentos", icone: Building2 },
] as const;

/**
 * Plano de contas.
 *
 * A classificação é tabela, e não lista fixa no código, exatamente para que
 * possa ser cadastrada — está na regra de negócio original. Sem esta tela, a
 * regra existia no banco e não existia para o usuário.
 */
export default function PlanoDeContas() {
  const [aba, setAba] = useState<Aba>("classificacoes");

  return (
    <div className="p-container-padding">
      <CabecalhoPagina
        titulo="Plano de contas"
        descricao="Como as entradas e saídas são organizadas. Mudar aqui muda a leitura de todos os relatórios."
      />

      <div className="mb-container-padding flex gap-1 rounded-lg bg-surface-container-low p-1">
        {ABAS.map(({ valor, rotulo, icone: Icone }) => (
          <button
            key={valor}
            onClick={() => setAba(valor)}
            className={cn(
              "flex items-center gap-2 rounded px-4 py-2 text-body-sm transition-colors",
              aba === valor
                ? "bg-surface-container-lowest font-semibold text-on-surface shadow-sm"
                : "text-on-surface-variant hover:text-on-surface",
            )}
          >
            <Icone className="h-4 w-4" />
            {rotulo}
          </button>
        ))}
      </div>

      {aba === "classificacoes" && <Classificacoes />}
      {aba === "categorias" && <Categorias />}
      {aba === "estabelecimentos" && <Estabelecimentos />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Classificacoes() {
  const classificacoes = useQuery({
    queryKey: ["classificacoes"],
    queryFn: () => api.classificacoes(),
  });
  const [editando, setEditando] = useState<Classificacao | null>(null);
  const [aberto, setAberto] = useState(false);

  return (
    <>
      <div className="cartao overflow-hidden">
        <div className="flex items-center justify-between border-b border-outline-variant bg-surface p-stack-md">
          <div>
            <h2 className="text-headline-sm text-on-surface">Classificações</h2>
            <p className="mt-1 text-body-sm text-on-surface-variant">
              Essenciais, Bons, Ruins, Operacionais — e as que você criar. O
              peso alimenta a leitura de qualidade do gasto.
            </p>
          </div>
          <Button
            onClick={() => {
              setEditando(null);
              setAberto(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Nova
          </Button>
        </div>

        <div className="divide-y divide-outline-variant">
          {(classificacoes.data ?? []).map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setEditando(item);
                setAberto(true);
              }}
              className="flex w-full items-center justify-between gap-stack-md p-stack-md text-left transition-colors hover:bg-surface-container-low"
            >
              <div className="flex min-w-0 items-center gap-stack-md">
                <span
                  className="h-8 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: item.cor }}
                />
                <div className="min-w-0">
                  <p className="font-medium text-on-surface">{item.nome}</p>
                  {item.descricao && (
                    <p className="truncate text-body-sm text-on-surface-variant">
                      {item.descricao}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-stack-sm">
                <Selo tom={item.peso > 0 ? "sucesso" : item.peso <= -2 ? "erro" : "neutro"}>
                  peso {item.peso}
                </Selo>
                <span className="text-body-sm text-on-surface-variant">
                  {item.total_contratos ?? 0} contrato(s)
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <FormularioClassificacao
        aberto={aberto}
        classificacao={editando}
        onFechar={() => setAberto(false)}
      />
    </>
  );
}

function FormularioClassificacao({
  aberto,
  classificacao,
  onFechar,
}: {
  aberto: boolean;
  classificacao: Classificacao | null;
  onFechar: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [peso, setPeso] = useState("0");
  const [cor, setCor] = useState("#64748b");

  const preencher = () => {
    setNome(classificacao?.nome ?? "");
    setDescricao(classificacao?.descricao ?? "");
    setPeso(String(classificacao?.peso ?? 0));
    setCor(classificacao?.cor ?? "#64748b");
  };

  const salvar = useMutation({
    mutationFn: () =>
      api.salvarClassificacao(
        { nome, descricao, peso: Number(peso), cor },
        classificacao?.id,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["classificacoes"] });
      toast({ title: classificacao ? "Classificação atualizada" : "Classificação criada" });
      onFechar();
    },
    onError: (erro: ApiError) =>
      toast({ variant: "destructive", title: "Não deu para salvar", description: erro.message }),
  });

  return (
    <Dialog
      open={aberto}
      onOpenChange={(v) => {
        if (v) preencher();
        else onFechar();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{classificacao ? "Editar" : "Nova classificação"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-stack-md">
          <Campo rotulo="Nome">
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Contratos Ruins" />
          </Campo>
          <Campo rotulo="Descrição">
            <Input
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Juros, multas, assinatura esquecida"
            />
          </Campo>
          <div className="grid grid-cols-2 gap-stack-md">
            <Campo
              rotulo="Peso"
              ajuda="Positivo para receita, negativo para gasto de baixa qualidade."
            >
              <Input type="number" value={peso} onChange={(e) => setPeso(e.target.value)} />
            </Campo>
            <Campo rotulo="Cor">
              <Input type="color" value={cor} onChange={(e) => setCor(e.target.value)} className="h-10 p-1" />
            </Campo>
          </div>

          <div className="flex justify-end gap-stack-sm">
            <Button variant="ghost" onClick={onFechar}>
              Cancelar
            </Button>
            <Button onClick={() => salvar.mutate()} disabled={!nome || salvar.isPending}>
              Salvar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

function Categorias() {
  const categorias = useQuery({ queryKey: ["categorias"], queryFn: () => api.categorias() });
  const classificacoes = useQuery({
    queryKey: ["classificacoes"],
    queryFn: () => api.classificacoes(),
  });
  const [aberto, setAberto] = useState(false);
  const [editando, setEditando] = useState<Categoria | null>(null);

  const receitas = (categorias.data ?? []).filter((c) => c.tipo === "RECEITA");
  const despesas = (categorias.data ?? []).filter((c) => c.tipo === "DESPESA");

  return (
    <>
      <div className="mb-container-padding flex justify-end">
        <Button
          onClick={() => {
            setEditando(null);
            setAberto(true);
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          Nova categoria
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-container-padding md:grid-cols-2">
        {[
          { titulo: "Entradas", lista: receitas },
          { titulo: "Saídas", lista: despesas },
        ].map(({ titulo, lista }) => (
          <div key={titulo} className="cartao overflow-hidden">
            <div className="border-b border-outline-variant bg-surface p-stack-md">
              <h2 className="text-headline-sm text-on-surface">{titulo}</h2>
            </div>
            <div className="divide-y divide-outline-variant">
              {lista.map((categoria) => (
                <button
                  key={categoria.id}
                  onClick={() => {
                    setEditando(categoria);
                    setAberto(true);
                  }}
                  className="flex w-full items-center justify-between gap-2 p-stack-sm px-stack-md text-left transition-colors hover:bg-surface-container-low"
                >
                  <span className="truncate text-body-md text-on-surface">
                    {categoria.nome}
                  </span>
                  <div className="flex shrink-0 items-center gap-2">
                    {categoria.consolida_mercado && <Selo tom="sucesso">mercado</Selo>}
                    <Selo>{categoria.classificacao_nome}</Selo>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <FormularioCategoria
        aberto={aberto}
        categoria={editando}
        classificacoes={classificacoes.data ?? []}
        onFechar={() => setAberto(false)}
      />
    </>
  );
}

function FormularioCategoria({
  aberto,
  categoria,
  classificacoes,
  onFechar,
}: {
  aberto: boolean;
  categoria: Categoria | null;
  classificacoes: Classificacao[];
  onFechar: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState<"RECEITA" | "DESPESA">("DESPESA");
  const [classificacao, setClassificacao] = useState("");

  const preencher = () => {
    setNome(categoria?.nome ?? "");
    setTipo(categoria?.tipo ?? "DESPESA");
    setClassificacao(categoria?.classificacao ?? classificacoes[0]?.id ?? "");
  };

  const salvar = useMutation({
    mutationFn: () =>
      api.salvarCategoria({ nome, tipo, classificacao }, categoria?.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categorias"] });
      toast({ title: categoria ? "Categoria atualizada" : "Categoria criada" });
      onFechar();
    },
    onError: (erro: ApiError) =>
      toast({ variant: "destructive", title: "Não deu para salvar", description: erro.message }),
  });

  return (
    <Dialog
      open={aberto}
      onOpenChange={(v) => {
        if (v) preencher();
        else onFechar();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{categoria ? "Editar categoria" : "Nova categoria"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-stack-md">
          <Campo rotulo="Nome">
            <Input value={nome} onChange={(e) => setNome(e.target.value)} />
          </Campo>

          <div className="grid grid-cols-2 gap-2">
            {(["RECEITA", "DESPESA"] as const).map((valor) => (
              <button
                key={valor}
                onClick={() => setTipo(valor)}
                className={cn(
                  "rounded-md border px-3 py-2 text-body-sm transition-colors",
                  tipo === valor
                    ? "border-secondary bg-secondary-container text-on-secondary-container"
                    : "border-outline-variant text-on-surface-variant hover:bg-surface-container-high",
                )}
              >
                {valor === "RECEITA" ? "Entrada" : "Saída"}
              </button>
            ))}
          </div>

          <Campo rotulo="Classificação">
            <select
              className="h-10 w-full rounded-md border border-outline-variant bg-surface-container-lowest px-3 text-body-sm"
              value={classificacao}
              onChange={(e) => setClassificacao(e.target.value)}
            >
              {classificacoes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </Campo>

          <div className="flex justify-end gap-stack-sm">
            <Button variant="ghost" onClick={onFechar}>
              Cancelar
            </Button>
            <Button onClick={() => salvar.mutate()} disabled={!nome || salvar.isPending}>
              Salvar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

function Estabelecimentos() {
  const estabelecimentos = useQuery({
    queryKey: ["estabelecimentos"],
    queryFn: () => api.estabelecimentos(),
  });

  /**
   * Agrupa por raiz do CNPJ.
   *
   * Os 8 primeiros dígitos identificam a empresa; os 4 seguintes, a filial. A
   * Redemix do cupom é a filial 0015, e a rede tem dezenas de lojas com CNPJ
   * próprio — sem agrupar, "quanto gastei na Redemix" não responde nada.
   */
  const grupos = new Map<string, Estabelecimento[]>();
  for (const item of estabelecimentos.data ?? []) {
    const chave = item.cnpj ? item.cnpj.slice(0, 8) : `sem-cnpj-${item.id}`;
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave)!.push(item);
  }

  return (
    <div className="cartao overflow-hidden">
      <div className="border-b border-outline-variant bg-surface p-stack-md">
        <h2 className="text-headline-sm text-on-surface">Estabelecimentos</h2>
        <p className="mt-1 text-body-sm text-on-surface-variant">
          Criados sozinhos ao ler o cupom, a partir do CNPJ da chave de acesso.
          Filiais da mesma rede aparecem agrupadas.
        </p>
      </div>

      <div className="divide-y divide-outline-variant">
        {[...grupos.entries()].map(([chave, itens]) => (
          <div key={chave} className="p-stack-md">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium text-on-surface">{itens[0].nome}</p>
              {itens.length > 1 && <Selo>{itens.length} filiais</Selo>}
            </div>
            {itens.map((item) => (
              <p key={item.id} className="mt-1 text-body-sm text-on-surface-variant">
                {item.cnpj ? formatarCnpj(item.cnpj) : "sem CNPJ"}
              </p>
            ))}
          </div>
        ))}
        {(estabelecimentos.data ?? []).length === 0 && (
          <p className="p-stack-lg text-center text-body-sm text-on-surface-variant">
            Nenhum estabelecimento ainda. Eles nascem sozinhos ao ler o
            primeiro cupom.
          </p>
        )}
      </div>
    </div>
  );
}

function Campo({
  rotulo,
  ajuda,
  children,
}: {
  rotulo: string;
  ajuda?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-body-sm font-medium">{rotulo}</label>
      {children}
      {ajuda && <p className="text-[11px] text-on-surface-variant">{ajuda}</p>}
    </div>
  );
}
