import { Navigate, Route, Routes } from "react-router-dom";

import Assistente from "@/features/assistente/Assistente";
import Contratos from "@/features/contratos/Contratos";
import FluxoCaixa from "@/features/fluxo/FluxoCaixa";
import Notas from "@/features/fiscal/Notas";
import { AppShell } from "@/shared/components/AppShell";

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/fluxo" replace />} />
        <Route path="/fluxo" element={<FluxoCaixa />} />
        <Route path="/contratos" element={<Contratos />} />
        <Route path="/notas" element={<Notas />} />
        <Route path="/assistente" element={<Assistente />} />
        <Route
          path="*"
          element={
            <div className="p-container-padding text-center">
              <p className="text-body-md text-on-surface-variant">
                Esta página não existe. Use o menu ao lado.
              </p>
            </div>
          }
        />
      </Routes>
    </AppShell>
  );
}
