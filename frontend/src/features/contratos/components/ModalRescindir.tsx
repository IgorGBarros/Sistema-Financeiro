import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api, type Contrato } from "@/shared/lib/api";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { useToast } from "@/shared/ui/use-toast";

interface Props {
  aberto: boolean;
  contrato: Contrato | null;
  onFechar: () => void;
}

export function ModalRescindir({ aberto, contrato, onFechar }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dataRescisao, setDataRescisao] = useState("");

  const rescindir = useMutation({
    mutationFn: () => api.rescindirContrato(contrato!.id, dataRescisao),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contratos"] });
      queryClient.invalidateQueries({ queryKey: ["fluxo-caixa"] });
      toast({ title: "Contrato rescindido", description: "As parcelas futuras foram canceladas." });
      onFechar();
    },
    onError: (e: Error) => {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    },
  });

  function handleFechar() {
    setDataRescisao("");
    onFechar();
  }

  if (!contrato) return null;

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && handleFechar()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Rescindir contrato</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-body-md text-on-surface-variant">
            Você está rescindindo{" "}
            <span className="font-semibold text-on-surface">{contrato.descricao}</span>. As
            parcelas previstas após a data de rescisão serão removidas.
          </p>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-on-surface">Data de rescisão</label>
            <Input
              type="date"
              value={dataRescisao}
              onChange={(e) => setDataRescisao(e.target.value)}
              max={contrato.data_fim}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={handleFechar} disabled={rescindir.isPending}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={() => rescindir.mutate()}
            disabled={!dataRescisao || rescindir.isPending}
          >
            {rescindir.isPending ? "Rescindindo…" : "Rescindir"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
