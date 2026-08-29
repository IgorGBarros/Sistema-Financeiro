/**
 * Testes da fila offline.
 *
 * Esta é a lógica com maior custo de erro no frontend: um bug aqui significa
 * cupom perdido, e o papel já foi para o lixo na saída da loja.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  enfileirar,
  limpar,
  listarPendentes,
  quantidadePendente,
  registrarFalha,
  remover,
  sincronizar,
} from "../fila";

// Cupom real: Redemix Supermercados, Salvador/BA, 28/08/2026.
const CHAVE = "29260806337087001579650110002303451225761309";
const QR =
  "http://nfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx?p=" +
  CHAVE +
  "|2|1|1|E7977D669E2ED9FAFAF6E2F2381A395CA35DC1E4";

// Outra chave válida (dígito verificador recalculado a partir da primeira).
const OUTRA = "29260806337087001579650110002303461225761306";

beforeEach(() => {
  localStorage.clear();
  limpar();
});

describe("enfileirar", () => {
  it("guarda um cupom válido", () => {
    expect(enfileirar(QR, CHAVE)).toBe(true);
    expect(quantidadePendente()).toBe(1);
    expect(listarPendentes()[0].chave).toBe(CHAVE);
  });

  it("recusa chave com dígito verificador errado", () => {
    const invalida = CHAVE.slice(0, 43) + (CHAVE[43] === "0" ? "1" : "0");
    expect(enfileirar(QR, invalida)).toBe(false);
    expect(quantidadePendente()).toBe(0);
  });

  it("não duplica o mesmo cupom", () => {
    // Ler duas vezes o mesmo papel é comum: a câmera dispara em sequência.
    enfileirar(QR, CHAVE);
    enfileirar(QR, CHAVE);
    expect(quantidadePendente()).toBe(1);
  });

  it("guarda o conteúdo original, não só a chave", () => {
    // O parâmetro completo tem o hash assinado, que a SEFAZ aceita sem captcha.
    enfileirar(QR, CHAVE);
    expect(listarPendentes()[0].conteudo).toBe(QR);
  });
});

describe("sincronizar", () => {
  it("envia e remove os cupons enviados", async () => {
    enfileirar(QR, CHAVE);
    const enviar = vi.fn().mockResolvedValue({});

    const resultado = await sincronizar(enviar);

    expect(enviar).toHaveBeenCalledWith(QR);
    expect(resultado).toEqual({ enviados: 1, falharam: 0, restantes: 0 });
    expect(quantidadePendente()).toBe(0);
  });

  it("mantém na fila o que falhou", async () => {
    enfileirar(QR, CHAVE);
    const enviar = vi.fn().mockRejectedValue(new Error("Sem conexão"));

    const resultado = await sincronizar(enviar);

    expect(resultado.falharam).toBe(1);
    expect(quantidadePendente()).toBe(1);
    expect(listarPendentes()[0].tentativas).toBe(1);
    expect(listarPendentes()[0].ultimoErro).toBe("Sem conexão");
  });

  it("envia um por vez, não em paralelo", async () => {
    // Em rede fraca, disparar tudo junto costuma fazer todas expirarem.
    enfileirar(QR, CHAVE);
    enfileirar(QR.replace(CHAVE, OUTRA), OUTRA);

    let simultaneas = 0;
    let pico = 0;
    const enviar = vi.fn(async () => {
      simultaneas += 1;
      pico = Math.max(pico, simultaneas);
      await new Promise((r) => setTimeout(r, 5));
      simultaneas -= 1;
    });

    await sincronizar(enviar);
    expect(pico).toBe(1);
  });

  it("uma falha não impede o envio das demais", async () => {
    enfileirar(QR, CHAVE);
    enfileirar(QR.replace(CHAVE, OUTRA), OUTRA);

    const enviar = vi
      .fn()
      .mockRejectedValueOnce(new Error("falhou"))
      .mockResolvedValueOnce({});

    const resultado = await sincronizar(enviar);

    expect(resultado.enviados).toBe(1);
    expect(resultado.falharam).toBe(1);
    expect(quantidadePendente()).toBe(1);
  });
});

describe("desistência após tentativas repetidas", () => {
  it("descarta o cupom após 5 falhas", () => {
    enfileirar(QR, CHAVE);
    for (let i = 0; i < 4; i += 1) {
      registrarFalha(CHAVE, "erro");
      expect(quantidadePendente()).toBe(1);
    }
    // Insistir para sempre numa chave que a SEFAZ rejeita só faria a fila
    // crescer sem fim.
    registrarFalha(CHAVE, "erro");
    expect(quantidadePendente()).toBe(0);
  });
});

describe("resiliência do armazenamento", () => {
  it("não quebra com storage corrompido", () => {
    localStorage.setItem("cupons_pendentes", "{isso não é json");
    expect(listarPendentes()).toEqual([]);
    expect(() => enfileirar(QR, CHAVE)).not.toThrow();
  });

  it("ignora conteúdo que não é lista", () => {
    localStorage.setItem("cupons_pendentes", '{"a":1}');
    expect(listarPendentes()).toEqual([]);
  });
});

describe("remover", () => {
  it("tira apenas o cupom indicado", () => {
    enfileirar(QR, CHAVE);
    enfileirar(QR.replace(CHAVE, OUTRA), OUTRA);
    remover(CHAVE);
    expect(listarPendentes().map((c) => c.chave)).toEqual([OUTRA]);
  });
});
