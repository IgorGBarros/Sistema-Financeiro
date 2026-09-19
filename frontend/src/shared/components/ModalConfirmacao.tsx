import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/ui/dialog";

interface Props {
  aberto: boolean;
  titulo: string;
  mensagem: string;
  rotuloBotao?: string;
  carregando?: boolean;
  onConfirmar: () => void;
  onFechar: () => void;
}

export function ModalConfirmacao({
  aberto,
  titulo,
  mensagem,
  rotuloBotao = "Confirmar",
  carregando = false,
  onConfirmar,
  onFechar,
}: Props) {
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
        </DialogHeader>
        <p className="text-body-md text-on-surface-variant">{mensagem}</p>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onFechar} disabled={carregando}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={onConfirmar} disabled={carregando}>
            {carregando ? "Aguarde…" : rotuloBotao}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
