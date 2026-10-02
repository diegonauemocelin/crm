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
 * Valida o código aceitando 1 período de tolerância (30 s) para relógio adiantado/atrasado.
 * `lastStep` impede que um código já usado seja aceito de novo (replay).
 */
export async function checkTotp(secret: string, token: string, lastStep: number | null): Promise<number | null> {
  if (!/^\d{6}$/.test(token)) return null
  const result = await verify({
    secret,
    token,
    epochTolerance: 30,
    ...(lastStep !== null ? { afterTimeStep: lastStep } : {}),
  })
  // O verify funcional também cobre HOTP; no modo TOTP (padrão) o resultado traz o timeStep.
  return result.valid && 'timeStep' in result ? result.timeStep : null
}
