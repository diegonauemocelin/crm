/** Opção de menu de robô dentro de uma mensagem ("1 Marketing", "2) Conversas", "3 - CRM"). */
export interface MenuOption {
  n: number
  label: string
}

const LINE = /^\s*\*?(\d{1,2})\*?\s*(?:[-.)–:]|️?⃣)?\*?\s+(\S.{0,79}?)\s*$/

/**
 * Opções numeradas de um menu de robô: ao menos duas linhas seguidas começando em 1 (1, 2, 3...). Com mais de um
 * bloco, vale o último (normalmente o menu fica no fim da mensagem).
 */
export function menuOptions(text: string | null | undefined): MenuOption[] {
  if (!text) return []
  let best: MenuOption[] = []
  let cur: MenuOption[] = []
  for (const line of text.split('\n')) {
    const m = LINE.exec(line)
    const n = m ? Number(m[1]) : NaN
    if (m && n === cur.length + 1) cur.push({ n, label: m[2]!.replace(/[*_~]/g, '').trim() })
    else {
      if (cur.length >= 2) best = cur
      cur = m && n === 1 ? [{ n, label: m[2]!.replace(/[*_~]/g, '').trim() }] : []
    }
  }
  if (cur.length >= 2) best = cur
  return best.slice(0, 30)
}

/** Pede para escolher uma opção (menu de robô), e não é só uma lista numerada qualquer. */
export const MENU_HINT = /op[cç](?:[aã]o|[oõ]es)|escolh|digite|clique|selecione|menu|responda com|toque/i

/** Botões de resposta: menu de robô de fornecedor/empresa, ou mensagem que pede para escolher uma opção. */
export function menuFor(text: string | null | undefined, category: string | null | undefined): MenuOption[] {
  const options = menuOptions(text)
  return options.length && (category !== 'CLIENTE' || MENU_HINT.test(text ?? '')) ? options : []
}
