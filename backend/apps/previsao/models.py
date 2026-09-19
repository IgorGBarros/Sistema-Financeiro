"""
Este app não tem tabelas.

A previsão é derivada: sai do histórico de realizados e da projeção dos
contratos, ambos já persistidos. Guardar o resultado criaria uma terceira
versão da verdade que envelhece sozinha — o mesmo motivo que fez o consolidado
de mercado virar view em vez de tabela.

Se um dia for preciso comparar previsão antiga com o que aconteceu, o modelo a
criar é um registro do que foi previsto **naquele momento**, com data e modelo
usado. Isso é um log de previsões, não um cache.
"""
