/**
 * Trilha de conhecimento: para cada tela, para que serve e o passo a passo ("o que fazer e como fazer").
 * Cada módulo segue a permissão do perfil (só aparece o que a pessoa usa). O progresso fica no servidor por usuário.
 * Ao mudar uma tela, atualize aqui a lição correspondente (o id da lição não deve mudar: guarda o progresso).
 */

export interface Lesson {
  id: string
  title: string
  steps: string[]
  tip?: string
}

export interface TrailModule {
  key: string
  title: string
  /** Permissão necessária (módulo do perfil). Sem módulo: todos veem. */
  module?: string
  /** Telas em que a ajuda "?" mostra este módulo (começo do endereço). */
  routes: string[]
  /** Para que serve, em uma frase. */
  purpose: string
  lessons: Lesson[]
}

export const TRAIL: TrailModule[] = [
  {
    key: 'primeiros-passos',
    title: 'Primeiros passos',
    routes: ['/meu-perfil', '/atualizacoes'],
    purpose: 'Deixar sua conta segura e o sistema do seu jeito.',
    lessons: [
      {
        id: 'perfil.seguranca',
        title: 'Proteger a sua conta',
        steps: [
          'Clique na sua foto (canto de baixo do menu) e abra Meu perfil.',
          'Ative a verificação em 2 fatores e leia o QR Code com o aplicativo autenticador do celular.',
          'Guarde os códigos de recuperação num lugar seguro (fora do computador do trabalho).',
          'Em Aparelhos conectados, desconecte os que você não reconhece.',
        ],
        tip: 'Nunca passe senha ou código por WhatsApp ou e-mail: o sistema nunca pede isso.',
      },
      {
        id: 'perfil.preferencias',
        title: 'Seu nome, foto, tema e modelo das telas',
        steps: [
          'Em Meu perfil, ajuste seu nome e a foto.',
          'Escolha o tema (claro, escuro ou do sistema) e, se liberado, um dos 4 modelos: Moderno (menu ao lado) ou Clássico (menu no topo), com as telas de sempre ou com as telas novas (Minha fila, quadro de pré-vendas e chat com painel do cliente).',
          'Se você usa o chat, defina como seu nome aparece nas mensagens do WhatsApp (ex.: Diego - Vendas).',
        ],
      },
      {
        id: 'sistema.busca',
        title: 'Achar qualquer tela rápido',
        steps: [
          'Aperte Ctrl + K (ou clique em Buscar no topo).',
          'Digite parte do nome da tela (ex.: “carrinhos”) e aperte Enter.',
          'Em Sistema → Atualizações você vê o que mudou em cada versão.',
        ],
      },
    ],
  },
  {
    key: 'inicio',
    title: 'Início',
    module: 'dashboard',
    routes: ['/'],
    purpose: 'Os números do dia: leads, atendimentos e vendas.',
    lessons: [
      {
        id: 'inicio.ler',
        title: 'Ler o painel do dia',
        steps: [
          'Abra Dashboards → Início.',
          'Veja os cartões de leads, atendimentos e vendas do dia e a comparação com o período anterior.',
          'Os relatórios marcados com Mostrar no Painel aparecem logo abaixo (marque em Relatórios).',
        ],
      },
    ],
  },
  {
    key: 'pre-vendas',
    title: 'Pré-Vendas',
    module: 'pre_vendas',
    routes: ['/pre-vendas'],
    purpose: 'Registrar e acompanhar cada contato de cliente até a venda (ou o motivo da perda).',
    lessons: [
      {
        id: 'prevenda.registrar',
        title: 'Registrar um atendimento',
        steps: [
          'Abra Atendimento Comercial → Pré-Vendas e clique em Novo atendimento.',
          'Preencha nome, telefone, origem do lead, marca da máquina e tipo de peça.',
          'Escolha a unidade e o vendedor e salve.',
          'Contatos que chegam por formulário, botão de WhatsApp ou chat já entram sozinhos: confira e complete.',
        ],
        tip: 'Telefone com DDD: o sistema usa para achar o lead e abrir a conversa no WhatsApp.',
      },
      {
        id: 'prevenda.acompanhar',
        title: 'Acompanhar até fechar',
        steps: [
          'Marque “Repassou ao vendedor” quando passar o contato e “Vendedor retornou?” quando ele der retorno.',
          'Em “Venda realizada?”, marque Sim (com o valor da venda e a nota fiscal) ou Não (com o motivo da venda perdida).',
          'Use as observações para registrar o que foi conversado.',
          'Filtre a lista por período, situação e vendedor para ver o que está parado.',
        ],
      },
      {
        id: 'prevenda.dashboard',
        title: 'Ver o resultado',
        steps: [
          'Na aba Dashboard: atendimentos, taxa de conversão, valor vendido e motivos de perda.',
          'Compare vendedores e origens para saber de onde vêm as melhores vendas.',
          'Exportar baixa a planilha com os filtros aplicados (se o seu perfil permitir).',
        ],
      },
    ],
  },
  {
    key: 'pos-vendas',
    title: 'Pós-Vendas',
    module: 'pos_vendas',
    routes: ['/pos-vendas'],
    purpose: 'Acompanhar o cliente depois da compra: entrega, satisfação e nova venda.',
    lessons: [
      {
        id: 'posvenda.acompanhar',
        title: 'Fazer o acompanhamento',
        steps: [
          'Abra Atendimento Comercial → Pós-Vendas: as vendas da Pré-Venda viram acompanhamentos.',
          'Abra cada um no prazo, faça o contato e registre a situação do pós-venda e a observação do contato.',
          'Os atrasados aparecem destacados: comece por eles.',
        ],
      },
    ],
  },
  {
    key: 'chat',
    title: 'Chat WhatsApp',
    module: 'chat',
    routes: ['/chat'],
    purpose: 'Atender os clientes pelo WhatsApp da empresa direto no CRM, com tudo no histórico do lead.',
    lessons: [
      {
        id: 'chat.responder',
        title: 'Responder uma conversa',
        steps: [
          'Abra Atendimento Comercial → Chat WhatsApp e escolha a conversa (as não lidas ficam em negrito).',
          'Escreva e aperte Enter para enviar (Shift + Enter quebra a linha).',
          'Use o clipe para enviar foto ou arquivo e o microfone para gravar áudio.',
          'Respostas rápidas: textos prontos, com o primeiro nome do cliente já preenchido.',
        ],
        tip: 'Você também pode responder pelo celular: a conversa aparece igual no CRM.',
      },
      {
        id: 'chat.organizar',
        title: 'Organizar: tipo de contato, lembrete e arquivo',
        steps: [
          'Marque o tipo do contato (cliente, colega, fornecedor ou outro): só cliente vira lead e pré-venda.',
          'Crie um lembrete para retornar depois (1 hora, amanhã ou uma data).',
          'Arquive a conversa resolvida: se o cliente escrever de novo, ela volta para a lista.',
        ],
      },
      {
        id: 'chat.fila',
        title: 'Fila e atendimento dividido',
        steps: [
          'Nos números com atendimento dividido, cliente novo aparece “Na fila”.',
          'Clique em Assumir para a conversa ser sua (ou responda: ela vira sua sozinha).',
          'Para passar para outra pessoa ou setor, escolha no campo do atendente, no topo da conversa.',
        ],
      },
      {
        id: 'chat.iniciar',
        title: 'Iniciar conversa com um cliente',
        steps: [
          'Clique em Nova conversa, escolha o número da empresa e informe o telefone.',
          'Na ficha do lead, o botão WhatsApp abre a conversa no CRM.',
        ],
        tip: 'Evite mandar a mesma mensagem para muitos contatos seguidos: o WhatsApp bloqueia números que parecem disparo em massa.',
      },
    ],
  },
  {
    key: 'monitoramento',
    title: 'Monitorar conversas',
    module: 'monitoramento',
    routes: ['/chat?monitorar=1'],
    purpose: 'Acompanhar a equipe lendo as conversas, sem marcar como lidas para o vendedor.',
    lessons: [
      {
        id: 'monitor.ler',
        title: 'Acompanhar a equipe',
        steps: [
          'No chat, clique em Monitorar equipe (ou no menu Monitorar conversas).',
          'Filtre por vendedor e ligue “Aguardando resposta” para ver quem está esperando.',
          'Abra a conversa: é só leitura e não muda nada para o vendedor (fica registrado na auditoria).',
        ],
      },
      {
        id: 'monitor.nota',
        title: 'Escrever nota interna',
        steps: [
          'Na conversa, clique em Nota interna.',
          'Escreva a orientação (ex.: desconto de 5% liberado) e salve.',
          'A nota aparece em amarelo só no CRM; o vendedor vê o aviso “Nota” na lista. O cliente nunca recebe.',
        ],
      },
    ],
  },
  {
    key: 'consulta-produtos',
    title: 'Consulta de produtos',
    module: 'consulta_produtos',
    routes: ['/consulta-produtos'],
    purpose: 'Achar a peça na Tcar por código, referência ou título, com estoque e preço.',
    lessons: [
      {
        id: 'produtos.buscar',
        title: 'Buscar uma peça',
        steps: [
          'Abra Atendimento Comercial → Consulta de produtos.',
          'Digite o código, a referência, o código de fábrica ou parte do título.',
          'Para buscar só num campo, escolha em “Buscar em” (ex.: Código de fábrica).',
          'As 10 primeiras peças têm o estoque atualizado na Tcar na hora; nas outras, use o botão de atualizar.',
        ],
        tip: 'Clique no número do estoque para ver por filial.',
      },
    ],
  },
  {
    key: 'cadastros',
    title: 'Cadastros de atendimento',
    module: 'cadastros',
    routes: ['/cadastros-atendimento'],
    purpose: 'As listas usadas no atendimento: unidades, vendedores, origens, marcas, tipos de peça e motivos de perda.',
    lessons: [
      {
        id: 'cadastros.listas',
        title: 'Manter as listas em dia',
        steps: [
          'Abra Atendimento Comercial → Cadastros.',
          'Em Vendedores, cadastre cada vendedor e ligue ao login dele (para o escopo “Próprios”).',
          'Desative o que não usa mais em vez de excluir: o histórico continua certo.',
          'Em Importar, traga planilhas antigas de atendimento.',
        ],
      },
    ],
  },
  {
    key: 'leads',
    title: 'Base de leads',
    module: 'leads',
    routes: ['/leads'],
    purpose: 'Todos os contatos da empresa, com origem, interesse, compras e histórico.',
    lessons: [
      {
        id: 'leads.filtrar',
        title: 'Achar e filtrar leads',
        steps: [
          'Abra CRM → Base de leads e busque por nome, e-mail ou telefone.',
          'Use os filtros (estágio, nota, tags, estado, responsável, origem, datas) para montar listas.',
          'Exportar baixa a lista filtrada (se o seu perfil permitir).',
        ],
      },
      {
        id: 'leads.ficha',
        title: 'Entender a ficha do lead',
        steps: [
          'Abra um lead: Dados, Linha do tempo, WhatsApp, Site, Loja virtual e Privacidade (LGPD).',
          'Na Linha do tempo: conversões, atendimentos, e-mails e compras, em ordem.',
          'Na aba Site: as páginas e os produtos que ele viu na loja (bom para saber o que oferecer).',
          'Em Privacidade: consentimentos, exportar os dados do lead e anonimizar a pedido dele.',
        ],
        tip: 'A nota (A, B, C...) mostra o perfil e o interesse do lead: comece pelos de nota alta.',
      },
      {
        id: 'leads.importar',
        title: 'Importar uma planilha',
        steps: [
          'Em Base de leads, clique em Importar leads e escolha o arquivo CSV.',
          'Relacione as colunas aos campos e confira a prévia.',
          'Importe só contatos com autorização para receber comunicação (LGPD).',
        ],
      },
    ],
  },
  {
    key: 'carrinhos',
    title: 'Carrinhos e checkout',
    module: 'carrinhos',
    routes: ['/carrinhos'],
    purpose: 'Recuperar vendas de quem colocou produtos no carrinho da loja e não comprou.',
    lessons: [
      {
        id: 'carrinhos.recuperar',
        title: 'Recuperar um carrinho',
        steps: [
          'Abra CRM → Carrinhos e checkout: os abandonados aparecem primeiro.',
          'Clique em WhatsApp: a mensagem já vem com o nome, os produtos, o link e o cupom.',
          'Marque o contato feito para a equipe não repetir.',
        ],
      },
    ],
  },
  {
    key: 'catalogo',
    title: 'Catálogo e produtos vistos',
    module: 'catalogo',
    routes: ['/catalogo'],
    purpose: 'Os produtos da loja virtual, o que os clientes mais veem e quem viu e não comprou.',
    lessons: [
      {
        id: 'catalogo.usar',
        title: 'Usar o catálogo',
        steps: [
          'Abra CRM → Catálogo: produtos da Magazord, copiados todo dia de madrugada.',
          'Ordene por “Mais vistos no site” ou “Mais colocados no carrinho” para ver o que está em alta.',
          'Copie o link do produto para mandar ao cliente.',
        ],
      },
      {
        id: 'catalogo.vistos',
        title: 'Viram e não compraram',
        steps: [
          'Abra Análise → Produtos vistos.',
          'Em “Procurados e sem estoque”, veja o que repor.',
          'Em “Viram e não compraram”, chame no WhatsApp quem está com o produto no carrinho primeiro.',
        ],
      },
    ],
  },
  {
    key: 'captura',
    title: 'Captura (formulários, pop-ups e WhatsApp)',
    module: 'captura',
    routes: ['/captura'],
    purpose: 'Transformar visitas do site e das landing pages em leads.',
    lessons: [
      {
        id: 'captura.formulario',
        title: 'Criar um formulário',
        steps: [
          'Abra Marketing → Captura → Formulários e clique em Novo.',
          'Monte os campos no editor e o texto de consentimento (LGPD).',
          'Copie o código e cole no site ou na landing page.',
          'Em Envios, veja cada conversão e de onde veio.',
        ],
      },
      {
        id: 'captura.whatsapp',
        title: 'Botão de WhatsApp',
        steps: [
          'Em Botões de WhatsApp, crie o botão, escolha o número e as páginas onde aparece.',
          '“Mostrar só nas páginas” restringe; “Nunca mostrar em” bloqueia (e vale primeiro).',
          'Quem clica vira lead e pré-venda, com a origem (inclusive Google Ads).',
        ],
        tip: 'Cuidado ao bloquear o domínio inteiro em “Nunca mostrar em”: o botão some de todas as páginas dele.',
      },
    ],
  },
  {
    key: 'email',
    title: 'Email marketing',
    module: 'email_marketing',
    routes: ['/email-marketing'],
    purpose: 'Campanhas para os leads que autorizaram receber e-mail, com resultado de cada envio.',
    lessons: [
      {
        id: 'email.campanha',
        title: 'Criar e enviar uma campanha',
        steps: [
          'Abra Marketing → Email marketing → Nova campanha.',
          'Escolha o segmento (quem recebe) e escreva o assunto.',
          'Monte o e-mail com blocos: título, texto, 2 colunas, imagem, botão, produtos, redes sociais.',
          'Use Ver como fica e o botão Teste para receber o e-mail antes de enviar.',
          'Envie agora ou agende.',
        ],
        tip: 'O assistente de IA escreve, melhora e sugere assuntos; confira sempre antes de usar.',
      },
      {
        id: 'email.segmento',
        title: 'Montar um segmento',
        steps: [
          'Na aba Segmentos, crie com os mesmos filtros da base de leads.',
          'Veja quantos podem receber (só quem autorizou e tem e-mail válido).',
        ],
      },
      {
        id: 'email.resultado',
        title: 'Ver o resultado',
        steps: [
          'Abra Dashboards → Resultados do e-mail.',
          'Veja entregues, abertura, cliques, descadastros e as vendas de quem clicou.',
          'Use o mapa de horários para agendar os próximos envios.',
        ],
      },
    ],
  },
  {
    key: 'automacoes',
    title: 'Automações',
    module: 'automacoes',
    routes: ['/automacoes'],
    purpose: 'Fluxos que trabalham sozinhos: e-mails, tarefas e mudanças no lead a partir de um acontecimento.',
    lessons: [
      {
        id: 'automacoes.fluxo',
        title: 'Criar um fluxo',
        steps: [
          'Abra Marketing → Automações → Novo fluxo.',
          'Escolha o gatilho (ex.: abandonou o carrinho, entrou no Pré-Vendas).',
          'Adicione os passos: esperar, condição (sim/não) e ações (enviar e-mail, passar para vendedor, tag).',
          'Ligue o fluxo: só acontecimentos a partir daí fazem o lead entrar.',
        ],
        tip: 'Deixe “sair do fluxo quando comprar” ligado para ninguém receber oferta do que já comprou.',
      },
    ],
  },
  {
    key: 'analise',
    title: 'Dashboards e relatórios',
    module: 'relatorios',
    routes: ['/relatorios'],
    purpose: 'Visão geral do negócio e relatórios montados por você.',
    lessons: [
      {
        id: 'relatorios.criar',
        title: 'Montar um relatório',
        steps: [
          'Abra Análise → Relatórios → Relatórios salvos → Novo.',
          'Escolha a fonte, os agrupamentos, as métricas, os filtros e o gráfico.',
          'Salve como privado ou para a equipe e marque Mostrar no Painel para ele aparecer no Início.',
        ],
      },
    ],
  },
  {
    key: 'google-ads',
    title: 'Google Ads',
    module: 'google_ads',
    routes: ['/google-ads'],
    purpose: 'Quanto foi investido, quantos leads e vendas vieram e o custo de cada um, por campanha e palavra-chave.',
    lessons: [
      {
        id: 'ads.ler',
        title: 'Ler o painel',
        steps: [
          'Abra Dashboards → Google Ads e escolha o período.',
          'Compare campanhas e palavras-chave por custo por lead e por venda.',
          'Acompanhe o saldo estimado para saber quando recarregar.',
        ],
      },
    ],
  },
  {
    key: 'whatsapp-dash',
    title: 'Atendimento WhatsApp (painel)',
    module: 'chat',
    routes: ['/whatsapp/dashboard'],
    purpose: 'Tempo de resposta, volume, situação agora e o resultado comercial das conversas.',
    lessons: [
      {
        id: 'wadash.ler',
        title: 'Ler o painel de atendimento',
        steps: [
          'Abra Dashboards → Atendimento WhatsApp.',
          'Veja a 1ª resposta típica em horário comercial e quantos ficaram sem resposta.',
          'Em “Esperando resposta agora”, abra as conversas mais antigas.',
          'O mapa de calor mostra quando os clientes mais escrevem: use para escalar a equipe.',
        ],
      },
    ],
  },
  {
    key: 'sugestoes',
    title: 'Sugestões de melhoria',
    routes: ['/sugestoes'],
    purpose: 'Mandar ideias para melhorar o sistema e acompanhar a resposta.',
    lessons: [
      {
        id: 'sugestoes.enviar',
        title: 'Enviar uma sugestão',
        steps: [
          'Abra Sugestões → Minhas sugestões → Nova sugestão.',
          'Diga o que acontece hoje, o que gostaria e como ajuda; anexe um print se ajudar.',
          'Você é avisado no menu e por e-mail quando houver resposta.',
        ],
      },
    ],
  },
  {
    key: 'admin',
    title: 'Administração',
    module: 'usuarios',
    routes: ['/usuarios', '/perfis', '/configuracoes', '/auditoria', '/whatsapp/numeros', '/sugestoes/analisar'],
    purpose: 'Usuários, perfis de acesso, números de WhatsApp, integrações e auditoria.',
    lessons: [
      {
        id: 'admin.usuarios',
        title: 'Cadastrar um usuário',
        steps: [
          'Abra Administração → Usuários → Novo usuário, com nome, e-mail e perfil.',
          'A pessoa recebe o convite por e-mail e cria a senha (com 2 fatores, se o perfil exigir).',
          'Para quem saiu da empresa: Desativar (o histórico continua; dá para reativar depois).',
        ],
      },
      {
        id: 'admin.perfis',
        title: 'Ajustar um perfil de acesso',
        steps: [
          'Em Perfis de acesso, abra o perfil e marque o que ele pode ver, criar, editar, excluir e exportar.',
          'Em Leads, Pré/Pós-Vendas e Chat, escolha o escopo: próprios, da unidade ou todos.',
          'Use o Gestor comercial para quem acompanha a equipe (inclui monitorar conversas).',
        ],
      },
      {
        id: 'admin.whatsapp',
        title: 'Números de WhatsApp',
        steps: [
          'Em Números de WhatsApp, cadastre o número e clique em Conectar para ler o QR Code no celular.',
          'Ligue os usuários e vendedores que usam o número; ligue o atendimento dividido e os setores, se for o caso.',
          'Defina as regras: o que vira lead e pré-venda e os contatos da empresa (colegas e fornecedores).',
        ],
      },
      {
        id: 'admin.auditoria',
        title: 'Conferir na auditoria',
        steps: [
          'Em Auditoria, filtre por pessoa, ação e período para ver quem fez o quê.',
          'Exportações de dados, mudanças de permissão e leituras no monitoramento ficam registradas.',
        ],
      },
    ],
  },
]

export const ALL_LESSONS = TRAIL.flatMap((m) => m.lessons)

/** Módulos que a pessoa usa (pela permissão do perfil). */
export function trailFor(can: (module: string) => boolean) {
  return TRAIL.filter((m) => !m.module || can(m.module))
}

/** Módulo da trilha para a tela aberta (o endereço mais específico ganha). */
export function trailForRoute(pathname: string, search: string, can: (module: string) => boolean) {
  const here = `${pathname}${search}`
  let best: { m: TrailModule; len: number } | null = null
  for (const m of trailFor(can)) {
    for (const r of m.routes) {
      const [path = '', query] = r.split('?')
      const hit = (path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`)) && (!query || here.includes(query))
      if (hit && (!best || r.length > best.len)) best = { m, len: r.length }
    }
  }
  return best?.m ?? null
}
