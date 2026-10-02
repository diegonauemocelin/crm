import { defineConfig } from 'vitest/config'

export default defineConfig({
  // O oxc (transformador do Vite 8) compila os decorators legados do NestJS a partir do tsconfig.
  test: {
    include: ['test/**/*.spec.ts'],
    environment: 'node',
    env: {
      JWT_ACCESS_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres!!',
      APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      APP_URL: 'https://crm.exemplo.com.br',
      DATABASE_URL: 'postgresql://teste:teste@localhost:1/teste',
    },
  },
})
