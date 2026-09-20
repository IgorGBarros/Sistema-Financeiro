import { Navigate, Route, Routes } from "react-router-dom";

import Aderencia from "@/features/relatorios/Aderencia";
import EvolucaoCategoria from "@/features/relatorios/EvolucaoCategoria";
import Metas from "@/features/relatorios/Metas";
import DetalheContrato from "@/features/contratos/DetalheContrato";
import Assistente from "@/features/assistente/Assistente";
import Cartoes from "@/features/cartoes/Cartoes";
import Fatura from "@/features/cartoes/Fatura";
import Contas from "@/features/contas/Contas";
import Contratos from "@/features/contratos/Contratos";
import Documentos from "@/features/documentos/Documentos";
import PlanoDeContas from "@/features/catalogo/PlanoDeContas";
import Catalogo from "@/features/catalogo/Catalogo";
import Realizados from "@/features/realizados/Realizados";
import Financiamento from "@/features/financiamento/Financiamento";
import Notas from "@/features/fiscal/Notas";
import Previsao from "@/features/previsao/Previsao";
import FluxoCaixa from "@/features/fluxo/FluxoCaixa";
import Folha from "@/features/folha/Folha";
import { AppShell } from "@/shared/components/AppShell";

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/fluxo" replace />} />
        <Route path="/fluxo" element={<FluxoCaixa />} />
        <Route path="/previsao" element={<Previsao />} />
        <Route path="/contratos" element={<Contratos />} />
        <Route path="/cartoes" element={<Cartoes />} />
        <Route path="/faturas/:id" element={<Fatura />} />
        <Route path="/lancamentos" element={<Realizados />} />
        <Route path="/notas" element={<Notas />} />
        <Route path="/documentos" element={<Documentos />} />
        <Route path="/plano-de-contas" element={<PlanoDeContas />} />
        <Route path="/catalogo" element={<Catalogo />} />
        <Route path="/financiamento" element={<Financiamento />} />
        <Route path="/folha" element={<Folha />} />
        <Route path="/contas" element={<Contas />} />
        <Route path="/aderencia" element={<Aderencia />} />
        <Route path="/metas" element={<Metas />} />
        <Route path="/evolucao-categoria" element={<EvolucaoCategoria />} />
        <Route path="/contratos/:id" element={<DetalheContrato />} />
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
