import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import { ToastHost } from "@/shared/ui/use-toast";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // Erro de autenticação não melhora tentando de novo.
      retry: (tentativas, erro: unknown) => {
        const status = (erro as { status?: number })?.status;
        if (status === 401 || status === 403 || status === 404) return false;
        return tentativas < 2;
      },
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastHost>
          <App />
        </ToastHost>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
