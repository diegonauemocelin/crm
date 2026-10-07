/**
 * Parte do script do site que desenha a captura: formulários embutidos (<div data-usacrm-form="ID">),
 * pop-ups e o botão de WhatsApp. Roda dentro do script de rastreamento (mesmas variáveis w, d, C, get).
 *
 * Segurança: tudo é montado com createElement/textContent (nada de innerHTML com texto do painel), dentro de
 * Shadow DOM (o CSS da loja não quebra o formulário e vice-versa). Consentimento nunca vem marcado.
 */
export const CAPTURE_JS = `
  // ---------- Captura: formulários, pop-ups e botão de WhatsApp ----------
  var BASE = C.e.replace(/\\/api\\/public\\/rastreamento\\/coleta$/, '');
  var UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
  var CSS = ':host{all:initial}*{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}'
    + '.f{display:flex;flex-direction:column;gap:10px;font-size:14px;color:#111}'
    + '.f label{display:flex;flex-direction:column;gap:4px;font-weight:600;font-size:13px}'
    + '.f input,.f select,.f textarea{font:inherit;font-weight:400;padding:9px 10px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#111;width:100%}'
    + '.f textarea{min-height:80px;resize:vertical}'
    + '.f .chk{flex-direction:row;align-items:flex-start;gap:8px;font-weight:400;font-size:12px;color:#334155}'
    + '.f .chk input{width:auto;margin-top:2px}'
    + '.f .err{color:#b91c1c;font-size:12px;font-weight:400}'
    + '.f button{font:inherit;font-weight:700;border:0;border-radius:8px;padding:11px 14px;color:#fff;cursor:pointer}'
    + '.f button[disabled]{opacity:.6;cursor:default}'
    + '.f .msg{font-size:13px;color:#334155}.f .ok{font-size:15px;color:#065f46;font-weight:600;padding:8px 0}'
    + '.f .priv{font-size:11px;color:#64748b}.f .priv a{color:inherit}'
    + '.hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}'
    + '.ov{position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;z-index:2147483000;padding:16px}'
    + '.card{background:#fff;border-radius:14px;max-width:420px;width:100%;max-height:92vh;overflow:auto;box-shadow:0 20px 50px rgba(0,0,0,.3);position:relative}'
    + '.card img{width:100%;display:block;border-radius:14px 14px 0 0;max-height:200px;object-fit:cover}'
    + '.card .in{padding:18px}.card h2{margin:0 0 6px;font-size:20px;color:#0f172a}.card p.t{margin:0 0 12px;color:#334155;font-size:14px}'
    + '.x{position:absolute;top:8px;right:8px;width:32px;height:32px;border-radius:50%;border:0;background:rgba(255,255,255,.9);font-size:18px;cursor:pointer;color:#0f172a}'
    + '.wa{position:fixed;bottom:18px;z-index:2147482999;display:flex;align-items:center;gap:8px;border:0;border-radius:999px;padding:12px 16px;color:#fff;font-weight:700;font-size:14px;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.25)}'
    + '.wa svg{width:22px;height:22px;fill:#fff}'
    + '.pn{position:fixed;bottom:84px;z-index:2147483000;width:320px;max-width:calc(100vw - 24px);background:#fff;border-radius:14px;box-shadow:0 20px 50px rgba(0,0,0,.3);overflow:hidden}'
    + '.pn .hd{padding:14px 16px;color:#fff}.pn .hd b{display:block;font-size:16px}.pn .hd span{font-size:13px;opacity:.95}.pn .in{padding:14px 16px}'
    + '@media (max-width:640px){.wa .lb{display:none}.wa{padding:14px}}';
  var WA_ICON = 'M16 3C8.8 3 3 8.7 3 15.8c0 2.5.7 4.9 2 7L3 29l6.4-2c2 1.1 4.3 1.7 6.6 1.7 7.2 0 13-5.7 13-12.8S23.2 3 16 3zm0 23.3c-2.1 0-4.1-.6-5.9-1.6l-.4-.2-3.8 1.2 1.2-3.7-.3-.4c-1.1-1.8-1.7-3.8-1.7-5.9C5.1 9.9 10 5.1 16 5.1s10.9 4.8 10.9 10.7S22 26.3 16 26.3zm6-8c-.3-.2-1.9-.9-2.2-1s-.5-.2-.7.2-.8 1-1 1.2-.4.2-.7.1c-.3-.2-1.4-.5-2.6-1.6-1-.9-1.6-1.9-1.8-2.2s0-.5.1-.6l.5-.6c.2-.2.2-.4.3-.6.1-.2 0-.4 0-.6l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4s-1.2 1.1-1.2 2.7 1.2 3.2 1.4 3.4c.2.2 2.4 3.6 5.8 5.1.8.3 1.4.5 1.9.7.8.3 1.5.2 2.1.1.6-.1 1.9-.8 2.2-1.5.3-.7.3-1.4.2-1.5-.1-.1-.3-.2-.6-.4z';
  var CFG = null;
  function el(tag, cls, text) { var e = d.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }
  function shadowHost() { var h = d.createElement('div'); var r = h.attachShadow ? h.attachShadow({ mode: 'open' }) : h; var s = el('style'); s.textContent = CSS; r.appendChild(s); return { h: h, r: r }; }
  function isMobile() { return /Mobi|Android|iPhone|iPod/i.test(nav.userAgent || '') || (w.matchMedia && w.matchMedia('(max-width: 768px)').matches); }
  function deviceOk(dev) { return dev === 'todos' || !dev || (dev === 'celular' ? isMobile() : !isMobile()); }
  function pageOk(inc, exc) {
    var p = (location.pathname + location.search).toLowerCase(), hs = location.hostname.toLowerCase();
    function pathHit(x) { return x.slice(-1) === '*' ? p.indexOf(x.slice(0, -1)) === 0 : p === x || p.indexOf(x) >= 0; }
    // Aceita caminho ("/produto/*") ou domínio com caminho opcional ("teste.usaparts.com.br/ofertas*").
    function hit(x) {
      x = String(x || '').trim().toLowerCase(); if (!x) return false;
      var m = x.charAt(0) !== '/' && /^(?:https?:\\/\\/)?([a-z0-9-]+(?:\\.[a-z0-9-]+)+)(\\/.*)?$/.exec(x);
      if (m) { var dom = m[1].replace(/^www\\./, ''); if (hs !== dom && hs !== 'www.' + dom) return false; x = m[2] || ''; return !x || x === '/' || x === '/*' || pathHit(x); }
      return pathHit(x);
    }
    for (var i = 0; i < (exc || []).length; i++) if (hit(exc[i])) return false;
    var list = (inc || []).filter(function (x) { return String(x || '').trim(); });
    if (!list.length) return true;
    for (var j = 0; j < list.length; j++) if (hit(list[j])) return true;
    return false;
  }
  function store(k, v) { try { if (v === undefined) return w.localStorage.getItem(k); w.localStorage.setItem(k, v); } catch (e) { return null; } }
  function capSend(payload, done) {
    payload.k = C.k; payload.u = location.href; var vid = get('_crm_vid'); if (vid) payload.v = vid;
    fetch(BASE + '/api/public/captura/enviar', { method: 'POST', body: JSON.stringify(payload), credentials: 'omit' })
      .then(function (r) { return r.json(); }).then(done)
      .catch(function () { done({ ok: false, message: 'Não foi possível enviar agora. Tente novamente.' }); });
  }
  function go(url) {
    if (!url || !/^https?:\\/\\//.test(url)) return;
    if (/^https:\\/\\/wa\\.me\\//.test(url) && !isMobile()) { var win = w.open(url, '_blank', 'noopener'); if (win) return; }
    location.href = url;
  }
  function field(f) {
    var lb = el('label'); lb.appendChild(d.createTextNode(f.label + (f.required ? ' *' : '')));
    var input;
    if (f.key === 'message') input = el('textarea');
    else if (f.key === 'state' || f.type === 'uf') { input = el('select'); input.appendChild(el('option', null, 'Selecione')).value = ''; UFS.forEach(function (u) { input.appendChild(el('option', null, u)).value = u; }); }
    else if ((f.type === 'select' || f.type === 'multiselect') && f.options) { input = el('select'); if (f.type === 'multiselect') input.multiple = true; else input.appendChild(el('option', null, 'Selecione')).value = ''; f.options.forEach(function (o) { input.appendChild(el('option', null, o)).value = o; }); }
    else if (f.type === 'boolean') { input = el('select'); [['', 'Selecione'], ['Sim', 'Sim'], ['Não', 'Não']].forEach(function (o) { input.appendChild(el('option', null, o[1])).value = o[0]; }); }
    else { input = el('input'); input.type = f.key === 'email' ? 'email' : f.key === 'phone' ? 'tel' : f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text';
      if (f.key === 'phone') { input.placeholder = '(00) 00000-0000'; input.autocomplete = 'tel'; } if (f.key === 'email') input.autocomplete = 'email'; if (f.key === 'name') input.autocomplete = 'name'; }
    input.name = f.key; if (f.required) input.required = true; input.maxLength = f.key === 'message' ? 2000 : 200;
    lb.appendChild(input); var er = el('span', 'err'); lb.appendChild(er);
    return { lb: lb, input: input, err: er, f: f };
  }
  /** Monta um formulário. opts: { kind, formId, popupId, color, fields?, submitLabel?, consentText?, onDone } */
  function renderForm(root, opts) {
    var started = Date.now();
    var form = el('form', 'f'); form.noValidate = true;
    var list = opts.fields.map(field); list.forEach(function (x) { form.appendChild(x.lb); });
    var hp = el('input', 'hp'); hp.name = 'website'; hp.tabIndex = -1; hp.autocomplete = 'off'; form.appendChild(hp);
    var consent = null;
    if (opts.consentText) { var cl = el('label', 'chk'); consent = el('input'); consent.type = 'checkbox'; cl.appendChild(consent); cl.appendChild(d.createTextNode(opts.consentText)); form.appendChild(cl); }
    if (CFG && CFG.privacyUrl) { var pv = el('span', 'priv', 'Seus dados são tratados conforme a nossa '); var a = el('a', null, 'Política de Privacidade'); a.href = CFG.privacyUrl; a.target = '_blank'; a.rel = 'noopener'; pv.appendChild(a); pv.appendChild(d.createTextNode('.')); form.appendChild(pv); }
    var msg = el('div', 'msg'); var btn = el('button', null, opts.submitLabel || 'Enviar'); btn.type = 'submit'; btn.style.background = opts.color || '#1d4ed8';
    form.appendChild(btn); form.appendChild(msg);
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var data = {};
      list.forEach(function (x) { x.err.textContent = ''; var v = x.input.multiple ? Array.prototype.filter.call(x.input.options, function (o) { return o.selected; }).map(function (o) { return o.value; }) : x.input.value; data[x.f.key] = v; });
      btn.disabled = true; msg.textContent = '';
      capSend({ kind: opts.kind, formId: opts.formId, popupId: opts.popupId, whatsappId: opts.whatsappId, d: data, consent: consent ? consent.checked : undefined, hp: hp.value, t: Date.now() - started }, function (res) {
        btn.disabled = false;
        if (!res || !res.ok) {
          msg.textContent = (res && res.message) || 'Não foi possível enviar.';
          if (res && res.errors) list.forEach(function (x) { if (res.errors[x.f.key]) x.err.textContent = res.errors[x.f.key]; });
          return;
        }
        form.textContent = ''; form.appendChild(el('div', 'ok', res.message || 'Enviado!'));
        if (opts.onDone) opts.onDone(res);
        if (res.redirect) setTimeout(function () { go(res.redirect); }, opts.kind === 'whatsapp' ? 0 : 1200);
      });
    });
    root.appendChild(form);
    return form;
  }
  function embedForms() {
    var nodes = d.querySelectorAll('[data-usacrm-form]');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i]; if (n.__crm) continue; var f = CFG.forms[n.getAttribute('data-usacrm-form')]; if (!f) continue; n.__crm = 1;
      var hh = shadowHost(); n.appendChild(hh.h);
      renderForm(hh.r, { kind: n.getAttribute('data-usacrm-kind') === 'landing' ? 'landing' : 'form', formId: f.id, fields: f.fields, submitLabel: f.submitLabel, consentText: f.consentText, color: n.getAttribute('data-color') || '#1d4ed8' });
    }
  }
  function showPopup(p) {
    var f = CFG.forms[p.formId]; if (!f) return;
    var hh = shadowHost(); var ov = el('div', 'ov'); var card = el('div', 'card'); ov.appendChild(card);
    function close() { store('_crm_pp_' + p.id, String(Date.now())); if (hh.h.parentNode) hh.h.parentNode.removeChild(hh.h); }
    var x = el('button', 'x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Fechar'); x.onclick = close; card.appendChild(x);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    if (p.imageUrl && /^https:\\/\\//.test(p.imageUrl)) { var img = el('img'); img.src = p.imageUrl; img.alt = ''; card.appendChild(img); }
    var inner = el('div', 'in'); card.appendChild(inner); inner.appendChild(el('h2', null, p.title)); if (p.text) inner.appendChild(el('p', 't', p.text));
    renderForm(inner, { kind: 'popup', formId: f.id, popupId: p.id, fields: f.fields, submitLabel: f.submitLabel, consentText: f.consentText, color: p.color, onDone: function () { store('_crm_pp_' + p.id, String(Date.now())); } });
    hh.r.appendChild(ov); d.body.appendChild(hh.h);
    capSend({ kind: 'popup_view', popupId: p.id }, function () {});
  }
  function popups() {
    var shown = false;
    (CFG.popups || []).forEach(function (p) {
      if (shown || !deviceOk(p.device) || !pageOk(p.include, p.exclude)) return;
      var last = Number(store('_crm_pp_' + p.id) || 0); if (last && Date.now() - last < p.frequencyDays * 864e5) return;
      shown = true; var fired = false; function fire() { if (fired) return; fired = true; showPopup(p); }
      if (p.trigger === 'exit' && !isMobile()) d.addEventListener('mouseout', function (e) { if (!e.relatedTarget && e.clientY <= 0) fire(); });
      else if (p.trigger === 'scroll') w.addEventListener('scroll', function () { var h = d.documentElement; if ((h.scrollTop + w.innerHeight) / Math.max(1, h.scrollHeight) * 100 >= p.scrollPct) fire(); }, { passive: true });
      else setTimeout(fire, Math.max(0, (p.trigger === 'exit' ? 30 : p.delaySec) * 1000));
    });
  }
  function whatsapp() {
    // Vários botões: vale o primeiro (pela ordem do painel) que combina com a página e o dispositivo.
    var list = CFG.whatsapps || (CFG.whatsapp ? [CFG.whatsapp] : []), c = null;
    for (var i = 0; i < list.length; i++) if (deviceOk(list[i].device) && pageOk(list[i].include, list[i].exclude)) { c = list[i]; break; }
    if (!c) return;
    var hh = shadowHost(); var side = c.position === 'esquerda' ? 'left' : 'right';
    var b = el('button', 'wa'); b.type = 'button'; b.style.background = c.color; b.style[side] = '18px'; b.setAttribute('aria-label', c.buttonText);
    var ns = 'http://www.w3.org/2000/svg'; var svg = d.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 32 32'); var path = d.createElementNS(ns, 'path'); path.setAttribute('d', WA_ICON); svg.appendChild(path); b.appendChild(svg);
    b.appendChild(el('span', 'lb', c.buttonText));
    var panel = null;
    b.onclick = function () {
      if (panel) { panel.parentNode.removeChild(panel); panel = null; return; }
      panel = el('div', 'pn'); panel.style[side] = '18px';
      var hd = el('div', 'hd'); hd.style.background = c.color; hd.appendChild(el('b', null, c.title)); if (c.subtitle) hd.appendChild(el('span', null, c.subtitle)); panel.appendChild(hd);
      var inner = el('div', 'in'); panel.appendChild(inner);
      var fields = [{ key: 'name', label: 'Nome', required: true }, { key: 'phone', label: 'WhatsApp', required: true }];
      if (c.askEmail) fields.push({ key: 'email', label: 'E-mail', required: false });
      renderForm(inner, { kind: 'whatsapp', whatsappId: c.id, fields: fields, submitLabel: 'Iniciar conversa', color: c.color });
      hh.r.appendChild(panel);
    };
    hh.r.appendChild(b); d.body.appendChild(hh.h);
  }
  function startCapture() {
    if (w.__crmCap || typeof fetch !== 'function' || !d.body) return; w.__crmCap = 1;
    fetch(BASE + '/api/public/captura/config?k=' + encodeURIComponent(C.k), { credentials: 'omit' })
      .then(function (r) { return r.json(); })
      .then(function (cfg) {
        CFG = cfg || {}; CFG.forms = CFG.forms || {}; embedForms(); popups(); whatsapp();
        // Lojas que montam o conteúdo depois de abrir a página (ex.: Magazord): desenha os formulários quando o marcador aparecer.
        w.__crmEmbed = embedForms;
        if (w.MutationObserver) { var tm = null; new MutationObserver(function () { if (tm) return; tm = setTimeout(function () { tm = null; embedForms(); }, 300); }).observe(d.body, { childList: true, subtree: true }); }
      })
      .catch(function () {});
  }
`
