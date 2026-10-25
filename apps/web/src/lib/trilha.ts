/**
 * Trilha de conhecimento: para cada tela, para que serve e o passo a passo ("o que fazer e como fazer").
 * Cada módulo segue a permissão do perfil (só aparece o que a pessoa usa). O progresso fica no servidor por usuário.
 * Ao mudar uma tela, atualize aqui a lição correspondente (o id da lição não deve mudar: guarda o progresso).
 */

/** Imagem (print da tela) ou vídeo curto que mostra a tela funcionando (arquivos em public/trilha). */
export interface Media {
  src: string
  alt: string
  kind?: 'imagem' | 'video'
}

export interface Lesson {
  id: string
  title: string
  steps: string[]
  tip?: string
  /** Mostra este passo a passo acontecendo (vídeo curto ou print). */
  media?: Media
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
  /** Como a tela funciona, em poucas linhas (o "porquê" antes do passo a passo). */
  howItWorks?: string
  /** Print da tela principal do módulo. */
  media?: Media
  lessons: Lesson[]
}

export const TRAIL: TrailModule[] = [
  {
    key: 'primeiros-passos',
    title: 'Primeiros passos',
    routes: ['/meu-perfil', '/atualizacoes', '/trilha'],
    purpose: 'Deixar sua conta segura e o sistema do seu jeito.',
    howItWorks: 'Cada pessoa entra com o próprio e-mail e senha (e, se o perfil exigir, um código do celular). O menu mostra só as telas que o seu perfil de acesso libera. Em qualquer tela, o botão “?” no topo abre a ajuda daquela tela, e esta Trilha guarda o que você já aprendeu.',
    media: { src: '/trilha/primeiros-passos.jpg', alt: 'Tela Meu perfil' },
    lessons: [
      {
        id: 'perfil.seguranca',
        title: 'Proteger a sua conta',
        steps: [
          'Clique no seu nome (canto de baixo do menu) e abra Meu perfil.',
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
      {
        id: 'sistema.ajuda',
        title: 'Ajuda da tela e avisos',
        steps: [
          'Clique no “?” do topo: abre o passo a passo da tela em que você está.',
          'O sino mostra os avisos: lembretes do chat, pré-vendas paradas, prazos vencidos e respostas às suas sugestões.',
          'Os avisos vermelhos no canto (ex.: “clientes sem resposta no WhatsApp”) têm o botão para ir direto ao que precisa.',
        ],
      },
    ],
  },
  {
    key: 'inicio',
    title: 'Início e Minha fila',
    module: 'dashboard',
    routes: ['/'],
    purpose: 'Os números do dia e, nas telas novas, a sua fila de trabalho.',
    howItWorks: 'O Início junta o que aconteceu hoje (leads, atendimentos e vendas) e compara com o período anterior. Nas telas novas ele vira a Minha fila: as conversas esperando você, as pré-vendas para chamar e os leads novos, na ordem de prioridade.',
    media: { src: '/trilha/inicio.jpg', alt: 'Início com os números do dia' },
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
      {
        id: 'inicio.fila',
        title: 'Trabalhar pela Minha fila (telas novas)',
        steps: [
          'Em Meu perfil, escolha um modelo “com telas novas”: o Início vira a Minha fila.',
          'Comece pelo topo: conversas esperando resposta há mais tempo e pré-vendas com prazo vencido.',
          'Clique no item para abrir a conversa ou a ficha, resolva e volte: a fila se atualiza sozinha.',
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
    howItWorks: 'Cada contato de cliente vira um atendimento de pré-venda: quem chamou, de onde veio (origem, Google Ads), o que procura e para qual vendedor foi repassado. O sistema cobra os prazos (retorno do vendedor e “chamar o cliente até”), e quando a venda fecha (Sim ou Não) o cliente vai sozinho para o Pós-Vendas.',
    media: { src: '/trilha/pre-vendas.jpg', alt: 'Lista de Pré-Vendas' },
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
        media: { src: '/trilha/pre-vendas-registrar.webm', alt: 'Registrando um atendimento de pré-venda', kind: 'video' },
      },
      {
        id: 'prevenda.acompanhar',
        title: 'Acompanhar até fechar',
        steps: [
          'Marque “Repassou ao vendedor” quando passar o contato e, em “Vendedor retornou?”, escolha Sim, Não ou Pendente (a opção escolhida fica destacada com ✓).',
          'Em “Venda realizada?”, marque Sim (com o valor da venda e a nota fiscal) ou Não (com o motivo da venda perdida).',
          'Use as observações para registrar o que foi conversado.',
          'Filtre a lista por período, situação, vendedor ou Google Ads para ver o que está parado.',
        ],
        tip: 'Se os botões não mudam ao clicar e aparece “Só leitura”, o seu perfil não pode editar pré-vendas: peça ao administrador.',
      },
      {
        id: 'prevenda.prazo',
        title: 'Prazo para chamar o cliente',
        steps: [
          'Em negociação, a ficha mostra “Chamar o cliente até”: o prazo é calculado sozinho ao repassar (pode mudar a data).',
          'Ligou ou falou com o cliente? Clique em Chamei o cliente: o prazo recomeça. Responder pelo chat do CRM também conta.',
          'Passou do prazo, vira aviso no sino para quem atende.',
        ],
      },
      {
        id: 'prevenda.quadro',
        title: 'Quadro e resumo do dia',
        steps: [
          'Na aba Quadro, os atendimentos ficam em colunas por fase: arraste o cartão para mudar de fase.',
          'Em Resumo do dia, veja os clientes repassados hoje a cada vendedor, com os telefones prontos para copiar.',
          'Se estiver ligado em Configurações, cada vendedor recebe esse resumo no WhatsApp no fim do dia.',
        ],
      },
      {
        id: 'prevenda.dashboard',
        title: 'Ver o resultado',
        steps: [
          'Na aba Dashboard: atendimentos, taxa de conversão, valor vendido e motivos de perda.',
          'O quadro “Google Ads × fora do Ads” compara leads, retorno do vendedor e vendas de quem veio do anúncio com o resto.',
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
    howItWorks: 'Quando uma pré-venda fecha (vendeu ou não), o sistema cria o acompanhamento de pós-venda com prazo para o contato. Assim nenhum cliente fica sem retorno depois da compra, e o motivo de quem não comprou também é ouvido.',
    media: { src: '/trilha/pos-vendas.jpg', alt: 'Lista de Pós-Vendas' },
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
    howItWorks: 'Os números de WhatsApp da empresa ficam conectados ao CRM: tudo o que chega e sai aparece aqui e no celular, igual ao WhatsApp Web. Cliente novo vira lead e pré-venda sozinho (conforme as regras), o robô de atendimento pode receber e direcionar, e cada conversa tem dono: as dos outros atendentes não se misturam com as suas.',
    media: { src: '/trilha/chat.jpg', alt: 'Chat WhatsApp com conversa aberta' },
    lessons: [
      {
        id: 'chat.responder',
        title: 'Responder uma conversa',
        steps: [
          'Abra Atendimento Comercial → Chat WhatsApp e escolha a conversa (as não lidas ficam em negrito, com o número verde).',
          'Escreva e aperte Enter para enviar (Shift + Enter quebra a linha).',
          'Use o clipe para enviar foto ou arquivo e o microfone para gravar áudio.',
          'Passe o mouse na mensagem: Responder (cita a mensagem), reagir com emoji, encaminhar e, nas suas, Corrigir ou apagar.',
          'No botão de carinha, ao lado da caixa de texto: emojis e as suas figurinhas. Figurinha recebida: menu ⋮ → Salvar figurinha.',
          'O tempo de espera conta da última mensagem do cliente e para quando você responde. Se a resposta for uma promessa de retorno (“vou verificar e lhe retorno”, “só um momento”), o tempo continua até você retornar ou clicar em Já retornei. Figurinha não conta como resposta. Se o cliente escrever de novo, volta a contar.',
        ],
        tip: 'Você também pode responder pelo celular: a conversa aparece igual no CRM.',
        media: { src: '/trilha/chat-responder.webm', alt: 'Respondendo uma conversa no chat', kind: 'video' },
      },
      {
        id: 'chat.arquivos',
        title: 'Arquivos, imagens e respostas rápidas',
        steps: [
          'Arraste o arquivo do computador para a conversa (aparece “Solte para anexar”) ou cole uma imagem com Ctrl + V.',
          'Vão arquivos de até 64 MB; foto ou vídeo grande vai como documento, com o arquivo original.',
          'No raio (ou digitando / na caixa, nas telas novas), escolha uma resposta rápida: o nome do cliente já vem preenchido e, se ela tiver arquivo (catálogo em PDF), ele vai junto.',
          'Áudio recebido: clique em Transcrever para ler o que foi dito.',
        ],
      },
      {
        id: 'chat.telefone',
        title: 'Telefone na mensagem, contato e menu de robô',
        steps: [
          'Telefone escrito na mensagem fica azul: clique e o CRM confere se tem WhatsApp e abre a conversa, sem salvar o contato no celular.',
          'Cartão de contato recebido tem o botão Conversar, que faz o mesmo.',
          'Mensagem de robô com opções (“1 Marketing, 2 CRM...”) mostra botões: clique na opção para responder como se tocasse no celular.',
          'Mensagem que é resposta a outra mostra a citação em cima; clique nela para ir até a mensagem original.',
        ],
      },
      {
        id: 'chat.organizar',
        title: 'Organizar: tipo de contato, etiquetas, lembrete e arquivo',
        steps: [
          'Marque o tipo do contato (cliente, colega, fornecedor ou outro): só cliente vira lead e pré-venda.',
          'Use Etiquetas para separar as conversas (ex.: Orçamento, Urgente) e filtre a lista por elas.',
          'Crie um Lembrete para retornar depois (1 hora, amanhã ou uma data): ele aparece no sino.',
          'Arquive a conversa resolvida: se o cliente escrever de novo, ela volta para a lista.',
        ],
      },
      {
        id: 'chat.fila',
        title: 'Fila, robô e atendimento dividido',
        steps: [
          'Nos números com atendimento dividido, cliente novo aparece “Na fila” (ou passa antes pelo robô de atendimento, se houver um fluxo ligado).',
          'Clique em Assumir para a conversa ser sua (ou responda: ela vira sua sozinha). As respostas do cliente ao robô aparecem numa nota.',
          'Para passar para outra pessoa ou setor, escolha no campo do atendente, no topo da conversa. Ajudantes também podem responder.',
        ],
      },
      {
        id: 'chat.finalizar',
        title: 'Finalizar o atendimento',
        steps: [
          'Terminou de atender? Clique em Finalizar no topo da conversa.',
          'O sistema pode mandar a mensagem de encerramento (configurada em Regras e horário), tira a conversa de você e arquiva.',
          'Se o cliente chamar de novo, começa um atendimento novo (fila ou robô).',
          'Vários de uma vez: na lista de conversas, clique em Selecionar, marque as conversas (ou Todas da lista) e clique em Finalizar sem mensagem. Nenhuma mensagem é enviada aos contatos.',
        ],
      },
      {
        id: 'chat.iniciar',
        title: 'Iniciar conversa com um cliente',
        steps: [
          'Clique em Nova conversa, escolha o número da empresa e informe o telefone ou o nome (busca na agenda, nos vendedores e nos leads).',
          'O CRM confere se o número tem WhatsApp antes de abrir.',
          'Na ficha do lead ou em Leads para chamar, o botão WhatsApp abre a conversa no CRM.',
        ],
        tip: 'Evite mandar a mesma mensagem para muitos contatos seguidos: o WhatsApp bloqueia números que parecem disparo em massa.',
      },
      {
        id: 'chat.chamar',
        title: 'Leads para chamar',
        steps: [
          'Na aba Leads para chamar ficam os leads que converteram (formulário, loja, botão) e ainda não conversaram no WhatsApp.',
          'Filtre por Hoje, Ontem, últimos dias ou um período no calendário.',
          'A linha de cima mostra quando chegou o último lead por canal: data antiga num canal com movimento é sinal de que ele parou de mandar leads.',
          'Clique em Chamar no WhatsApp para abrir a conversa.',
        ],
      },
    ],
  },
  {
    key: 'agenda',
    title: 'Agenda de contatos',
    module: 'whatsapp',
    routes: ['/agenda'],
    purpose: 'Quem é cliente, colega, fornecedor ou outro em cada número de WhatsApp.',
    howItWorks: 'Cada número de WhatsApp tem a sua agenda: o tipo de cada contato define o que acontece quando ele chama (só cliente vira lead e pré-venda; colega e fornecedor ficam fora das vendas). A agenda “Todos os números” vale para os números sem agenda própria.',
    media: { src: '/trilha/agenda.jpg', alt: 'Agenda de contatos' },
    lessons: [
      {
        id: 'agenda.usar',
        title: 'Manter a agenda em dia',
        steps: [
          'Abra Atendimento Comercial → Agenda de contatos e escolha o número (ou Todos os números).',
          'Busque o contato e mude o tipo: Cliente, Colega de trabalho, Fornecedor ou Outro.',
          'Importe a agenda do celular (arquivo .vcf ou planilha do Google Contatos) para não classificar um por um.',
          'Abrir conversa no chat leva direto ao WhatsApp do contato.',
        ],
      },
    ],
  },
  {
    key: 'monitoramento',
    title: 'Monitorar conversas',
    module: 'monitoramento',
    routes: ['/chat?monitorar=1'],
    purpose: 'Acompanhar a equipe lendo as conversas, sem marcar como lidas para o vendedor.',
    howItWorks: 'Quem tem a permissão de monitorar vê todas as conversas; o gestor de um setor (ou de vendedores) vê as da sua equipe. É só leitura: nada muda para quem atende, e cada leitura fica registrada na auditoria.',
    media: { src: '/trilha/monitoramento.jpg', alt: 'Monitorar conversas da equipe' },
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
    howItWorks: 'A busca consulta o cadastro de peças da Tcar (o sistema da empresa) e atualiza o estoque na hora das primeiras peças encontradas, por filial.',
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
    title: 'Ajustes do atendimento',
    module: 'cadastros',
    routes: ['/configuracoes?secao=listas', '/configuracoes?secao=vendedores', '/configuracoes?secao=unidades', '/configuracoes?secao=prazos', '/configuracoes?secao=mensagens-automaticas', '/configuracoes?secao=importar'],
    purpose: 'Em Configurações: unidades, vendedores, listas (origens, marcas, tipos de peça, motivos de perda), prazos e mensagens automáticas.',
    howItWorks: 'As listas e os prazos daqui alimentam as fichas de Pré e Pós-Vendas. As mensagens automáticas mandam WhatsApp sozinhas no horário escolhido (pós-venda do dia seguinte e resumo do dia para os vendedores), sempre com intervalo entre os envios para não bloquear o número.',
    media: { src: '/trilha/cadastros.jpg', alt: 'Configurações de mensagens automáticas' },
    lessons: [
      {
        id: 'cadastros.listas',
        title: 'Manter as listas em dia',
        steps: [
          'Abra Configurações → Listas do atendimento.',
          'Em Configurações → Vendedores, cadastre cada vendedor com o telefone e ligue ao login dele (para o escopo “Próprios”).',
          'Desative o que não usa mais em vez de excluir: o histórico continua certo.',
          'Em Configurações → Prazos e alertas, ajuste o aviso de retorno do vendedor e o prazo para chamar o cliente.',
        ],
      },
      {
        id: 'cadastros.mensagens',
        title: 'Mensagens automáticas de WhatsApp',
        steps: [
          'Abra Configurações → Mensagens automáticas.',
          'Mensagem do dia seguinte (pós-venda): escolha o horário, o texto ({nome} e {vendedor}), os números de WhatsApp cujos atendimentos recebem, só repassadas ao vendedor e as situações da venda. Conversa finalizada ou arquivada nunca recebe.',
          'Ajuste o intervalo entre as mensagens (padrão 3 a 20 minutos): o WhatsApp bloqueia número que manda muitas seguidas.',
          'Resumo do dia para os vendedores: horário, texto e para quais vendedores vai.',
        ],
        tip: 'Comece com poucos envios por dia e acompanhe: mensagem automática para quem não pediu contato aumenta o risco de bloqueio.',
      },
      {
        id: 'cadastros.importar',
        title: 'Importar planilha de atendimentos',
        steps: [
          'Em Configurações → Importar planilha, envie a planilha antiga de pré-vendas (Excel ou CSV).',
          'Confira como cada coluna foi entendida na prévia e importe.',
          'Pré-vendas importadas não recebem mensagens automáticas.',
        ],
      },
    ],
  },
  {
    key: 'leads',
    title: 'Base de leads',
    module: 'leads',
    routes: ['/leads', '/configuracoes?secao=leads-campos', '/configuracoes?secao=leads-pontuacao', '/configuracoes?secao=leads-tags'],
    purpose: 'Todos os contatos da empresa, com origem, interesse, compras e histórico.',
    howItWorks: 'Todo contato que chega (formulário, loja virtual, WhatsApp, Meta, planilha) vira um lead único, achado pelo e-mail ou telefone. A ficha junta tudo o que ele fez: conversões, atendimentos, e-mails, compras e páginas vistas, e a nota (A, B, C) mostra o perfil e o interesse.',
    media: { src: '/trilha/leads.jpg', alt: 'Base de leads' },
    lessons: [
      {
        id: 'leads.filtrar',
        title: 'Achar e filtrar leads',
        steps: [
          'Abra CRM → Base de leads e busque por nome, e-mail ou telefone.',
          'Use os filtros (estágio, nota, tags, estado, responsável, origem, datas) para montar listas.',
          'Selecione vários (ou todos do filtro) para ações em lote: responsável, tags, etapa.',
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
      {
        id: 'leads.configurar',
        title: 'Campos, pontuação e tags',
        steps: [
          'Em Configurações → Campos personalizados, crie os campos que a empresa usa (ex.: tipo de frota).',
          'Em Pontuação dos leads, defina quanto vale cada perfil e cada interesse para a nota A, B, C.',
          'Em Tags dos leads, organize as tags usadas nos filtros e nas automações.',
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
    howItWorks: 'A loja virtual (Magazord) avisa o CRM de cada carrinho e checkout. Os que ficam parados sem compra aparecem aqui com o cliente e os produtos, prontos para um contato.',
    media: { src: '/trilha/carrinhos.jpg', alt: 'Carrinhos e checkout' },
    lessons: [
      {
        id: 'carrinhos.recuperar',
        title: 'Recuperar um carrinho',
        steps: [
          'Abra E-commerce → Carrinhos abandonados: os abandonados aparecem primeiro.',
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
    howItWorks: 'O catálogo da loja é copiado todo dia de madrugada. O rastreamento do site registra quais produtos cada visitante viu, e o CRM cruza com carrinhos e compras.',
    media: { src: '/trilha/catalogo.jpg', alt: 'Catálogo da loja' },
    lessons: [
      {
        id: 'catalogo.usar',
        title: 'Usar o catálogo',
        steps: [
          'Abra E-commerce → Catálogo: produtos da Magazord, copiados todo dia de madrugada.',
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
    routes: ['/captura', '/configuracoes?secao=captura'],
    purpose: 'Transformar visitas do site e das landing pages em leads.',
    howItWorks: 'Formulários, pop-ups e botões de WhatsApp criados aqui vão para o site e as landing pages com um código. Cada envio vira lead (e pré-venda, no botão de WhatsApp), com a origem e a campanha do Google Ads quando houver.',
    media: { src: '/trilha/captura.jpg', alt: 'Captura: formulários' },
    lessons: [
      {
        id: 'captura.formulario',
        title: 'Criar um formulário ou pop-up',
        steps: [
          'Abra Marketing → Captura → Formulários (ou Pop-ups) e clique em Novo.',
          'Monte os campos no editor (inclusive Tipo de cliente) e o texto de consentimento (LGPD).',
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
    routes: ['/email-marketing', '/configuracoes?secao=email-marketing'],
    purpose: 'Campanhas para os leads que autorizaram receber e-mail, com resultado de cada envio.',
    howItWorks: 'Você escolhe quem recebe (segmento), monta o e-mail com blocos e envia ou agenda. Só recebe quem autorizou e tem e-mail válido; aberturas, cliques e vendas de quem clicou voltam para o lead.',
    media: { src: '/trilha/email.jpg', alt: 'Email marketing' },
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
    key: 'landing',
    title: 'Landing pages',
    module: 'email_marketing',
    routes: ['/landing-pages', '/landing-pages/:id'],
    purpose: 'Páginas para anúncios e campanhas, no subdomínio da empresa, com medição até a venda.',
    howItWorks: 'Você monta a página com blocos (a partir de um modelo pronto, com a IA ou em branco), ajusta as cores e publica. Quem preenche o formulário vira lead e pré-venda com a página e o anúncio como origem; visitas e cliques entram só nas métricas. GA4, Meta Pixel e Google Ads recebem as conversões de quem aceitou os cookies.',
    media: { src: '/trilha/landing-pages.jpg', alt: 'Editor de landing page' },
    lessons: [
      {
        id: 'landing.criar',
        title: 'Criar e publicar uma landing page',
        steps: [
          'Abra Marketing → Landing pages → Nova landing page.',
          'Escolha um modelo pronto, peça para a IA montar a partir do objetivo ou comece em branco.',
          'Clique em cada bloco para trocar textos e imagens; complete o que estiver [entre colchetes].',
          'Em Tema, ajuste cores, fonte, cantos, botões e o WhatsApp da página.',
          'Confira a prévia no computador e no celular e clique em Publicar.',
        ],
        tip: 'A IA não inventa preço, prazo, estoque nem garantia: confira os textos com o Comercial antes de publicar.',
      },
      {
        id: 'landing.anuncios',
        title: 'Usar nos anúncios e medir',
        steps: [
          'Na aba Links, copie o endereço com UTM do canal (Google, Meta, TikTok, e-mail, WhatsApp).',
          'Na aba Métricas, veja visitantes, cliques, leads, conversão e as vendas do Pré-Vendas.',
          'Para comparar duas versões, ligue o Teste A/B na aba Página.',
        ],
      },
      {
        id: 'landing.config',
        title: 'Subdomínio e medição',
        steps: [
          'Em Subdomínio e medição, informe o subdomínio (ex.: lp.usaparts.com.br), o GA4 e o Meta Pixel.',
          'O TI aponta o DNS e roda o script do servidor (deploy/LANDING-PAGES.md).',
        ],
      },
    ],
  },
  {
    key: 'seo',
    title: 'SEO do e-commerce',
    module: 'seo_ecommerce',
    routes: ['/seo-ecommerce'],
    purpose: 'Melhorar títulos, meta-descrições e descrições dos produtos da loja virtual para aparecer melhor no Google.',
    howItWorks: 'O CRM lê os produtos do Magazord, dá uma nota de SEO para cada um e aponta o que falta. A IA sugere textos novos, um a um ou em lote; nada vai para a loja sem você revisar e clicar em Enviar. Cada envio guarda o texto anterior, e dá para desfazer.',
    media: { src: '/trilha/seo-ecommerce.jpg', alt: 'SEO do e-commerce' },
    lessons: [
      {
        id: 'seo.produto',
        title: 'Melhorar um produto',
        steps: [
          'Abra E-commerce → SEO dos produtos e clique em Analisar catálogo (a primeira leitura demora).',
          'Filtre pelas notas mais baixas ou por um problema e abra o produto.',
          'Clique em Sugerir com IA (se quiser, escreva uma instrução) e confira cada campo.',
          'Marque os campos que vão para a loja e clique em Enviar para a loja.',
        ],
        tip: 'A IA não inventa medidas, aplicações nem códigos: onde faltar dado ela escreve [conferir: …]. Complete antes de enviar.',
      },
      {
        id: 'seo.lote',
        title: 'Melhorar em lote',
        steps: [
          'Na aba Produtos, selecione até 50 itens e clique em Gerar sugestões com IA.',
          'Na aba Para revisar, abra cada sugestão, ajuste e envie (ou selecione várias e envie juntas).',
          'Na aba Enviadas, veja o histórico e use Desfazer se precisar voltar o texto anterior.',
        ],
        tip: 'Mudar a URL da página faz o produto perder posição no Google por um tempo: só altere quando valer a pena.',
      },
    ],
  },
  {
    key: 'postagens',
    title: 'Postagens',
    module: 'postagens',
    routes: ['/postagens'],
    purpose: 'Planejar e publicar as postagens do Instagram e do Facebook (feed, Stories e Reels) no dia e na hora certos.',
    howItWorks: 'Você monta a postagem com imagens próprias, fotos do catálogo, artes com a marca ou imagens da IA, e a legenda (a IA gratuita ajuda), e escolhe em quais contas sai: uma, um grupo (ex.: Vendedores) ou todas. Ela vai para aprovação; depois de aprovada, o CRM publica sozinho na hora marcada. A aba Métricas mostra seguidores, alcance, engajamento e o perfil dos seguidores de cada conta e de cada grupo.',
    media: { src: '/trilha/postagens.jpg', alt: 'Calendário de postagens' },
    lessons: [
      {
        id: 'postagens.criar',
        title: 'Criar e agendar uma postagem',
        steps: [
          'Abra Marketing → Postagens e clique em Nova postagem (ou no + do dia no calendário).',
          'Em Onde publicar, marque as contas (uma, um grupo inteiro ou todas), o formato (Feed, Stories ou Reels) e a data e hora.',
          'Em Imagens ou vídeo: traga da biblioteca, prepare uma imagem nova (do computador, do catálogo ou com IA) ou monte um vídeo a partir de fotos.',
          'Escreva a legenda ou use Escrever com IA e confira o texto.',
          'Clique em Enviar para aprovação. Quem aprova vê a postagem em Aguardando aprovação e clica em Aprovar.',
        ],
        tip: 'A IA não inventa preço, prazo nem estoque: onde faltar dado ela escreve [conferir: …]. Complete antes de mandar para aprovação.',
      },
      {
        id: 'postagens.calendario',
        title: 'Calendário com IA',
        steps: [
          'Clique em Calendário com IA, escolha o período, quantas postagens por semana, os temas, as redes e os formatos.',
          'Confira as sugestões e desmarque o que não quiser; clique em Criar rascunhos.',
          'Abra cada rascunho, escolha a imagem e mande para aprovação.',
        ],
      },
      {
        id: 'postagens.conexao',
        title: 'Contas, grupos e métricas',
        steps: [
          'Na aba Contas, clique em Buscar na Meta e adicione a conta oficial e as dos vendedores; dê um grupo a cada uma (ex.: Oficial, Vendedores).',
          'O CRM usa o token de Configurações › Marketing Inteligente: as páginas (e o Instagram ligado a cada uma) precisam estar atribuídas ao usuário do sistema.',
          'Na aba Métricas: seguidores, alcance, interações e engajamento dos últimos 28 dias, por conta e por grupo; clique numa conta do Instagram para ver idade, gênero e cidades dos seguidores.',
          'Para publicar, o token precisa das permissões instagram_content_publish e pages_manage_posts. Use Testar publicação para conferir.',
          'Se uma postagem der erro, o motivo aparece nela; corrija e clique em Tentar de novo (só as redes que falharam).',
        ],
        tip: 'O Instagram aceita até 50 publicações por dia e imagens do feed entre 4:5 e 1,91:1 (o editor de imagem já enquadra).',
      },
    ],
  },
  {
    key: 'automacoes',
    title: 'Automações',
    module: 'automacoes',
    routes: ['/automacoes'],
    purpose: 'Fluxos que trabalham sozinhos: e-mails, tarefas e mudanças no lead a partir de um acontecimento.',
    howItWorks: 'Um fluxo começa com um gatilho (algo que o lead fez) e segue os passos em ordem: esperar, conferir uma condição e agir (e-mail, tag, vendedor, pré-venda). Cada lead anda no fluxo no seu tempo, e você acompanha quem está em cada passo no relatório.',
    media: { src: '/trilha/automacoes.jpg', alt: 'Editor de automação' },
    lessons: [
      {
        id: 'automacoes.fluxo',
        title: 'Criar um fluxo',
        steps: [
          'Abra Marketing → Automações → Novo fluxo.',
          'Escolha o gatilho (ex.: abandonou o carrinho, viu produtos da loja, entrou no Pré-Vendas).',
          'Adicione os passos: esperar, condição (sim/não, ex.: “Não comprou”) e ações (enviar e-mail, passar para vendedor, tag, abrir atendimento).',
          'Ligue o fluxo: só acontecimentos a partir daí fazem o lead entrar.',
        ],
        tip: 'Deixe “sair do fluxo quando comprar” ligado para ninguém receber oferta do que já comprou.',
      },
      {
        id: 'automacoes.whatsapp',
        title: 'Passo de WhatsApp (só com autorização)',
        steps: [
          'O passo Enviar WhatsApp manda a mensagem pelo número escolhido, com {nome} e {produto}, e pode abrir a pré-venda junto.',
          'Use só com a API oficial do WhatsApp e com clientes que autorizaram receber mensagens nos formulários.',
          'Sem isso, deixe o fluxo desligado: mensagem automática para quem não pediu contato pode bloquear o número.',
        ],
      },
      {
        id: 'automacoes.carrinho',
        title: 'E-mail de carrinho abandonado com os produtos e cupom',
        steps: [
          'Crie o cupom na Magazord (o mesmo código para todos os clientes).',
          'Em Email marketing → Modelos, monte o e-mail: arraste o bloco Produtos do carrinho (cada cliente recebe os produtos do carrinho dele, com foto, preço e o botão para finalizar a compra) e escreva a sua mensagem.',
          'Nas configurações do e-mail, preencha Cupom com o código da Magazord. No texto, use o botão de cupom da barra (ou escreva {cupom}): no envio, vira o código.',
          'No fluxo com o gatilho Abandonou o carrinho, coloque um passo Enviar e-mail com esse modelo. Se o cliente já comprou ou o carrinho está vazio, o e-mail não vai.',
        ],
        tip: 'Mande um e-mail de teste para você antes de ligar o fluxo: ele mostra um carrinho de exemplo e o cupom informado.',
      },
    ],
  },
  {
    key: 'analise',
    title: 'Dashboards e relatórios',
    module: 'relatorios',
    routes: ['/relatorios'],
    purpose: 'Visão geral do negócio e relatórios montados por você.',
    howItWorks: 'Os relatórios leem os mesmos dados das telas (leads, atendimentos, vendas, e-mails) e você escolhe como agrupar e medir. Os marcados para o painel aparecem no Início para todos que podem vê-los.',
    media: { src: '/trilha/analise.jpg', alt: 'Relatórios' },
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
    routes: ['/google-ads', '/configuracoes?secao=google-ads'],
    purpose: 'Quanto foi investido, quantos leads e vendas vieram e o custo de cada um, por campanha e palavra-chave.',
    howItWorks: 'O CRM lê o investimento da conta do Google Ads e liga cada lead ao clique no anúncio. Assim dá para ver o custo real de cada lead e de cada venda, e o CRM devolve ao Google quem virou venda, para as campanhas aprenderem.',
    media: { src: '/trilha/google-ads.jpg', alt: 'Painel do Google Ads' },
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
    key: 'marketing',
    title: 'Marketing Inteligente',
    module: 'mi_executivo',
    routes: ['/marketing'],
    purpose: 'Investimento, leads, atendimento, vendas e retorno de todos os canais num lugar só, para decidir com números.',
    howItWorks:
      'O módulo lê o Pré-Vendas (fonte da verdade: leads, atendimento, vendas e o valor da venda) e o investimento das plataformas (hoje o Google Ads, pelo script). Um lead conta uma vez, mesmo com vários atendimentos; conversões das plataformas não são somadas às vendas do CRM. Cada tela tem os mesmos filtros (período, plataforma, campanha, marca, tipo de peça, estado, região, filial, vendedor, origem, tipo de cliente e cliente novo/recorrente) e compara com o período anterior do mesmo tamanho. Cada parte do menu só aparece para quem tem a permissão no perfil.',
    lessons: [
      {
        id: 'mkt.ler',
        title: 'Ler o dashboard executivo',
        steps: [
          'Abra Marketing Inteligente → Dashboard executivo e escolha o período (ou as datas).',
          'Cada card mostra o valor, a variação contra o período anterior (verde quando melhora) e a tendência.',
          'Clique numa linha das tabelas (campanha, vendedor, região, marca) para filtrar a tela inteira por ela; use “Limpar filtros” para voltar.',
          'ROAS = faturamento atribuído ÷ investimento em mídia. ROI estimado usa a margem configurada (padrão 30%) e os custos fixos.',
        ],
        tip: 'Com filtro de marca, estado ou vendedor, o custo aparece como “—”: as plataformas não informam investimento por esses recortes.',
      },
      {
        id: 'mkt.funil',
        title: 'Funil, campanhas e recomendações',
        steps: [
          'Em Funil e atribuição, veja onde mais se perde (impressões → cliques → leads → atendidos → oportunidades → qualificados → vendas) e compare por plataforma, região, vendedor ou marca.',
          'Em Análise de campanhas, clique no nome para investigar uma campanha, ou marque duas ou mais para comparar lado a lado.',
          'Em Recomendações, cada diagnóstico traz os números que o sustentam, a ação sugerida e como medir. Nada é alterado nas plataformas.',
          'Gerar resumo (IA) escreve um resumo do período a partir dos números agregados, sem dados de clientes. Precisa da chave do Gemini (Configurações › E-mail marketing).',
        ],
      },
      {
        id: 'mkt.relatorios',
        title: 'Relatórios por e-mail, PDF/Excel e alertas',
        steps: [
          'Abra Marketing Inteligente → Relatórios e alertas → Novo relatório.',
          'Cadastre os e-mails, a frequência (todo dia, semana ou mês), o dia e o horário, o período, o que vai no relatório e se vai anexo em PDF ou Excel.',
          'Use Prévia para ver o e-mail com os dados de hoje e Enviar agora para mandar na hora. Na aba Baixar agora, gere o PDF ou o Excel com os filtros da tela.',
          'Na aba Alertas, crie avisos (gasto perto do limite, CPL subindo, campanha sem lead, leads sem atendimento, meta atrasada, dados desatualizados) e clique em Testar agora para ver se dispararia hoje.',
        ],
      },
      {
        id: 'mkt.resumo-vendedor',
        title: 'Resumo semanal de cada vendedor no WhatsApp',
        steps: [
          'Em Relatórios e alertas → Relatórios agendados, veja o cartão Resumo do vendedor (semanal, WhatsApp).',
          'Ligue o envio, escolha o horário da sexta, o número que envia, para quem vai e o que vai no resumo (leads repassados, vendas, conversão, valor, perdas e motivos, retorno ao cliente, clientes sem contato, comparação com o ciclo anterior e com a equipe, marcas, peças, origem e sugestões).',
          'O ciclo é de sexta a quinta (ex.: 16/10 a 22/10) e sai na sexta seguinte (23/10), só para quem teve cliente repassado. Confira a mensagem de cada vendedor na Prévia antes de ligar.',
        ],
        tip: 'O resumo vai para o telefone do cadastro do vendedor (Configurações › Vendedores): sem telefone, ele não recebe. Para o gestor receber o resumo da equipe, informe o WhatsApp dele no campo Também para o gestor. As mensagens saem uma por vez, com 2 a 10 minutos entre elas.',
      },
      {
        id: 'mkt.google',
        title: 'Google Ads: termos de pesquisa e negativas',
        steps: [
          'Em Marketing Inteligente → Google Ads, aba Termos de pesquisa: o que as pessoas digitaram antes de clicar.',
          'As sugestões de negativas mostram termos com palavra de alerta (emprego, curso, grátis…) ou com gasto e nenhuma conversão. Marque Negativar ou Manter.',
          'Baixe a lista de negativas aprovadas e aplique no Google Ads: o CRM nunca altera a conta.',
          'As outras abas mostram tipo de campanha, dispositivo, rede, região, anúncios e as páginas de destino com os leads do CRM.',
        ],
        tip: 'Os detalhes chegam com o script novo de Configurações › Google Ads (troque o script no Google Ads).',
      },
      {
        id: 'mkt.plano',
        title: 'Planejamento, metas e cenários',
        steps: [
          'Em Planejamento, escolha o mês e cadastre o orçamento (total e por plataforma) e as metas de leads, CPL, vendas e faturamento.',
          'A tela mostra o gasto, o saldo, a projeção até o fim do mês (com faixa) e se cada meta está no ritmo.',
          'Os cenários mostram o que pode acontecer com 15% ou 30% a mais ou a menos de investimento, como faixa: não é promessa.',
        ],
      },
      {
        id: 'mkt.redes',
        title: 'Meta, TikTok, redes sociais e SEO',
        steps: [
          'Meta Ads e TikTok Ads mostram campanhas, conjuntos, anúncios e criativos, com os leads e as vendas do CRM, e avisam anúncios cansados.',
          'Redes sociais mostra seguidores, alcance, as melhores publicações, formatos e temas, e o Calendário editorial para planejar as publicações.',
          'SEO e site mostra o Search Console (consultas, páginas, oportunidades), páginas de marcas e categorias e por onde os leads entram no site.',
          'Redes sociais também indica os melhores horários para postar no Instagram e no Facebook, pelo alcance das publicações dos últimos 90 dias.',
          'Tudo depende da conta conectada em Configurações › Marketing Inteligente; sem conta, a tela mostra “Não disponível”.',
        ],
      },
      {
        id: 'mkt.instagram',
        title: 'Instagram: perfis, horários e concorrentes',
        steps: [
          'Abra Marketing Inteligente › Instagram. No topo, escolha “Visão geral” (todos os perfis conectados) ou um perfil só.',
          'Visão geral, Conteúdo e Stories mostram seguidores, alcance, interações, publicações e cada story (guardado a cada 6 horas, antes de sumir).',
          'Melhores horários cruza as horas em que os seguidores estão online com o alcance das publicações e sugere os 3 melhores horários.',
          'Tráfego e leads separa anúncio de orgânico e mostra as visitas ao site. Lead é só quem preencheu formulário: seguidores, curtidas e mensagens não entram na base de leads.',
          'Em Perfis, cadastre os perfis dos vendedores: pelo Gerenciador de Negócios (dados completos) ou pelo @ (só dados públicos).',
          'Em Concorrentes, cadastre os @ e compare engajamento, feed, reels e frequência. Stories e anúncio ativo: confira no perfil e na Biblioteca de Anúncios e clique em Registrar.',
        ],
      },
    ],
  },
  {
    key: 'marketing-config',
    title: 'Marketing Inteligente: regras e integrações',
    module: 'mi_config',
    routes: ['/marketing/integracoes', '/configuracoes?secao=marketing-inteligente'],
    purpose: 'Definir como o módulo conta (lead qualificado, margem, custos, atribuição) e conectar Meta, TikTok e Search Console.',
    howItWorks:
      'Em Configurações › Marketing Inteligente ficam as regras das análises e as contas das plataformas, sempre só leitura: o CRM nunca altera campanha, orçamento ou anúncio. Os tokens ficam criptografados no servidor. A tela Integrações mostra a saúde de cada fonte e a qualidade dos dados dos leads (campanha identificada, origem, estado).',
    lessons: [
      {
        id: 'mkt.regras',
        title: 'Ajustar as regras',
        steps: [
          'Lead qualificado: repassado ao vendedor e com retorno do vendedor (padrão) ou só repassado.',
          'Margem de contribuição média (padrão 30%) e custos fixos de marketing por mês, para o ROI e o CAC.',
          'Origens do Pré-Vendas que também contam como marketing e o modelo/janela de atribuição.',
        ],
      },
      {
        id: 'mkt.contas',
        title: 'Conectar as plataformas',
        steps: [
          'Meta Ads: token do usuário do sistema do Business Manager (ads_read, read_insights) e as contas act_…',
          'TikTok Ads: token da Marketing API e o ID do anunciante. Search Console: adicione a conta de serviço do GA4 na propriedade.',
          'Salve e clique em Testar conexão; depois Sincronizar agora. A sincronização roda sozinha de tempos em tempos (Meta e TikTok a cada 3 h, redes e Search Console a cada 6 h).',
        ],
      },
    ],
  },
  {
    key: 'marketplaces',
    title: 'Marketplaces: Mercado Livre Ads',
    module: 'marketplaces',
    routes: ['/marketplaces', '/configuracoes?secao=marketplaces-conexoes'],
    purpose: 'Acompanhar a publicidade e as vendas nos marketplaces: hoje o Mercado Livre (Product Ads e Display Ads); depois, a Shopee.',
    howItWorks:
      'O CRM lê as campanhas do Mercado Livre a cada 6 horas, só leitura: nunca altera anúncio, preço ou orçamento. A receita é a que o Mercado Livre atribui aos anúncios (até 14 dias depois do clique), por isso os últimos 15 dias são refeitos a cada sincronização. A Visão geral junta a publicidade com as vendas por canal da loja virtual (Magazord).',
    lessons: [
      {
        id: 'mktp.painel',
        title: 'Ler o painel do Mercado Livre Ads',
        steps: [
          'Abra Marketplaces → Mercado Livre Ads (ou Dashboards → Mercado Livre Ads) e escolha o período.',
          'Investimento e receita atribuída vêm comparados com o período anterior. ROAS = receita ÷ investimento (não é lucro); ACOS = investimento ÷ receita (quanto menor, melhor).',
          'Escolha uma campanha no seletor para ver só ela. As abas mostram as campanhas, os anúncios com mais investimento e o Display Ads.',
          'Baixe qualquer tabela em CSV pelo botão no canto (precisa da permissão Exportar).',
        ],
      },
      {
        id: 'mktp.conectar',
        title: 'Conectar o Mercado Livre',
        steps: [
          'Abra Configurações → Marketplaces → Conexões dos marketplaces. Copie a URI de redirecionamento e acrescente no aplicativo do Mercado Livre (developers.mercadolivre.com.br).',
          'Digite o Client ID e o Client Secret do aplicativo e clique em Salvar credenciais.',
          'Clique em Conectar o Mercado Livre, entre com a conta da empresa e autorize. Escolha o anunciante do Product Ads, se houver mais de um.',
          'Clique em Sincronizar agora. Na primeira vez vêm os últimos 90 dias (limite do Mercado Livre).',
        ],
        tip: 'Quando o CRM conecta, a sincronização do sistema anterior para: o Mercado Livre aceita uma conexão por aplicativo.',
      },
    ],
  },
  {
    key: 'assistente-ml',
    title: 'Assistente das perguntas do Mercado Livre',
    module: 'assist_atendimento',
    routes: ['/marketplaces/assistente', '/configuracoes?secao=assistente-ml', '/configuracoes?secao=assistente-respostas', '/configuracoes?secao=assistente-ia', '/configuracoes?secao=assistente-testar'],
    purpose: 'Responder as perguntas dos clientes no Mercado Livre com a base de conhecimento, a IA e o frete calculado na Magazord, e acompanhar quais perguntas viraram venda.',
    howItWorks:
      'Cada pergunta nova é analisada: o assistente procura respostas aprovadas, aplicações peça × máquina confirmadas e os anúncios da loja (por título, código e OEM). Pergunta de frete com CEP é respondida com as opções da Magazord; sem CEP, o assistente pede o CEP. Com confiança alta e a resposta automática ligada, a resposta vai sozinha; senão, fica como sugestão ou entra na fila de pendentes com o motivo (A a G). Compatibilidade só é afirmada quando a aplicação está confirmada.',
    lessons: [
      {
        id: 'assist.pendentes',
        title: 'Atender as perguntas pendentes',
        steps: [
          'Abra Marketplaces → Perguntas pendentes. A fila vem da mais urgente para a menos: idade, intenção de compra, dúvida técnica e relevância.',
          'Abra a pergunta. Leia a análise do assistente (o que achou e o que faltou).',
          'Se houver sugestão, edite se precisar e clique em Aprovar e enviar. Ou escreva a resposta em Responder. "Rascunho pedindo informações" monta a pergunta ao cliente sobre modelo, ano ou código.',
          'Se precisar de outra pessoa, use Encaminhar para; mude a situação e o motivo quando fizer sentido.',
        ],
        tip: 'O Mercado Livre não aceita telefone, e-mail ou link de fora do Mercado Livre na resposta.',
      },
      {
        id: 'assist.conhecimento',
        title: 'Ensinar o assistente (base de conhecimento)',
        steps: [
          'Na pergunta, clique em Cadastrar conhecimento: a pergunta e a resposta já vêm preenchidas.',
          'Preencha marca, modelo, código e a aplicação confirmada. Marque "Cadastrar também a aplicação" para a IA poder afirmar a compatibilidade.',
          'Quem pode aprovar salva como Ativo; os demais salvam Em revisão e alguém aprova em Base de conhecimento.',
          'Para muitos de uma vez: Base de conhecimento → Importar planilha. Baixe o modelo, preencha e envie. Confira a prévia (novo, atualização, duplicado, erro), decida as atualizações e confirme.',
        ],
      },
      {
        id: 'assist.config',
        title: 'Configurar e passar o atendimento para o CRM',
        steps: [
          'Abra Configurações → Marketplaces → Assistente ML: motor de IA. Escolha Sem IA, Gemini ou Claude e salve a chave do provedor escolhido.',
          'Na aba Respostas, ajuste a resposta automática e a confiança mínima, os textos de frete e quando pedir informação ou encaminhar.',
          'Use a aba Testar o assistente com perguntas reais: nada é enviado ao cliente.',
          'Na aba Integração, informe a loja oficial, sincronize os anúncios e clique em Assumir o atendimento. Depois, peça para parar o painel antigo no servidor.',
        ],
        tip: 'Enquanto o CRM não assume, o painel antigo continua respondendo e o CRM só mostra os dados e testa.',
      },
    ],
  },

  {
    key: 'whatsapp-dash',
    title: 'Atendimento WhatsApp (painel)',
    module: 'chat',
    routes: ['/whatsapp/dashboard'],
    purpose: 'Tempo de resposta, volume, situação agora e o resultado comercial das conversas.',
    howItWorks: 'O painel mede cada conversa: quanto tempo o cliente esperou pela primeira resposta (contando só o horário comercial), quantas ficaram sem resposta e quantas viraram pré-venda e venda.',
    media: { src: '/trilha/whatsapp-dash.jpg', alt: 'Painel de atendimento WhatsApp' },
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
    key: 'whatsapp-config',
    title: 'WhatsApp: números, setores e robô',
    module: 'whatsapp',
    routes: ['/configuracoes?secao=whatsapp-numeros', '/configuracoes?secao=setores', '/configuracoes?secao=chatbot', '/configuracoes?secao=whatsapp-regras', '/configuracoes?secao=respostas-rapidas', '/configuracoes?secao=etiquetas'],
    purpose: 'Configurar os números, quem atende cada um, o robô de atendimento, as regras e as respostas prontas.',
    howItWorks: 'Cada número é conectado lendo o QR Code no celular. Setores dizem quem atende em quais números e quem gerencia; o robô (sem IA) recebe o cliente, mostra um menu e passa para o setor ou a pessoa certa. As regras dizem o que vira lead e pré-venda, o horário comercial e as mensagens de ausência e de encerramento.',
    media: { src: '/trilha/whatsapp-config.jpg', alt: 'Configuração dos números de WhatsApp' },
    lessons: [
      {
        id: 'admin.whatsapp',
        title: 'Números de WhatsApp',
        steps: [
          'Em Configurações → Números de WhatsApp, cadastre o número e clique em Conectar para ler o QR Code no celular.',
          'Ligue os usuários e vendedores que usam o número; ligue o atendimento dividido e os setores, se for o caso.',
          'Em Configurações → Regras e horário, defina o que vira lead e pré-venda, o horário comercial, a mensagem de ausência e a de encerramento.',
        ],
      },
      {
        id: 'waconfig.setores',
        title: 'Setores, equipes e gestores',
        steps: [
          'Em Configurações → Setores e equipes, crie os setores (Vendas, Pós-venda, Financeiro...).',
          'Em cada setor, escolha os números em que atende, quem atende e quem gerencia (o gestor monitora a equipe).',
          'Ligue cada vendedor a um ou mais gestores para eles acompanharem as conversas da equipe.',
        ],
      },
      {
        id: 'waconfig.chatbot',
        title: 'Robô de atendimento (chatbot)',
        steps: [
          'Em Configurações → Chatbot de atendimento, crie um fluxo com mensagens, menu de opções, perguntas e transferência para setor ou pessoa.',
          'Escolha quando começa: conversa nova ou parada, ou por palavra-chave (ex.: garantia), em todos ou alguns números, e se é só fora do horário.',
          'Teste no simulador ao lado (nada é enviado de verdade) e só então ligue o fluxo.',
        ],
        media: { src: '/trilha/chatbot.webm', alt: 'Testando o robô de atendimento no simulador', kind: 'video' },
      },
      {
        id: 'waconfig.respostas',
        title: 'Respostas rápidas e etiquetas da empresa',
        steps: [
          'Em Configurações → Respostas rápidas, crie os textos padrão para todos, com {nome} e {vendedor}; anexe um arquivo (catálogo em PDF, tabela) se quiser que ele vá junto.',
          'Em Configurações → Etiquetas do chat, crie as etiquetas padrão da empresa (cada pessoa também pode ter as suas).',
        ],
      },
    ],
  },
  {
    key: 'sugestoes',
    title: 'Sugestões de melhoria',
    routes: ['/sugestoes'],
    purpose: 'Mandar ideias para melhorar o sistema e acompanhar a resposta.',
    howItWorks: 'Cada sugestão vai para quem cuida do sistema, que responde e muda a situação (em análise, planejada, feita). Você é avisado a cada resposta.',
    media: { src: '/trilha/sugestoes.jpg', alt: 'Sugestões de melhoria' },
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
    title: 'Administração e configurações',
    module: 'usuarios',
    routes: ['/configuracoes', '/auditoria', '/sugestoes/analisar'],
    purpose: 'Configurações (empresa, equipe e acesso, marketing e integrações) e auditoria.',
    howItWorks: 'Tudo que é ajuste do sistema fica em Configurações, separado por grupo (Empresa, Equipe e acesso, Pré e Pós-Vendas, WhatsApp, Leads e marketing, Integrações). Cada pessoa vê só as seções que o perfil dela permite, e cada mudança fica na auditoria.',
    media: { src: '/trilha/admin.jpg', alt: 'Configurações do sistema' },
    lessons: [
      {
        id: 'admin.empresa',
        title: 'Identidade da empresa',
        steps: [
          'Em Configurações → Identidade da empresa, ajuste nome, logo e dados que aparecem nos e-mails e mensagens.',
          'Mudou o nome da empresa? Use “Trocar o nome nos textos” para atualizar as mensagens e textos já salvos de uma vez.',
          'Em Aparência, escolha as cores do sistema.',
        ],
      },
      {
        id: 'admin.usuarios',
        title: 'Cadastrar um usuário',
        steps: [
          'Abra Configurações → Usuários → Novo usuário, com nome, e-mail e perfil.',
          'A pessoa recebe o convite por e-mail e cria a senha (com 2 fatores, se o perfil exigir).',
          'Para quem saiu da empresa: Desativar (o histórico continua; dá para reativar depois).',
        ],
      },
      {
        id: 'admin.perfis',
        title: 'Ajustar um perfil de acesso',
        steps: [
          'Em Configurações → Perfis de acesso, abra o perfil e marque o que ele pode ver, criar, editar, excluir e exportar.',
          'Em Leads, Pré/Pós-Vendas e Chat, escolha o escopo: próprios, da unidade ou todos.',
          'Quem precisa marcar retorno e venda na pré-venda precisa de “Editar” em Pré-Vendas.',
          'Use o Gestor comercial para quem acompanha a equipe (inclui monitorar conversas).',
        ],
      },
      {
        id: 'admin.integracoes',
        title: 'Integrações',
        steps: [
          'Servidor de e-mail (SMTP): de onde saem os e-mails do sistema e das campanhas.',
          'Rastreamento do site e Google Analytics: o código que registra visitas e produtos vistos.',
          'Loja virtual (Magazord), Meta Lead Ads, Google Ads e Tcar: cada uma tem o seu passo a passo na própria seção, com o botão de testar a conexão.',
        ],
        tip: 'Chaves e senhas das integrações ficam criptografadas: nem quem administra consegue ver depois de salvas.',
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
