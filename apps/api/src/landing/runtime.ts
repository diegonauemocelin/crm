/**
 * Script das landing pages publicadas (servido em /api/public/lp/runtime.js, mesmo endereço da página: nenhum
 * script inline). Conta visitas, rolagem e cliques; envia os formulários; mostra a contagem regressiva; pede o
 * aceite de cookies (LGPD) antes de carregar GA4, Meta Pixel e a tag do Google Ads.
 */
export const LP_RUNTIME = String.raw`(function () {
  'use strict';
  var d = document, w = window;
  var el = d.getElementById('lp-cfg');
  if (!el) return;
  var C; try { C = JSON.parse(el.textContent || '{}'); } catch (e) { return; }
  var API = '/api/public/lp';
  var started = Date.now();

  function getCookie(n) { var m = d.cookie.match(new RegExp('(?:^|; )' + n + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : null; }
  function setCookie(n, v, age) { d.cookie = n + '=' + encodeURIComponent(v) + '; Max-Age=' + age + '; Path=/; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : ''); }
  function rid() { var a = new Uint8Array(12); (w.crypto || w.msCrypto).getRandomValues(a); return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }

  // Consentimento (LGPD): sem aceite, o identificador fica só nesta aba e nenhuma ferramenta de terceiros carrega.
  var needsConsent = !!(C.ga4 || C.px || (C.ads && C.ads.tagId));
  var consent = getCookie('_lp_ok');
  function visitor() {
    var v = getCookie('_lp_vid');
    if (v) return v;
    try { v = sessionStorage.getItem('_lp_vid'); } catch (e) {}
    if (!v) { v = rid(); try { sessionStorage.setItem('_lp_vid', v); } catch (e) {} }
    if (consent === '1' || !needsConsent) setCookie('_lp_vid', v, 31536000);
    return v;
  }

  // Origem da visita: UTMs ou marca de anúncio (gclid, fbclid). Guardada na aba para os eventos seguintes.
  function origin() {
    var saved; try { saved = JSON.parse(sessionStorage.getItem('_lp_src') || 'null'); } catch (e) {}
    var q = new URLSearchParams(location.search);
    var o = null;
    if (q.get('utm_source')) o = { s: q.get('utm_source'), m: q.get('utm_medium') || '', c: q.get('utm_campaign') || '' };
    else if (q.get('gclid') || q.get('gbraid') || q.get('wbraid')) o = { s: 'google', m: 'cpc', c: q.get('utm_campaign') || '' };
    else if (q.get('fbclid')) o = { s: 'facebook', m: 'paid', c: '' };
    else if (!saved) {
      var r = d.referrer ? (function () { try { return new URL(d.referrer).hostname; } catch (e) { return ''; } })() : '';
      o = r && r !== location.hostname ? { s: r.replace(/^www\./, ''), m: 'referral', c: '' } : { s: 'direto', m: 'direto', c: '' };
    }
    if (o) { try { sessionStorage.setItem('_lp_src', JSON.stringify(o)); } catch (e) {} return o; }
    return saved || { s: 'direto', m: 'direto', c: '' };
  }
  var SRC = origin();

  function send(type) {
    var body = JSON.stringify({ p: C.p, x: C.x, e: type, v: visitor(), s: SRC.s, m: SRC.m, c: SRC.c });
    try {
      if (navigator.sendBeacon) navigator.sendBeacon(API + '/evento', new Blob([body], { type: 'application/json' }));
      else fetch(API + '/evento', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true });
    } catch (e) {}
  }

  // ---- Ferramentas de terceiros (só depois do aceite) ----
  var loaded = false;
  function gtag() { w.dataLayer = w.dataLayer || []; w.dataLayer.push(arguments); }
  function loadTools() {
    if (loaded) return; loaded = true;
    var tagId = C.ga4 || (C.ads && C.ads.tagId);
    if (tagId) {
      var s = d.createElement('script'); s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(tagId); d.head.appendChild(s);
      w.gtag = w.gtag || gtag;
      w.gtag('js', new Date());
      if (C.ga4) w.gtag('config', C.ga4, { page_title: d.title, lp_variant: C.x });
      if (C.ads && C.ads.tagId) w.gtag('config', C.ads.tagId);
    }
    if (C.px) {
      (function (f, b, e, v, n, t, s) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); }; if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = []; t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s); })(w, d, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
      w.fbq('init', C.px); w.fbq('track', 'PageView');
    }
    if (w.usaCrm) w.usaCrm('consent', true);
  }
  function track(kind) {
    if (!loaded) return;
    if (w.gtag) {
      if (C.ga4) w.gtag('event', kind === 'lead' ? 'generate_lead' : kind === 'whatsapp' ? 'contact' : 'select_content', { method: kind, lp_variant: C.x, content_type: 'landing_page' });
      if (C.ads) {
        var to = kind === 'lead' ? C.ads.formSendTo : kind === 'whatsapp' ? C.ads.whatsappSendTo : '';
        if (to) w.gtag('event', 'conversion', { send_to: to });
      }
    }
    if (w.fbq) w.fbq('track', kind === 'lead' ? 'Lead' : 'Contact');
  }

  function banner() {
    if (!needsConsent || consent) { if (consent === '1' || !needsConsent) loadTools(); return; }
    var b = d.createElement('div'); b.className = 'cookie'; b.setAttribute('role', 'dialog'); b.setAttribute('aria-label', 'Cookies');
    var p = d.createElement('p'); p.textContent = C.ck || 'Usamos cookies para medir as visitas e melhorar nossos anúncios.';
    if (C.pv) { var a = d.createElement('a'); a.href = C.pv; a.target = '_blank'; a.rel = 'noopener'; a.textContent = ' Política de privacidade'; p.appendChild(a); }
    var row = d.createElement('div');
    var no = d.createElement('button'); no.className = 'btn outline'; no.type = 'button'; no.textContent = 'Recusar';
    var ok = d.createElement('button'); ok.className = 'btn'; ok.type = 'button'; ok.textContent = 'Aceitar';
    no.onclick = function () { setCookie('_lp_ok', '0', 15552000); consent = '0'; b.remove(); };
    ok.onclick = function () { setCookie('_lp_ok', '1', 31536000); consent = '1'; visitor(); b.remove(); loadTools(); };
    row.appendChild(no); row.appendChild(ok); b.appendChild(p); b.appendChild(row); d.body.appendChild(b);
  }

  // ---- Eventos da página ----
  send('view');
  banner();
  var scrolled = false;
  w.addEventListener('scroll', function () {
    if (scrolled) return;
    var h = d.documentElement;
    if ((h.scrollTop + w.innerHeight) / h.scrollHeight >= 0.5) { scrolled = true; send('scroll'); }
  }, { passive: true });
  d.addEventListener('click', function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest('[data-lp-cta],[data-lp-wa]') : null;
    if (!a) return;
    var kind = a.hasAttribute('data-lp-wa') ? 'whatsapp' : 'cta';
    send(kind); track(kind);
  });

  // ---- Contagem regressiva ----
  Array.prototype.forEach.call(d.querySelectorAll('[data-lp-ate]'), function (box) {
    var end = Number(box.getAttribute('data-lp-ate'));
    function tick() {
      var s = Math.max(0, Math.floor((end - Date.now()) / 1000));
      if (!s) { box.remove(); return; }
      var v = { d: Math.floor(s / 86400), h: Math.floor(s % 86400 / 3600), m: Math.floor(s % 3600 / 60), s: s % 60 };
      Object.keys(v).forEach(function (k) { var n = box.querySelector('[data-k="' + k + '"]'); if (n) n.textContent = (v[k] < 10 ? '0' : '') + v[k]; });
      setTimeout(tick, 1000);
    }
    tick();
  });

  // ---- Formulários (o lead nasce aqui) ----
  Array.prototype.forEach.call(d.querySelectorAll('[data-lp-form]'), function (form) {
    var shown = Date.now();
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var msg = form.querySelector('.msg'); var btn = form.querySelector('button[type=submit]');
      msg.textContent = ''; msg.className = 'msg';
      Array.prototype.forEach.call(form.querySelectorAll('.fld'), function (f) { f.classList.remove('bad'); var e = f.querySelector('.err'); if (e) e.textContent = ''; });
      var data = {}; var missing = false;
      Array.prototype.forEach.call(form.querySelectorAll('input,select,textarea'), function (i) {
        if (!i.name || i.name.charAt(0) === '_') return;
        data[i.name] = i.value.trim();
        if (i.required && !data[i.name]) { missing = true; var f = i.closest('.fld'); f.classList.add('bad'); f.querySelector('.err').textContent = 'Preencha este campo.'; }
      });
      if (missing) { msg.textContent = 'Confira os campos destacados.'; msg.className = 'msg bad'; return; }
      var consentBox = form.querySelector('input[name=_consent]');
      var payload = {
        p: C.p, x: C.x, kind: form.getAttribute('data-kind'), id: form.getAttribute('data-id'), d: data,
        consent: consentBox ? consentBox.checked : false, hp: (form.querySelector('input[name=_hp]') || {}).value || '',
        t: Date.now() - shown, v: visitor(), cv: getCookie('_crm_vid') || '', u: location.href, s: SRC.s, m: SRC.m, c: SRC.c
      };
      btn.disabled = true;
      fetch(API + '/enviar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        .then(function (r) { return r.json(); })
        .then(function (r) {
          btn.disabled = false;
          if (!r || !r.ok) {
            msg.textContent = (r && r.message) || 'Não foi possível enviar. Tente de novo.'; msg.className = 'msg bad';
            if (r && r.errors) Object.keys(r.errors).forEach(function (k) { var e = form.querySelector('[data-err="' + k + '"]'); if (e) { e.textContent = r.errors[k]; e.closest('.fld').classList.add('bad'); } });
            return;
          }
          track(payload.kind === 'whatsapp' ? 'whatsapp' : 'lead');
          if (r.redirect) { w.location.href = r.redirect; return; }
          var ok = form.parentNode.querySelector('.ok');
          if (ok) { form.hidden = true; ok.hidden = false; if (r.message) ok.querySelector('p').textContent = r.message; }
          else { msg.textContent = r.message || 'Recebido.'; form.reset(); }
        })
        .catch(function () { btn.disabled = false; msg.textContent = 'Sem conexão. Tente de novo.'; msg.className = 'msg bad'; });
    });
  });
})();
`
