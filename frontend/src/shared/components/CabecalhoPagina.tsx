export function CabecalhoPagina({
  titulo,
  descricao,
  acoes,
}: {
  titulo: string;
  descricao: string;
  acoes?: React.ReactNode;
}) {
  return (
    <div className="mb-stack-lg flex flex-col justify-between gap-stack-md md:flex-row md:items-end">
      <div>
        <h1 className="text-display-lg text-on-surface">{titulo}</h1>
        <p className="mt-unit text-body-lg text-on-surface-variant">{descricao}</p>
      </div>
      {acoes && <div className="flex shrink-0 items-center gap-stack-sm">{acoes}</div>}
    </div>
  );
}
