import * as React from "react";

import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "./toast";

interface Aviso {
  id: number;
  title: string;
  description?: string;
  variant?: "default" | "destructive";
}

interface ContextoToast {
  toast: (aviso: Omit<Aviso, "id">) => void;
}

const Contexto = React.createContext<ContextoToast | null>(null);

export function ToastHost({ children }: { children: React.ReactNode }) {
  const [avisos, setAvisos] = React.useState<Aviso[]>([]);
  const proximoId = React.useRef(0);

  const toast = React.useCallback((aviso: Omit<Aviso, "id">) => {
    const id = (proximoId.current += 1);
    setAvisos((atuais) => [...atuais, { ...aviso, id }]);
  }, []);

  const remover = React.useCallback((id: number) => {
    setAvisos((atuais) => atuais.filter((a) => a.id !== id));
  }, []);

  return (
    <Contexto.Provider value={{ toast }}>
      <ToastProvider duration={6000}>
        {children}
        {avisos.map((aviso) => (
          <Toast
            key={aviso.id}
            variant={aviso.variant}
            onOpenChange={(aberto) => !aberto && remover(aviso.id)}
          >
            <div className="grid gap-1">
              <ToastTitle>{aviso.title}</ToastTitle>
              {aviso.description && <ToastDescription>{aviso.description}</ToastDescription>}
            </div>
            <ToastClose />
          </Toast>
        ))}
        <ToastViewport />
      </ToastProvider>
    </Contexto.Provider>
  );
}

export function useToast(): ContextoToast {
  const contexto = React.useContext(Contexto);
  if (!contexto) throw new Error("useToast precisa estar dentro de <ToastHost>.");
  return contexto;
}
