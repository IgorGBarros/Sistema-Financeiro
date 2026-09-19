import { useState } from "react";
import { NavLink } from "react-router-dom";
import {
  BookOpen,
  CheckSquare,
  FileText,
  LayoutDashboard,
  Menu,
  Receipt,
  Search,
  Sparkles,
  Wallet,
  X,
} from "lucide-react";

import { BarraStatus } from "@/shared/components/BarraStatus";
import { cn } from "@/shared/lib/utils";

const NAVEGACAO = [
  { para: "/fluxo", rotulo: "Fluxo de caixa", icone: LayoutDashboard },
  { para: "/contratos", rotulo: "Contratos", icone: FileText },
  { para: "/realizados", rotulo: "Realizados", icone: CheckSquare },
  { para: "/notas", rotulo: "Notas fiscais", icone: Receipt },
  { para: "/catalogo", rotulo: "Catálogo", icone: BookOpen },
  { para: "/assistente", rotulo: "Assistente", icone: Sparkles },
];

/**
 * Ícones: Lucide, não Material Symbols como no mockup.
 *
 * O Material Symbols só existe como webfont do Google Fonts, e uma requisição
 * externa quebraria offline — justamente onde o app precisa funcionar. O Lucide
 * já é dependência, vem como SVG e some do bundle o que não é usado.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [menuAberto, setMenuAberto] = useState(false);

  return (
    <div className="flex min-h-screen">
      {/* Fundo escurecido do menu no celular */}
      {menuAberto && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setMenuAberto(false)}
          aria-hidden
        />
      )}

      <nav
        className={cn(
          "fixed left-0 top-0 z-50 flex h-screen w-[260px] flex-col border-r border-outline-variant bg-surface p-container-padding transition-transform md:translate-x-0",
          menuAberto ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="mb-stack-lg flex items-center gap-stack-sm">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-container">
            <Wallet className="h-5 w-5 text-on-primary-container" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-headline-sm font-semibold leading-tight text-on-surface">
              Financeiro
            </p>
            <p className="text-body-sm text-on-surface-variant">Controle pessoal</p>
          </div>
          <button
            className="ml-auto text-on-surface-variant md:hidden"
            onClick={() => setMenuAberto(false)}
            aria-label="Fechar menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <ul className="flex flex-1 flex-col gap-unit">
          {NAVEGACAO.map(({ para, rotulo, icone: Icone }) => (
            <li key={para}>
              <NavLink
                to={para}
                onClick={() => setMenuAberto(false)}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-stack-md rounded-lg px-stack-md py-stack-sm transition-colors",
                    isActive
                      ? "bg-secondary-container font-semibold text-on-secondary-container"
                      : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface",
                  )
                }
              >
                <Icone className="h-5 w-5 shrink-0" />
                <span className="text-body-md">{rotulo}</span>
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="mt-auto border-t border-outline-variant pt-stack-md">
          <div className="flex items-center gap-stack-sm rounded-lg px-stack-sm py-stack-sm">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-container-high text-body-sm font-semibold text-on-surface">
              IG
            </div>
            <div className="min-w-0">
              <p className="truncate text-body-md font-semibold text-on-surface">
                Minhas finanças
              </p>
              <p className="truncate text-body-sm text-on-surface-variant">
                Workspace pessoal
              </p>
            </div>
          </div>
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col md:ml-[260px]">
        <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-outline-variant bg-surface-container-lowest px-container-padding">
          <div className="flex flex-1 items-center gap-stack-md">
            <button
              className="rounded p-unit text-on-surface hover:bg-surface-container-high md:hidden"
              onClick={() => setMenuAberto(true)}
              aria-label="Abrir menu"
            >
              <Menu className="h-5 w-5" />
            </button>

            {/* A busca ainda não filtra nada; fica desabilitada em vez de
                aceitar texto e não responder. */}
            <div className="relative ml-stack-lg hidden w-full max-w-md md:block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant" />
              <input
                disabled
                className="w-full cursor-not-allowed rounded-lg border border-outline-variant bg-surface-container-low py-2 pl-10 pr-4 text-body-sm text-on-surface placeholder:text-on-surface-variant"
                placeholder="Busca global — em breve"
              />
            </div>
          </div>
        </header>

        <BarraStatus />

        <main className="flex-1 overflow-x-hidden">{children}</main>
      </div>
    </div>
  );
}
