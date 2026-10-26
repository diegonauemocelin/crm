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
export function menuOptions(text: string | null | undefined, min = 2): MenuOption[] {
  if (!text) return []
  let best: MenuOption[] = []
  let cur: MenuOption[] = []
  for (const line of text.split('\n')) {
    const m = LINE.exec(line)
    const n = m ? Number(m[1]) : NaN
    if (m && n === cur.length + 1) cur.push({ n, label: m[2]!.replace(/[*_~]/g, '').trim() })
    else {
      if (cur.length >= min) best = cur
      cur = m && n === 1 ? [{ n, label: m[2]!.replace(/[*_~]/g, '').trim() }] : []
    }
  }
  if (cur.length >= min) best = cur
  return best.slice(0, 30)
}

/** Pede para escolher uma opção (menu de robô), e não é só uma lista numerada qualquer. */
export const MENU_HINT = /op[cç](?:[aã]o|[oõ]es)|escolh|digite|clique|selecione|menu|responda com|toque/i

/** Botões de resposta: menu de robô de fornecedor/empresa, ou mensagem que pede para escolher uma opção. */
export function menuFor(text: string | null | undefined, category: string | null | undefined): MenuOption[] {
  const options = menuOptions(text).length ? menuOptions(text) : singleOption(text)
  return options.length && (category !== 'CLIENTE' || MENU_HINT.test(text ?? '')) ? options : []
}

/**
 * Botão único de robô ("Você pode conversar com alguém agora?" / "1 Sim, conversar agora"): vale só como a última linha,
 * depois do texto (seguida, no máximo, dos botões que só funcionam no celular, marcados com ▸).
 */
function singleOption(text: string | null | undefined): MenuOption[] {
  const lines = (text ?? '').split('\n').filter((l) => l.trim() && !l.startsWith('▸ '))
  if (lines.length < 2) return []
  const m = LINE.exec(lines[lines.length - 1]!)
  return m && m[1] === '1' && !LINE.test(lines[lines.length - 2]!) ? [{ n: 1, label: m[2]!.replace(/[*_~]/g, '').trim() }] : []
}
