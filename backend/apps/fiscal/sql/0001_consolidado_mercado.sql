-- Consolidado mensal da Tabela Mercado.
--
-- Materialized view em vez de tabela: o dado é 100% derivado das notas, então
-- guardar uma cópia gravável só criaria oportunidade de divergência. A view
-- responde "quanto gastei de mercado em cada mês" sem varrer os itens.
--
-- Aplicar via migration com RunSQL. Atualizar com:
--   REFRESH MATERIALIZED VIEW CONCURRENTLY vw_mercado_consolidado;

DROP MATERIALIZED VIEW IF EXISTS vw_mercado_consolidado;

CREATE MATERIALIZED VIEW vw_mercado_consolidado AS
SELECT
    n.workspace_id::text || '|' || to_char(date_trunc('month', n.data_emissao), 'YYYY-MM-DD') AS id,
    n.workspace_id,
    date_trunc('month', n.data_emissao)::date        AS competencia,
    count(*)::int                                    AS quantidade_notas,
    coalesce(sum(n.quantidade_itens), 0)::int        AS quantidade_itens,
    coalesce(sum(n.valor_total), 0)::numeric(14, 2)  AS valor_total,
    round(coalesce(avg(n.valor_total), 0), 2)        AS ticket_medio
FROM fiscal_notafiscal n
WHERE n.status = 'IMPORTADA'
  AND n.data_emissao IS NOT NULL
GROUP BY n.workspace_id, date_trunc('month', n.data_emissao);

-- Índice único é pré-requisito do REFRESH CONCURRENTLY.
CREATE UNIQUE INDEX uq_vw_mercado_consolidado ON vw_mercado_consolidado (id);
CREATE INDEX ix_vw_mercado_ws_comp ON vw_mercado_consolidado (workspace_id, competencia);


-- Visão auxiliar: ranking de produtos por mês. Responde "o que puxou a conta
-- do mercado para cima" a partir dos itens dos cupons.
DROP MATERIALIZED VIEW IF EXISTS vw_mercado_produtos;

CREATE MATERIALIZED VIEW vw_mercado_produtos AS
SELECT
    n.workspace_id::text || '|' ||
        to_char(date_trunc('month', n.data_emissao), 'YYYY-MM') || '|' ||
        coalesce(nullif(i.codigo, ''), md5(i.descricao))  AS id,
    n.workspace_id,
    date_trunc('month', n.data_emissao)::date  AS competencia,
    coalesce(nullif(i.codigo, ''), '')         AS codigo,
    min(i.descricao)                           AS descricao,
    sum(i.quantidade)                          AS quantidade,
    sum(i.valor_total)::numeric(14, 2)         AS valor_total,
    round(avg(i.valor_unitario), 4)            AS preco_medio,
    count(distinct n.id)::int                  AS compras
FROM fiscal_itemnotafiscal i
JOIN fiscal_notafiscal n ON n.id = i.nota_id
WHERE n.status = 'IMPORTADA' AND n.data_emissao IS NOT NULL
GROUP BY
    n.workspace_id,
    date_trunc('month', n.data_emissao),
    coalesce(nullif(i.codigo, ''), md5(i.descricao));

CREATE UNIQUE INDEX uq_vw_mercado_produtos ON vw_mercado_produtos (id);
