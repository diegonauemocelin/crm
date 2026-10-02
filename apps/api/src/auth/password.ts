import * as argon2 from 'argon2'

// Parâmetros recomendados pela OWASP para Argon2id (19 MiB, 2 iterações) com folga.
const ARGON_OPTIONS = { type: argon2.argon2id, memoryCost: 19_456 * 2, timeCost: 3, parallelism: 1 } as const

export function hashPassword(plain: string) {
  return argon2.hash(plain, ARGON_OPTIONS)
}

export function verifyPassword(hash: string, plain: string) {
  return argon2.verify(hash, plain).catch(() => false)
}

export function needsRehash(hash: string) {
  return argon2.needsRehash(hash, ARGON_OPTIONS)
}

// Hash fixo usado quando o e-mail não existe, para o tempo de resposta não revelar se a conta existe.
let dummyHash: Promise<string> | null = null
export function dummyVerify(plain: string) {
  dummyHash ??= hashPassword('senha-inexistente-para-equalizar-tempo')
  return dummyHash.then((h) => verifyPassword(h, plain))
}

const COMMON = ['123456789012', 'senha1234567', 'password1234', 'qwertyuiop12', 'usaparts1234', 'administrador']

/** Política de senha (ASVS 2.1): mínimo de 12 caracteres, sem limite de composição, bloqueando senhas óbvias. */
export function passwordProblems(password: string, email?: string): string | null {
  if (password.length < 12) return 'A senha precisa ter pelo menos 12 caracteres.'
  if (password.length > 128) return 'A senha pode ter no máximo 128 caracteres.'
  const lower = password.toLowerCase()
  if (COMMON.some((c) => lower.includes(c))) return 'Essa senha é muito comum. Escolha outra.'
  const local = email?.split('@')[0]?.toLowerCase()
  if (local && local.length >= 4 && lower.includes(local)) return 'A senha não pode conter seu e-mail.'
  if (/^(.)\1+$/.test(password)) return 'A senha não pode ser um caractere repetido.'
  return null
}
