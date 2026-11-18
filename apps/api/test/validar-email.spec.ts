import { describe, expect, it } from 'vitest'
import { checkEmailText, dnsMeaning, domainReason } from '../src/email/validar'

describe('validação de e-mail (sem internet)', () => {
  it('aceita e-mails normais', () => {
    expect(checkEmailText('Joao.Silva@Empresa.com.br')).toEqual({ ok: true, domain: 'empresa.com.br' })
    expect(checkEmailText('compras+pecas@usaparts.com.br').ok).toBe(true)
  })
  it('recusa formato errado', () => {
    for (const e of ['', 'joao', 'joao@', '@gmail.com', 'joao@gmail', 'jo ao@gmail.com', 'joao..silva@gmail.com', 'joao@@gmail.com', 'joao@gmail..com', '.joao@gmail.com'])
      expect(checkEmailText(e).ok, e).toBe(false)
  })
  it('aponta erro de digitação dos domínios grandes', () => {
    expect(checkEmailText('maria@gmial.com')).toMatchObject({ ok: false, suggestion: 'maria@gmail.com' })
    expect(checkEmailText('maria@hotmial.com')).toMatchObject({ ok: false, suggestion: 'maria@hotmail.com' })
    expect(checkEmailText('maria@gmail.com.br')).toMatchObject({ ok: false, suggestion: 'maria@gmail.com' })
  })
  it('recusa e-mail de mentira', () => {
    expect(checkEmailText('teste@teste.com').ok).toBe(false)
    expect(checkEmailText('naotem@gmail.com').ok).toBe(false)
    expect(checkEmailText('xxx@xxx.com').ok).toBe(false)
    expect(checkEmailText('teste.pecas@empresa.com.br').ok).toBe(true)
  })
  it('respostas do DNS', () => {
    expect(dnsMeaning('ENOTFOUND')).toBe('NAO_EXISTE')
    expect(dnsMeaning('ENODATA')).toBe('SEM_REGISTRO')
    expect(dnsMeaning('ETIMEOUT')).toBe('INCERTO')
    expect(domainReason('NAO_EXISTE', 'gmal.com.br')).toBe('O domínio gmal.com.br não existe.')
  })
})
