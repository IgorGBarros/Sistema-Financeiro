/** Converte array de objetos em CSV e dispara o download no navegador. */
export function exportarCsv(nomeArquivo: string, linhas: Record<string, unknown>[]) {
  if (linhas.length === 0) return;
  const cabecalho = Object.keys(linhas[0]);
  const escapar = (v: unknown) => {
    const s = String(v ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const conteudo = [
    cabecalho.join(","),
    ...linhas.map((l) => cabecalho.map((c) => escapar(l[c])).join(",")),
  ].join("\n");

  const blob = new Blob(["﻿" + conteudo], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${nomeArquivo}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
