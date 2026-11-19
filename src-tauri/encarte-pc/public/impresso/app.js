// Editor do impresso (cartaz de produto único). Caminho separado do encarte: só LÊ o banco de
// fotos, a busca (/encarte/busca.js) e as fontes; grava nas tabelas impresso_* (docs/IMPRESSO.md).
'use strict';
const $ = s => document.querySelector(s);
const API = '/api/impresso';
const URLP = new URLSearchParams(location.search);
const UNIDADES = ['UN', 'KG', 'PCT', 'CX', 'LT', 'DZ', 'BDJ', 'FD', '100G'];
const S = { ed: null, temaReg: null, tema: null, temas: [], i: 0, modoTema: false, sel: 'nome', indice: null, raiz: '', base: null, fontes: [], fontesUrl: {}, carregadas: new Set(), sujo: false, temaSujo: false };

const VOLTA = (() => {
  const v = URLP.get('volta'); if (!v) return '';
  try { const u = new URL(v, location.origin); return u.origin === location.origin ? u.pathname + u.search + u.hash : ''; } catch { return ''; }
})();

// ------------------------------------------------------------------ DOM
function h(tag, at = {}, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(at)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'on') for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
    else if (k === 'style') e.style.cssText = v;
    else if (['className', 'value', 'title', 'placeholder', 'type', 'rows', 'href', 'accept'].includes(k)) e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const f of filhos.flat()) if (f !== null && f !== undefined && f !== false) e.append(f);
  return e;
}

// ------------------------------------------------------------------ servidor
function alerta(t) { const a = $('#alerta'); a.querySelector('span').textContent = t; a.classList.toggle('oculto', !t); }
async function api(rota, opts = {}) {
  let r;
  try { r = await fetch(rota.startsWith('/') ? rota : API + '/' + rota, { credentials: 'same-origin', ...opts }); }
  catch (e) { alerta('Sem conexão com o servidor. O que você mexeu continua na tela.'); throw e; }
  if (r.status === 401 || (r.redirected && /\/login/i.test(r.url))) { alerta('Sua sessão expirou. Entre de novo no Somado Tarefas.'); throw new Error('sessao'); }
  alerta('');
  return r;
}
async function apiJson(rota, opts) {
  const r = await api(rota, opts);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.error || `${rota} → ${r.status}`); e.status = r.status; e.dados = d; throw e; }
  return d;
}
const json = (metodo, corpo) => ({ method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
const enc = encodeURIComponent;
const novoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
let tAviso;
function aviso(t, ms = 2500) { const s = $('#salvo'); if (!s) return; s.textContent = t; clearTimeout(tAviso); if (ms) tAviso = setTimeout(() => { if (s.textContent === t) s.textContent = ''; }, ms); }

// tela = reduzida; impressão = original (w=0)
function url(tipo, ref, original) {
  if (tipo === 'tema') return `${API}/img?k=${enc(ref)}&w=${original ? 0 : 1400}`;
  if (ref.k) return `${API}/img?k=${enc(ref.k)}&w=${original ? 0 : 900}`;
  return `/api/encarte/img?p=${enc(ref.arq)}&w=${original ? 0 : 900}`;
}

// ------------------------------------------------------------------ fontes
async function carregarListaFontes() {
  try {
    const css = await (await fetch('/api/impresso/fontes.css')).text();
    for (const m of css.matchAll(/font-family:'([^']+)';src:url\('([^']+)'\)/g)) S.fontesUrl[m[1]] = m[2];
    S.fontes = Object.keys(S.fontesUrl).sort();
  } catch { S.fontes = []; }
}
function familiasDoTema(t) {
  return [t.nome.fonte, t.preco.fonte, ...t.camadas.filter(c => c.tipo === 'texto').map(c => c.fonte)].filter(Boolean);
}
async function garantirFontes() {
  const falta = familiasDoTema(S.tema).filter(f => !S.carregadas.has(f));
  await Promise.all(falta.map(f => document.fonts.load(`20px '${f}'`).then(() => S.carregadas.add(f)).catch(() => {})));
}

// ------------------------------------------------------------------ início (sem ?edicao)
async function inicio() {
  $('#inicio').classList.remove('oculto');
  if (VOLTA) $('#ini-voltar').href = VOLTA;
  const task = URLP.get('task');
  const [{ temas }, { edicoes }] = await Promise.all([apiJson('temas'), apiJson('edicoes' + (task ? '?task=' + enc(task) : ''))]);
  $('#ini-tema').replaceChildren(new Option('Tema novo (em branco)', ''), ...temas.map(t => new Option(t.nome, t.id)));
  const fmt = f => f.id === 'personalizado' ? `${f.largura_mm}×${f.altura_mm} mm` : `${f.id} ${f.orientacao}`;
  $('#ini-lista').replaceChildren(...edicoes.map(e => h('a', { href: `?edicao=${e.id}${VOLTA ? '&volta=' + enc(VOLTA) : ''}` },
    h('b', {}, e.titulo), h('br'), h('small', {}, `${e.folhas} folha(s) · ${fmt(e.formato)} · ${new Date(e.atualizado_em).toLocaleString('pt-BR')}`))));
  if (!edicoes.length) $('#ini-lista').textContent = task ? 'Esta tarefa ainda não tem impresso.' : 'Nenhum impresso ainda.';
  $('#ini-criar').onclick = async () => {
    $('#ini-criar').disabled = true;
    try {
      let temaId = $('#ini-tema').value;
      const novoTema = !temaId;
      if (novoTema) temaId = (await apiJson('temas', json('POST', { nome: ($('#ini-titulo').value.trim() || 'Tema') + ' · tema', tema: Impresso.TEMA_PADRAO }))).tema.id;
      const { edicao } = await apiJson('edicoes', json('POST', { taskId: task || undefined, temaId, titulo: $('#ini-titulo').value.trim(), formato: { id: 'A4' } }));
      location.href = `?edicao=${edicao.id}${VOLTA ? '&volta=' + enc(VOLTA) : ''}${novoTema ? '&tema=1' : ''}`;
    } catch (e) { alert('Não consegui criar: ' + e.message); $('#ini-criar').disabled = false; }
  };
}

// ------------------------------------------------------------------ editor
async function abrir(id) {
  $('#editor').classList.remove('oculto');
  $('#voltar').href = VOLTA || '?';
  await carregarListaFontes();
  const [{ edicao, tema }, { temas }] = await Promise.all([apiJson('edicoes/' + id), apiJson('temas')]);
  S.ed = edicao; S.base = edicao.atualizado_em; S.temas = temas;
  S.ed.ficha = S.ed.ficha || {}; S.ed.ficha.produtos = S.ed.ficha.produtos || [];
  usarTema(tema);
  $('#titulo').value = S.ed.titulo;
  $('#validade').value = S.ed.ficha.validade || '';
  preencherFormato();
  if (URLP.get('tema') === '1') S.modoTema = true;
  ligarEventos();
  await tudo();
  carregarIndice();
}
function usarTema(reg) {
  S.temaReg = reg; S.tema = Impresso.temaCompleto(reg && reg.tema);
  $('#tema').replaceChildren(...S.temas.map(t => new Option(t.nome, t.id)), new Option('＋ Tema novo…', '__novo'));
  if (reg) $('#tema').value = reg.id;
}
function preencherFormato() {
  const f = S.ed.formato;
  $('#fmt-id').value = f.id; $('#fmt-or').value = f.orientacao;
  $('#fmt-w').value = f.largura_mm; $('#fmt-h').value = f.altura_mm; $('#fmt-sang').value = f.sangria_mm;
  $('#fmt-pers').classList.toggle('oculto', f.id !== 'personalizado');
  $('#fmt-or').classList.toggle('oculto', f.id === 'personalizado');
}
function lerFormato() {
  S.ed.formato = Impresso.formatoResolvido({ id: $('#fmt-id').value, orientacao: $('#fmt-or').value, largura_mm: $('#fmt-w').value, altura_mm: $('#fmt-h').value, sangria_mm: $('#fmt-sang').value, seguranca_mm: S.ed.formato.seguranca_mm });
  preencherFormato(); mudou(); desenhar();
}
const produtos = () => S.ed.ficha.produtos;
const atual = () => produtos()[S.i];

async function tudo() { listar(); await desenhar(); painel(); }

function listar() {
  const box = $('#produtos');
  box.replaceChildren(...produtos().map((p, i) => {
    const st = !p.preco ? 'erro' : !(p.fotos || []).length ? 'aviso' : 'ok';
    return h('div', { className: 'prod' + (i === S.i ? ' sel' : ''), on: { click: () => { S.i = i; S.modoTema = false; tudo(); } } },
      h('span', { className: 'n' }, String(i + 1)),
      h('span', { className: 't' }, h('b', {}, p.nome || '(sem nome)'), h('small', {}, p.preco ? `R$ ${Impresso.separarPreco(p.preco)} ${p.unidade || ''}` : 'sem preço')),
      h('span', { className: 'av ' + st, title: st === 'erro' ? 'sem preço' : st === 'aviso' ? 'sem foto' : 'ok' }));
  }));
  if (!produtos().length) box.replaceChildren(h('p', { className: 'dica' }, 'Cole a lista ou adicione um produto. Cada produto vira uma folha.'));
  $('#pos').textContent = produtos().length ? `Folha ${S.i + 1} de ${produtos().length}` : 'sem produtos (exemplo)';
}

const EXEMPLO = { nome: 'Chocolate Lacta 80g', preco: '7,99', unidade: 'UN', fotos: [] };
let desenhando = 0;
async function desenhar() {
  const n = ++desenhando;
  await garantirFontes();
  if (n !== desenhando) return;
  const p = atual() || EXEMPLO;
  const { svg, formato } = Impresso.montarFolha({ tema: S.tema, formato: S.ed.formato, produto: p, validade: S.ed.ficha.validade || (S.modoTema ? 'Ofertas válidas até 30/11' : ''), url: (t, r) => url(t, r, false), guias: $('#guias').checked });
  if (S.modoTema) alcas(svg, formato);
  $('#palco').replaceChildren(svg);
}

// ------------------------------------------------------------------ caixas do tema (arrastar na folha)
function caixasDoTema() {
  const t = S.tema;
  return [{ id: 'nome', nome: 'Nome', c: t.nome }, { id: 'fotos', nome: 'Fotos', c: t.fotos }, { id: 'preco', nome: 'Preço', c: t.preco },
    ...t.camadas.map(c => ({ id: c.id, nome: c.nome || c.tipo, c }))];
}
function svgEl(tag, at) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [a, v] of Object.entries(at)) e.setAttribute(a, v);
  return e;
}
function alcas(svg, f) {
  const g = svgEl('g', {});
  svg.appendChild(g);
  for (const k of caixasDoTema()) {
    const b = { x: k.c.x * f.largura_mm, y: k.c.y * f.altura_mm, w: k.c.w * f.largura_mm, h: k.c.h * f.altura_mm };
    const r = svgEl('rect', { x: b.x, y: b.y, width: b.w, height: b.h, class: 'alca' + (S.sel === k.id ? ' sel' : '') });
    const t = svgEl('text', { x: b.x + 1, y: b.y + 3.5, class: 'rot' });
    t.textContent = k.nome;
    const c = svgEl('rect', { x: b.x + b.w - 3, y: b.y + b.h - 3, width: 3, height: 3, class: 'canto' });
    g.append(r, t, c);
    arrastar(svg, r, k, f, false);
    arrastar(svg, c, k, f, true);
  }
}
function arrastar(svg, alvo, k, f, redimensiona) {
  alvo.addEventListener('pointerdown', ev => {
    ev.preventDefault(); ev.stopPropagation();
    if (S.sel !== k.id) { S.sel = k.id; painel(); }
    alvo.setPointerCapture(ev.pointerId);
    const m = svg.getScreenCTM().inverse();
    const pt = e => { const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m); return { x: p.x / f.largura_mm, y: p.y / f.altura_mm }; };
    const ini = pt(ev), orig = { ...k.c };
    const r4 = v => Math.round(v * 10000) / 10000;
    const mover = e => {
      const p = pt(e), dx = p.x - ini.x, dy = p.y - ini.y;
      if (redimensiona) { k.c.w = r4(Math.max(0.02, orig.w + dx)); k.c.h = r4(Math.max(0.01, orig.h + dy)); }
      else { k.c.x = r4(orig.x + dx); k.c.y = r4(orig.y + dy); }
      // redesenho leve: só mexe a alça; a folha refaz ao soltar
      const b = { x: k.c.x * f.largura_mm, y: k.c.y * f.altura_mm, w: k.c.w * f.largura_mm, h: k.c.h * f.altura_mm };
      const g = alvo.parentNode, [r, t, c] = [...g.children].slice([...g.children].indexOf(alvo) - (redimensiona ? 2 : 0), [...g.children].indexOf(alvo) + (redimensiona ? 1 : 3));
      r.setAttribute('x', b.x); r.setAttribute('y', b.y); r.setAttribute('width', b.w); r.setAttribute('height', b.h);
      t.setAttribute('x', b.x + 1); t.setAttribute('y', b.y + 3.5);
      c.setAttribute('x', b.x + b.w - 3); c.setAttribute('y', b.y + b.h - 3);
    };
    const soltar = () => { alvo.removeEventListener('pointermove', mover); alvo.removeEventListener('pointerup', soltar); temaMudou(); painel(); };
    alvo.addEventListener('pointermove', mover);
    alvo.addEventListener('pointerup', soltar);
  });
}

// ------------------------------------------------------------------ painel da direita
const campo = (rot, ...el) => h('div', { className: 'campo' }, h('span', {}, rot), h('div', { className: 'linha' }, ...el));
function inp(valor, aoMudar, at = {}) {
  return h('input', { ...at, value: valor ?? '', on: { input: e => aoMudar(e.target.type === 'number' || e.target.type === 'range' ? Number(e.target.value) : e.target.value) } });
}
function chk(valor, aoMudar) { const e = h('input', { type: 'checkbox', on: { change: ev => aoMudar(ev.target.checked) } }); e.checked = !!valor; return e; }
function sel(valor, opcoes, aoMudar) { const s = h('select', { on: { change: e => aoMudar(e.target.value) } }, ...opcoes.map(o => Array.isArray(o) ? new Option(o[1], o[0]) : new Option(o, o))); s.value = valor ?? ''; return s; }
function cor(valor, aoMudar) { return h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(valor || '') ? valor : '#000000', on: { input: e => aoMudar(e.target.value) } }); }
function fonteSel(valor, aoMudar) { const l = S.fontes.includes(valor) ? S.fontes : [valor, ...S.fontes]; return sel(valor, l, aoMudar); }
function enviarArquivo(aoEscolher, texto = 'Enviar imagem') {
  const f = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', style: 'display:none', on: { change: e => { const a = e.target.files[0]; if (a) aoEscolher(a); e.target.value = ''; } } });
  return h('span', {}, f, h('button', { className: 'bt', on: { click: () => f.click() } }, texto));
}

function painel() { $('#painel').replaceChildren(S.modoTema ? painelTema() : painelProduto()); }

function painelProduto() {
  const p = atual();
  if (!p) return h('div', {}, h('p', { className: 'dica' }, 'Sem produtos. Use "Colar lista" ou "＋ Produto".'), h('p', { className: 'dica' }, 'Pra mudar fundo, cabeçalho, fontes e cores: botão 🎨 Tema.'));
  p.aj = p.aj || {};
  const muda = fn => v => { fn(v); mudou(); listar(); desenhar(); };
  const busca = h('input', { placeholder: 'Buscar foto no banco…', style: 'flex:1;min-width:120px' });
  const res = h('div', { className: 'resultados' });
  const buscar = async () => {
    const q = busca.value.trim(); res.replaceChildren();
    if (!q) return;
    const ind = await carregarIndice();
    for (const r of window.SomadoBusca.buscar(q, ind, { limite: 40 })) {
      const ref = { arq: r.item.arq };
      res.append(h('button', { title: r.item.nome, style: `background-image:url("${url('foto', ref, false)}")`, on: { click: () => adicionarFoto(p, ref) } }));
    }
  };
  let tb; busca.addEventListener('input', () => { clearTimeout(tb); tb = setTimeout(buscar, 250); });
  const fotos = h('div', { className: 'fotos' }, ...(p.fotos || []).map((ft, i) => h('div', { className: 'foto', title: ft.arq ? ft.arq.split('/').pop() : 'enviada', style: `background-image:url("${url('foto', ft, false)}")` },
    h('button', { className: 'x', title: 'Tirar', on: { click: () => { p.fotos.splice(i, 1); mudou(); tudo(); } } }, '×'))));
  const faixa = (rot, chave, min, max, passo, padrao) => campo(rot, inp(p.aj[chave] ?? padrao, muda(v => { p.aj[chave] = v; }), { type: 'range', min, max, step: passo, style: 'flex:1' }),
    h('button', { className: 'bt', title: 'Voltar ao padrão', on: { click: () => { delete p.aj[chave]; mudou(); tudo(); } } }, '↺'));
  const nome = h('textarea', { rows: 2, on: { input: e => muda(v => { p.nome = v; })(e.target.value) } });
  nome.value = p.nome || '';
  return h('div', {},
    h('h3', {}, `Folha ${S.i + 1}`),
    campo('Nome', nome),
    h('p', { className: 'dica' }, 'Enter no nome força a quebra de linha.'),
    campo('Preço', inp(p.preco, muda(v => { p.preco = v; }), { placeholder: '7,99', style: 'width:90px' }),
      h('input', { list: 'uns', value: p.unidade || '', style: 'width:70px', placeholder: 'UN', on: { input: e => muda(v => { p.unidade = v; })(e.target.value) } }),
      h('datalist', { id: 'uns' }, ...UNIDADES.map(u => new Option(u, u)))),
    h('h3', {}, `Fotos (${(p.fotos || []).length})`),
    fotos,
    h('div', { className: 'linha', style: 'margin-top:6px' }, busca, enviarArquivo(a => enviarFoto(p, a), 'Do computador')),
    res,
    h('h3', {}, 'Ajustes desta folha'),
    faixa('Nome', 'nome', 0.4, 1.3, 0.02, 1),
    faixa('Preço', 'preco', 0.4, 1.4, 0.02, 1),
    faixa('Fotos', 'fotos', 0.4, 1.4, 0.02, 1),
    faixa('Fotos ↔', 'fx', -0.4, 0.4, 0.01, 0),
    faixa('Fotos ↕', 'fy', -0.4, 0.4, 0.01, 0),
    h('h3', {}, 'Folha'),
    h('div', { className: 'linha' },
      h('button', { className: 'bt', on: { click: () => mover(-1) } }, '↑ Antes'),
      h('button', { className: 'bt', on: { click: () => mover(1) } }, '↓ Depois'),
      h('button', { className: 'bt', on: { click: () => { produtos().splice(S.i + 1, 0, { ...Impresso.clone(p), id: novoId() }); S.i++; mudou(); tudo(); } } }, 'Duplicar'),
      h('button', { className: 'bt perigo', on: { click: () => { if (!confirm('Excluir esta folha?')) return; produtos().splice(S.i, 1); S.i = Math.max(0, Math.min(S.i, produtos().length - 1)); mudou(); tudo(); } } }, 'Excluir')));
}
function mover(d) {
  const l = produtos(), j = S.i + d;
  if (j < 0 || j >= l.length) return;
  [l[S.i], l[j]] = [l[j], l[S.i]]; S.i = j; mudou(); tudo();
}
// proporção da foto: o arranjo precisa dela (a miniatura tem a mesma proporção do original)
function medir(ref) {
  return new Promise(res => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => res(null); i.src = url('foto', ref, false); });
}
async function adicionarFoto(p, ref) {
  const d = await medir(ref);
  p.fotos = p.fotos || [];
  p.fotos.push({ ...ref, ...(d || {}) });
  mudou(); tudo();
}
async function enviarFoto(p, arq) {
  aviso('enviando foto…', 0);
  try {
    const r = await apiJson(`edicoes/${S.ed.id}/foto?nome=${enc(arq.name)}`, { method: 'PUT', body: arq });
    p.fotos = p.fotos || []; p.fotos.push({ k: r.k, w: r.w, h: r.h });
    aviso('foto enviada'); mudou(); tudo();
  } catch (e) { aviso('não enviou: ' + e.message, 5000); }
}

// ------------------------------------------------------------------ painel do tema
function painelTema() {
  const t = S.tema, reg = S.temaReg;
  const m = fn => v => { fn(v); temaMudou(); };
  const k = caixasDoTema().find(x => x.id === S.sel) || caixasDoTema()[0];
  const c = k.c;
  const pct = (rot, chave, base) => inp(Math.round(c[chave] * 1000) / 10, m(v => { c[chave] = v / 100; }), { type: 'number', step: 0.5, style: 'width:64px', title: `${rot} em % da ${base}` });
  const subirImg = async (arq, aoTer) => {
    if (!reg) return;
    aviso('enviando imagem…', 0);
    try { const r = await apiJson(`temas/${reg.id}/imagem?nome=${enc(arq.name)}`, { method: 'PUT', body: arq }); aoTer({ k: r.chave, w: r.largura, h: r.altura }); temaMudou(); painel(); aviso('imagem enviada'); }
    catch (e) { aviso('não enviou: ' + e.message, 5000); }
  };
  const esp = [];
  if (k.id === 'nome') esp.push(
    campo('Fonte', fonteSel(c.fonte, m(v => { c.fonte = v; }))),
    campo('Cor', cor(c.cor, m(v => { c.cor = v; })), h('span', { className: 'dica' }, 'contorno'), cor(c.contorno_cor || '#ffffff', m(v => { c.contorno_cor = v; })), inp(c.contorno || 0, m(v => { c.contorno = v; }), { type: 'number', min: 0, step: 0.1, style: 'width:56px', title: 'espessura do contorno (mm)' })),
    campo('Alinhar', sel(c.alinha, [['esquerda', 'Esquerda'], ['centro', 'Centro'], ['direita', 'Direita']], m(v => { c.alinha = v; }))),
    campo('Linhas máx.', inp(c.linhas_max, m(v => { c.linhas_max = v; }), { type: 'number', min: 1, max: 6, style: 'width:56px' }), h('label', { className: 'mini' }, chk(c.maiusculas, m(v => { c.maiusculas = v; })), 'MAIÚSCULAS')),
    campo('Entrelinha', inp(c.entrelinha, m(v => { c.entrelinha = v; }), { type: 'number', min: 0.7, max: 1.6, step: 0.05, style: 'width:64px' })));
  if (k.id === 'fotos') esp.push(campo('Espaço', inp(c.espaco, m(v => { c.espaco = v; }), { type: 'number', min: 0, max: 0.3, step: 0.005, style: 'width:70px' })));
  if (k.id === 'preco') esp.push(
    campo('Fonte', fonteSel(c.fonte, m(v => { c.fonte = v; }))),
    campo('Cor', cor(c.cor, m(v => { c.cor = v; })), h('span', { className: 'dica' }, 'R$'), cor(c.rs_cor, m(v => { c.rs_cor = v; })), h('span', { className: 'dica' }, 'un.'), cor(c.un_cor, m(v => { c.un_cor = v; }))),
    campo('Tamanho R$', inp(c.rs_escala, m(v => { c.rs_escala = v; }), { type: 'number', min: 0.1, max: 0.8, step: 0.02, style: 'width:64px' }), h('span', { className: 'dica' }, 'un.'), inp(c.un_escala, m(v => { c.un_escala = v; }), { type: 'number', min: 0.05, max: 0.6, step: 0.02, style: 'width:64px' })),
    campo('Contorno', cor(c.contorno_cor || '#ffffff', m(v => { c.contorno_cor = v; })), inp(c.contorno || 0, m(v => { c.contorno = v; }), { type: 'number', min: 0, step: 0.1, style: 'width:56px' })),
    campo('Selo', c.fundo ? h('button', { className: 'bt', on: { click: () => { c.fundo = null; temaMudou(); painel(); } } }, 'Tirar imagem') : enviarArquivo(a => subirImg(a, v => { c.fundo = v; }), 'Imagem do selo')),
    c.fundo ? null : campo('Cor do selo', h('label', { className: 'mini' }, chk(!!c.fundo_cor, v => { c.fundo_cor = v ? '#ffe600' : ''; temaMudou(); painel(); }), 'usar cor'), c.fundo_cor ? cor(c.fundo_cor, m(v => { c.fundo_cor = v; })) : null));
  const camada = t.camadas.find(x => x.id === k.id);
  if (camada) {
    if (camada.tipo === 'imagem') esp.push(
      campo('Imagem', enviarArquivo(a => subirImg(a, v => { camada.img = v; }), camada.img ? 'Trocar' : 'Enviar')),
      campo('Encaixe', sel(camada.ajuste, [['conter', 'Inteira (conter)'], ['cobrir', 'Preencher (cortar)'], ['esticar', 'Esticar']], m(v => { camada.ajuste = v; }))));
    if (camada.tipo === 'retangulo') esp.push(
      campo('Cor', cor(camada.cor, m(v => { camada.cor = v; }))),
      campo('Cantos', inp(camada.raio || 0, m(v => { camada.raio = v; }), { type: 'number', min: 0, max: 0.2, step: 0.005, style: 'width:70px' })),
      campo('Borda', cor(camada.borda_cor || '#000000', m(v => { camada.borda_cor = v; })), inp(camada.borda || 0, m(v => { camada.borda = v; }), { type: 'number', min: 0, step: 0.1, style: 'width:56px' })));
    if (camada.tipo === 'texto') esp.push(
      campo('Conteúdo', h('label', { className: 'mini' }, chk(camada.campo === 'validade', v => { camada.campo = v ? 'validade' : ''; temaMudou(); painel(); }), 'validade do impresso')),
      camada.campo === 'validade' ? null : campo('Texto', inp(camada.texto, m(v => { camada.texto = v; }))),
      campo('Fonte', fonteSel(camada.fonte, m(v => { camada.fonte = v; }))),
      campo('Cor', cor(camada.cor, m(v => { camada.cor = v; })), sel(camada.alinha, [['esquerda', 'Esq.'], ['centro', 'Centro'], ['direita', 'Dir.']], m(v => { camada.alinha = v; }))));
    esp.push(
      campo('Nome', inp(camada.nome, v => { camada.nome = v; S.temaSujo = true; agendarTema(); })),
      campo('Ordem', h('label', { className: 'mini' }, chk(camada.acima, m(v => { camada.acima = v; })), 'por cima do produto'),
        h('button', { className: 'bt', on: { click: () => moverCamada(camada, -1) } }, '↑'), h('button', { className: 'bt', on: { click: () => moverCamada(camada, 1) } }, '↓'),
        h('button', { className: 'bt perigo', on: { click: () => { t.camadas.splice(t.camadas.indexOf(camada), 1); S.sel = 'nome'; temaMudou(); painel(); } } }, 'Excluir')));
  }
  const novaCamada = tipo => {
    const c2 = { id: novoId(), tipo, nome: { imagem: 'Imagem', retangulo: 'Retângulo', texto: 'Texto' }[tipo], x: 0.1, y: 0.1, w: 0.3, h: 0.1 };
    if (tipo === 'imagem') Object.assign(c2, { img: null, ajuste: 'conter' });
    if (tipo === 'retangulo') Object.assign(c2, { cor: '#ffffff', raio: 0.02 });
    if (tipo === 'texto') Object.assign(c2, { texto: 'Texto', fonte: 'Montserrat-Bold', cor: '#111111', alinha: 'centro', h: 0.04 });
    t.camadas.push(c2); S.sel = c2.id; temaMudou(); painel();
  };
  return h('div', {},
    h('h3', {}, 'Tema'),
    campo('Nome', inp(reg ? reg.nome : '', v => { if (reg) { reg.nome = v; S.temaSujo = true; agendarTema(); } })),
    h('div', { className: 'linha' },
      h('button', { className: 'bt primario', on: { click: () => salvarTema(true) } }, 'Salvar tema'),
      h('button', { className: 'bt', on: { click: duplicarTema } }, 'Duplicar'),
      h('button', { className: 'bt', on: { click: () => { S.modoTema = false; tudo(); } } }, 'Fechar')),
    h('p', { className: 'dica' }, 'Arraste as caixas na folha; o quadradinho do canto muda o tamanho. As posições valem em qualquer formato (A3, A4, A5…).'),
    h('h3', {}, 'Fundo'),
    campo('Cor', cor(t.fundo.cor, m(v => { t.fundo.cor = v; }))),
    campo('Imagem', t.fundo.imagem ? h('button', { className: 'bt', on: { click: () => { t.fundo.imagem = null; temaMudou(); painel(); } } }, 'Tirar') : null,
      enviarArquivo(a => subirImg(a, v => { t.fundo.imagem = v; }), t.fundo.imagem ? 'Trocar' : 'Enviar')),
    h('p', { className: 'dica' }, 'O fundo cobre a folha e a sangria. Pra imprimir bem: 300 DPI no tamanho final (A4 ≈ 2550 × 3600 px).'),
    h('h3', {}, 'Caixas'),
    h('div', { className: 'linha' }, ...caixasDoTema().map(x => h('button', { className: 'bt' + (x.id === S.sel ? ' primario' : ''), on: { click: () => { S.sel = x.id; desenhar(); painel(); } } }, x.nome))),
    h('div', { className: 'linha', style: 'margin-top:6px' },
      h('button', { className: 'bt', on: { click: () => novaCamada('imagem') } }, '＋ Imagem'),
      h('button', { className: 'bt', on: { click: () => novaCamada('retangulo') } }, '＋ Retângulo'),
      h('button', { className: 'bt', on: { click: () => novaCamada('texto') } }, '＋ Texto')),
    h('h3', {}, k.nome),
    campo('Posição %', pct('X', 'x', 'largura'), pct('Y', 'y', 'altura')),
    campo('Tamanho %', pct('Largura', 'w', 'largura'), pct('Altura', 'h', 'altura')),
    ...esp);
}
function moverCamada(c, d) {
  const l = S.tema.camadas, i = l.indexOf(c), j = i + d;
  if (j < 0 || j >= l.length) return;
  [l[i], l[j]] = [l[j], l[i]]; temaMudou(); painel();
}
let tTema;
function temaMudou() { S.temaSujo = true; desenhar(); agendarTema(); }
function agendarTema() { clearTimeout(tTema); tTema = setTimeout(() => salvarTema(false), 1500); }
async function salvarTema(avisar) {
  clearTimeout(tTema);
  if (!S.temaReg || !S.temaSujo) { if (avisar) aviso('tema salvo'); return; }
  try {
    const { tema } = await apiJson('temas/' + S.temaReg.id, json('PUT', { nome: S.temaReg.nome, tema: S.tema }));
    S.temaSujo = false; S.temaReg = tema;
    const i = S.temas.findIndex(x => x.id === tema.id); if (i >= 0) S.temas[i] = { ...S.temas[i], nome: tema.nome };
    aviso('tema salvo');
  } catch (e) { aviso('tema NÃO salvo: ' + e.message, 6000); }
}
async function duplicarTema() {
  await salvarTema(false);
  const nome = prompt('Nome do tema novo:', (S.temaReg ? S.temaReg.nome : 'Tema') + ' (cópia)');
  if (!nome) return;
  // as imagens seguem nas chaves do tema de origem; a rota de imagem serve qualquer uma
  const { tema } = await apiJson('temas', json('POST', { nome, tema: S.tema }));
  S.temas.push({ id: tema.id, nome: tema.nome }); await trocarTema(tema.id);
}
async function trocarTema(id) {
  await salvarTema(false);
  if (id === '__novo') {
    const nome = prompt('Nome do tema novo:', 'Tema novo');
    if (!nome) { $('#tema').value = S.temaReg ? S.temaReg.id : ''; return; }
    const { tema } = await apiJson('temas', json('POST', { nome, tema: Impresso.TEMA_PADRAO }));
    S.temas.push({ id: tema.id, nome: tema.nome }); id = tema.id; S.modoTema = true;
  }
  const { tema } = await apiJson('temas/' + id);
  usarTema(tema); S.ed.tema_id = id; mudou(); tudo();
}

// ------------------------------------------------------------------ salvar a edição
let tSalvar, salvando = null;
function mudou() { S.sujo = true; aviso('alterado…', 0); clearTimeout(tSalvar); tSalvar = setTimeout(() => salvar(), 1200); }
async function salvar(versao = false) {
  clearTimeout(tSalvar);
  if (salvando) await salvando;
  if (!S.sujo && !versao) return true;
  S.ed.titulo = $('#titulo').value.trim() || 'Impresso';
  S.ed.ficha.validade = $('#validade').value;
  S.sujo = false;
  salvando = (async () => {
    try {
      const { edicao } = await apiJson('edicoes/' + S.ed.id, json('PUT', { titulo: S.ed.titulo, temaId: S.ed.tema_id, formato: S.ed.formato, ficha: S.ed.ficha, base: S.base, versao }));
      S.base = edicao.atualizado_em; aviso('salvo'); return true;
    } catch (e) {
      S.sujo = true;
      if (e.status === 409) alerta('Este impresso foi alterado em outro lugar. Recarregue a página (F5) pra não perder nada.');
      else aviso('NÃO salvo: ' + e.message, 6000);
      return false;
    } finally { salvando = null; }
  })();
  return salvando;
}
window.addEventListener('beforeunload', e => { if (S.sujo || S.temaSujo) { salvar(); salvarTema(false); e.preventDefault(); } });

// ------------------------------------------------------------------ lista
function lerLinha(l) {
  l = l.trim(); if (!l) return null;
  let nome, preco = '', un = '';
  const partes = l.split(/\s*[;|\t]\s*/);
  if (partes.length >= 2) [nome, preco = '', un = ''] = partes;
  else {
    const m = l.match(/^(.*?)\s*(?:-|–|:)?\s*(?:R\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(kg|un|und|unid|unidade|pct|pc|cx|lt|l|dz|bdj|fd)?\.?\s*$/i);
    if (m && m[1]) { nome = m[1]; preco = m[2]; un = m[3] || ''; } else nome = l;
  }
  un = (un || '').trim().toUpperCase().replace(/^(UND|UNID|UNIDADE)$/, 'UN').replace(/^L$/, 'LT');
  return { id: novoId(), nome: (nome || '').trim(), preco: (preco || '').trim(), unidade: un, fotos: [], aj: {} };
}
async function montarLista() {
  const novos = $('#lista-txt').value.split('\n').map(lerLinha).filter(Boolean);
  if (!novos.length) return;
  $('#dlg-lista').close();
  if ($('#lista-substituir').checked) { S.ed.ficha.produtos = []; S.i = 0; }
  const ini = produtos().length;
  produtos().push(...novos);
  S.i = ini; S.modoTema = false; mudou(); await tudo();
  aviso('buscando fotos no banco…', 0);
  const ind = await carregarIndice();
  let achou = 0;
  for (const p of novos) {
    const r = window.SomadoBusca.buscar(p.nome, ind, { limite: 1 })[0];
    if (!r) continue;
    const ref = { arq: r.item.arq };
    const d = await medir(ref);
    p.fotos = [{ ...ref, ...(d || {}) }]; achou++;
  }
  mudou(); await tudo();
  aviso(`${novos.length} folha(s) · foto achada em ${achou}. Confira as fotos!`, 6000);
}
async function carregarIndice() {
  if (S.indice) return S.indice;
  try {
    const d = await (await api('/api/encarte/indice')).json();
    S.raiz = String(d.raiz || '').replace(/\\/g, '/').replace(/\/$/, '');
    S.indice = (d.arquivos || []).map(([pasta, rel]) => window.SomadoBusca.prepararItem({ pasta, rel, nome: rel.split('/').pop(), arq: S.raiz + '/' + rel }));
  } catch { S.indice = []; aviso('não consegui carregar o banco de fotos', 5000); }
  return S.indice;
}

// ------------------------------------------------------------------ eventos
function ligarEventos() {
  $('#titulo').addEventListener('input', mudou);
  $('#validade').addEventListener('input', () => { mudou(); desenhar(); });
  for (const id of ['#fmt-id', '#fmt-or', '#fmt-w', '#fmt-h', '#fmt-sang']) $(id).addEventListener('change', lerFormato);
  $('#tema').addEventListener('change', e => trocarTema(e.target.value));
  $('#bt-tema').onclick = () => { S.modoTema = !S.modoTema; tudo(); };
  $('#guias').addEventListener('change', desenhar);
  $('#ant').onclick = () => { if (S.i > 0) { S.i--; tudo(); } };
  $('#prox').onclick = () => { if (S.i < produtos().length - 1) { S.i++; tudo(); } };
  $('#bt-add').onclick = () => { produtos().splice(S.i + 1, 0, { id: novoId(), nome: 'Produto', preco: '', unidade: 'UN', fotos: [], aj: {} }); S.i = produtos().length === 1 ? 0 : S.i + 1; S.modoTema = false; mudou(); tudo(); };
  $('#bt-lista').onclick = () => $('#dlg-lista').showModal();
  $('#lista-ok').onclick = montarLista;
  $('#bt-salvar').onclick = async () => { await salvarTema(false); S.sujo = true; await salvar(true); };
  $('#bt-baixar').onclick = () => ImpressoExportar.abrir();
  $('#bx-ok').onclick = () => ImpressoExportar.gerar();
  document.addEventListener('keydown', e => {
    if (e.target.closest('input,textarea,select')) return;
    if (e.key === 'ArrowRight') $('#prox').click();
    if (e.key === 'ArrowLeft') $('#ant').click();
  });
}

window.ImpressoApp = { S, url, salvar, salvarTema, aviso, api, apiJson, atual, produtos, garantirFontes, h };

(async () => {
  try {
    const id = URLP.get('edicao');
    if (id) await abrir(id); else await inicio();
  } catch (e) { if (e.message !== 'sessao') alerta('Erro ao abrir: ' + e.message); }
})();
