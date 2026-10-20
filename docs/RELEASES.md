# Como publicar uma versão

A versão do sistema tem **uma única fonte**: o arquivo [`releases.json`](../releases.json). Dele saem:

- a versão no rodapé de todas as telas;
- a tela **Atualizações**, com o histórico detalhado;
- a checagem de saúde do deploy (o deploy só é dado como concluído se a API responder na versão esperada);
- as notas da Release no GitHub.

## Passo a passo

1. Adicione a nova versão **no topo** de `releases.json`, seguindo [SemVer](https://semver.org/lang/pt-BR/):
   - `0.X.0` a cada fase entregue; `0.X.Y` para correções;
   - `1.0.0` ao concluir a Fase 8.

   ```json
   {
     "version": "0.2.0",
     "date": "2026-10-20",
     "title": "Fase 2 — Pré-Vendas e Pós-Vendas",
     "changes": [
       { "type": "novo", "area": "Pré-Vendas", "text": "Descrição clara, do ponto de vista de quem usa." }
     ]
   }
   ```

   Tipos aceitos: `novo`, `melhoria`, `correcao`, `seguranca`, `infra`. O campo `area` agrupa os itens na tela.

2. Atualize o campo `version` em `package.json`, `apps/api/package.json` e `apps/web/package.json`.

3. Confira:

   ```bash
   npm run release:check
   ```

4. Faça o commit e crie a tag **no commit da versão** (no PowerShell, um comando por vez; `&&` não funciona):

   ```bash
   git commit -am "release: v0.2.0"
   git push
   git tag v0.2.0 <commit>
   git push origin v0.2.0
   ```

   A Action "Publicar versão" confere se a tag bate com o `releases.json` do commit: tag no commit errado falha em
   "Conferir versão" e o deploy não acha as imagens. Para corrigir: `git tag -d v0.2.0`, `git push origin :refs/tags/v0.2.0`
   e crie de novo no commit certo.

5. O GitHub Actions confere a versão e publica a Release com as notas. A partir daí, o rodapé do sistema instalado mostra **"Nova versão disponível"** para quem estiver na versão anterior (se `GITHUB_REPO` estiver configurado no `.env`).

6. Na VPS:

   ```bash
   cd /opt/usaparts-crm && sudo bash deploy/deploy.sh
   ```

Cada servidor registra quando instalou cada versão (exibido na tela Atualizações), independentemente da data de publicação.

## Conferir se todas as versões estão no GitHub

O código de todas as versões fica na `main`; a tag `vX.Y.Z` marca onde cada versão termina e a Release guarda as
notas. Quando várias versões são entregues juntas e só a última é publicada, as do meio ficam sem tag. Para conferir
e completar:

1. Na pasta do projeto: `node scripts/versoes.mjs`. Ele lista as versões do `releases.json` sem tag no GitHub e
   mostra os comandos para criar cada tag no último commit da `main` com aquela versão, e um único `git push` com todas.
2. Rode os comandos **na ordem**. Envie todas as tags no mesmo `git push`: com mais de 3 tags de uma vez o GitHub não
   dispara a "Publicar versão" (não gera imagens de versões antigas, que não vão para a VPS).
3. No GitHub, **Actions › Documentar versões antigas › Run workflow**: cria a Release (só as notas, tiradas do
   `releases.json`) de toda versão com tag e sem Release. A versão mais nova continua sendo a "Latest".

Uma tag de versão antiga enviada sozinha roda a "Publicar versão" daquele commit (a versão antiga do arquivo) e gera
as imagens dela. Não quebra a VPS, porque o deploy usa sempre a versão exata (`CRM_VERSION`) e, sem argumento,
instala a maior tag. A partir da 0.69.0, a "Publicar versão" só marca como `latest` (imagem e Release) a maior versão.

As notas de qualquer versão: `node scripts/notas-versao.mjs v0.2.0`.
