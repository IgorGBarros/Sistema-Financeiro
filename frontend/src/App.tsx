import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { FileText, LayoutDashboard, Receipt } from "lucide-react";

import Contratos from "./pages/Contratos";
import FluxoCaixa from "./pages/FluxoCaixa";
import Notas from "./pages/Notas";
import { cn } from "./lib/utils";

const NAVEGACAO = [
  { para: "/fluxo", rotulo: "Fluxo de caixa", icone: LayoutDashboard },
  { para: "/contratos", rotulo: "Entradas e saídas", icone: FileText },
  { para: "/notas", rotulo: "Cupons fiscais", icone: Receipt },
];

export default function App() {
  return (
    <div className="min-h-screen">
      <nav className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-1 px-4 py-2">
          <span className="mr-4 font-semibold tracking-tight">Financeiro</span>
          {NAVEGACAO.map(({ para, rotulo, icone: Icone }) => (
            <NavLink
              key={para}
              to={para}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )
              }
            >
              <Icone className="h-4 w-4" />
              <span className="hidden sm:inline">{rotulo}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      <main className="mx-auto max-w-6xl">
        <Routes>
          <Route path="/" element={<Navigate to="/fluxo" replace />} />
          <Route path="/fluxo" element={<FluxoCaixa />} />
          <Route path="/contratos" element={<Contratos />} />
          <Route path="/notas" element={<Notas />} />
          <Route
            path="*"
            element={
              <div className="p-12 text-center">
                <p className="text-sm text-muted-foreground">
                  Esta página não existe. Use o menu acima.
                </p>
              </div>
            }
          />
        </Routes>
      </main>
    </div>
  );
}
