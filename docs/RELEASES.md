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

4. Faça o commit e crie a tag:

   ```bash
   git commit -am "release: v0.2.0" && git tag v0.2.0 && git push && git push --tags
   ```

5. O GitHub Actions confere a versão e publica a Release com as notas. A partir daí, o rodapé do sistema instalado mostra **"Nova versão disponível"** para quem estiver na versão anterior (se `GITHUB_REPO` estiver configurado no `.env`).

6. Na VPS:

   ```bash
   cd /opt/usaparts-crm && sudo bash deploy/deploy.sh
   ```

Cada servidor registra quando instalou cada versão (exibido na tela Atualizações), independentemente da data de publicação.
