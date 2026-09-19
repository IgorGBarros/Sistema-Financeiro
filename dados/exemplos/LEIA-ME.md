# Documentos de exemplo

PDFs reais, usados pelos testes dos extratores em
`backend/apps/documentos/tests/test_extratores.py`.

| Arquivo | O que é |
|---|---|
| `financiamento_ddc.pdf` | Demonstrativo Descritivo de Crédito, 296 parcelas, SAC |
| `holerite_mensal.pdf` | Folha mensal |
| `holerite_13_adiantado.pdf` | 13º, primeira parcela |
| `holerite_13_integral.pdf` | 13º, segunda parcela |

**Contêm dados pessoais reais** — CPF, salário, saldo devedor. Se o
repositório virar público, tire esta pasta do versionamento e mantenha os
testes com `pytest.mark.skipif`, como já estão.

Faltam exemplos de **fatura de cartão** e **conta de luz**. Os extratores
desses dois foram escritos sem PDF de referência e ainda não têm teste real.
