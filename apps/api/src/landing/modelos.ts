/**
 * Modelos prontos de landing page. Textos só com o que é fato da empresa (desde 1997, importação direta, estoque,
 * suporte técnico, lojas, marcas atendidas); o que depende de dado que o sistema não tem (condição de oferta, prazo,
 * depoimento) fica entre colchetes para alguém preencher. Nada de preço, prazo ou garantia inventados.
 */
import type { Seo, Theme } from './blocos'

export interface LandingTemplate {
  key: string
  name: string
  description: string
  /** Para que serve (filtro na galeria de modelos). */
  goal: 'orcamento' | 'promocao' | 'marca' | 'lancamento' | 'evento' | 'obrigado'
  theme: Partial<Theme>
  seo: Partial<Seo>
  blocks: Record<string, unknown>[]
}

const BRANDS = ['Caterpillar', 'Komatsu', 'Volvo', 'Hyundai', 'JCB', 'John Deere', 'Case', 'New Holland', 'XCMG', 'Liugong', 'Sany', 'Kawasaki', 'Isuzu', 'Yanmar', 'Perkins', 'Cummins'].map((name) => ({ name, image: '' }))
const NUMBERS = { type: 'numeros', background: 'padrao', items: [{ value: '1997', label: 'no mercado desde' }, { value: '16+', label: 'marcas atendidas' }, { value: '4', label: 'lojas no Sul do Brasil' }, { value: 'BR + LATAM', label: 'atendimento no Brasil e América Latina' }] }
const BENEFITS = {
  type: 'beneficios',
  variant: 'cartoes',
  background: 'suave',
  title: 'Por que comprar com a Usaparts',
  subtitle: 'Peças para máquinas da linha amarela com quem trabalha com isso há mais de 25 anos.',
  items: [
    { icon: 'mundo', title: 'Importação direta', text: 'Trazemos as peças direto dos fabricantes e fornecedores, sem intermediários.' },
    { icon: 'estoque', title: 'Amplo estoque', text: 'Peças de motor, material rodante, hidráulico, filtros, vedações e muito mais.' },
    { icon: 'suporte', title: 'Suporte técnico', text: 'Nossa equipe ajuda a identificar a peça certa pelo modelo, série e código.' },
    { icon: 'caminhao', title: 'Todo o Brasil', text: 'Enviamos para todo o Brasil e para a América Latina.' },
  ],
}
const FAQ = {
  type: 'faq',
  background: 'padrao',
  title: 'Perguntas frequentes',
  items: [
    { q: 'Como encontro a peça certa para a minha máquina?', a: 'Informe a marca, o modelo, a série ou o ano da máquina e, se tiver, o código original (OEM) da peça. Nossa equipe confere a aplicação antes do orçamento.' },
    { q: 'Vocês trabalham com peças originais?', a: 'Trabalhamos com peças originais, paralelas e equivalentes. No orçamento informamos qual é cada uma, para você escolher.' },
    { q: 'Atendem fora de Santa Catarina?', a: 'Sim. Atendemos todo o Brasil e a América Latina, com lojas em Maravilha/SC, Itajaí/SC, Cascavel/PR e Cachoeirinha/RS.' },
    { q: 'Qual o prazo de entrega?', a: '[Preencha com a informação do Comercial antes de publicar.]' },
  ],
}
const FORM = (title: string, text: string) => ({
  type: 'formulario',
  variant: 'lado-a-lado',
  background: 'padrao',
  title,
  text,
  bullets: 'Resposta pela equipe comercial\nConferência da aplicação pelo modelo e série\nOrçamento sem compromisso',
  formId: '',
})
const FINAL_CTA = (title: string) => ({ type: 'cta', background: 'destaque', title, text: 'Fale com a nossa equipe e receba o orçamento.', ctaText: 'Pedir orçamento', action: 'formulario', url: '' })

export const TEMPLATES: LandingTemplate[] = [
  {
    key: 'orcamento-pecas',
    name: 'Pedido de orçamento de peças',
    description: 'Para anúncios de busca: chamada direta, confiança (números e marcas) e formulário.',
    goal: 'orcamento',
    theme: { header: 'logo-botao', headerCta: 'Pedir orçamento' },
    seo: { title: 'Peças para máquinas pesadas | Orçamento', description: 'Peças para escavadeiras, retroescavadeiras, pás carregadeiras e tratores. Importação direta e amplo estoque.' },
    blocks: [
      { type: 'hero', variant: 'imagem-direita', eyebrow: 'Importação direta desde 1997', title: 'Peças para máquinas pesadas com quem entende da linha amarela', subtitle: 'Escavadeiras, retroescavadeiras, pás carregadeiras, tratores de esteira, motoniveladoras e rolos. Diga o modelo da máquina e a peça que você precisa.', image: '', ctaText: 'Pedir orçamento', action: 'formulario', note: 'Atendemos todo o Brasil e a América Latina' },
      NUMBERS,
      BENEFITS,
      { type: 'marcas', background: 'padrao', title: 'Marcas que atendemos', items: BRANDS },
      FORM('Peça seu orçamento', 'Conte qual é a máquina (marca, modelo, série ou ano) e a peça. Se tiver o código original, melhor ainda.'),
      FAQ,
      FINAL_CTA('Sua máquina não pode ficar parada'),
    ],
  },
  {
    key: 'material-rodante',
    name: 'Material rodante',
    description: 'Esteiras, roletes, rodas-guia, sapatas e corrente: foco em escavadeiras e tratores de esteira.',
    goal: 'promocao',
    theme: { header: 'logo-botao', headerCta: 'Cotar material rodante' },
    seo: { title: 'Material rodante para escavadeiras e tratores de esteira', description: 'Corrente, roletes, rodas-guia, rodas motrizes e sapatas para as principais marcas.' },
    blocks: [
      { type: 'hero', variant: 'imagem-fundo', eyebrow: 'Material rodante', title: 'Material rodante para escavadeiras e tratores de esteira', subtitle: 'Corrente, roletes superiores e inferiores, rodas-guia, rodas motrizes e sapatas para as principais marcas.', image: '', ctaText: 'Cotar agora', action: 'formulario', note: 'Informe o modelo e a série da máquina' },
      { type: 'beneficios', variant: 'lista', background: 'padrao', title: 'O que você encontra', subtitle: '', items: [{ icon: 'check', title: 'Correntes e sapatas', text: 'Para escavadeiras, miniescavadeiras e tratores de esteira.' }, { icon: 'check', title: 'Roletes', text: 'Superiores e inferiores.' }, { icon: 'check', title: 'Rodas-guia e motrizes', text: 'Conferidas pela aplicação da máquina.' }, { icon: 'check', title: 'Kits completos', text: '[Descreva os kits disponíveis com o Comercial.]' }] },
      { type: 'imagem-texto', variant: 'imagem-esquerda', background: 'suave', title: 'Peça certa na primeira vez', text: 'Material rodante varia muito de um modelo para outro. Nossa equipe confere a aplicação pelo modelo, série e código original antes de fechar o pedido.', image: '', ctaText: 'Falar com um especialista', action: 'whatsapp', url: '' },
      { type: 'marcas', background: 'padrao', title: 'Marcas atendidas', items: BRANDS },
      FORM('Cote o material rodante', 'Informe a máquina e quais itens você precisa trocar.'),
      FAQ,
    ],
  },
  {
    key: 'promocao-filtros',
    name: 'Promoção de filtros',
    description: 'Vitrine de produtos com oferta por prazo (contagem regressiva) e formulário.',
    goal: 'promocao',
    theme: { header: 'logo-botao', headerCta: 'Quero a oferta' },
    seo: { title: 'Filtros para máquinas pesadas', description: 'Filtros de óleo, combustível, ar e hidráulico para as principais marcas da linha amarela.' },
    blocks: [
      { type: 'hero', variant: 'centro', eyebrow: 'Oferta por tempo limitado', title: 'Filtros para a manutenção da sua frota', subtitle: 'Óleo, combustível, ar e hidráulico para escavadeiras, retroescavadeiras, pás carregadeiras e tratores.', image: '', ctaText: 'Ver a oferta', action: 'formulario', note: '' },
      { type: 'oferta', background: 'padrao', title: '[Descreva a condição da oferta]', text: 'Condição válida até a data indicada ou enquanto durar o estoque. [Confirme com o Comercial.]', endsAt: '', ctaText: 'Quero a oferta', action: 'formulario', url: '' },
      { type: 'produtos', background: 'suave', title: 'Filtros em destaque', subtitle: 'Escolha um produto do catálogo ou cadastre manualmente.', items: [{ image: '', name: 'Filtro de óleo', text: '[Aplicação]', price: '', ctaText: 'Quero este', url: '' }, { image: '', name: 'Filtro de combustível', text: '[Aplicação]', price: '', ctaText: 'Quero este', url: '' }, { image: '', name: 'Filtro de ar', text: '[Aplicação]', price: '', ctaText: 'Quero este', url: '' }] },
      FORM('Garanta a sua oferta', 'Informe a máquina e quais filtros você precisa.'),
      FAQ,
    ],
  },
  {
    key: 'pecas-por-marca',
    name: 'Peças por marca de máquina',
    description: 'Uma página por marca (ex.: Caterpillar): bom para anúncios com a marca na busca.',
    goal: 'marca',
    theme: { header: 'logo-botao', headerCta: 'Pedir orçamento' },
    seo: { title: 'Peças para [marca] | Usaparts', description: 'Peças para máquinas [marca]: motor, material rodante, hidráulico, filtros e vedações.' },
    blocks: [
      { type: 'hero', variant: 'imagem-direita', eyebrow: 'Peças para [marca]', title: 'Peças para máquinas [marca]', subtitle: 'Motor, material rodante, hidráulico, filtros, vedações, elétrico e transmissão. Diga o modelo e a peça.', image: '', ctaText: 'Pedir orçamento', action: 'formulario', note: 'Originais, paralelas e equivalentes' },
      { type: 'beneficios', variant: 'cartoes', background: 'suave', title: 'Linhas de peças', subtitle: '', items: [{ icon: 'raio', title: 'Motor', text: 'Peças e reparos para motores.' }, { icon: 'caminhao', title: 'Material rodante', text: 'Correntes, roletes, rodas e sapatas.' }, { icon: 'suporte', title: 'Hidráulico', text: 'Bombas, cilindros, vedações e reparos.' }, { icon: 'estoque', title: 'Filtros', text: 'Óleo, combustível, ar e hidráulico.' }] },
      NUMBERS,
      FORM('Orçamento de peças [marca]', 'Informe o modelo, a série ou o ano da máquina e a peça (com o código original, se tiver).'),
      FAQ,
      FINAL_CTA('Peças [marca] com quem conhece a linha amarela'),
    ],
  },
  {
    key: 'lancamento-linha',
    name: 'Lançamento de linha',
    description: 'Apresentar uma linha nova de produtos: imagem de impacto, galeria e WhatsApp.',
    goal: 'lancamento',
    theme: { header: 'logo', mode: 'escuro' },
    seo: { title: '[Nome da linha] | Usaparts', description: '[Descreva a nova linha.]' },
    blocks: [
      { type: 'hero', variant: 'imagem-fundo', eyebrow: 'Novidade', title: '[Nome da nova linha]', subtitle: '[Descreva em uma frase o que a linha resolve para quem trabalha com máquinas pesadas.]', image: '', ctaText: 'Conhecer a linha', action: 'formulario', note: '' },
      { type: 'imagem-texto', variant: 'imagem-direita', background: 'padrao', title: 'O que muda para você', text: '[Explique os diferenciais com dados confirmados pelo fornecedor.]', image: '', ctaText: '', action: 'formulario', url: '' },
      { type: 'galeria', background: 'suave', title: 'Veja de perto', items: [{ image: '', caption: '' }, { image: '', caption: '' }, { image: '', caption: '' }] },
      { type: 'whatsapp', background: 'padrao', title: 'Tire suas dúvidas com a equipe', text: 'Converse com um especialista pelo WhatsApp.', buttonText: 'Chamar no WhatsApp', mode: 'direto', whatsappId: '' },
      FORM('Quero saber mais', 'Deixe seus dados que a nossa equipe entra em contato.'),
    ],
  },
  {
    key: 'feira-evento',
    name: 'Feira ou evento',
    description: 'Convite para visitar o estande ou participar de um evento, com contagem regressiva.',
    goal: 'evento',
    theme: { header: 'logo-botao', headerCta: 'Confirmar presença' },
    seo: { title: 'Usaparts na [nome do evento]', description: 'Visite o nosso estande na [nome do evento].' },
    blocks: [
      { type: 'hero', variant: 'centro', eyebrow: '[Data e local]', title: 'Encontre a Usaparts na [nome do evento]', subtitle: '[Estande, horários e o que vai ter de especial.]', image: '', ctaText: 'Confirmar presença', action: 'formulario', note: '' },
      { type: 'oferta', background: 'padrao', title: 'Faltam poucos dias', text: '[Detalhes do evento.]', endsAt: '', ctaText: 'Confirmar presença', action: 'formulario', url: '' },
      { type: 'texto', background: 'suave', title: 'Como chegar', text: '[Endereço do evento, estacionamento e horários.]' },
      { ...FORM('Confirme sua presença', 'Deixe seus dados para receber a confirmação e novidades do evento.'), variant: 'cartao', bullets: '' },
    ],
  },
  {
    key: 'obrigado',
    name: 'Página de obrigado',
    description: 'Para onde o formulário leva depois do envio: confirma, dá o próximo passo e mede a conversão.',
    goal: 'obrigado',
    theme: { header: 'logo' },
    seo: { title: 'Recebemos seu contato', noindex: true },
    blocks: [
      { type: 'hero', variant: 'centro', eyebrow: 'Recebemos seu contato', title: 'Obrigado! Em breve nossa equipe fala com você', subtitle: 'Se for urgente, chame agora no WhatsApp.', image: '', ctaText: 'Chamar no WhatsApp', action: 'whatsapp', note: '' },
      { type: 'texto', background: 'suave', title: 'Enquanto isso', text: 'Separe o modelo, a série ou o ano da máquina e, se tiver, o código original da peça. Isso agiliza o orçamento.' },
    ],
  },
  {
    key: 'cotizacion-latam',
    name: 'Cotización (América Latina, em espanhol)',
    description: 'Versão em espanhol do pedido de orçamento, para campanhas na América Latina.',
    goal: 'orcamento',
    theme: { header: 'logo-botao', headerCta: 'Solicitar cotización', whatsappMessage: '¡Hola! Vengo de la página {pagina} y quisiera una cotización.' },
    seo: { title: 'Repuestos para maquinaria pesada | Cotización', description: 'Repuestos para excavadoras, retroexcavadoras, cargadores y tractores. Importación directa.' },
    blocks: [
      { type: 'hero', variant: 'imagem-direita', eyebrow: 'Importación directa desde 1997', title: 'Repuestos para maquinaria pesada', subtitle: 'Excavadoras, retroexcavadoras, cargadores frontales, tractores de oruga y motoniveladoras. Indíquenos el modelo de la máquina y el repuesto.', image: '', ctaText: 'Solicitar cotización', action: 'formulario', note: 'Atendemos Brasil y América Latina' },
      { type: 'beneficios', variant: 'cartoes', background: 'suave', title: '¿Por qué Usaparts?', subtitle: '', items: [{ icon: 'mundo', title: 'Importación directa', text: 'Repuestos directo de fabricantes y proveedores.' }, { icon: 'estoque', title: 'Amplio stock', text: 'Motor, tren de rodaje, hidráulico, filtros y más.' }, { icon: 'suporte', title: 'Soporte técnico', text: 'Le ayudamos a identificar el repuesto correcto.' }, { icon: 'caminhao', title: 'América Latina', text: 'Enviamos a toda América Latina.' }] },
      { type: 'marcas', background: 'padrao', title: 'Marcas que atendemos', items: BRANDS },
      { ...FORM('Solicite su cotización', 'Indique la marca, el modelo y la serie de la máquina y el repuesto que necesita.'), bullets: 'Respuesta del equipo comercial\nVerificación de la aplicación\nCotización sin compromiso' },
      { type: 'cta', background: 'destaque', title: 'Su máquina no puede parar', text: 'Hable con nuestro equipo.', ctaText: 'Solicitar cotización', action: 'formulario', url: '' },
    ],
  },
]
