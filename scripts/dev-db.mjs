// PostgreSQL local para desenvolvimento sem Docker (npm run dev:db). Em produção o banco roda no container.
import EmbeddedPostgres from 'embedded-postgres'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const dataDir = resolve(import.meta.dirname, '../apps/api/.devdb')
const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'crm',
  password: 'crm_dev_local',
  port: 54329,
  persistent: true,
  // No Windows o padrão seria WIN1252, que não aceita emojis vindos de WhatsApp/planilhas. Produção usa UTF-8.
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
})

if (!existsSync(dataDir)) {
  await pg.initialise()
  await pg.start()
  await pg.createDatabase('crm')
} else {
  await pg.start()
}
console.log('PostgreSQL de desenvolvimento em postgresql://crm:crm_dev_local@localhost:54329/crm (Ctrl+C para parar)')

const stop = async () => {
  await pg.stop()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
setInterval(() => {}, 1 << 30)
