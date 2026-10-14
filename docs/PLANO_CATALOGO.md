# Plano: melhoria do catálogo da loja virtual (item 14 do roteiro)

Objetivo: produtos mais fáceis de achar no Google e na busca da loja, e páginas que convencem a comprar.
Os campos tratados são título, descrição, título e descrição de SEO e palavras-chave.
A melhoria é feita por IA ou à mão, sempre aprovada por uma pessoa, e enviada de volta para a Magazord.

## O que já temos a favor

- **Dados técnicos da Tcar** (v0.34): código de fábrica, códigos de referência (REF/IMP), marca, aplicação e,
  quando a Tcar enviar, o "utilizado em". **Os códigos são ouro para SEO**, porque o mecânico pesquisa
  "RE539465" ou "filtro racor 3CX", e não "filtro de combustível".
- **O que os clientes procuram** (v0.25): produtos mais vistos, procurados sem estoque e os que vão ao carrinho e
  não vendem. Com isso dá para começar pelo que traz mais resultado, não pelo catálogo inteiro.
- **IA do e-mail** (v0.23/v0.27.1): o Gemini já está ligado, com escolha automática do modelo.

## API da Magazord (levantado em 15/10/2026)

Mesmo endereço e mesmo usuário WebService da integração atual (confirmado pelo usuário). Fonte:
[docs.api.magazord.com.br](https://docs.api.magazord.com.br/api/patch-produto/).

- **Ler:** `GET /v2/site/produto/:codigoProduto`, pelo código (SKU) do **produto pai**. A documentação não detalha os campos da
  resposta: conferir com um produto real antes de programar.
- **Alterar só alguns campos:** `PATCH /v2/site/produto/:codigoProduto`, com:
  - `nome` (até 100 caracteres);
  - `palavraChave` (palavras-chave de busca, até 1500 caracteres);
  - `produtoLoja: [{ loja, titulo, tituloComplemento, descricao, descricaoResumida }]` (por loja; `loja` = id da loja,
    o mesmo `storeId` da integração).
- **Título e descrição de SEO** (meta title e meta description): não aparecem como campos próprios na API. Provavelmente a
  loja usa `titulo` e `descricaoResumida`. Confirmar com a Magazord ou num produto real.
- Atenção: o código do catálogo copiado hoje (`/v2/site/frontend/produto`) pode ser o da derivação. Confirmar qual código
  o `PATCH` espera (o do produto pai).

## O que falta (precisa de você ou da Magazord)

1. **Confirmar os campos** da leitura (`GET /v2/site/produto/:codigo`) com um produto real, e se há campos de SEO à parte.
2. **Permissão de escrita** no usuário WebService para alterar produtos (o usuário é o mesmo da integração).
3. **Google Search Console** da loja (opcional, recomendado): para medir antes e depois (impressões, cliques e
   posição por produto).
4. **Decisão sobre a IA:** gratuita ou paga (veja "Custos").

## Fases

### Fase 1: diagnóstico (não altera nada na loja)

Tela **Catálogo → Saúde do catálogo**, com uma nota de 0 a 100 por produto e o que falta:

| Regra | Por quê |
|---|---|
| Título sem marca ou sem o código de fábrica | O cliente pesquisa pelo código |
| Título genérico, curto ou só em MAIÚSCULAS | Pouco clique no Google |
| Sem descrição ou descrição curta (< 300 caracteres) | O Google não entende a página |
| Título de SEO ausente ou com mais de 60 caracteres | É cortado no Google |
| Descrição de SEO ausente ou com mais de 160 caracteres | É cortada no Google |
| Sem imagem ou com uma imagem só | Menos conversão |
| Título ou descrição repetidos em vários produtos | Conteúdo duplicado |
| Sem aplicação ou "utilizado em" | O cliente não sabe se serve na máquina dele |

Ordem da fila: os **mais vistos**, depois os **procurados sem estoque** e os **mais colocados no carrinho**,
com peso para a nota mais baixa. O diagnóstico depende de a Magazord devolver a descrição e os campos de SEO
(item 1 de "O que falta").

### Fase 2: sugestões (IA ou à mão), com aprovação

Para cada produto, o CRM monta a sugestão **só com fatos** da Tcar e da Magazord: marca, códigos, aplicação,
"utilizado em", unidade e grupo.

- **Título:** `{Peça} {Marca} {Código de fábrica} – {Aplicação / máquina}` (ex.:
  "Filtro de Combustível Racor RE539465 – Retroescavadeira JCB 3CX").
- **Descrição:** o que é, onde serve, códigos equivalentes (referências), cuidados de instalação genéricos e
  chamada para o WhatsApp. **Nunca inventa** medidas, garantia, prazo ou compatibilidade que não esteja nos dados.
- **Título de SEO** (até 60) e **descrição de SEO** (até 160): com a marca e o código principal.
- **Palavras-chave:** códigos de fábrica e referência, marca e máquinas.

Fluxo: fila → sugestão → a pessoa **edita, aprova ou descarta**. Ver o antes e o depois lado a lado.
Ações em lote só para quem tem permissão.

### Fase 3: envio para a Magazord

- Envio **produto por produto**, com ritmo controlado (para não sobrecarregar a loja).
- Antes de enviar, o CRM **guarda o texto antigo**: é possível desfazer.
- **Não muda o endereço (URL/slug)** dos produtos, para não perder a posição no Google.
- Tudo na auditoria: quem aprovou e quando foi enviado.

### Fase 4: medição

Antes e depois de cada produto alterado, por 30 a 60 dias:

- visualizações na loja (rastreamento do CRM);
- carrinhos e vendas;
- impressões e cliques no Google, se houver Search Console.

O painel mostra o ganho por lote alterado.

## Custos e limites

- **Gemini gratuito:** limite de pedidos por minuto e por dia. Funciona para lotes de algumas dezenas por dia.
  No plano gratuito, o Google pode usar os textos para treinar os modelos; aqui são dados de produto, não de
  clientes.
- **Gemini pago:** custo baixo por produto e sem esse limite prático. Recomendado se o catálogo for grande e
  quisermos tratar tudo em poucas semanas.
- **À mão:** a mesma tela, sem IA, só com o modelo de título e as regras de SEO.

## Riscos e cuidados

- A IA pode errar: **toda sugestão passa por uma pessoa** e só usa os dados reais.
- Trocar o título de muitos produtos de uma vez pode oscilar a posição no Google por algumas semanas:
  fazer por lotes e medir.
- Conteúdo duplicado (mesmo texto em peças parecidas) atrapalha o SEO: a fase 1 aponta e a fase 2 evita.

## Ordem sugerida

1. Conseguir a documentação e a permissão de escrita da Magazord (sem isso, só a parte do CRM avança).
2. Fase 1 (diagnóstico) e fase 2 (sugestões, já com os dados da Tcar), testadas com 20 produtos mais vistos.
3. Fase 3 (envio) nesses 20, e medir por 30 dias.
4. Ampliar em lotes semanais.
