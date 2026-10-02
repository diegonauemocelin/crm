// Aplica o tema antes do React carregar, evitando o "piscar" de tela clara no modo escuro.
// Fica em arquivo separado (e não inline) para a CSP poder bloquear qualquer script inline.
;(function () {
  try {
    var t = localStorage.getItem('crm-theme')
    var dark = t === 'DARK' || ((t === null || t === 'SYSTEM') && window.matchMedia('(prefers-color-scheme: dark)').matches)
    if (dark) document.documentElement.classList.add('dark')
  } catch {
    /* sem armazenamento: segue o padrão claro */
  }
})()
