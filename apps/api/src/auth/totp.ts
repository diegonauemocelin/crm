import { generateSecret, generateURI, verify } from 'otplib'
import * as QRCode from 'qrcode'

export function newTotpSecret() {
  return generateSecret()
}

export async function totpQrCode(secret: string, issuer: string, label: string) {
  const uri = generateURI({ issuer, label, secret })
  return { uri, qrDataUrl: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) }
}

/**
 * Tolerância de relógio: até 90 s (3 períodos) de diferença entre o celular e o servidor.
 * Com 1 período, uma pequena diferença de horário fazia códigos certos serem recusados.
 * Continua seguro: 7 códigos válidos entre 1 milhão, bloqueio após 5 erros e sem reuso de código.
 */
export const TOTP_TOLERANCE_S = 90

/**
 * Valida o código. `lastStep` impede que um código já usado seja aceito de novo (replay).
 * `driftSeconds`: quanto o celular está adiantado (+) ou atrasado (-) em relação ao servidor.
 */
export async function checkTotp(secret: string, token: string, lastStep: number | null): Promise<{ step: number; driftSeconds: number } | null> {
  if (!/^\d{6}$/.test(token)) return null
  const result = await verify({
    secret,
    token,
    epochTolerance: TOTP_TOLERANCE_S,
    ...(lastStep !== null ? { afterTimeStep: lastStep } : {}),
  })
  // O verify funcional também cobre HOTP; no modo TOTP (padrão) o resultado traz o timeStep.
  if (!result.valid || !('timeStep' in result)) return null
  return { step: result.timeStep, driftSeconds: (result.delta ?? 0) * 30 }
}
