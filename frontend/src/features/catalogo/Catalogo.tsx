import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Building2, Layers, Pencil, Plus, Tag, Trash2 } from "lucide-react";

import { api, type Categoria, type Classificacao, type Estabelecimento } from "@/shared/lib/api";
import { CabecalhoPagina } from "@/shared/components/CabecalhoPagina";
import { ModalConfirmacao } from "@/shared/components/ModalConfirmacao";
import { Button } from "@/shared/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { useToast } from "@/shared/ui/use-toast";
import { FormularioClassificacao } from "./components/FormularioClassificacao";
import { FormularioCategoria } from "./components/FormularioCategoria";
import { FormularioEstabelecimento } from "./components/FormularioEstabelecimento";

export default function Catalogo() {
  return (
    <div className="p-container-padding">
      <CabecalhoPagina
        titulo="Catálogo"
        descricao="Classificações, categorias e estabelecimentos usados em contratos e lançamentos."
      />

      <Tabs defaultValue="classificacoes">
        <TabsList className="mb-container-padding">
          <TabsTrigger value="classificacoes" className="flex items-center gap-2">
            <Layers className="h-4 w-4" />
            Classificações
          </TabsTrigger>
          <TabsTrigger value="categorias" className="flex items-center gap-2">
            <Tag className="h-4 w-4" />
            Categorias
          </TabsTrigger>
          <TabsTrigger value="estabelecimentos" className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Estabelecimentos
          </TabsTrigger>
        </TabsList>

        <TabsContent value="classificacoes">
          <AbaClassificacoes />
        </TabsContent>
        <TabsContent value="categorias">
          <AbaCategorias />
        </TabsContent>
        <TabsContent value="estabelecimentos">
          <AbaEstabelecimentos />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ─── Classificações ─────────────────────────────────────────────────────── */

function AbaClassificacoes() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [formularioAberto, setFormularioAberto] = useState(false);
  const [emEdicao, setEmEdicao] = useState<Classificacao | null>(null);
  const [emExclusao, setEmExclusao] = useState<Classificacao | null>(null);

  const { data = [], isLoading } = useQuery({
    queryKey: ["classificacoes"],
    queryFn: () => api.classificacoes(),
  });

  const deletar = useMutation({
    mutationFn: (id: string) => api.deletarClassificacao(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["classificacoes"] });
      toast({ title: "Classificação removida" });
      setEmExclusao(null);
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  return (
    <>
      <div className="cartao overflow-hidden">
        <div className="flex items-center justify-between border-b border-outline-variant bg-surface p-stack-md">
          <h2 className="text-headline-sm text-on-surface">Classificações</h2>
          <Button
            size="sm"
            onClick={() => { setEmEdicao(null); setFormularioAberto(true); }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Nova
          </Button>
        </div>

        {isLoading ? (
          <p className="p-stack-lg text-center text-body-sm text-on-surface-variant">Carregando…</p>
        ) : data.length === 0 ? (
          <EmptyState icone={BookOpen} mensagem="Nenhuma classificação cadastrada." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-outline-variant bg-surface-container-low">
                  <th className="rotulo px-gutter-table py-2">Nome</th>
                  <th className="rotulo px-gutter-table py-2">Descrição</th>
                  <th className="rotulo px-gutter-table py-2 text-center">Peso</th>
                  <th className="rotulo px-gutter-table py-2 text-center">Cor</th>
                  <th className="rotulo px-gutter-table py-2 text-center">Status</th>
                  <th className="rotulo px-gutter-table py-2 text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="text-body-sm">
                {data.map((c) => (
                  <tr
                    key={c.id}
                    className="group h-[44px] border-b border-outline-variant transition-colors hover:bg-surface-container-low"
                  >
                    <td className="px-gutter-table py-2 font-medium text-on-surface">{c.nome}</td>
                    <td className="max-w-[200px] truncate px-gutter-table py-2 text-on-surface-variant">
                      {c.descricao || "—"}
                    </td>
                    <td className="px-gutter-table py-2 text-center tabular text-on-surface-variant">
                      {c.peso > 0 ? `+${c.peso}` : c.peso}
                    </td>
                    <td className="px-gutter-table py-2 text-center">
                      <span
                        className="inline-block h-5 w-5 rounded-full border border-outline-variant"
                        style={{ backgroundColor: c.cor }}
                        title={c.cor}
                      />
                    </td>
                    <td className="px-gutter-table py-2 text-center">
                      <span
                        className={
                          "rounded-full px-2 py-0.5 text-xs font-medium " +
                          (c.ativo
                            ? "bg-receita-surface text-receita-on"
                            : "bg-surface-container-high text-on-surface-variant")
                        }
                      >
                        {c.ativo ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    <td className="px-gutter-table py-2">
                      <AcoesCelula
                        onEditar={() => { setEmEdicao(c); setFormularioAberto(true); }}
                        onDeletar={() => setEmExclusao(c)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <FormularioClassificacao
        aberto={formularioAberto}
        classificacao={emEdicao}
        onFechar={() => setFormularioAberto(false)}
      />

      <ModalConfirmacao
        aberto={!!emExclusao}
        titulo="Remover classificação"
        mensagem={`Deseja remover "${emExclusao?.nome}"? Categorias vinculadas serão afetadas.`}
        rotuloBotao="Remover"
        carregando={deletar.isPending}
        onConfirmar={() => emExclusao && deletar.mutate(emExclusao.id)}
        onFechar={() => setEmExclusao(null)}
      />
    </>
  );
}

/* ─── Categorias ─────────────────────────────────────────────────────────── */

function AbaCategorias() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [formularioAberto, setFormularioAberto] = useState(false);
  const [emEdicao, setEmEdicao] = useState<Categoria | null>(null);
  const [emExclusao, setEmExclusao] = useState<Categoria | null>(null);
  const [filtroTipo, setFiltroTipo] = useState<"TODOS" | "RECEITA" | "DESPESA">("TODOS");

  const { data = [], isLoading } = useQuery({
    queryKey: ["categorias", "todas"],
    queryFn: () => api.categorias(),
  });

  const lista = filtroTipo === "TODOS" ? data : data.filter((c) => c.tipo === filtroTipo);

  const deletar = useMutation({
    mutationFn: (id: string) => api.deletarCategoria(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categorias"] });
      toast({ title: "Categoria removida" });
      setEmExclusao(null);
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  return (
    <>
      <div className="cartao overflow-hidden">
        <div className="flex items-center justify-between border-b border-outline-variant bg-surface p-stack-md">
          <div className="flex items-center gap-3">
            <h2 className="text-headline-sm text-on-surface">Categorias</h2>
            <FiltroTipo valor={filtroTipo} onChange={setFiltroTipo} />
          </div>
          <Button
            size="sm"
            onClick={() => { setEmEdicao(null); setFormularioAberto(true); }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Nova
          </Button>
        </div>

        {isLoading ? (
          <p className="p-stack-lg text-center text-body-sm text-on-surface-variant">Carregando…</p>
        ) : lista.length === 0 ? (
          <EmptyState icone={Tag} mensagem="Nenhuma categoria cadastrada." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-outline-variant bg-surface-container-low">
                  <th className="rotulo px-gutter-table py-2">Nome</th>
                  <th className="rotulo px-gutter-table py-2">Tipo</th>
                  <th className="rotulo px-gutter-table py-2">Classificação</th>
                  <th className="rotulo px-gutter-table py-2 text-center">Mercado</th>
                  <th className="rotulo px-gutter-table py-2 text-center">Status</th>
                  <th className="rotulo px-gutter-table py-2 text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="text-body-sm">
                {lista.map((c) => (
                  <tr
                    key={c.id}
                    className="group h-[44px] border-b border-outline-variant transition-colors hover:bg-surface-container-low"
                  >
                    <td className="px-gutter-table py-2 font-medium text-on-surface">{c.nome}</td>
                    <td className="px-gutter-table py-2">
                      <span
                        className={
                          "rounded-full px-2 py-0.5 text-xs font-medium " +
                          (c.tipo === "RECEITA"
                            ? "bg-receita-surface text-receita-on"
                            : "bg-despesa-surface text-despesa-on")
                        }
                      >
                        {c.tipo === "RECEITA" ? "Entrada" : "Saída"}
                      </span>
                    </td>
                    <td className="px-gutter-table py-2 text-on-surface-variant">
                      {c.classificacao_nome}
                    </td>
                    <td className="px-gutter-table py-2 text-center text-on-surface-variant">
                      {c.consolida_mercado ? "✓" : "—"}
                    </td>
                    <td className="px-gutter-table py-2 text-center">
                      <span
                        className={
                          "rounded-full px-2 py-0.5 text-xs font-medium " +
                          (c.ativo
                            ? "bg-receita-surface text-receita-on"
                            : "bg-surface-container-high text-on-surface-variant")
                        }
                      >
                        {c.ativo ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    <td className="px-gutter-table py-2">
                      <AcoesCelula
                        onEditar={() => { setEmEdicao(c); setFormularioAberto(true); }}
                        onDeletar={() => setEmExclusao(c)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <FormularioCategoria
        aberto={formularioAberto}
        categoria={emEdicao}
        onFechar={() => setFormularioAberto(false)}
      />

      <ModalConfirmacao
        aberto={!!emExclusao}
        titulo="Remover categoria"
        mensagem={`Deseja remover "${emExclusao?.nome}"? Contratos e lançamentos vinculados serão afetados.`}
        rotuloBotao="Remover"
        carregando={deletar.isPending}
        onConfirmar={() => emExclusao && deletar.mutate(emExclusao.id)}
        onFechar={() => setEmExclusao(null)}
      />
    </>
  );
}

/* ─── Estabelecimentos ───────────────────────────────────────────────────── */

function AbaEstabelecimentos() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [formularioAberto, setFormularioAberto] = useState(false);
  const [emEdicao, setEmEdicao] = useState<Estabelecimento | null>(null);
  const [emExclusao, setEmExclusao] = useState<Estabelecimento | null>(null);
  const [busca, setBusca] = useState("");

  const { data = [], isLoading } = useQuery({
    queryKey: ["estabelecimentos"],
    queryFn: () => api.estabelecimentos(),
  });

  const lista = busca.trim()
    ? data.filter((e) => e.nome.toLowerCase().includes(busca.toLowerCase()))
    : data;

  const deletar = useMutation({
    mutationFn: (id: string) => api.deletarEstabelecimento(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["estabelecimentos"] });
      toast({ title: "Estabelecimento removido" });
      setEmExclusao(null);
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  return (
    <>
      <div className="cartao overflow-hidden">
        <div className="flex items-center justify-between border-b border-outline-variant bg-surface p-stack-md">
          <div className="flex items-center gap-3">
            <h2 className="text-headline-sm text-on-surface">Estabelecimentos</h2>
            <input
              className="rounded-md border border-outline-variant bg-surface-container-low px-3 py-1.5 text-body-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-1 focus:ring-secondary"
              placeholder="Buscar…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            onClick={() => { setEmEdicao(null); setFormularioAberto(true); }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Novo
          </Button>
        </div>

        {isLoading ? (
          <p className="p-stack-lg text-center text-body-sm text-on-surface-variant">Carregando…</p>
        ) : lista.length === 0 ? (
          <EmptyState icone={Building2} mensagem="Nenhum estabelecimento encontrado." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-outline-variant bg-surface-container-low">
                  <th className="rotulo px-gutter-table py-2">Nome</th>
                  <th className="rotulo px-gutter-table py-2">CNPJ</th>
                  <th className="rotulo px-gutter-table py-2 text-center">Código</th>
                  <th className="rotulo px-gutter-table py-2 text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="text-body-sm">
                {lista.map((e) => (
                  <tr
                    key={e.id}
                    className="group h-[44px] border-b border-outline-variant transition-colors hover:bg-surface-container-low"
                  >
                    <td className="px-gutter-table py-2 font-medium text-on-surface">{e.nome}</td>
                    <td className="px-gutter-table py-2 tabular text-on-surface-variant">
                      {e.cnpj ? formatarCnpj(e.cnpj) : "—"}
                    </td>
                    <td className="px-gutter-table py-2 text-center tabular text-on-surface-variant">
                      {e.codigo ?? "—"}
                    </td>
                    <td className="px-gutter-table py-2">
                      <AcoesCelula
                        onEditar={() => { setEmEdicao(e); setFormularioAberto(true); }}
                        onDeletar={() => setEmExclusao(e)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {lista.length > 0 && (
          <div className="border-t border-outline-variant bg-surface-container-low p-stack-sm text-body-sm text-on-surface-variant">
            {lista.length} estabelecimento{lista.length === 1 ? "" : "s"}
          </div>
        )}
      </div>

      <FormularioEstabelecimento
        aberto={formularioAberto}
        estabelecimento={emEdicao}
        onFechar={() => setFormularioAberto(false)}
      />

      <ModalConfirmacao
        aberto={!!emExclusao}
        titulo="Remover estabelecimento"
        mensagem={`Deseja remover "${emExclusao?.nome}"?`}
        rotuloBotao="Remover"
        carregando={deletar.isPending}
        onConfirmar={() => emExclusao && deletar.mutate(emExclusao.id)}
        onFechar={() => setEmExclusao(null)}
      />
    </>
  );
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */

function AcoesCelula({ onEditar, onDeletar }: { onEditar: () => void; onDeletar: () => void }) {
  return (
    <div className="flex justify-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
      <button
        className="rounded p-1 text-on-surface-variant hover:bg-surface-container-high hover:text-secondary"
        title="Editar"
        onClick={onEditar}
      >
        <Pencil className="h-4 w-4" />
      </button>
      <button
        className="rounded p-1 text-on-surface-variant hover:bg-error-container hover:text-on-error-container"
        title="Remover"
        onClick={onDeletar}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function FiltroTipo({
  valor,
  onChange,
}: {
  valor: "TODOS" | "RECEITA" | "DESPESA";
  onChange: (v: "TODOS" | "RECEITA" | "DESPESA") => void;
}) {
  return (
    <div className="flex gap-1 rounded-lg bg-surface-container-low p-1">
      {(["TODOS", "RECEITA", "DESPESA"] as const).map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={
            "rounded px-3 py-1 text-body-sm transition-colors " +
            (valor === v
              ? "bg-surface-container-lowest font-semibold text-on-surface shadow-sm"
              : "text-on-surface-variant hover:text-on-surface")
          }
        >
          {v === "TODOS" ? "Todos" : v === "RECEITA" ? "Entradas" : "Saídas"}
        </button>
      ))}
    </div>
  );
}

function EmptyState({ icone: Icone, mensagem }: { icone: React.ElementType; mensagem: string }) {
  return (
    <div className="flex flex-col items-center gap-3 p-stack-lg text-center">
      <Icone className="h-8 w-8 text-on-surface-variant opacity-40" />
      <p className="text-body-sm text-on-surface-variant">{mensagem}</p>
    </div>
  );
}

function formatarCnpj(cnpj: string): string {
  if (cnpj.length !== 14) return cnpj;
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
}
