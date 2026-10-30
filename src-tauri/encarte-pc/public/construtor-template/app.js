// Construtor de template de encarte (SMD-954). Monta o projeto JSON (pranchetas, fundo,
// elementos, modelos de card, zonas) e o servidor gera o SVG no contrato do editor.
// Desenha em SVG de verdade (não canvas): a medida do texto bate com a do editor.
'use strict';

const API = '/api/encarte/projetos-template';
const NS = 'http://www.w3.org/2000/svg';
const $ = s => document.querySelector(s);
const uid = p => p + Math.random().toString(36).slice(2, 8);
const arred = b => ({ x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10, w: Math.round(b.w * 10) / 10, h: Math.round(b.h * 10) / 10 });
const clone = o => JSON.parse(JSON.stringify(o));
// tamanho da prancheta é em px (1080 px do Instagram); medidas dentro dela seguem em pt
const TAMANHOS = [['1080x1350', '1080 × 1350 px (feed)'], ['1080x1920', '1080 × 1920 px (stories)']];

const S = { proj: null, pi: 0, tool: 'selecionar', sel: null, fontes: ['sans-serif'], clientes: [], sujo: false, blocos: [] };
// ?embutido: só o editor do modelo do card, dentro do editor de encarte (embutido.js). Nada é gravado
// daqui: o encarte é que aplica "só neste encarte" ou "salvar no template"
const EMB = { on: new URLSearchParams(location.search).has('embutido'), antesDeDesenhar: null };

function el(tag, at = {}, pai) {
  const e = document.createElementNS(NS, tag);
  for (const k in at) if (at[k] != null) e.setAttribute(k, at[k]);
  if (pai) pai.appendChild(e);
  return e;
}
function h(tag, at = {}, ...filhos) {
  const e = document.createElement(tag);
  for (const k in at) { if (k === 'on') for (const ev in at.on) e.addEventListener(ev, at.on[ev]); else if (at[k] != null) e.setAttribute(k, at[k]); }
  for (const f of filhos) e.append(f);
  return e;
}
async function api(caminho, opt = {}) {
  const r = await fetch(API + caminho, { headers: { 'content-type': 'application/json' }, ...opt });
  if (r.status === 401) { alert('Faça login no Somado Tarefas (mesmo endereço) e recarregue esta página.'); throw new Error('401'); }
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
function carregando(on) { $('#loading').classList.toggle('hidden', !on); }

// ---------------------------------------------------------------- imagens enviadas
// no projeto a imagem é "arq:<arquivo>" (pasta do projeto no servidor) ou "bloco:<papel>" (bloco do
// cliente: a trocada neste projeto ou a do cadastro, ver biblioteca.js); URL comum também vale
const srcImg = ref => !ref ? '' : ref.startsWith('arq:') ? `${API}/${S.proj.id}/imagem?arq=${encodeURIComponent(ref.slice(4))}`
  : ref.startsWith('bloco:') ? srcBloco(ref.slice(6)) : ref;
function enviarImagem() {
  return new Promise(res => {
    const i = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/svg+xml' });
    i.onchange = async () => {
      const f = i.files[0]; if (!f) return res(null);
      const fd = new FormData(); fd.append('arquivo', f);
      carregando(true);
      try {
        const r = await fetch(`${API}/${S.proj.id}/imagem`, { method: 'POST', body: fd });
        const j = await r.json(); if (!r.ok) throw new Error(j.erro || r.status);
        res(j.ref);
      } catch (e) { alert('Não enviou: ' + e.message); res(null); }
      finally { carregando(false); }
    };
    i.click();
  });
}

// ---------------------------------------------------------------- fontes (as da VPS)
async function carregarFontes() {
  try {
    const css = await (await fetch('/api/encarte/fontes.css')).text();
    document.head.appendChild(h('style', {}, css));
    const fam = [...css.matchAll(/font-family\s*:\s*['"]?([^;'"]+)['"]?/g)].map(m => m[1].trim());
    if (fam.length) S.fontes = [...new Set(fam)].sort();
  } catch { /* fica com sans-serif */ }
  // a quebra do nome mede o texto: quando uma fonte termina de carregar, desenha de novo com a medida certa
  if (document.fonts) document.fonts.addEventListener('loadingdone', () => {
    if (!S.proj) return;
    render();
    if ($('#modal-overlay').classList.contains('open')) renderModelo();
  });
}
const F = () => S.fontes.includes('AmsiPro-Black') ? 'AmsiPro-Black' : S.fontes[0];

// ---------------------------------------------------------------- modelos de card
function camposPadrao() {
  const f = F();
  return {
    nome_fundo: { x: 4, y: 2, w: 92, h: 15, cor: '#e30613', raio: 4, regra: 'fixo', margem_t: 6, margem_r: 6, margem_b: 6, margem_l: 6 },
    nome: { x: 6, y: 3, w: 88, h: 12, fonte: f, tamanho: 14, cor: '#222222', alinhamento: 'middle', texto_exemplo: 'NOME DO PRODUTO' },
    area: { x: 5, y: 17, w: 90, h: 55 },
    foto: { x: 8, y: 18, w: 84, h: 53 },
    preco_fundo: { x: 10, y: 74, w: 80, h: 22, cor: '#e30613', raio: 6 },
    moeda_fundo: { x: 12, y: 76, w: 12, h: 12, cor: '#ffcc00', raio: 40 },
    moeda: { x: 14, y: 77, w: 14, h: 10, fonte: f, tamanho: 11, cor: '#ffffff' },
    preco: { x: 30, y: 75, w: 46, h: 19, fonte: f, tamanho: 30, cor: '#ffffff' },
    centavos: { x: 62, y: 76, w: 16, h: 11, fonte: f, tamanho: 15, cor: '#ffffff' },
    unidade: { x: 78, y: 84, w: 12, h: 8, fonte: f, tamanho: 9, cor: '#ffffff', texto_exemplo: 'kg' },
    de_fundo: { x: 10, y: 62, w: 48, h: 10, cor: '#ffffff', raio: 3 },
    de_rotulo: { x: 12, y: 63, w: 14, h: 8, fonte: f, tamanho: 8, cor: '#555555', texto_exemplo: 'DE R$' },
    de_valor: { x: 27, y: 63, w: 28, h: 8, fonte: f, tamanho: 10, cor: '#555555', riscar: true },
    selo_fundo: { x: 55, y: 55, w: 40, h: 17, cor: '#0a4fd6', raio: 4 },
    selo_rotulo: { x: 57, y: 56, w: 36, h: 6, fonte: f, tamanho: 6, cor: '#ffffff', alinhamento: 'middle', texto_exemplo: 'CLUB SMART' },
    selo_moeda: { x: 58, y: 63, w: 8, h: 7, fonte: f, tamanho: 6, cor: '#ffffff' },
    selo_valor: { x: 66, y: 62, w: 27, h: 9, fonte: f, tamanho: 12, cor: '#ffffff' },
    // gatilho do atacado: frase por produto ("NA COMPRA DE // 10 UN OU MAIS!") numa tarja
    gatilho_fundo: { x: 6, y: 58, w: 88, h: 14, cor: '#ffcc00', raio: 4 },
    gatilho: { x: 8, y: 59, w: 84, h: 12, fonte: f, tamanho: 9, cor: '#e30613', alinhamento: 'middle', texto_exemplo: 'NA COMPRA DE // 10 UN OU MAIS!' },
    limite: { x: 6, y: 66, w: 88, h: 7, fonte: f, tamanho: 9, cor: '#222222', alinhamento: 'middle', texto_exemplo: 'LIMITE 3 UN' },
  };
}
// centavos não vem ligado no modelo novo: liga o preço dividido quando marcar
const CAMPOS = [
  ['area', 'Área do produto', 'area'], ['foto', 'Foto', 'area'], ['nome_fundo', 'Fundo do nome', 'ret'], ['nome', 'Nome', 'texto'],
  ['preco_fundo', 'Fundo do preço', 'ret'], ['moeda_fundo', 'Fundo do R$', 'ret'], ['moeda', 'R$', 'texto'], ['preco', 'Preço (ou só o real)', 'texto'],
  ['centavos', 'Centavos separados', 'texto'], ['unidade', 'Unidade', 'texto'],
  ['de_fundo', 'Fundo do DE', 'ret'], ['de_rotulo', 'Rótulo do DE', 'texto'], ['de_valor', 'Valor do DE', 'texto'],
  ['selo_fundo', 'Tarja do selo', 'ret'], ['selo_rotulo', 'Nome do clube', 'texto'], ['selo_moeda', 'R$ do selo', 'texto'], ['selo_valor', 'Valor do selo', 'texto'],
  ['gatilho_fundo', 'Tarja do gatilho', 'ret'], ['gatilho', 'Gatilho', 'texto'],
  ['limite', 'Limite', 'texto'],
];
// blocos da lista de campos: cada um liga/desliga inteiro e abre pra configurar as peças
const GRUPOS = [
  { id: 'produto', rot: 'Produto', campos: ['area', 'foto', 'nome_fundo', 'nome'] },
  { id: 'preco', rot: 'Preço', campos: ['preco_fundo', 'moeda_fundo', 'moeda', 'preco', 'centavos', 'unidade'] },
  { id: 'de', rot: 'Preço DE', dica: 'Desenho pro produto que tiver DE (o editor mostra só nele). A chave só mostra ou esconde aqui no card.', campos: ['de_fundo', 'de_rotulo', 'de_valor'] },
  { id: 'selo', rot: 'Selo do clube', dica: 'Desenho pro produto que tiver o preço do clube. Com a chave ligada você vê o card com selo: arraste ou puxe o canto do preço pra arrumar ele junto do selo (o editor usa esse lugar só nos produtos com selo). Desligada: o preço normal.', campos: ['selo_fundo', 'selo_rotulo', 'selo_moeda', 'selo_valor'] },
  { id: 'gatilho', rot: 'Gatilho (atacado)', dica: 'Frase que muda em cada produto, ex. "NA COMPRA DE // 10 UN OU MAIS!" ("//" quebra a linha, até 2). No editor ela se troca no painel do produto (Tarja) ou na lista ("tarja: ..."). O texto fica sempre no meio do card e a tarja estica com o card.', campos: ['gatilho_fundo', 'gatilho'] },
  { id: 'limite', rot: 'Limite', dica: 'Texto que muda em cada produto, ex. "DINHEIRO OU PIX" ou "LIMITE 3 UN". No editor ele se troca no campo Limite do produto; vazio = não aparece. O texto daqui é só exemplo pra você ver o lugar.', campos: ['limite'] },
  { id: 'extras', rot: 'Elementos extras', extras: true },
];
// gatilho: altura do card que ele segue no editor (na largura fica sempre no meio)
const ANCORAS_GATILHO = [['auto', 'Automático (a mais perto)'], ['cima', 'Topo do card'], ['meio', 'Meio do card'], ['baixo', 'Pé do card']];
const GATILHO_KS = ['gatilho_fundo', 'gatilho'];
const linhasGatilho = t => String(t || 'NA COMPRA DE // 10 UN OU MAIS!').split(/\s*(?:\n|\/\/)\s*/).map(x => x.trim()).filter(Boolean).slice(0, 2);
// mesmas contas do gerador (ancoraVGatilho / baseGatilho em lib/encarte/gerador-template.ts)
function ancoraVGatilho(c) {
  if (c.gatilho_ancora && c.gatilho_ancora !== 'auto') return c.gatilho_ancora;
  const bs = [c.gatilho_fundo, c.gatilho].filter(Boolean);
  if (!bs.length) return 'cima';
  const cy = (Math.min(...bs.map(b => b.y)) + Math.max(...bs.map(b => b.y + b.h))) / 2;
  return cy < 40 ? 'cima' : cy > 60 ? 'baixo' : 'meio';
}
function baseGatilho(b, c, n) {
  const entre = +(c.tamanho * 1.1).toFixed(2), bloco = entre * (n - 1);
  const y = c.alinha_v === 'topo' ? b.y + c.tamanho * 0.8 : c.alinha_v === 'baixo' ? b.y + b.h - bloco - c.tamanho * 0.1 : b.y + b.h / 2 - bloco / 2 + c.tamanho * 0.36;
  return { y, entre };
}
// "Travar em": onde o bloco fica preso no editor (vai como data-trava/data-ancora no SVG)
const TRAVAS = [['auto', 'Automático (canto mais perto)'], ['preco', 'Grupo do preço'], ['nome', 'Título'], ['imagem', 'Imagem (área da foto)'],
  ['esq', 'Lado esquerdo do card'], ['dir', 'Lado direito do card'], ['centro', 'Centro do card']];
const OPCIONAIS = ['nome_fundo', 'moeda_fundo', 'centavos', 'de_fundo', 'de_rotulo', 'de_valor', 'selo_fundo', 'selo_rotulo', 'selo_moeda', 'selo_valor', 'gatilho_fundo', 'gatilho'];
const modeloPadrao = () => { const c = camposPadrao(); for (const k of OPCIONAIS) delete c[k]; return c; };

// casa (tamanho de 1 card) da 1ª zona que usa o modelo
// normal = a 1ª casa do modelo que sai no desenho normal (não horizontal): é nela que o normal é desenhado
// e medido (mesma conta do casasNormaisPorModelo do gerador); sem nenhuma, a 1ª zona
function casaDoModelo(mid, normal = false) {
  const m = S.proj.modelos_card.find(x => x.id === mid);
  let prim = null;
  for (const pr of S.proj.pranchetas) for (const z of zonasAbertas(pr)) if (z.modelo_card_id === mid) {
    const e = z.espaco ?? S.proj.espaco_padrao;
    // todas as linhas: a 1ª pode ter outro número de cards e sair horizontal (Rigoni, por_linha 2,4,4)
    for (let r = 0; r < (normal ? z.linhas : 1); r++) {
      const n = itensDaLinha(z, r), c = { w: (z.w - (n - 1) * e) / n, h: (z.h - (z.linhas - 1) * e) / z.linhas, e };
      if (!normal || !m || !usaHorizontal(m, z, c.w, c.h)) return c;
      if (!prim) prim = c;
    }
  }
  if (prim) return prim;
  return { w: 200, h: 280, e: S.proj.espaco_padrao };
}
// casa larga (largura/altura ≥ isto) usa o desenho horizontal do modelo; mesmo número do gerador e do editor
const PROPORCAO_HORIZONTAL = 1.35;
function usaHorizontal(m, z, w, h) {
  if (!m.horizontal || z.formato === 'normal') return false;
  return z.formato === 'horizontal' || w / h >= PROPORCAO_HORIZONTAL;
}
const itensDaLinha = (z, r) =>Math.max(1, Math.round((z.por_linha && z.por_linha[r]) || z.colunas));
// zona composta: uma zona normal por parte (mesma conta do expandirZona do gerador)
function expandirZona(z, espacoPadrao = S.proj.espaco_padrao) {
  if (z.tipo !== 'composta' || !z.partes || !z.partes.length) return [z];
  const e = z.espaco ?? espacoPadrao, v = z.direcao !== 'h', ps = z.partes;
  const pesos = ps.map(p => (p.tam > 0 ? p.tam : 1)), soma = pesos.reduce((a, b) => a + b, 0);
  const livre = (v ? z.h : z.w) - (ps.length - 1) * e;
  let pos = v ? z.y : z.x;
  return ps.map((p, i) => {
    const t = livre * pesos[i] / soma, r = v ? { x: z.x, y: pos, w: z.w, h: t } : { x: pos, y: z.y, w: t, h: z.h };
    pos += t + e;
    const col = p.tipo === 'fixo' ? Math.max(1, Math.round(p.n || 1)) : Math.max(1, Math.round(p.colunas || 2));
    const { tipo, partes, direcao, por_linha, divisorias, ...base } = z;
    return { ...base, ...r, id: `${z.id}_p${i + 1}`, linhas: 1, colunas: col, parte: { ...p, grupo: z.id, i } };
  });
}
const zonasAbertas = pr => pr.zonas.flatMap(z => expandirZona(z));

// ---------------------------------------------------------------- desenho (mesma conta do gerador)
function xTexto(b, a) { return a === 'middle' ? b.x + b.w / 2 : a === 'end' ? b.x + b.w : b.x; }
const ancora = a => a === 'middle' ? 'middle' : a === 'end' ? 'end' : 'start';
const contorno = o => o.borda && o.borda_cor ? { stroke: tinta(o.borda_cor), 'stroke-width': o.borda } : {};

function caminhoCantos(b, r, c) {
  const [tl, tr, br, bl] = c.map(on => on ? r : 0), { x, y, w, h: hh } = b;
  const arco = (k, ex, ey) => k ? ` A${k} ${k} 0 0 1 ${ex} ${ey}` : ` L${ex} ${ey}`;
  return `M${x + tl} ${y} H${x + w - tr}${arco(tr, x + w, y + tr)} V${y + hh - br}${arco(br, x + w - br, y + hh)} H${x + bl}${arco(bl, x, y + hh - bl)} V${y + tl}${arco(tl, x + tl, y)} Z`;
}
// sombra (mesmo filtro do gerador, svgFiltroSombra): os filtros moram num <svg> escondido da página,
// um por combinação de valores
const SOMBRAS = new Map();
function filtroSombra(o) {
  if (!o || !o.sombra) return null;
  const k = ['sombra_x', 'sombra_y', 'sombra_blur', 'sombra_largura', 'sombra_altura', 'sombra_cor'].map(c => o[c] ?? '').join('|');
  if (SOMBRAS.has(k)) return SOMBRAS.get(k);
  let defs = document.getElementById('defs-sombras');
  if (!defs) {
    const sv = el('svg', { width: 0, height: 0, style: 'position:absolute;width:0;height:0' }); document.body.append(sv);
    defs = el('defs', { id: 'defs-sombras' }, sv);
  }
  const id = 'sombra_c' + (SOMBRAS.size + 1), n = v => +(+v || 0).toFixed(2);
  const m = (typeof o.sombra_cor === 'string' ? o.sombra_cor : '#000000').match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i) || ['', '000000'];
  const sx = n(o.sombra_largura), sy = n(o.sombra_altura);
  const f = el('filter', { id, x: '-100%', y: '-100%', width: '300%', height: '300%', 'color-interpolation-filters': 'sRGB' }, defs);
  if (sx || sy) el('feMorphology', { in: 'SourceAlpha', operator: sx + sy < 0 ? 'erode' : 'dilate', radius: `${Math.abs(sx)} ${Math.abs(sy)}`, result: 'sa' }, f);
  el('feOffset', { in: sx || sy ? 'sa' : 'SourceAlpha', dx: n(o.sombra_x), dy: n(o.sombra_y), result: 'so' }, f);
  el('feGaussianBlur', { in: 'so', stdDeviation: Math.max(0, n(o.sombra_blur)) / 2, result: 'sb' }, f);
  el('feFlood', { 'flood-color': '#' + m[1], 'flood-opacity': m[2] ? (parseInt(m[2], 16) / 255).toFixed(3) : 1 }, f);
  el('feComposite', { in2: 'sb', operator: 'in', result: 'sc' }, f);
  const mg = el('feMerge', {}, f); el('feMergeNode', { in: 'sc' }, mg); el('feMergeNode', { in: 'SourceGraphic' }, mg);
  const url = `url(#${id})`; SOMBRAS.set(k, url); return url;
}
const pegaSombra = o => Object.fromEntries(Object.entries(o || {}).filter(([k]) => k.startsWith('sombra')));
// forma: retângulo, com só alguns cantos redondos, ou imagem no lugar
function forma(pai, b, f, at = {}) {
  at = { ...at, filter: filtroSombra(f) };
  if (f.imagem_url && srcImg(f.imagem_url)) return el('image', { ...at, href: srcImg(f.imagem_url), x: b.x, y: b.y, width: b.w, height: b.h, preserveAspectRatio: 'none' }, pai);
  const st = { ...at, fill: tinta(f.cor), ...contorno(f), 'pointer-events': at['data-id'] ? 'all' : null };
  const r = Math.min(f.raio || 0, b.w / 2, b.h / 2), c = f.cantos && f.cantos.length === 4 ? f.cantos : [true, true, true, true];
  if (!r || c.every(Boolean)) return el('rect', { ...st, x: b.x, y: b.y, width: b.w, height: b.h, rx: r || null }, pai);
  return el('path', { ...st, d: caminhoCantos(b, r, c) }, pai);
}
// instância de fonte variável (mesma regra do editor de encarte, eixosDaFonte em public/encarte/app.js):
// "AcuminConcept-ExtraCondUltraBlackItalic" = arquivo variável com largura 50, peso 900 e inclinação.
// Sem isso o construtor mostra a Acumin larga e o editor estreita.
const LARG_ACUMIN = { ExtraCond: 50, Cond: 67.5, SemiCond: 90, '': 100, Wide: 115 };
const PESO_ACUMIN = { Thin: 100, ExtraLight: 200, Light: 300, '': 400, Medium: 500, Semibold: 600, Bold: 700, Black: 800, UltraBlack: 900 };
function eixosDaFonte(fam) {
  const m = (fam || '').match(/^AcuminConcept-(ExtraCond|SemiCond|Cond|Wide)?(Thin|ExtraLight|Light|Medium|Semibold|Bold|Black|UltraBlack)?(Italic)?$/);
  return m ? `"wdth" ${LARG_ACUMIN[m[1] || '']}, "wght" ${PESO_ACUMIN[m[2] || '']}, "slnt" ${m[3] ? 12 : 0}` : null;
}
function texto(pai, c, b, conteudo, anc) {
  const a = anc || c.alinhamento;
  // linha de base: mesma conta do baselineTexto do gerador (Na altura: em cima / no meio / embaixo)
  const yb = c.alinha_v === 'centro' ? b.y + b.h / 2 + (c.tamanho || 0) * 0.36 : c.alinha_v === 'baixo' ? b.y + b.h : b.y + b.h * 0.78;
  const t = el('text', { x: xTexto(b, a), y: yb, 'text-anchor': ancora(a), 'font-family': c.fonte, 'font-size': c.tamanho, fill: tinta(c.cor), 'pointer-events': 'none',
    ...contorno(c), 'paint-order': 'stroke', 'stroke-linejoin': 'round', filter: filtroSombra(c),
    'font-style': c.italico ? 'italic' : null, 'letter-spacing': c.espacamento ? (c.espacamento / 1000) * c.tamanho : null,
    'text-decoration': [c.sublinhado && 'underline', c.tachado && 'line-through'].filter(Boolean).join(' ') || null }, pai);
  const eixos = eixosDaFonte(c.fonte);
  if (eixos) t.style.fontVariationSettings = eixos;
  if (c.caixa_alta) t.style.textTransform = 'uppercase';
  if (c.versalete) t.style.fontVariant = 'small-caps';
  t.textContent = conteudo;
  return t;
}
// nome como o editor escreve: quebra na largura da caixa até max_linhas (padrão 2), com linhas de
// tamanho parecido; se nem assim couber, a fonte diminui (até 15 pt). O bloco encosta no topo da
// caixa (as linhas descem), fica no meio ou embaixo dela (alinha_v). Fora da tela (sem medida) fica
// numa linha só, como antes.
function textoNome(pai, c, b, conteudo) {
  const t = texto(pai, c, b, conteudo);
  let w0 = 0; try { w0 = t.getComputedTextLength(); } catch (e) { /* sem medida */ }
  if (!w0) return t;
  const x = t.getAttribute('x'), pal = String(conteudo).split(/\s+/).filter(Boolean);
  const escreve = (ls, f) => {
    t.textContent = ''; t.setAttribute('font-size', f);
    ls.forEach((ln, i) => { el('tspan', { x, dy: i ? f : null }, t).textContent = ln; });
    return Math.max(...[...t.children].map(s => s.getComputedTextLength()));
  };
  let melhor = null;
  for (let k = 1; k <= (c.max_linhas || 2) && k <= Math.max(1, pal.length); k++) {
    const ls = quebrarEm(pal, k), w = escreve(ls, c.tamanho);
    if (!melhor || w < melhor.w) melhor = { ls, w };
    if (w <= b.w) break;
  }
  const f = melhor.w > b.w ? Math.max(c.tamanho * b.w / melhor.w, Math.min(15, c.tamanho)) : c.tamanho;
  escreve(melhor.ls, f);
  const bb = t.getBBox(), folga = b.h - bb.height;
  t.setAttribute('y', +t.getAttribute('y') + b.y + (c.alinha_v === 'baixo' ? folga : c.alinha_v === 'centro' ? folga / 2 : 0) - bb.y);
  return t;
}
// fundo do nome que abraça o texto (mesma regra do editor): cresce do lado do alinhamento, texto no
// meio da altura; estica_encolhe não passa do tamanho desenhado. Fixo (e path) fica como está.
function abracarFundoNome(f, cfg, t, alinhamento) {
  if (!f || !cfg || !t || (cfg.regra !== 'estica' && cfg.regra !== 'estica_encolhe') || f.tagName === 'path') return;
  let tb; try { tb = t.getBBox(); } catch (e) { return; }
  if (!tb.width) return;
  const m = margensNome(cfg), w0 = +f.getAttribute('width'), h0 = +f.getAttribute('height');
  let w = tb.width + m.l + m.r, h = tb.height + m.t + m.b;
  if (cfg.regra === 'estica_encolhe') { w = Math.min(w, w0); h = Math.min(h, h0); }
  const an = alinhamento === 'middle' ? 'middle' : alinhamento === 'end' ? 'end' : 'start';
  const x = an === 'end' ? tb.x + tb.width + m.r - w : an === 'middle' ? tb.x + tb.width / 2 - w / 2 : tb.x - m.l;
  f.setAttribute('x', x); f.setAttribute('y', tb.y + tb.height / 2 - h / 2); f.setAttribute('width', w); f.setAttribute('height', h);
}
// R$ "na borda" do fundo do preço (mesma conta do precoNaBorda do gerador): o R$ e o círculo andam até o
// meio deles ficar na borda lateral do fundo
function precoNaBorda(campos) {
  const f = campos.preco_fundo, lado = f && f.na_borda;
  if (!f || (lado !== 'esq' && lado !== 'dir')) return campos;
  const ms = [campos.moeda, campos.moeda_fundo].filter(Boolean);
  if (!ms.length) return campos;
  const x0 = Math.min(...ms.map(b => b.x)), x1 = Math.max(...ms.map(b => b.x + b.w));
  const dx = (lado === 'esq' ? f.x : f.x + f.w) - (x0 + x1) / 2;
  if (Math.abs(dx) < 0.01) return campos;
  const out = { ...campos };
  for (const k of ['moeda', 'moeda_fundo']) if (out[k]) out[k] = { ...out[k], x: out[k].x + dx };
  return out;
}
// Prévia da regra do fundo do preço no construtor (a mesma ideia do aplicarRegraFundo do editor): R$ encosta
// no começo do valor, o fundo cresce pro lado da regra com o respiro, e passou da largura máxima o grupo
// inteiro diminui por igual.
function previaRegraPreco(gp, cfg, pc) {
  const borda = cfg.na_borda === 'esq' || cfg.na_borda === 'dir' ? cfg.na_borda : '';
  if (borda && (!cfg.regra || cfg.regra === 'fixo')) cfg = { ...cfg, regra: 'estica' };
  if (!cfg.regra || cfg.regra === 'fixo' || pc.fundo.tagName === 'image') return;
  const bb = e => e.getBBox(), val = [pc.valor, pc.cent, pc.un].filter(Boolean).map(bb).filter(b => b.width);
  if (!val.length) return;
  const uni = rs => { const x0 = Math.min(...rs.map(r => r.x)), y0 = Math.min(...rs.map(r => r.y)); return { x: x0, y: y0, w: Math.max(...rs.map(r => r.x + r.width)) - x0, h: Math.max(...rs.map(r => r.y + r.height)) - y0 }; };
  const v0 = bb(pc.valor), moedas = [pc.moeda, pc.moedaFundo].filter(Boolean);
  if (pc.moeda && !borda) {
    const rm = bb(pc.moeda), dx = v0.x - Math.max(2, v0.height * 0.12) - (rm.x + rm.width);
    for (const m of moedas) m.setAttribute('transform', `translate(${dx} 0) ${m.getAttribute('transform') || ''}`.trim());
  }
  const bloco = borda ? uni(val) : uni([...val, ...moedas.map(m => { const b = bb(m), t = (m.getAttribute('transform') || '').match(/translate\(([-\d.]+)/); return { ...b, x: b.x + (t ? +t[1] : 0), y: b.y, width: b.width, height: b.height }; })]);
  const f = pc.fundo, F = pc.fundoB;
  const r = cfg.respiro ?? 12;
  const M = borda && moedas.length ? uni(moedas.map(bb)) : null, meiaM = M ? M.w / 2 : 0;
  let W = bloco.w + 2 * r + meiaM;
  if (!cfg.encolhe) W = Math.max(W, F.w);
  if (cfg.regra === 'estica_encolhe' && !cfg.largura_max) W = Math.min(W, F.w);
  const lado = cfg.regra_lado || 'ambos';
  const x = lado === 'esq' ? F.x + F.w - W : lado === 'dir' ? F.x : F.x + F.w / 2 - W / 2;
  if (f.tagName === 'rect') { f.setAttribute('x', x); f.setAttribute('width', W); }
  else { const c = cfg.cantos && cfg.cantos.length === 4 ? cfg.cantos : [true, true, true, true]; f.setAttribute('d', caminhoCantos({ x, y: F.y, w: W, h: F.h }, Math.min(cfg.raio || 0, W / 2, F.h / 2), c)); }
  const alvo = lado === 'ambos' ? x + (W - bloco.w) / 2 : lado === 'esq' ? Math.min(bloco.x, x + W - r - bloco.w) : Math.max(bloco.x, x + r);
  const dx = Math.max(x + r, Math.min(alvo, x + W - r - bloco.w)) - bloco.x;
  if (borda) {
    // R$ na borda: valor no meio do que o R$ não cobre, R$ e círculo com o meio na borda lateral
    const ix = x + (borda === 'esq' ? meiaM : 0), dv = ix + (W - meiaM - bloco.w) / 2 - bloco.x;
    for (const n of [pc.valor, pc.cent, pc.un].filter(Boolean)) n.setAttribute('transform', `translate(${dv} 0) ${n.getAttribute('transform') || ''}`.trim());
    if (M) { const dm = (borda === 'esq' ? x : x + W) - (M.x + M.w / 2); for (const n of moedas) n.setAttribute('transform', `translate(${dm} 0) ${n.getAttribute('transform') || ''}`.trim()); }
  } else if (Math.abs(dx) > 0.01) for (const n of [pc.valor, pc.cent, pc.un, ...moedas].filter(Boolean)) n.setAttribute('transform', `translate(${dx} 0) ${n.getAttribute('transform') || ''}`.trim());
  // largura máxima: o grupo inteiro diminui por igual, preso no lado que não cresce (pé do fundo)
  if (cfg.largura_max && W > cfg.largura_max * 1.01) {
    const s = cfg.largura_max / W, ax = lado === 'esq' ? x + W : lado === 'dir' ? x : x + W / 2, ay = F.y + F.h;
    gp.setAttribute('transform', `translate(${ax} ${ay}) scale(${s}) translate(${-ax} ${-ay})`);
  }
}
// k linhas com a mais comprida a menor possível (mesma conta do quebrarEm do editor)
function quebrarEm(pal, k) {
  if (k <= 1 || pal.length < k) return [pal.join(' ')];
  let melhor = null;
  const corta = (ini, resto, acc) => {
    if (resto === 1) { const l = [...acc, pal.slice(ini).join(' ')], m = Math.max(...l.map(s => s.length)); if (!melhor || m < melhor.m) melhor = { m, l }; return; }
    for (let i = ini + 1; i <= pal.length - resto + 1; i++) corta(i, resto - 1, [...acc, pal.slice(ini, i).join(' ')]);
  };
  corta(0, k, []);
  return melhor.l;
}
const pctCaixa = (c, card) => ({ x: card.x + c.x / 100 * card.w, y: card.y + c.y / 100 * card.h, w: c.w / 100 * card.w, h: c.h / 100 * card.h });

// preço COM selo do clube (Matheus, 17/10/2026): o card tem dois desenhos do preço. O normal (campos) vale
// pro produto sem selo; com selo, o grupo do preço inteiro vai pra outro lugar/tamanho (campos.com_selo =
// { x, y, escala }: canto de cima-esquerdo do grupo em % do card e o tamanho em relação ao normal), junto
// das peças do selo. O editor troca sozinho conforme o produto tenha ou não o preço do clube.
const PRECO_KS = ['preco_fundo', 'moeda_fundo', 'moeda', 'preco', 'centavos', 'unidade'];
const SELO_KS = ['selo_fundo', 'selo_rotulo', 'selo_moeda', 'selo_valor'];
const DE_KS = ['de_fundo', 'de_rotulo', 'de_valor'];
const MEDIDAS_GRUPO = ['tamanho', 'borda', 'raio', 'respiro', 'largura_max', 'margem_t', 'margem_r', 'margem_b', 'margem_l'];
function caixaPrecoNormal(campos, card) {
  const bs = PRECO_KS.filter(k => campos[k]).map(k => pctCaixa(campos[k], { x: 0, y: 0, w: card.w, h: card.h }));
  if (!bs.length) return null;
  const x0 = Math.min(...bs.map(b => b.x)), y0 = Math.min(...bs.map(b => b.y));
  return { x: x0, y: y0, w: Math.max(...bs.map(b => b.x + b.w)) - x0, h: Math.max(...bs.map(b => b.y + b.h)) - y0 };
}
// as peças do preço como ficam com selo (cópias: mexer nelas não muda o normal)
function pecasComSelo(campos, card) {
  const cs = campos.com_selo, U = caixaPrecoNormal(campos, card);
  if (!cs || !U) return {};
  const s = cs.escala || 1, X = cs.x / 100 * card.w, Y = cs.y / 100 * card.h, r = v => +v.toFixed(2), out = {};
  for (const k of PRECO_KS) {
    const o = campos[k]; if (!o) continue;
    const x = o.x / 100 * card.w, y = o.y / 100 * card.h, w = o.w / 100 * card.w, h = o.h / 100 * card.h;
    const n = { ...o, x: r((X + (x - U.x) * s) / card.w * 100), y: r((Y + (y - U.y) * s) / card.h * 100), w: r(w * s / card.w * 100), h: r(h * s / card.h * 100) };
    for (const m of MEDIDAS_GRUPO) if (typeof o[m] === 'number') n[m] = Math.round(o[m] * s * 10) / 10;
    // ajustes só do preço com selo (cor, borda, lugar): por cima da cópia
    const aj = cs.pecas && cs.pecas[k];
    if (aj) for (const p of ['x', 'y', 'cor', 'borda_cor']) if (aj[p] != null) n[p] = aj[p];
    out[k] = n;
  }
  return out;
}
// o que aparece no card: sem selo = só o preço normal; com selo = preço no lugar "com selo" + selo
function vistaSelo(campos, card, comSelo, comDe) {
  const v = { ...campos };
  if (!comDe) for (const k of DE_KS) delete v[k];
  if (!campos.selo_valor) return v;
  if (!comSelo) { for (const k of SELO_KS) delete v[k]; return v; }
  return Object.assign(v, pecasComSelo(campos, card));
}
// grupo do preço proporcional (mesma conta do precoProporcional do gerador): numa casa de outro tamanho que
// a do modelo, fundo, R$, valor, unidade, DE, selo e extras travados crescem e encolhem por igual com o card,
// presos no canto do card
const PECAS_JUNTO = ['de_fundo', 'de_rotulo', 'de_valor', 'selo_fundo', 'selo_rotulo', 'selo_moeda', 'selo_valor'];
function precoProporcional(campos, ref, casa) {
  if (!(ref.w > 0 && ref.h > 0 && casa.w > 0 && casa.h > 0)) return campos;
  if (Math.abs(ref.w - casa.w) < 0.01 && Math.abs(ref.h - casa.h) < 0.01) return campos;
  const pecas = PRECO_KS.filter(k => campos[k]).map(k => campos[k]);
  if (!pecas.length) return campos;
  const x0 = Math.min(...pecas.map(b => b.x)) / 100 * ref.w, x1 = Math.max(...pecas.map(b => b.x + b.w)) / 100 * ref.w;
  const y0 = Math.min(...pecas.map(b => b.y)) / 100 * ref.h, y1 = Math.max(...pecas.map(b => b.y + b.h)) / 100 * ref.h;
  // cresce e encolhe por igual com o card: a menor das proporções de largura e altura (nada estica)
  const cx = (x0 + x1) / 2 / ref.w, cy = (y0 + y1) / 2 / ref.h;
  // distância até as bordas em pt (o movimento), tamanho proporcional; se com as margens em pt não couber, encolhe mais
  const s0 = Math.min(casa.w / ref.w, casa.h / ref.h,
    cx > 0.6 || cx < 0.4 ? Math.max(0.05, (casa.w - (cx > 0.6 ? ref.w - x1 : x0)) / (x1 - x0)) : Infinity,
    Math.max(0.05, (casa.h - (cy > 0.5 ? ref.h - y1 : y0)) / (y1 - y0)));
  // altura mínima do grupo do preço (pt, no modelo): não encolhe abaixo dela, desde que o grupo caiba no card
  const minH = campos.min_preco_h ?? (typeof M !== 'undefined' && M.m ? M.m.min_preco_h : null);
  const s = typeof minH === 'number' && minH > 0 ? Math.max(s0, Math.min(minH / (y1 - y0), casa.w / (x1 - x0), casa.h / (y1 - y0))) : s0;
  const X0 = cx > 0.6 ? casa.w - (ref.w - x1) - (x1 - x0) * s : cx < 0.4 ? x0 : cx * casa.w - (x1 - x0) * s / 2;
  const Y0 = cy > 0.5 ? casa.h - (ref.h - y1) - (y1 - y0) * s : y0;
  const ptX = x => X0 + (x / 100 * ref.w - x0) * s, ptY = y => Y0 + (y / 100 * ref.h - y0) * s, r = v => +v.toFixed(3);
  const out = { ...campos };
  for (const k of [...PRECO_KS, ...PECAS_JUNTO.filter(k => !k.startsWith('de_') || !campos.de_trava || campos.de_trava === 'preco')]) {
    const o = campos[k]; if (!o) continue;
    const n = { ...o, x: r(ptX(o.x) / casa.w * 100), y: r(ptY(o.y) / casa.h * 100), w: r(o.w / 100 * ref.w * s / casa.w * 100), h: r(o.h / 100 * ref.h * s / casa.h * 100) };
    for (const m of MEDIDAS_GRUPO) if (typeof o[m] === 'number') n[m] = Math.round(o[m] * s * 100) / 100;
    out[k] = n;
  }
  if (campos.com_selo) out.com_selo = { ...campos.com_selo, x: r(ptX(campos.com_selo.x) / casa.w * 100), y: r(ptY(campos.com_selo.y) / casa.h * 100) };
  // extras travados no preço (etiqueta do R$, moeda): andam e encolhem com o grupo
  if (campos.extras) out.extras = campos.extras.map(e => {
    if (e.trava !== 'preco') return e;
    const n = { ...e, x: r(ptX(e.x) / casa.w * 100), y: r(ptY(e.y) / casa.h * 100), w: r(e.w / 100 * ref.w * s / casa.w * 100), h: r(e.h / 100 * ref.h * s / casa.h * 100) };
    for (const m of MEDIDAS_GRUPO) if (typeof e[m] === 'number') n[m] = Math.round(e[m] * s * 100) / 100;
    return n;
  });
  return out;
}
// nome (ou o fundo dele) preso ao grupo do preço, com espaço e limites até a borda do card (Matheus, 22/10/2026)
function linhasPreso(c) {
  return [{ dica: '— Posição: preso ao preço —' },
    { rot: 'Preso ao preço', k: 'preso_preco', tipo: 'check' },
    ...(c.preso_preco ? [
      { rot: 'Espaço até o preço', k: 'preso_gap', tipo: 'number', ph: '6', un: 'pt' },
      { rot: 'Limite esquerdo', k: 'preso_esq', tipo: 'number', ph: 'livre', un: 'pt' },
      { rot: 'Limite direito', k: 'preso_dir', tipo: 'number', ph: 'livre', un: 'pt' },
      { dica: 'No editor, o pé do nome (ou do fundo dele) fica a esse espaço acima do grupo do preço, em qualquer tamanho de card. Limite = distância da borda do card; vazio = livre (cresce pra esse lado com o título). Os dois vazios: centrado no preço.' }] : [])];
}
// nome (ou o fundo dele) preso ao preço: prévia da conta do editor (nomePresoAoPreco), com o fundo do tamanho
// desenhado. out já está na casa (% dela); mexe em out e devolve o deslocamento do pé do nome (pras travas no nome).
// Vale em toda casa, inclusive a do tamanho do desenho (Matheus, 30/10/2026: o título mudava de lugar ao mexer no card)
function prenderNomeAoPreco(c, out, ref, casa) {
  const nf = c.nome_fundo || (c.nome && c.nome.preso_preco ? c.nome : null);
  if (!nf || !nf.preso_preco) return null;
  const r = v => +v.toFixed(3);
  const pt = b => ({ x: b.x / 100 * ref.w, y: b.y / 100 * ref.h, w: b.w / 100 * ref.w, h: b.h / 100 * ref.h });
  const pct = b => ({ x: r(b.x / casa.w * 100), y: r(b.y / casa.h * 100), w: r(b.w / casa.w * 100), h: r(b.h / casa.h * 100) });
  const pp = PRECO_KS.filter(k => out[k]).map(k => ({ x: out[k].x / 100 * casa.w, y: out[k].y / 100 * casa.h, w: out[k].w / 100 * casa.w, h: out[k].h / 100 * casa.h }));
  if (!pp.length) return null;
  const fy = Math.min(...pp.map(b => b.y)), fx0 = Math.min(...pp.map(b => b.x)), fx1 = Math.max(...pp.map(b => b.x + b.w));
  const B = pt(nf), lim = v => (typeof v === 'number' && isFinite(v) ? v : null), e = lim(nf.preso_esq), d = lim(nf.preso_dir);
  const w = Math.min(B.w, casa.w - (e || 0) - (d || 0));
  const x = d != null ? casa.w - d - w : e != null ? e : (fx0 + fx1) / 2 - w / 2;
  const N = { x, y: fy - (nf.preso_gap ?? 6) - B.h, w, h: B.h };
  const dx = N.x - B.x, dy = N.y - B.y;
  if (c.nome_fundo) out.nome_fundo = { ...nf, ...pct(N) };
  if (c.nome) { const T = pt(c.nome); out.nome = { ...c.nome, ...pct({ x: T.x + dx, y: T.y + dy, w: Math.min(T.w, w), h: T.h }) }; }
  return { dx: dx + B.w / 2 - w / 2, dy };
}
// card numa casa de outro tamanho que a do desenho: tudo por distância em pt (mesma conta do camposNaCasa do gerador)
function camposNaCasa(campos, ref, casa) {
  if (!(ref.w > 0 && ref.h > 0 && casa.w > 0 && casa.h > 0)) return campos;
  // casa do tamanho do desenho: só o nome preso ao preço (sem ele, o título ficava onde foi desenhado aqui e
  // pulava pro preço quando a casa mudava um nada de tamanho)
  if (Math.abs(ref.w - casa.w) < 0.01 && Math.abs(ref.h - casa.h) < 0.01) { const out = { ...campos }; return prenderNomeAoPreco(campos, out, ref, casa) ? out : campos; }
  const r = v => +v.toFixed(3);
  const pt = b => ({ x: b.x / 100 * ref.w, y: b.y / 100 * ref.h, w: b.w / 100 * ref.w, h: b.h / 100 * ref.h });
  const pct = b => ({ x: r(b.x / casa.w * 100), y: r(b.y / casa.h * 100), w: r(b.w / casa.w * 100), h: r(b.h / casa.h * 100) });
  const out = precoProporcional(campos, ref, casa), c = campos;
  const estica = B => ({ x: B.x, y: B.y, w: Math.max(10, casa.w - B.x - (ref.w - B.x - B.w)), h: Math.max(10, casa.h - B.y - (ref.h - B.y - B.h)) });
  for (const k of ['area', 'foto']) if (c[k]) out[k] = { ...c[k], ...pct(estica(pt(c[k]))) };
  const nomeNa = B => ({ x: B.x, y: (B.y + B.h / 2) / ref.h <= 0.5 ? B.y : casa.h - (ref.h - B.y), w: Math.max(10, casa.w - B.x - (ref.w - B.x - B.w)), h: B.h });
  let dNome = null;
  for (const k of ['nome_fundo', 'nome']) {
    if (!c[k]) continue;
    const B = pt(c[k]), N = nomeNa(B);
    out[k] = { ...c[k], ...pct(N) };
    if (!dNome || k === 'nome') dNome = { dx: (N.x + N.w / 2) - (B.x + B.w / 2), dy: (N.y + N.h) - (B.y + B.h) };
  }
  const dPreso = prenderNomeAoPreco(c, out, ref, casa);
  if (dPreso) dNome = dPreso;
  const A0 = c.area ? pt(c.area) : null, A1 = A0 ? estica(A0) : null;
  const sB =Math.min(casa.w / ref.w, casa.h / ref.h);
  const bloco = (U, trava) => {
    let ax = 0.5, ay = 0.5, PX, PY;
    if (trava === 'nome' && dNome) { ay = 1; PX = U.x + U.w / 2 + dNome.dx; PY = U.y + U.h + dNome.dy; }
    else if (trava === 'imagem' && A0 && A1) {
      PX = A1.x + (U.x + U.w / 2 - A0.x) / (A0.w || 1) * A1.w; PY = A1.y + (U.y + U.h / 2 - A0.y) / (A0.h || 1) * A1.h;
    } else {
      const cx = (U.x + U.w / 2) / ref.w, cy = (U.y + U.h / 2) / ref.h;
      const lado = trava === 'esq' || trava === 'dir' || trava === 'centro' ? trava : cx < 0.4 ? 'esq' : cx > 0.6 ? 'dir' : 'centro';
      ax = lado === 'esq' ? 0 : lado === 'dir' ? 1 : 0.5; ay = cy < 0.4 ? 0 : cy > 0.6 ? 1 : 0.5;
      const px = U.x + ax * U.w, py = U.y + ay * U.h;
      // o ponto que o bloco segue fica à mesma distância em pt da borda; só o tamanho é proporcional
      PX = ax === 0 ? px : ax === 1 ? casa.w - (ref.w - px) : px / ref.w * casa.w;
      PY = ay === 0 ? py : ay === 1 ? casa.h - (ref.h - py) : py / ref.h * casa.h;
    }
    const ox = U.x + ax * U.w, oy = U.y + ay * U.h;
    return o => {
      const B = pt(o), n = { ...o, ...pct({ x: PX + (B.x - ox) * sB, y: PY + (B.y - oy) * sB, w: B.w * sB, h: B.h * sB }) };
      for (const m of MEDIDAS_GRUPO) if (typeof o[m] === 'number') n[m] = Math.round(o[m] * sB * 100) / 100;
      return n;
    };
  };
  const uniaoPt = bs => { const x0 = Math.min(...bs.map(b => b.x)), y0 = Math.min(...bs.map(b => b.y)); return { x: x0, y: y0, w: Math.max(...bs.map(b => b.x + b.w)) - x0, h: Math.max(...bs.map(b => b.y + b.h)) - y0 }; };
  if (c.de_trava && c.de_trava !== 'preco') {
    const ks = DE_KS.filter(k => c[k]);
    if (ks.length) { const f = bloco(uniaoPt(ks.map(k => pt(c[k]))), c.de_trava); for (const k of ks) out[k] = f(c[k]); }
  }
  if (c.extras) out.extras = out.extras.map((e, i) => (c.extras[i].trava === 'preco' ? e : bloco(pt(c.extras[i]), c.extras[i].trava)(c.extras[i])));
  // gatilho: laterais em pt e a altura do card que ele segue; letra e altura da tarja iguais (como o gerador)
  const gks = GATILHO_KS.filter(k => c[k]);
  if (gks.length) {
    const U = uniaoPt(gks.map(k => pt(c[k]))), v = ancoraVGatilho(c);
    const dy = v === 'cima' ? 0 : v === 'baixo' ? casa.h - ref.h : (U.y + U.h / 2) * (casa.h / ref.h - 1);
    for (const k of gks) { const B = pt(c[k]); out[k] = { ...c[k], ...pct({ x: B.x, y: B.y + dy, w: Math.max(4, casa.w - B.x - (ref.w - B.x - B.w)), h: B.h }) }; }
  }
  return out;
}
// O preço de cada versão do card guarda o tamanho (pt) do card em que foi desenhado (preco_ref). Ao abrir o
// modelo, ele é trazido pro card que o modal mostra (mesmos pt, mesmo canto) e o preco_ref passa a ser esse
// card: mudar zona, colunas ou itens por linha nunca estica nem afina o preço (Matheus, 19/10/2026)
// o card inteiro (desde que tudo passou a ser medido em pt na casa, não só o preço)
const fotoPreco = c => JSON.stringify(c);
function precoRefDaAba(aba, converte = true) {
  const c = M.m[aba]; if (!c) return;
  const aba0 = M.aba; M.aba = aba; const card = caixaCardModal(); M.aba = aba0;
  // o desenho de antes fica guardado: se o preço não for mexido no modal, salvar devolve ele (um card mais
  // estreito encolheria o preço pra caber e, gravado assim, ele não voltaria a crescer no card largo)
  const orig = converte && c.preco_ref && c.preco_ref.w > 0 && c.preco_ref.h > 0 ? clone(c) : null;
  if (orig) M.m[aba] = camposNaCasa(c, c.preco_ref, card);
  M.m[aba].preco_ref = { w: +card.w.toFixed(2), h: +card.h.toFixed(2) };
  if (orig) (M.precoOrig || (M.precoOrig = {}))[aba] = { orig, visto: fotoPreco(M.m[aba]) };
}
function prepararPrecoRef() { M.precoOrig = {}; for (const aba of ['campos', 'especial', 'horizontal']) precoRefDaAba(aba); }
function devolverPrecoOrig() {
  for (const [aba, o] of Object.entries(M.precoOrig || {})) {
    const c = M.m[aba]; if (!c || fotoPreco(c) !== o.visto) continue;
    M.m[aba] = clone(o.orig);
  }
}
// Molde padrão (Matheus, 19/10/2026): todo modelo de card, em todo template, é desenhado no mesmo tamanho; os
// tamanhos que as zonas deste template têm são "formatos": saem do padrão (movimento em pt, tamanho
// proporcional) e, se ajustados, guardam o desenho próprio em modelo.formatos (mesma conta do gerador)
const MOLDE_PADRAO = { campos: { w: 240, h: 250 }, horizontal: { w: 300, h: 180 }, especial: { w: 490, h: 510 } };
const NOME_VERSAO = { campos: 'Normal', horizontal: 'Horizontal', especial: 'Especial' };
const rf1 = v => Math.round(v * 10) / 10;
const chaveFormato = (v, w, h) => `${v}:${rf1(w)}x${rf1(h)}`;
function tamDaChave(k) { const m = String(k).match(/^(\w+):([\d.]+)x([\d.]+)$/); return m ? { v: m[1], w: +m[2], h: +m[3] } : null; }
function versaoNaCasa(m, v, casa, refLegado) {
  const f = m.formatos && m.formatos[chaveFormato(v, casa.w, casa.h)];
  const min = c => (m.min_preco_h ? { ...c, min_preco_h: m.min_preco_h } : c);
  if (f) return precoNaCasa(min(comTravas(m, f)), casa, casa);
  return precoNaCasa(min(comTravas(m, m[v])), refLegado, casa);
}
// formatos deste modelo no template: cada linha de cada zona (normal ou horizontal, pela casa) e os moldes de
// especial e horizontal que a publicação gera (mesma conta do gerador: casa da 1ª zona, pelas colunas)
function formatosDoModelo(m) {
  const lista = new Map(), soma = (v, w, h, onde, n) => {
    const k = chaveFormato(v, w, h), f = lista.get(k) || { k, v, w: rf1(w), h: rf1(h), onde: [], n: 0 };
    if (!f.onde.includes(onde)) f.onde.push(onde); f.n += n; lista.set(k, f);
  };
  let primeira = null;
  S.proj.pranchetas.forEach((pr, pi) => zonasAbertas(pr).forEach((z, zi) => {
    if (z.modelo_card_id !== m.id) return;
    const e = z.espaco ?? S.proj.espaco_padrao, h = (z.h - (z.linhas - 1) * e) / z.linhas;
    if (!primeira) primeira = { w: (z.w - (z.colunas - 1) * e) / z.colunas, h, e };
    for (let r = 0; r < z.linhas; r++) {
      const n = itensDaLinha(z, r), w = (z.w - (n - 1) * e) / n;
      soma(usaHorizontal(m, z, w, h) ? 'horizontal' : 'campos', w, h, `${pr.nome || 'Prancheta ' + (pi + 1)} · zona ${zi + 1}`, n);
    }
  }));
  if (primeira && m.especial) soma('especial', primeira.w * 2 + primeira.e, primeira.h * 2 + primeira.e, 'molde do especial', 0);
  if (primeira && m.horizontal) {
    const c = primeira, hz = c.w / c.h >= PROPORCAO_HORIZONTAL ? c : { w: c.w * 2 + c.e, h: c.h };
    soma('horizontal', hz.w, hz.h, 'molde do horizontal', 0);
  }
  return [...lista.values()];
}
const comRef = (c, t) => ({ ...c, preco_ref: { w: +t.w.toFixed(2), h: +t.h.toFixed(2) } });
// casa em que a versão estava desenhada antes do molde padrão (a conta antiga do caixaCardModal)
function refAntiga(m, v) {
  const c0 = m[v]; if (c0 && c0.preco_ref && c0.preco_ref.w > 0 && c0.preco_ref.h > 0) return c0.preco_ref;
  const c = casaDoModelo(m.id, v === 'campos');
  if (v === 'especial') return { w: c.w * 2 + c.e, h: c.h * 2 + c.e };
  if (v === 'horizontal') return c.w / c.h >= PROPORCAO_HORIZONTAL ? { w: c.w, h: c.h } : { w: c.w * 2 + c.e, h: c.h };
  return { w: c.w, h: c.h };
}
// leva o modelo pro molde padrão. Template já publicado: cada tamanho em uso ganha o formato ajustado igual ao
// que está publicado hoje (nada muda de cara até ajustar ou "voltar ao padrão"); o padrão sai do desenho atual
function migrarMolde(m) {
  if (m.molde) return;
  const formatos = { ...(m.formatos || {}) }, refs = {};
  for (const v of Object.keys(MOLDE_PADRAO)) if (m[v]) refs[v] = refAntiga(m, v);
  if (S.proj.publicadoEm) for (const f of formatosDoModelo(m)) {
    if (!m[f.v] || formatos[f.k]) continue;
    formatos[f.k] = comRef(camposNaCasa(m[f.v], refs[f.v], f), f);
  }
  for (const v of Object.keys(refs)) m[v] = comRef(camposNaCasa(m[v], refs[v], MOLDE_PADRAO[v]), MOLDE_PADRAO[v]);
  m.formatos = formatos; if (!Object.keys(formatos).length) delete m.formatos;
  m.molde = 1;
}
const versaoDaAba = aba => (String(aba).startsWith('f:') ? tamDaChave(aba.slice(2)).v : aba);
// abre um formato no modal: o ajustado, ou o padrão levado pra casa dele (só é gravado se for mexido)
function abrirFormato(f) {
  const a = 'f:' + f.k, base = M.m[f.v]; if (!base) return;
  const derivado = M.derivados[f.k] != null && fotoPreco(M.m[a]) === M.derivados[f.k];
  if (!M.m[a] || derivado) { M.m[a] = comRef(camposNaCasa(base, MOLDE_PADRAO[f.v], f), f); M.derivados[f.k] = fotoPreco(M.m[a]); }
  M.aba = a; M.sel = null; renderModelo();
}
const formatoAjustado = k => !!M.m['f:' + k] && (M.derivados[k] == null || fotoPreco(M.m['f:' + k]) !== M.derivados[k]);
// prévia da prancheta: igual ao precoNaCasa do gerador
function precoNaCasa(campos, ref, casa) {
  const r = campos.preco_ref && campos.preco_ref.w > 0 && campos.preco_ref.h > 0 ? campos.preco_ref : ref;
  return r ? camposNaCasa(campos, r, casa) : campos;
}
// olho aberto (aparece) ou riscado (escondido), no lugar da chave liga/desliga dos grupos do card
function iconeOlho(aberto) {
  const sv = el('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  el('path', { d: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z' }, sv);
  el('circle', { cx: 12, cy: 12, r: 3 }, sv);
  if (!aberto) el('path', { d: 'M3 3l18 18' }, sv);
  return sv;
}
// entra no "com selo" a 1ª vez: o preço já nasce menor (com o selo ele divide o espaço; pedido do Matheus,
// 17/10/2026), preso no canto de baixo à direita do normal — o selo costuma ficar em cima dele
const ESCALA_COM_SELO = 0.8;
function garantirComSelo(campos, card) {
  if (campos.com_selo || !campos.selo_valor) return;
  const U = caixaPrecoNormal(campos, card), s = ESCALA_COM_SELO;
  if (U) campos.com_selo = { x: +((U.x + U.w * (1 - s)) / card.w * 100).toFixed(2), y: +((U.y + U.h * (1 - s)) / card.h * 100).toFixed(2), escala: s };
}
// caixa do texto do nome (mesma conta do gerador): com fundo do nome, é o fundo menos as margens (pt)
const margensNome = f => ({ t: f.margem_t ?? 6, r: f.margem_r ?? 6, b: f.margem_b ?? 6, l: f.margem_l ?? 6 });
function caixaDoNome(campos, card) {
  if (!campos.nome_fundo) return pctCaixa(campos.nome, card);
  const f = pctCaixa(campos.nome_fundo, card), m = margensNome(campos.nome_fundo);
  return { x: f.x + m.l, y: f.y + m.t, w: Math.max(4, f.w - m.l - m.r), h: Math.max(4, f.h - m.t - m.b) };
}
// com fundo do nome, o campo nome guarda a caixa derivada (em % deste card), pra seleção e grupos verem
function sincronizarNome(campos, card) {
  if (!campos.nome || !campos.nome_fundo) return;
  const b = caixaDoNome(campos, { x: 0, y: 0, w: card.w, h: card.h }), r = v => +v.toFixed(2);
  Object.assign(campos.nome, { x: r(b.x / card.w * 100), y: r(b.y / card.h * 100), w: r(b.w / card.w * 100), h: r(b.h / card.h * 100) });
}

// área da foto pelas regras (mesma conta do gerador); null = modo posição
function areaPorRegra(campos, card) {
  const a = campos.area;
  if (!a || a.modo !== 'regras') return null;
  const gap = a.espaco ?? 6;
  let top = card.y + (a.margem_t ?? 6), bot = card.y + card.h - (a.margem_b ?? 6);
  const l = card.x + (a.margem_l ?? 6), r = card.x + card.w - (a.margem_r ?? 6);
  if (a.resp_nome !== false && campos.nome) { const n = pctCaixa(campos.nome_fundo || campos.nome, card); top = Math.max(top, n.y + n.h + gap); }
  const pecas = ['preco_fundo', 'moeda_fundo', 'moeda', 'preco', 'centavos', 'unidade'].filter(k => campos[k]).map(k => pctCaixa(campos[k], card));
  if (pecas.length) {
    const y0 = Math.min(...pecas.map(b => b.y)), y1 = Math.max(...pecas.map(b => b.y + b.h));
    if ((y0 + y1) / 2 > card.y + card.h / 2) { if (a.resp_preco_baixo !== false) bot = Math.min(bot, y0 - gap); }
    else if (a.resp_preco_cima) top = Math.max(top, y1 + gap);
  }
  return { x: l, y: top, w: Math.max(10, r - l), h: Math.max(10, bot - top) };
}

// produtos de exemplo (de uma edição de verdade): o construtor desenha nome, preço e fotos reais nos
// cards pra ver o template com produto antes de publicar. S.exemplo = { edicao, titulo, produtos }
const srcFoto = arq => `/api/encarte/img?p=${encodeURIComponent(arq)}&w=360`;
function partesPrecoEx(txt) {
  const m = String(txt || '').trim().match(/^(\d+)[,.](\d{2})$/);
  return m ? { real: m[1], cent: ',' + m[2] } : { real: String(txt || '0,00'), cent: '' };
}
// fotos assentadas na área como o editor faz no simples: uma ocupa a área (alinhada pelo foto_alinha);
// duas ou três dividem a largura, encavaladas
function fotosExemplo(g, fotos, A, alinha) {
  const [v, hz] = (alinha || 'baixo centro').split(' ');
  const ay = v === 'cima' ? 'YMin' : v === 'centro' ? 'YMid' : 'YMax', n = Math.min(fotos.length, 3);
  for (let i = 0; i < n; i++) {
    const w = n === 1 ? A.w : A.w * 0.62, x = n === 1 ? A.x : A.x + i * (A.w - w) / (n - 1);
    const ax = n > 1 ? 'xMid' : hz === 'esq' ? 'xMin' : hz === 'dir' ? 'xMax' : 'xMid';
    el('image', { href: srcFoto(fotos[i]), x, y: A.y, width: w, height: A.h, preserveAspectRatio: ax + ay + ' meet', 'pointer-events': 'none' }, g);
  }
}
const chaveExemplo = () => S.proj ? 'construtor-exemplo-' + S.proj.id : '';
function produtoExemplo(i) {
  const ps = S.exemplo && S.exemplo.produtos;
  return ps && ps.length ? ps[i % ps.length] : null;
}
// produtos de uma edição (ficha do editor) → { nome, preco, formato, fotos[] }; removidos ficam de fora
function produtosDaEdicao(ed) {
  return (ed.produtos || []).filter(p => !p.removido && (p.nome || p.preco)).map(p => ({
    nome: String(p.nome || '').replace(/\s*\n\s*/g, ' ').trim(), preco: p.preco || '', formato: p.formato || '',
    selo: p.selo && p.selo.on ? p.selo.preco || '' : '',
    de: p.de && p.de.on ? p.de.preco || '' : '',
    fotos: (p.fotos || []).map(f => f.arq).filter(a => a && !/SEM IMAGEM/i.test(a)),
  }));
}
async function carregarExemplo(id) {
  if (!id) {
    S.exemplo = null;
    try { localStorage.removeItem(chaveExemplo()); } catch { /* sem storage */ }
  } else {
    carregando(true);
    try {
      const r = await fetch('/api/encarte/edicoes/' + encodeURIComponent(id));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const ed = await r.json();
      S.exemplo = { edicao: id, titulo: ed.titulo, produtos: produtosDaEdicao(ed) };
      try { localStorage.setItem(chaveExemplo(), id); } catch { /* sem storage */ }
    } catch (e) { alert('Não carreguei os produtos: ' + e.message); }
    finally { carregando(false); }
  }
  tudo();
  if ($('#modal-overlay').classList.contains('open')) renderModelo();
  botaoExemplo();
}
function botaoExemplo() {
  const b = $('#btn-exemplo'); if (!b) return;
  b.textContent = S.exemplo ? `Produtos: ${S.exemplo.produtos.length}` : 'Produtos de exemplo';
  b.title = S.exemplo ? `Exemplo: ${S.exemplo.titulo} (clique pra trocar ou tirar)` : 'Ver o template com os produtos de um encarte de verdade';
}
// escolher a edição: as últimas do workspace, filtradas pelo cliente do projeto
async function dialogoExemplo() {
  if (!S.proj) return;
  let lst = [];
  try { const r = await fetch('/api/encarte/edicoes'); lst = r.ok ? await r.json() : []; } catch { /* sem lista */ }
  const fundo = h('div', { style: 'position:fixed;inset:0;background:#0008;z-index:250;display:flex;align-items:center;justify-content:center' });
  const fechar = () => fundo.remove();
  const cli = (S.proj.cliente || '').replace(/^\d+\.\s*(SUP\s+)?/i, '').trim().toLowerCase();
  const busca = h('input', { placeholder: 'Buscar edição (cliente, tema…)', value: cli, style: 'width:100%;height:30px;margin-bottom:8px;background:var(--c-campo);border:1px solid var(--c-campo-borda);border-radius:4px;color:var(--c-text);padding:0 8px' });
  const lista = h('div', { style: 'max-height:50vh;overflow:auto' });
  const desenha = () => {
    lista.replaceChildren();
    const t = busca.value.trim().toLowerCase();
    const vis = lst.filter(e => !t || String(e.titulo || '').toLowerCase().includes(t));
    if (!vis.length) lista.append(h('div', { style: 'padding:10px;color:var(--c-text2)' }, 'Nenhuma edição com essa busca.'));
    for (const e of vis) lista.append(h('div', { class: 'sb-item' + (S.exemplo && S.exemplo.edicao === e.id ? ' active' : ''), on: { click: () => { fechar(); carregarExemplo(e.id); } } },
      h('span', {}, e.titulo || e.id), h('span', { style: 'margin-left:auto;font-size:11px;color:var(--c-text2)' }, String(e.atualizadoEm || '').slice(0, 10))));
  };
  busca.addEventListener('input', desenha); desenha();
  fundo.append(h('div', { style: 'background:var(--c-panel);border:1px solid #111;border-radius:8px;padding:20px;width:min(520px,94vw)' },
    h('h2', { style: 'font-size:14px;margin-bottom:6px' }, 'Produtos de exemplo'),
    h('div', { style: 'font-size:11px;color:var(--c-text2);margin-bottom:10px' }, 'Os cards mostram os produtos dessa edição (nome, preço, unidade e fotos) enquanto você mexe no template. Nada é gravado na edição.'),
    busca, lista,
    h('div', { style: 'display:flex;gap:8px;justify-content:flex-end;margin-top:12px' },
      ...(S.exemplo ? [h('button', { class: 'btn', on: { click: () => { fechar(); carregarExemplo(null); } } }, 'Tirar os produtos')] : []),
      h('button', { class: 'btn', on: { click: fechar } }, 'Fechar'))));
  document.body.append(fundo); busca.focus();
}
function desenharCard(pai, modelo, campos, card, marcar, prod, comSelo, comDe) {
  // sem dizer: o produto de exemplo manda (com selo / com DE se ele tem); sem produto, o template mostra os dois
  campos = vistaSelo(campos, card, comSelo ?? (prod ? !!prod.selo : false), comDe ?? (prod ? !!prod.de : false));
  campos = precoNaBorda(campos);
  const g = el('g', {}, pai);
  const id = k => marcar ? { 'data-id': k } : {};
  const fc = campos.fundo_card; // fundo só desta versão (especial vermelho de um card branco)
  forma(g, card, fc ? { ...pegaSombra(modelo), cor: fc.cor, raio: fc.raio ?? modelo.raio, borda: fc.borda ?? modelo.borda, borda_cor: fc.borda_cor ?? modelo.borda_cor }
    : { ...pegaSombra(modelo), cor: modelo.fundo_cor, raio: modelo.raio, borda: modelo.borda, borda_cor: modelo.borda_cor });
  const porRegra = areaPorRegra(campos, card);
  if (campos.area) { const b = porRegra || pctCaixa(campos.area, card); el('rect', { ...id('area'), x: b.x, y: b.y, width: b.w, height: b.h, fill: 'transparent', stroke: '#00a0ff', 'stroke-dasharray': '3 3', 'stroke-width': marcar ? 1 : 0.6 }, g); }
  // extras: atrás da foto, na frente dela com `frente` (tarja do nome) ou na frente do preço com `topo`, como o gerador
  const extra = (e, k) => {
    const b = pctCaixa(e, card);
    if (e.tipo === 'texto') { if (marcar) el('rect', { ...id('x' + k), x: b.x, y: b.y, width: b.w, height: b.h, fill: 'transparent' }, g); texto(g, e, b, e.texto); }
    else if (e.tipo === 'imagem') {
      if (srcImg(e.url)) el('image', { ...id('x' + k), href: srcImg(e.url), x: b.x, y: b.y, width: b.w, height: b.h, preserveAspectRatio: 'xMidYMid meet' }, g);
      else el('rect', { ...id('x' + k), x: b.x, y: b.y, width: b.w, height: b.h, fill: '#0000001a', stroke: '#0004', 'stroke-dasharray': '3 3' }, g);
    } else forma(g, b, e, id('x' + k));
  };
  (campos.extras || []).forEach((e, k) => { if (!e.frente) extra(e, k); });
  if (campos.foto && prod) {
    const b = porRegra || pctCaixa(campos.foto, card);
    el('rect', { ...id('foto'), x: b.x, y: b.y, width: b.w, height: b.h, fill: 'transparent' }, g);
    const A = porRegra || (campos.area ? pctCaixa(campos.area, card) : b);
    if (prod.fotos && prod.fotos.length) fotosExemplo(g, prod.fotos, A, campos.area && campos.area.foto_alinha);
  } else if (campos.foto) {
    const b = porRegra || pctCaixa(campos.foto, card);
    el('rect', { ...id('foto'), x: b.x, y: b.y, width: b.w, height: b.h, fill: '#00000014' }, g);
    const al = campos.area && campos.area.foto_alinha;
    if (al) {
      // prévia do alinhamento: um "produto" de exemplo (retrato 3:4) assentado na área como o editor faz
      const A = porRegra || pctCaixa(campos.area, card), [v, hz] = al.split(' ');
      let ph = A.h * 0.75, pw = ph * 0.75; if (pw > A.w * 0.6) { pw = A.w * 0.6; ph = pw / 0.75; }
      const px = hz === 'esq' ? A.x : hz === 'dir' ? A.x + A.w - pw : A.x + (A.w - pw) / 2;
      const py = v === 'cima' ? A.y : v === 'baixo' ? A.y + A.h - ph : A.y + (A.h - ph) / 2;
      el('rect', { x: px, y: py, width: pw, height: ph, rx: Math.min(pw, ph) * 0.08, fill: '#7a8a9a55', stroke: '#5a6a7a', 'stroke-width': 0.8, 'pointer-events': 'none' }, g);
      const t = el('text', { x: px + pw / 2, y: py + ph / 2, 'text-anchor': 'middle', 'font-size': Math.min(ph / 5, 12), fill: '#0008', 'pointer-events': 'none', 'font-family': 'system-ui' }, g); t.textContent = 'PRODUTO';
    } else {
      const t = el('text', { x: b.x + b.w / 2, y: b.y + b.h / 2, 'text-anchor': 'middle', 'font-size': Math.min(b.h / 4, 14), fill: '#0006', 'pointer-events': 'none', 'font-family': 'system-ui' }, g); t.textContent = 'FOTO';
    }
  }
  (campos.extras || []).forEach((e, k) => { if (e.frente && !e.topo) extra(e, k); });
  const txt = (k, conteudo, anc) => {
    const c = campos[k]; if (!c) return;
    const b = pctCaixa(c, card);
    if (marcar) el('rect', { ...id(k), x: b.x, y: b.y, width: b.w, height: b.h, fill: 'transparent' }, g);
    texto(g, c, b, conteudo, anc);
  };
  // gatilho do atacado: tarja + frase (1 ou 2 linhas), na frente da foto e atrás do nome, como no gerador
  if (campos.gatilho_fundo) forma(g, pctCaixa(campos.gatilho_fundo, card), campos.gatilho_fundo, id('gatilho_fundo'));
  if (campos.gatilho) {
    const c = campos.gatilho, b = pctCaixa(c, card), ls = linhasGatilho(c.texto_exemplo), bg = baseGatilho(b, c, ls.length);
    if (marcar) el('rect', { ...id('gatilho'), x: b.x, y: b.y, width: b.w, height: b.h, fill: 'transparent' }, g);
    const t = texto(g, c, b, '', 'middle');
    t.setAttribute('y', bg.y);
    ls.forEach((ln, i) => { el('tspan', { x: t.getAttribute('x'), dy: i ? bg.entre : null }, t).textContent = ln; });
  }
  // fundo do nome: na frente da foto, atrás do texto (sai dentro do grupo do nome no gerador)
  const fundoNome = campos.nome_fundo ? forma(g, pctCaixa(campos.nome_fundo, card), campos.nome_fundo, id('nome_fundo')) : null;
  if (campos.nome) {
    const b = caixaDoNome(campos, card);
    // área do nome: tracejada como a do produto (o nome quebra e assenta dentro dela)
    if (marcar) el('rect', { ...id('nome'), x: b.x, y: b.y, width: b.w, height: b.h, fill: 'transparent', stroke: '#ff9f0a', 'stroke-dasharray': '3 3', 'stroke-width': 1 }, g);
    const t = textoNome(g, campos.nome, b, prod ? prod.nome : campos.nome.texto_exemplo || 'NOME DO PRODUTO');
    abracarFundoNome(fundoNome, campos.nome_fundo, t, campos.nome.alinhamento);
  }
  // grupo do preço: as peças entram num <g> próprio pra prévia da regra do fundo (estica / largura máxima)
  // limite do produto (campo Limite do editor): fora do grupo do preço, ou dentro dele na frente do fundo (no_preco)
  const limiteTxt = () => txt('limite', campos.limite && (campos.limite.texto_exemplo || 'LIMITE 3 UN'));
  const limiteNoPreco = !!(campos.limite && campos.limite.no_preco);
  if (!limiteNoPreco) limiteTxt();
  const n0 = g.childNodes.length, pega = {};
  if (campos.preco_fundo) { pega.fundoB = pctCaixa(campos.preco_fundo, card); pega.fundo = forma(g, pega.fundoB, campos.preco_fundo, id('preco_fundo')); }
  if (campos.moeda_fundo) pega.moedaFundo = forma(g, pctCaixa(campos.moeda_fundo, card), campos.moeda_fundo, id('moeda_fundo'));
  if (limiteNoPreco) limiteTxt();
  const ultimo = () => g.lastChild;
  txt('moeda', 'R$'); if (campos.moeda) pega.moeda = ultimo();
  const precoVer = (marcar && M.precoTeste) || (prod && prod.preco) || null;
  const pp = precoVer ? partesPrecoEx(precoVer) : null;
  if (campos.centavos) { txt('preco', pp ? pp.real : '0', 'end'); if (campos.preco) pega.valor = ultimo(); txt('centavos', pp ? pp.cent : ',00', 'start'); pega.cent = ultimo(); }
  else { txt('preco', precoVer || '0,00'); if (campos.preco) pega.valor = ultimo(); }
  txt('unidade', campos.unidade && (prod && prod.formato ? prod.formato : campos.unidade.texto_exemplo || 'kg')); if (campos.unidade) pega.un = ultimo();  if (campos.preco_fundo && pega.fundo && pega.valor) {
    // só as peças desenhadas vão pro grupo; os retângulos de seleção ficam POR CIMA dele (senão o fundo do
    // preço cobre o clique e não dá mais pra selecionar R$, valor e centavos)
    const novos = [...g.childNodes].slice(n0), ehSel = n => n.getAttribute && n.getAttribute('fill') === 'transparent' && n.dataset && n.dataset.id;
    const gp = el('g', {}); g.insertBefore(gp, novos[0] || null);
    for (const n of novos) if (!ehSel(n)) gp.appendChild(n);
    try { previaRegraPreco(gp, campos.preco_fundo, pega); } catch (e) { /* sem medida (fora da tela) */ }
  }
  if (campos.de_valor) {
    if (campos.de_fundo) forma(g, pctCaixa(campos.de_fundo, card), campos.de_fundo, id('de_fundo'));
    txt('de_rotulo', campos.de_rotulo && (campos.de_rotulo.texto_exemplo || 'DE R$'));
    txt('de_valor', prod && prod.de ? prod.de : '0,00');
    if (campos.de_valor.riscar !== false) g.lastChild.setAttribute('text-decoration', 'line-through');
  }
  if (campos.selo_valor) {
    if (campos.selo_fundo) forma(g, pctCaixa(campos.selo_fundo, card), campos.selo_fundo, id('selo_fundo'));
    txt('selo_rotulo', campos.selo_rotulo && (campos.selo_rotulo.texto_exemplo || 'CLUBE'));
    txt('selo_moeda', 'R$');
    txt('selo_valor', prod && prod.selo ? prod.selo : '0,00');
  }
  (campos.extras || []).forEach((e, k) => { if (e.topo) extra(e, k); });
  return g;
}
// camada do extra no card: 0 = atrás da foto, 1 = na frente da foto (atrás do nome e do preço), 2 = na frente
// do preço. Dentro da camada vale a ordem da lista (o último fica por cima)
const CAMADAS_EXTRA = ['Atrás da foto', 'Na frente da foto (atrás do nome e do preço)', 'Na frente do nome e do preço'];
const camadaExtra = e => (e.topo ? 2 : e.frente ? 1 : 0);
function porCamada(e, n) { delete e.frente; delete e.topo; if (n >= 1) e.frente = true; if (n === 2) e.topo = true; }
// Trazer pra frente / Mandar pra trás (como os elementos da prancheta): passa pelo outro extra da mesma
// camada e, no fim dela, pula pra camada de cima (foto → nome e preço) ou de baixo
function ordenarExtra(dir) {
  const ex = M.m[M.aba].extras || [], i = +String(M.sel).slice(1), e = ex[i]; if (!e) return;
  const L = camadaExtra(e), mesmos = ex.map((x, k) => (camadaExtra(x) === L ? k : -1)).filter(k => k >= 0);
  const j = mesmos[mesmos.indexOf(i) + dir];
  if (j != null) { [ex[i], ex[j]] = [ex[j], ex[i]]; M.sel = 'x' + j; }
  else {
    const n = L + dir; if (n < 0 || n > 2) return;
    ex.splice(i, 1); porCamada(e, n);
    const da = ex.map((x, k) => (camadaExtra(x) === n ? k : -1)).filter(k => k >= 0);
    // subindo entra embaixo de todos da camada nova; descendo, em cima de todos
    const at = dir > 0 ? (da.length ? da[0] : ex.length) : (da.length ? da[da.length - 1] + 1 : 0);
    ex.splice(at, 0, e); M.sel = 'x' + at;
  }
  renderModelo();
}

// ---------------------------------------------------------------- arrastar / redimensionar (genérico)
// ad: { caixa(id), setCaixa(id,b), pegar(alvo), selecionado(), selecionar(id), criar(b), ferramenta(), redesenhar(), fantasma(b) }
function ligarArraste(svg, ad) {
  let d = null;
  const pt = e => { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); };
  svg.addEventListener('pointerdown', e => {
    const p = pt(e), alca = e.target.dataset && e.target.dataset.handle, sel = ad.selecionado();
    if (alca && sel) d = { modo: alca, id: sel, p0: p, b0: { ...ad.caixa(sel) } };
    else if (ad.ferramenta() !== 'selecionar') d = { modo: 'novo', p0: p };
    else {
      // selecionar pode trocar o alvo (vários = 'm:') ou devolver null (Shift + clique: só seleciona)
      const pego = ad.pegar(e.target), r = ad.selecionar(pego, e), id = r === undefined ? pego : r;
      if (r === null) e.preventDefault(); // sem isso o Shift + clique seleciona texto da página
      if (id) d = { modo: 'mover', id, p0: p, b0: { ...ad.caixa(id) } };
    }
    if (d) { svg.setPointerCapture(e.pointerId); e.preventDefault(); }
  });
  svg.addEventListener('pointermove', e => {
    if (!d) return;
    const p = pt(e), dx = p.x - d.p0.x, dy = p.y - d.p0.y;
    if (d.modo === 'novo') { d.b = { x: Math.min(p.x, d.p0.x), y: Math.min(p.y, d.p0.y), w: Math.abs(dx), h: Math.abs(dy) }; ad.fantasma(d.b); return; }
    const b = { ...d.b0 }, m = d.modo;
    d.moveu = true;
    if (m === 'mover') { b.x += dx; b.y += dy; }
    else {
      if (m.includes('w')) { b.x += dx; b.w -= dx; }
      if (m.includes('e')) b.w += dx;
      if (m.includes('n')) { b.y += dy; b.h -= dy; }
      if (m.includes('s')) b.h += dy;
      if (b.w < 2) b.w = 2; if (b.h < 2) b.h = 2;
    }
    ad.setCaixa(d.id, arred(b)); ad.redesenhar();
  });
  svg.addEventListener('pointerup', () => {
    if (d && d.modo === 'novo') {
      const b = d.b && d.b.w > 5 && d.b.h > 5 ? d.b : { x: d.p0.x, y: d.p0.y, w: 0, h: 0 };
      ad.fantasma(null); ad.criar(arred(b));
    }
    d = null;
  });
  // segundo dedo na tela (pinça): desfaz o arraste que o primeiro começou
  return {
    cancelar() {
      if (d && d.b0 && d.moveu) { ad.setCaixa(d.id, d.b0); ad.redesenhar(); }
      else if (d && d.modo === 'novo') ad.fantasma(null);
      d = null;
    },
  };
}
// no celular as alças ficam maiores, do tamanho do dedo
const TOQUE = matchMedia('(pointer: coarse)').matches;
function desenharSelecao(svg, b, esc, semAlcas) {
  const g = el('g', {}, svg), t = (TOQUE ? 18 : 8) / esc;
  el('rect', { class: 'sel-rect', x: b.x, y: b.y, width: b.w, height: b.h, 'stroke-width': 1.5 / esc }, g);
  if (semAlcas === true) return;
  // 'cantos' (grupo): só as 4 alças dos cantos, que mudam o tamanho do grupo inteiro na mesma proporção
  const pos = semAlcas === 'cantos' ? { nw: [0, 0], ne: [1, 0], se: [1, 1], sw: [0, 1] }
    : { nw: [0, 0], n: [.5, 0], ne: [1, 0], e: [1, .5], se: [1, 1], s: [.5, 1], sw: [0, 1], w: [0, .5] };
  for (const k in pos) el('rect', { class: 'handle ' + k, 'data-handle': k, x: b.x + pos[k][0] * b.w - t / 2, y: b.y + pos[k][1] * b.h - t / 2, width: t, height: t, 'stroke-width': 1.5 / esc }, g);
}

// ---------------------------------------------------------------- seletor de cor (no lugar do do Windows)
function hexHsv(hex) {
  const n = parseInt(hex.slice(1, 7), 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  const hh = !d ? 0 : mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const a = hex.length === 9 ? parseInt(hex.slice(7), 16) / 255 : 1;
  return { h: hh * 60, s: mx ? d / mx : 0, v: mx, a };
}
function hsvHex({ h: hh, s, v, a = 1 }) {
  const f = k => { const x = (k + hh / 60) % 6; return v - v * s * Math.max(0, Math.min(x, 4 - x, 1)); };
  // opacidade < 100% vira #RRGGBBAA (o gerador separa em fill-opacity no SVG)
  return '#' + [f(5), f(3), f(1), ...(a < 1 ? [a] : [])].map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
}
const hexValido = s => /^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(s);
// cores já usadas no projeto (as mais usadas primeiro)
function coresDoProjeto() {
  const n = {};
  for (const m of JSON.stringify(S.proj || {}).matchAll(/"(#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?)"/g)) { const c = m[1].toLowerCase(); n[c] = (n[c] || 0) + 1; }
  return Object.keys(n).sort((a, b) => n[b] - n[a]).slice(0, 12);
}
// ---- degradê: { tipo: 'linear'|'radial', angulo, escala, paradas: [{ cor, pos, a }] }
const ehDegrade = v => !!v && typeof v === 'object' && Array.isArray(v.paradas);
function rgba(hex, a = 1) {
  const n = parseInt(hex.slice(1, 7), 16), k = hex.length === 9 ? parseInt(hex.slice(7), 16) / 255 : 1;
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${+(a * k).toFixed(3)})`;
}
const paradasOrd = g => [...g.paradas].sort((x, y) => x.pos - y.pos);
// cor pra CSS (amostras, barra): o ângulo do Photoshop (0 = pra direita) vira o do CSS (90deg = pra direita)
function cssCor(v) {
  if (!ehDegrade(v)) return !v || v === 'none' ? 'transparent' : v;
  const st = paradasOrd(v).map(p => `${rgba(p.cor, p.a ?? 1)} ${p.pos}%`).join(',');
  return v.tipo === 'radial' ? `radial-gradient(circle,${st})` : `linear-gradient(${90 - (v.angulo || 0)}deg,${st})`;
}
const XADREZ = 'repeating-conic-gradient(#bbb 0 25%,#fff 0 50%) 0 0/8px 8px';
// cor pra SVG: degradê vira <linearGradient> no <defs> do SVG que está sendo desenhado (mesma conta do gerador)
let SVG_ATUAL = null, nGrad = 0;
function tinta(v) {
  if (!ehDegrade(v)) return v || 'none';
  let defs = SVG_ATUAL.querySelector(':scope > defs');
  if (!defs) { defs = el('defs'); SVG_ATUAL.insertBefore(defs, SVG_ATUAL.firstChild); }
  const id = 'gd' + (++nGrad), sc = (v.escala ?? 100) / 100;
  let g;
  if (v.tipo === 'radial') g = el('radialGradient', { id, cx: 0.5, cy: 0.5, r: 0.5 * sc }, defs);
  else { const an = (v.angulo || 0) * Math.PI / 180, dx = Math.cos(an) * sc / 2, dy = -Math.sin(an) * sc / 2; g = el('linearGradient', { id, x1: 0.5 - dx, y1: 0.5 - dy, x2: 0.5 + dx, y2: 0.5 + dy }, defs); }
  for (const pa of paradasOrd(v)) el('stop', { offset: pa.pos + '%', 'stop-color': pa.cor.slice(0, 7), 'stop-opacity': (pa.a ?? 1) * (pa.cor.length === 9 ? parseInt(pa.cor.slice(7), 16) / 255 : 1) }, g);
  return `url(#${id})`;
}

function botaoCor(valor, aoMudar) {
  const b = h('button', { class: 'cor-btn', type: 'button' }, h('span', { class: 'cor-amostra' }), h('span', { class: 'cor-hex' }));
  b.pintar = c => {
    b.firstChild.style.background = c === 'none' ? '' : ehDegrade(c) ? `${cssCor(c)},${XADREZ}` : `linear-gradient(${c},${c}),${XADREZ}`;
    b.firstChild.classList.toggle('xadrez', c === 'none');
    b.lastChild.textContent = c === 'none' ? 'sem cor' : ehDegrade(c) ? 'Degradê' : c.toUpperCase();
    b.valor = c;
  };
  b.pintar(valor);
  b.addEventListener('click', () => abrirCor(b, b.valor === 'none' ? '#ffffff' : b.valor, c => { b.pintar(c); aoMudar(c); }));
  return b;
}
let popCor = null;
function fecharCor() { if (popCor) { popCor.remove(); popCor = null; } }
function abrirCor(ancora, valor, aoMudar) {
  fecharCor();
  // modo cor: edita a cor sólida; modo degradê: edita a parada selecionada (mesmos controles)
  let modo = ehDegrade(valor) ? 'degrade' : 'cor';
  const solida = ehDegrade(valor) ? paradasOrd(valor)[0].cor : (hexValido(valor) ? valor : '#ffffff');
  let grad = ehDegrade(valor) ? clone(valor) : { tipo: 'linear', angulo: 0, escala: 100, paradas: [{ cor: solida.slice(0, 7), pos: 0 }, { cor: '#000000', pos: 100 }] };
  let sel = 0;
  let hsv = hexHsv(modo === 'cor' ? solida : grad.paradas[0].cor);
  const area = h('div', { class: 'pc-area' }, h('div', { class: 'pc-pino' }));
  const matiz = h('input', { type: 'range', min: 0, max: 360, class: 'pc-matiz' });
  const alfa = h('input', { type: 'range', min: 0, max: 100, class: 'pc-alfa', title: 'Opacidade' });
  const alfaTxt = h('span', { class: 'pc-alfa-txt' });
  const hex = h('input', { class: 'pc-hex', maxlength: 9, spellcheck: 'false' });
  const prev = h('div', { class: 'pc-prev' });
  // conta-gotas: pega a cor de qualquer ponto da tela (só Chrome/Edge têm a API; nos outros fica desabilitado)
  const temGotas = 'EyeDropper' in window;
  const gotas = h('button', { type: 'button', class: 'pc-gotas', title: temGotas ? 'Conta-gotas: pegar cor da tela (Esc cancela)' : 'Conta-gotas: use Chrome ou Edge' });
  gotas.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/></svg>';
  gotas.disabled = !temGotas;
  const amostras = (titulo, cores) => cores.length ? h('div', {}, h('div', { class: 'pc-tit' }, titulo),
    h('div', { class: 'pc-grade' }, ...cores.map(c => h('button', { type: 'button', class: 'pc-cor', title: c, style: `background:${c}`, on: { click: () => { const a = hsv.a; hsv = hexHsv(c); if (c.length === 7) hsv.a = a; atualiza(true); } } })))) : '';
  // abas
  const abaCor = h('button', { type: 'button', class: 'pc-aba' }, 'Cor'), abaGrad = h('button', { type: 'button', class: 'pc-aba' }, 'Degradê');
  // editor do degradê: barra com as paradas (clique na barra = parada nova; arrastar = mover; puxar pra baixo = apagar)
  const barra = h('div', { class: 'pg-barra', title: 'Clique pra adicionar uma cor' });
  const trilho = h('div', { class: 'pg-trilho' });
  const tipo = h('select', { class: 'pg-sel' }, h('option', { value: 'linear' }, 'Linear'), h('option', { value: 'radial' }, 'Radial'));
  const ang = h('input', { type: 'number', class: 'pg-num', step: 1, title: 'Ângulo' });
  const dial = h('div', { class: 'pg-dial', title: 'Arraste pra girar' }, h('div', { class: 'pg-ponteiro' }));
  const esc = h('input', { type: 'number', class: 'pg-num', step: 1, min: 1, title: 'Escala (%)' });
  const pos = h('input', { type: 'number', class: 'pg-num', step: 1, min: 0, max: 100, title: 'Posição da parada (%)' });
  const linhaAng = h('div', { class: 'pc-linha' }, dial, ang, h('span', { class: 'pg-u' }, '°'), h('span', { class: 'pg-rot' }, 'Escala'), esc, h('span', { class: 'pg-u' }, '%'));
  const caixaGrad = h('div', { class: 'pg' }, barra, trilho,
    h('div', { class: 'pc-linha' }, tipo, h('span', { class: 'pg-rot' }, 'Posição'), pos, h('span', { class: 'pg-u' }, '%')), linhaAng);
  popCor = h('div', { class: 'pop-cor' }, h('div', { class: 'pc-abas' }, abaCor, abaGrad), caixaGrad, area, matiz,
    h('div', { class: 'pc-linha' }, alfa, alfaTxt), h('div', { class: 'pc-linha' }, prev, hex, gotas), amostras('No projeto', coresDoProjeto()));
  document.body.append(popCor);

  const emitir = () => aoMudar(modo === 'cor' ? hsvHex(hsv) : clone(grad));
  const desenharGrad = () => {
    caixaGrad.style.display = modo === 'degrade' ? '' : 'none';
    abaCor.classList.toggle('on', modo === 'cor'); abaGrad.classList.toggle('on', modo === 'degrade');
    if (modo !== 'degrade') return;
    barra.style.background = `${cssCor({ ...grad, tipo: 'linear', angulo: 0 })},${XADREZ}`;
    trilho.replaceChildren(...grad.paradas.map((pa, i) => {
      const m = h('div', { class: 'pg-parada' + (i === sel ? ' sel' : ''), style: `left:${pa.pos}%` }, h('span', { style: `background:${rgba(pa.cor, pa.a ?? 1)}` }));
      m.addEventListener('pointerdown', e => {
        e.preventDefault(); m.setPointerCapture(e.pointerId);
        sel = i; hsv = hexHsv(pa.cor); atualiza(false); desenharGrad();
        const r = trilho.getBoundingClientRect();
        const mover = ev => {
          // puxou pra baixo, longe da barra: apaga (sempre sobram 2)
          if (ev.clientY - r.bottom > 30 && grad.paradas.length > 2) { m.style.opacity = 0.3; m.dataset.apaga = '1'; return; }
          m.style.opacity = ''; delete m.dataset.apaga;
          pa.pos = Math.round(Math.min(100, Math.max(0, (ev.clientX - r.left) / r.width * 100)));
          m.style.left = pa.pos + '%'; pos.value = pa.pos;
          barra.style.background = `${cssCor({ ...grad, tipo: 'linear', angulo: 0 })},${XADREZ}`; emitir();
        };
        const soltar = () => {
          m.removeEventListener('pointermove', mover); m.removeEventListener('pointerup', soltar);
          if (m.dataset.apaga) { grad.paradas.splice(i, 1); sel = 0; hsv = hexHsv(grad.paradas[0].cor); atualiza(false); emitir(); }
          desenharGrad();
        };
        m.addEventListener('pointermove', mover); m.addEventListener('pointerup', soltar);
      });
      return m;
    }));
    tipo.value = grad.tipo || 'linear'; ang.value = grad.angulo || 0; esc.value = grad.escala ?? 100; pos.value = grad.paradas[sel].pos;
    linhaAng.style.display = ''; ang.disabled = dial.style.opacity = grad.tipo === 'radial' ? 0.35 : '';
    ang.disabled = grad.tipo === 'radial';
    dial.firstChild.style.transform = `rotate(${-(grad.angulo || 0)}deg)`;
  };
  const atualiza = (avisa, deHex) => {
    const c = hsvHex(hsv);
    area.style.background = `linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,hsl(${hsv.h},100%,50%))`;
    area.firstChild.style.left = hsv.s * 100 + '%'; area.firstChild.style.top = (1 - hsv.v) * 100 + '%';
    matiz.value = hsv.h; prev.style.background = `linear-gradient(${c},${c}),${XADREZ}`;
    alfa.value = Math.round(hsv.a * 100); alfaTxt.textContent = alfa.value + '%';
    alfa.style.background = `linear-gradient(to right,transparent,${hsvHex({ ...hsv, a: 1 })}),${XADREZ}`;
    if (!deHex) hex.value = c.toUpperCase();
    if (modo === 'degrade') { grad.paradas[sel].cor = c; delete grad.paradas[sel].a; if (avisa) desenharGrad(); }
    if (avisa) emitir();
  };
  const pelaArea = e => {
    const r = area.getBoundingClientRect();
    hsv.s = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); hsv.v = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height));
    atualiza(true);
  };
  area.addEventListener('pointerdown', e => { area.setPointerCapture(e.pointerId); pelaArea(e); });
  area.addEventListener('pointermove', e => { if (e.buttons) pelaArea(e); });
  matiz.addEventListener('input', () => { hsv.h = +matiz.value; atualiza(true); });
  alfa.addEventListener('input', () => { hsv.a = +alfa.value / 100; atualiza(true); });
  hex.addEventListener('input', () => { let v = hex.value.trim(); if (v[0] !== '#') v = '#' + v; if (hexValido(v)) { hsv = hexHsv(v); atualiza(true, true); } });
  gotas.addEventListener('click', async () => {
    const pop = popCor;
    let r;
    try { r = await new window.EyeDropper().open(); } catch { return; } // Esc: não muda nada
    if (popCor !== pop || !hexValido(r.sRGBHex)) return;
    // mantém a opacidade que já estava (cor sólida ou parada selecionada do degradê)
    const a = hsv.a; hsv = hexHsv(r.sRGBHex); hsv.a = a; atualiza(true);
  });
  abaCor.addEventListener('click', () => { if (modo === 'cor') return; modo = 'cor'; atualiza(false); desenharGrad(); emitir(); });
  abaGrad.addEventListener('click', () => {
    if (modo === 'degrade') return;
    modo = 'degrade'; sel = 0; grad.paradas[0].cor = hsvHex(hsv); desenharGrad(); emitir();
  });
  barra.addEventListener('pointerdown', e => {
    const r = barra.getBoundingClientRect(), x = Math.round((e.clientX - r.left) / r.width * 100);
    grad.paradas.push({ cor: hsvHex(hsv), pos: x }); sel = grad.paradas.length - 1; desenharGrad(); emitir();
  });
  tipo.addEventListener('input', () => { grad.tipo = tipo.value; desenharGrad(); emitir(); });
  ang.addEventListener('input', () => { grad.angulo = ((+ang.value % 360) + 360) % 360; dial.firstChild.style.transform = `rotate(${-grad.angulo}deg)`; emitir(); });
  esc.addEventListener('input', () => { if (+esc.value > 0) { grad.escala = +esc.value; emitir(); } });
  pos.addEventListener('input', () => { const v = Math.min(100, Math.max(0, +pos.value || 0)); grad.paradas[sel].pos = v; desenharGrad(); emitir(); });
  // dial do ângulo: arrastar em volta do centro (0° = pra direita, sentido anti-horário, como no Photoshop)
  dial.addEventListener('pointerdown', e => {
    if (grad.tipo === 'radial') return;
    dial.setPointerCapture(e.pointerId);
    const girar = ev => {
      const r = dial.getBoundingClientRect();
      grad.angulo = Math.round((Math.atan2(-(ev.clientY - (r.top + r.height / 2)), ev.clientX - (r.left + r.width / 2)) * 180 / Math.PI + 360) % 360);
      ang.value = grad.angulo; dial.firstChild.style.transform = `rotate(${-grad.angulo}deg)`; emitir();
    };
    girar(e);
    dial.onpointermove = ev => { if (ev.buttons) girar(ev); };
  });
  atualiza(false); desenharGrad();
  // posição: abaixo do botão, sem sair da tela
  const r = ancora.getBoundingClientRect(), pw = popCor.offsetWidth, ph = popCor.offsetHeight;
  popCor.style.left = Math.max(8, Math.min(r.left, innerWidth - pw - 8)) + 'px';
  popCor.style.top = (r.bottom + ph + 8 > innerHeight ? Math.max(8, r.top - ph - 6) : r.bottom + 6) + 'px';
}
document.addEventListener('pointerdown', e => { if (popCor && !popCor.contains(e.target) && !e.target.closest('.cor-btn')) fecharCor(); }, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharCor(); });
// Enter confirma o número (o change do campo só vinha ao sair dele)
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches && e.target.matches('input[type=number], input:not([type])')) e.target.blur(); });
document.head.append(h('style', {}, `
.cor-btn{display:flex;align-items:center;gap:8px;flex:1;min-width:0;background:var(--c-campo);border:1px solid var(--c-border);border-radius:6px;padding:3px 8px 3px 3px;color:var(--c-text);cursor:pointer;font:12px ui-monospace,monospace}
.cor-btn:hover{border-color:var(--c-accent2)}
.cor-amostra{width:22px;height:22px;border-radius:4px;box-shadow:inset 0 0 0 1px #fff3;flex-shrink:0}
.xadrez{background:repeating-conic-gradient(#bbb 0 25%,#fff 0 50%) 0 0/8px 8px!important}
.pop-cor{position:fixed;z-index:500;width:232px;padding:12px;background:#2c2c2c;border:1px solid #111;border-radius:10px;box-shadow:0 12px 32px #0009;display:flex;flex-direction:column;gap:10px}
.pc-area{position:relative;height:140px;border-radius:6px;cursor:crosshair;touch-action:none}
.pc-pino{position:absolute;width:14px;height:14px;margin:-7px 0 0 -7px;border:2px solid #fff;border-radius:50%;box-shadow:0 0 0 1px #0008;pointer-events:none}
.pc-matiz{-webkit-appearance:none;appearance:none;width:100%;height:12px;border-radius:6px;background:linear-gradient(to right,red,#ff0,lime,cyan,blue,#f0f,red);outline:none}
.pc-matiz::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:#fff;border:2px solid #0006;cursor:pointer}
.pc-matiz::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:#fff;border:2px solid #0006;cursor:pointer}
.pc-linha{display:flex;gap:8px;align-items:center}
.car-painel{background:#2c2c2c;border:1px solid #111;border-radius:6px;margin-bottom:8px;font:12px 'Source Sans 3',system-ui,sans-serif;color:var(--c-text)}
.car-cab{display:flex;align-items:center;padding:6px 10px;border-bottom:1px solid #111;font-weight:700;font-size:11px;letter-spacing:.03em;user-select:none}
.car-corpo{padding:10px;display:flex;flex-direction:column;gap:8px}
.car-linha{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;align-items:center}
.car-linha select{min-width:0;height:26px;background:var(--c-campo);border:1px solid var(--c-campo-borda);border-radius:4px;color:var(--c-text);padding:0 6px;font:12px 'Source Sans 3',system-ui,sans-serif}
.car-linha:first-child{grid-template-columns:minmax(0,1.5fr) minmax(0,1fr)}
.car-campo{display:flex;align-items:center;gap:6px;min-width:0;color:var(--c-text2)}
.car-campo svg{width:16px;height:16px;flex-shrink:0}
.car-campo input{flex:1;min-width:0;height:26px;background:var(--c-campo);border:1px solid var(--c-campo-borda);border-radius:4px;color:var(--c-text);padding:0 6px;font:12px 'Source Sans 3',system-ui,sans-serif}
.car-campo input:focus,.car-linha select:focus{outline:none;border-color:var(--c-accent)}
.car-campo .un{font-size:11px;color:var(--c-text2)}
.car-campo .cor-btn{flex:1;min-width:0}
.car-ic{font-size:10px;width:16px;text-align:center;flex-shrink:0}
.car-rot{font-size:11px;flex-shrink:0}
.car-al{display:flex;gap:2px;justify-content:flex-end}
.car-togs{display:flex;gap:4px;border-top:1px solid #111;padding-top:8px}
.car-tog{flex:1;height:26px;border:0;border-radius:4px;background:#ffffff0d;color:#cfcfcf;cursor:pointer;font:700 13px 'Source Sans 3',system-ui,sans-serif;display:grid;place-items:center}
.car-al .car-tog{flex:0 0 28px}
.car-tog:hover{background:#ffffff1f;color:#fff}
.car-tog.on{background:var(--c-accent);color:#fff}
.prop-row .un{font-size:11px;color:var(--c-text2);margin-left:-4px;flex-shrink:0}
.pc-abas{display:flex;background:var(--c-campo);border-radius:6px;padding:2px;gap:2px}
.pc-aba{flex:1;border:0;background:none;color:var(--c-text2);padding:5px;border-radius:5px;cursor:pointer;font-size:12px}
.pc-aba.on{background:#ffffff1f;color:var(--c-text)}
.pg{display:flex;flex-direction:column;gap:8px}
.pg-barra{height:20px;border-radius:5px;cursor:copy;box-shadow:inset 0 0 0 1px #fff3}
.pg-trilho{position:relative;height:16px;margin:-6px 6px 0}
.pg-parada{position:absolute;top:0;width:12px;height:16px;margin-left:-6px;cursor:ew-resize;touch-action:none}
.pg-parada::before{content:'';position:absolute;left:3px;top:-3px;border:3px solid transparent;border-bottom-color:#fff}
.pg-parada span{position:absolute;inset:3px 0 0;border:2px solid #fff;border-radius:3px;box-shadow:0 0 0 1px #0008}
.pg-parada.sel span{border-color:var(--c-accent)}
.pg-parada.sel::before{border-bottom-color:var(--c-accent)}
.pg-sel{flex:1;background:var(--c-campo);border:1px solid var(--c-border);border-radius:6px;color:var(--c-text);padding:4px 6px;font-size:12px}
.pg-num{width:52px;background:var(--c-campo);border:1px solid var(--c-border);border-radius:6px;color:var(--c-text);padding:4px 6px;font:12px ui-monospace,monospace}
.pg-num:disabled{opacity:.35}
.pg-u{font-size:11px;color:var(--c-text2);margin-left:-4px}
.pg-rot{font-size:11px;color:var(--c-text2);margin-left:auto}
.pg-dial{position:relative;width:26px;height:26px;border-radius:50%;border:1px solid var(--c-border);background:var(--c-campo);cursor:grab;flex-shrink:0;touch-action:none}
.pg-ponteiro{position:absolute;left:50%;top:50%;width:11px;height:2px;margin-top:-1px;background:var(--c-text);transform-origin:0 50%}
.grp{border:1px solid var(--c-border);border-radius:8px;margin-bottom:8px;overflow:hidden}
.grp-cab{display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:pointer;background:#ffffff08;user-select:none}
.grp-cab:hover{background:#ffffff12}
.grp-mover{width:24px;height:24px;border:0;border-radius:4px;background:none;color:var(--c-text2);cursor:pointer;font-size:14px;line-height:1;padding:0}
.grp-mover:hover{background:#ffffff1f;color:#fff}
.grp-mover.on{background:var(--c-accent);color:#fff}
@media (pointer:coarse){.grp-mover{width:34px;height:34px}}
.grp-seta{width:12px;color:var(--c-text2);transition:transform .15s;font-size:10px}
.grp.aberto .grp-seta{transform:rotate(90deg)}
.grp-nome{flex:1;font-size:12px;font-weight:600}
.grp-cont{font-size:11px;color:var(--c-text2)}
.grp-corpo{padding:6px 8px 2px;display:none}
.grp.aberto .grp-corpo{display:block}
.grp.off .grp-nome,.grp.off .grp-cont{opacity:.45}
.chave{display:flex;align-items:center;justify-content:center;width:26px;height:22px;flex-shrink:0;border-radius:4px;background:none;border:0;cursor:pointer;padding:0;color:var(--c-text2);opacity:.55}
.chave:hover{background:#ffffff14;opacity:1}
.chave.on{color:var(--c-text);opacity:1}
.chave svg{width:16px;height:16px}
.pc-alfa{-webkit-appearance:none;appearance:none;flex:1;height:12px;border-radius:6px;outline:none}
.pc-alfa::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:#fff;border:2px solid #0006;cursor:pointer}
.pc-alfa::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:#fff;border:2px solid #0006;cursor:pointer}
.pc-alfa-txt{width:36px;text-align:right;font:11px ui-monospace,monospace;color:var(--c-text2)}
.pc-prev{width:32px;height:32px;border-radius:6px;box-shadow:inset 0 0 0 1px #fff3}
.pc-hex{flex:1;background:var(--c-campo);border:1px solid var(--c-border);border-radius:6px;color:var(--c-text);padding:6px 8px;font:13px ui-monospace,monospace;text-transform:uppercase}
.pc-hex:focus{outline:none;border-color:var(--c-accent)}
.pc-gotas{width:32px;height:32px;flex-shrink:0;display:grid;place-items:center;background:var(--c-campo);border:1px solid var(--c-border);border-radius:6px;color:var(--c-text);cursor:pointer;padding:0}
.pc-gotas:hover:not(:disabled){border-color:var(--c-accent2)}
.pc-gotas:disabled{opacity:.35;cursor:not-allowed}
.pc-tit{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--c-text2);margin-bottom:5px}
.pc-grade{display:grid;grid-template-columns:repeat(6,1fr);gap:6px}
.pc-cor{aspect-ratio:1;border-radius:5px;border:0;box-shadow:inset 0 0 0 1px #fff3;cursor:pointer}
.pc-cor:hover{transform:scale(1.12)}
`));

// ícones dos campos (no lugar do rótulo, como no painel Caractere do Photoshop); o rótulo vira dica.
// SVG fixo daqui, montado por DOMParser (nada vindo de fora entra nele)
const ICONE = {
  x: '<svg viewBox="0 0 16 16"><text x="8" y="12" text-anchor="middle" font-size="11" font-weight="700" fill="currentColor" font-family="Source Sans 3,sans-serif">X</text></svg>',
  y: '<svg viewBox="0 0 16 16"><text x="8" y="12" text-anchor="middle" font-size="11" font-weight="700" fill="currentColor" font-family="Source Sans 3,sans-serif">Y</text></svg>',
  w: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 8h12M2 5v6M14 5v6M4.5 6 2.5 8l2 2M11.5 6l2 2-2 2"/></svg>',
  h: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M8 2v12M5 2h6M5 14h6M6 4.5 8 2.5l2 2M6 11.5l2 2 2-2"/></svg>',
  raio: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 14V8a5 5 0 0 1 5-5h6"/></svg>',
  borda: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="10" height="10" rx="1"/></svg>',
  tamanho: '<svg viewBox="0 0 16 16"><text x="1" y="13" font-size="9" font-weight="700" fill="currentColor" font-family="Source Sans 3,sans-serif">t</text><text x="6" y="13" font-size="13" font-weight="700" fill="currentColor" font-family="Source Sans 3,sans-serif">T</text></svg>',
  respiro: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="4" width="12" height="8" rx="1"/><path d="M5 8h6" stroke-dasharray="1.5 1.5"/></svg>',
};
const icone = k => document.importNode(new DOMParser().parseFromString(ICONE[k].replace('<svg ', `<svg xmlns="${NS}" `), 'image/svg+xml').documentElement, true);
// campos numéricos com ícone e em meia largura (dois por linha); margens ficam em meia largura com o nome
const MEIA = { x: 'x', y: 'y', w: 'w', h: 'h', raio: 'raio', borda: 'borda', tamanho: 'tamanho', respiro: 'respiro' };
const MEIA_TXT = ['margem_t', 'margem_r', 'margem_b', 'margem_l'];
// campos em pt (a unidade do SVG; a mesma que o editor de encarte mostra)
const UN_PT = ['x', 'y', 'w', 'h', 'tamanho', 'borda', 'raio', 'respiro', 'largura_max', 'espaco', 'espaco_padrao', 'margem_t', 'margem_r', 'margem_b', 'margem_l'];

// ---------------------------------------------------------------- painel Caractere (como o do Photoshop)
// aparece sempre que um texto está selecionado (prancheta, campo do card, extra) e edita aquele item;
// fica preso no painel de propriedades, no lugar da linha { caractere: true }
function familias() {
  const g = new Map();
  for (const f of S.fontes) {
    const i = f.lastIndexOf('-'), base = i > 0 ? f.slice(0, i) : f, estilo = i > 0 ? f.slice(i + 1) : 'Regular';
    if (!g.has(base)) g.set(base, []);
    g.get(base).push({ estilo, f });
  }
  return g;
}
function caractere(obj, aoMudar, alvo) {
  if (!obj) { for (const p of document.querySelectorAll('.car-painel')) p.remove(); return; }
  const p = h('div', { class: 'car-painel' });
  alvo.append(p);
  const muda = (k, v) => { if (v === '' || v == null || v === false) delete obj[k]; else obj[k] = v; bordaPadrao(obj, k); aoMudar(k); };
  const fam = familias(), atual = obj.fonte || F();
  const i = atual.lastIndexOf('-'), base = fam.has(atual) ? atual : i > 0 && fam.has(atual.slice(0, i)) ? atual.slice(0, i) : atual;
  const selFam = h('select', { title: 'Fonte' }, ...[...fam.keys()].map(k => h('option', { value: k }, k)));
  if (!fam.has(base)) selFam.prepend(h('option', { value: base }, base));
  selFam.value = base;
  const estilos = fam.get(base) || [{ estilo: 'Regular', f: atual }];
  const selEst = h('select', { title: 'Estilo' }, ...estilos.map(e => h('option', { value: e.f }, e.estilo)));
  selEst.value = estilos.some(e => e.f === atual) ? atual : estilos[0].f;
  selFam.addEventListener('input', () => { const es = fam.get(selFam.value) || []; const pref = es.find(e => /^(regular|bold|black)$/i.test(e.estilo)) || es[0]; if (pref) muda('fonte', pref.f); });
  selEst.addEventListener('input', () => muda('fonte', selEst.value));
  const num = (k, titulo, ic, un, ph) => {
    const inp = h('input', { type: 'number', step: 'any', title: titulo, placeholder: ph || '' }); inp.value = obj[k] ?? '';
    inp.addEventListener('change', () => muda(k, inp.value === '' ? null : +inp.value));
    return h('label', { class: 'car-campo', title: titulo }, ic, inp, h('span', { class: 'un' }, un));
  };
  const tog = (k, rot, titulo, estilo) => h('button', { type: 'button', class: 'car-tog' + (obj[k] ? ' on' : ''), title: titulo, style: estilo,
    on: { click: () => muda(k, !obj[k]) } }, rot);
  const al = h('div', { class: 'car-al' }, ...[['start', 'Esquerda', 'M3 4h14M3 8h9M3 12h14M3 16h9'], ['middle', 'Centro', 'M3 4h14M5.5 8h9M3 12h14M5.5 16h9'], ['end', 'Direita', 'M3 4h14M8 8h9M3 12h14M8 16h9']]
    .map(([v, t, d]) => {
      const b = h('button', { type: 'button', class: 'car-tog' + ((obj.alinhamento || 'start') === v ? ' on' : ''), title: t, on: { click: () => muda('alinhamento', v) } });
      const sv = el('svg', { viewBox: '0 0 20 20', width: 16, height: 16, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6 }); el('path', { d }, sv); b.append(sv);
      return b;
    }));
  const cor = botaoCor(obj.cor || '#000000', c => muda('cor', c));
  const corBorda = botaoCor(obj.borda_cor || '#000000', c => muda('borda_cor', c));
  const cab = h('div', { class: 'car-cab' }, 'Caractere');
  p.replaceChildren(cab, h('div', { class: 'car-corpo' },
    h('div', { class: 'car-linha' }, selFam, selEst),
    h('div', { class: 'car-linha' }, num('tamanho', 'Tamanho da fonte', icone('tamanho'), 'pt'),
      num('espacamento', 'Espaçamento entre letras (milésimos de em, como no Photoshop)', h('b', { class: 'car-ic' }, 'VA'), '', '0')),
    h('div', { class: 'car-linha' }, h('label', { class: 'car-campo', title: 'Cor do texto' }, h('span', { class: 'car-rot' }, 'Cor'), cor), al),
    h('div', { class: 'car-linha' }, num('borda', 'Borda (contorno do texto)', icone('borda'), 'pt', '0'),
      h('label', { class: 'car-campo', title: 'Cor da borda' }, h('span', { class: 'car-rot' }, 'Borda'), corBorda)),
    h('div', { class: 'car-togs' },
      tog('italico', 'T', 'Itálico', 'font-style:italic'),
      tog('caixa_alta', 'TT', 'Todas em maiúsculas'),
      tog('versalete', 'Tᴛ', 'Versalete (maiúsculas pequenas)'),
      tog('sublinhado', 'T', 'Sublinhado', 'text-decoration:underline'),
      tog('tachado', 'T', 'Tachado', 'text-decoration:line-through'))));
}

// ---------------------------------------------------------------- onde a foto assenta na área
// 3×3 como o ponto de referência do Illustrator; vale nos dois modos da área (posição e regras)
const ALINHA_V = [['cima', 'Em cima'], ['centro', 'No meio'], ['baixo', 'Embaixo']];
const ALINHA_H = [['esq', 'à esquerda'], ['centro', 'no centro'], ['dir', 'à direita']];
function seletorFotoAlinha(area, aoMudar) {
  const atual = area.foto_alinha || '';
  const grade = h('div', { class: 'fa-grade' }, ...ALINHA_V.flatMap(([v, rv]) => ALINHA_H.map(([hz, rh]) => {
    const val = `${v} ${hz}`;
    return h('button', { type: 'button', class: 'fa-ponto' + (atual === val ? ' on' : ''), title: `${rv} ${rh}`,
      on: { click: () => { area.foto_alinha = val; aoMudar(); } } }, h('span', {}));
  })));
  const nomeAtual = atual ? (() => { const [v, hz] = atual.split(' '); return `${ALINHA_V.find(a => a[0] === v)[1]} ${ALINHA_H.find(a => a[0] === hz)[1]}`; })()
    : 'Automático: uma foto embaixo no centro, várias no meio';
  return h('div', { class: 'fa' },
    h('div', { class: 'fa-tit' }, 'Foto dentro da área'),
    h('div', { class: 'fa-linha' }, grade, h('div', { class: 'fa-info' }, h('div', {}, nomeAtual),
      ...(atual ? [h('button', { type: 'button', class: 'btn', style: 'margin-top:6px;height:24px;padding:0 8px', on: { click: () => { delete area.foto_alinha; aoMudar(); } } }, 'Voltar pro automático')] : []))));
}
document.head.append(h('style', {}, `
.fa{grid-column:1/-1;margin:6px 0 8px}
.fa-tit{font-size:12px;color:var(--c-text2);margin-bottom:6px}
.fa-linha{display:flex;gap:12px;align-items:flex-start}
.fa-grade{display:grid;grid-template-columns:repeat(3,22px);grid-template-rows:repeat(3,22px);gap:2px;padding:4px;background:var(--c-campo);border:1px solid var(--c-campo-borda);border-radius:4px;flex-shrink:0}
.fa-ponto{border:0;background:none;display:grid;place-items:center;cursor:pointer;border-radius:3px;padding:0}
.fa-ponto span{width:8px;height:8px;border:1.5px solid #9d9d9d;border-radius:1px}
.fa-ponto:hover{background:#ffffff14}
.fa-ponto.on span{background:var(--c-accent);border-color:var(--c-accent);width:10px;height:10px}
.fa-info{font-size:12px;color:var(--c-text);line-height:1.35;min-width:0}
@media (pointer:coarse){.fa-grade{grid-template-columns:repeat(3,36px);grid-template-rows:repeat(3,36px)}}
`));

// ---------------------------------------------------------------- formulário de propriedades
// tipos: text, number, color, select, textarea, corT (cor ou transparente), cantos, imagem, botao
// trava (opcional, peças do modelo de card): { campo, m } — cadeado em cada propriedade (ver cadeado)
function form(alvo, titulo, linhas, obj, aoMudar, trava) {
  const sec = h('div', { class: 'prop-section' }, h('h3', {}, titulo));
  for (const l of linhas) {
    if (l.caractere) {
      caractere(obj, aoMudar, sec);
      if (trava) sec.append(h('div', { class: 'prop-row trava-car' }, h('label', {}, 'Travar'),
        h('div', { style: 'display:flex;gap:4px;flex-wrap:wrap;flex:1' }, ...[['fonte', 'Fonte'], ['tamanho', 'Tamanho'], ['cor', 'Cor'], ['borda', 'Borda'], ['borda_cor', 'Cor da borda'], ['alinhamento', 'Alinhamento']]
          .map(([k, r]) => cadeado(trava, k, r, true)))));
      continue;
    }
    if (l.botao) { sec.append(h('div', { class: 'prop-row' }, h('button', { class: 'btn', style: 'flex:1', on: { click: l.botao } }, l.rot))); continue; }
    if (l.dica) { sec.append(h('div', { style: 'font-size:11px;color:var(--c-text2);margin:-2px 0 6px' }, l.dica)); continue; }
    let inp;
    const v = obj[l.k] ?? '';
    if (l.tipo === 'color' || l.tipo === 'corT') {
      const transp = l.tipo === 'corT' && (!v || v === 'none');
      let ultima = transp || !v ? '#ffffff' : v;
      const btn = botaoCor(transp ? 'none' : ultima, c => { ultima = c; if (sem) sem.checked = false; obj[l.k] = c; aoMudar(l.k); });
      const sem = l.tipo === 'corT' ? h('input', { type: 'checkbox', title: 'Transparente' }) : null;
      if (sem) {
        sem.checked = transp;
        sem.addEventListener('change', () => { obj[l.k] = sem.checked ? 'none' : ultima; btn.pintar(obj[l.k]); aoMudar(l.k); });
      }
      inp = h('div', { style: 'display:flex;gap:8px;align-items:center;flex:1' }, btn,
        ...(sem ? [h('label', { style: 'display:flex;gap:4px;align-items:center;width:auto;font-size:11px' }, sem, 'sem')] : []));
    } else if (l.tipo === 'check') {
      inp = h('div', { style: 'flex:1' }); const cb = h('input', { type: 'checkbox' }); cb.checked = v === '' ? (l.padrao ?? true) : v !== false;
      cb.addEventListener('change', () => { obj[l.k] = cb.checked; aoMudar(l.k); }); inp.append(cb);
    } else if (l.tipo === 'cantos') {
      const c = Array.isArray(v) && v.length === 4 ? v.slice() : [true, true, true, true];
      inp = h('div', { style: 'display:flex;gap:8px;flex:1' }, ...['↖', '↗', '↘', '↙'].map((s, i) => {
        const cb = h('input', { type: 'checkbox' }); cb.checked = c[i];
        cb.addEventListener('change', () => { c[i] = cb.checked; obj[l.k] = c.every(Boolean) ? undefined : c.slice(); aoMudar(l.k); });
        return h('label', { style: 'display:flex;gap:2px;align-items:center;width:auto' }, cb, s);
      }));
    } else if (l.tipo === 'imagem') {
      const nome = v ? (v.startsWith('arq:') ? 'imagem enviada' : v.startsWith('bloco:') ? 'bloco do cliente' : v.slice(0, 24)) : 'nenhuma';
      inp = h('div', { style: 'display:flex;gap:6px;align-items:center;flex:1;flex-wrap:wrap' },
        h('button', { class: 'btn', on: { click: async () => { const r = await enviarImagem(); if (r) { obj[l.k] = r; aoMudar(l.k); } } } }, 'Enviar…'),
        ...(v ? [h('button', { class: 'btn', title: 'Tirar a imagem', on: { click: () => { delete obj[l.k]; aoMudar(l.k); } } }, '×')] : []),
        h('span', { style: 'font-size:11px;color:var(--c-text2)' }, nome),
        // bloco do cliente: a imagem vem do cadastro do cliente (logo, selo do tema…)
        seletorBloco(v, ref => { if (ref) obj[l.k] = ref; else delete obj[l.k]; aoMudar(l.k); }));
    } else if (l.tipo === 'select') {
      inp = h('select', {}, ...l.opcoes.map(o => h('option', { value: Array.isArray(o) ? o[0] : o }, Array.isArray(o) ? o[1] : o)));
      inp.value = v === '' && l.padrao != null ? l.padrao : v;
    } else if (l.tipo === 'textarea') { inp = h('textarea', { rows: 2 }); inp.value = v; }
    else { inp = h('input', { type: l.tipo || 'text', step: l.step || 'any', list: l.lista || null, placeholder: l.ph || null }); inp.value = v; }
    if (inp.tagName !== 'DIV') inp.addEventListener(l.tipo === 'color' || l.tipo === 'select' ? 'input' : 'change', () => {
      obj[l.k] = l.tipo === 'number' || l.num ? (inp.value === '' ? undefined : +inp.value) : inp.value;
      aoMudar(l.k);
    });
    const ic = l.tipo === 'number' && MEIA[l.k], meia = ic || MEIA_TXT.includes(l.k);
    const rot = h('label', { title: l.rot });
    if (ic) rot.append(icone(MEIA[l.k])); else rot.textContent = l.rot;
    const un = l.tipo === 'number' && (l.un ?? (UN_PT.includes(l.k) ? 'pt' : ''));
    const cad = trava && l.k ? cadeado(trava, l.k) : null;
    if (cad && travada(trava, l.k) && !trava.base) { inp.style.pointerEvents = 'none'; inp.style.opacity = '.45'; }
    sec.append(h('div', { class: 'prop-row' + (meia ? ' meia' : '') + (ic ? ' ic' : '') }, rot, inp, ...(un ? [h('span', { class: 'un' }, un)] : []), ...(cad ? [cad] : [])));
  }
  alvo.append(sec);
}
// Travas do modelo (Matheus, 22/10/2026): "campo.prop" trancado vale o do card Normal padrão em toda versão e
// formato (comTravas, aqui e no gerador). Só se tranca/destranca no Normal padrão; nos outros fica bloqueado.
const travada = (t, k) => !!(t.m.travas && t.m.travas.includes(t.campo + '.' + k));
function cadeado(t, k, rot, comTexto) {
  const on = travada(t, k);
  return h('button', { type: 'button', class: 'cadeado' + (on ? ' on' : ''), disabled: t.base ? null : true,
    title: (on ? 'Trancado: vale em todo formato e versão' : 'Trancar: todo formato e versão usam o valor do Normal padrão') + (t.base ? '' : ' (tranque no Normal padrão)'),
    on: { click: ev => {
      ev.stopPropagation();
      const id = t.campo + '.' + k, l = t.m.travas || [];
      t.m.travas = on ? l.filter(x => x !== id) : [...l, id];
      if (!t.m.travas.length) delete t.m.travas;
      renderModelo();
    } } }, (on ? '🔒' : '🔓') + (comTexto ? ' ' + rot : ''));
}
document.head.append(h('style', {}, `
.cadeado{border:0;background:none;cursor:pointer;font-size:12px;opacity:.45;padding:0 2px;flex-shrink:0}
.cadeado.on{opacity:1}
.cadeado:disabled{cursor:default}
.trava-car .cadeado{border:1px solid var(--c-campo-borda);border-radius:4px;padding:2px 6px;font-size:11px;color:var(--c-text)}
`));
// a versão com as travas do modelo aplicadas (mesma conta do comTravas do gerador)
function comTravas(m, c) {
  if (!m.travas || !m.travas.length || !c || c === m.campos) return c;
  const out = { ...c };
  for (const t of m.travas) {
    const [k, prop] = String(t).split('.'), b = m.campos[k];
    if (!b || !out[k] || !prop || !(prop in b)) continue;
    out[k] = { ...out[k], [prop]: JSON.parse(JSON.stringify(b[prop])) };
  }
  return out;
}
// prancheta duplicada/colada: tudo copiado, com ids novos (elementos e zonas)
function comIdsNovos(pr) {
  const n = clone(pr);
  n.elementos = (n.elementos || []).map(e => ({ ...e, id: uid('e') }));
  n.zonas = (n.zonas || []).map(z => ({ ...z, id: uid('z') }));
  return n;
}
function duplicarPrancheta(i) {
  const n = comIdsNovos(S.proj.pranchetas[i]); n.id = uid('pr'); n.nome = `${S.proj.pranchetas[i].nome} (cópia)`;
  S.proj.pranchetas.splice(i + 1, 0, n); S.pi = i + 1; S.sel = null; S.sujo = true; tudo();
}
function colarPrancheta(i) {
  const pr = S.proj.pranchetas[i], c = S.clipPrancheta; if (!c) return;
  if (!confirm(`Colar "${c.nome}" por cima de "${pr.nome}"? Fundo, elementos e zonas desta prancheta são trocados.`)) return;
  const n = comIdsNovos(c);
  Object.assign(pr, { fundo: n.fundo, elementos: n.elementos, zonas: n.zonas });
  S.pi = i; S.sel = null; S.sujo = true; tudo();
}
// zona: duplicar e copiar/colar o estilo (tudo menos id, lugar e tamanho)
const ESTILO_FORA = ['id', 'x', 'y', 'w', 'h'];
function duplicarZona(z) {
  const n = { ...clone(z), id: uid('z'), x: z.x + 20, y: z.y + 20 };
  S.proj.pranchetas[S.pi].zonas.push(n); S.sel = n.id; S.sujo = true; render(); props();
}
function copiarEstiloZona(z) {
  S.clipZona = Object.fromEntries(Object.entries(clone(z)).filter(([k]) => !ESTILO_FORA.includes(k)));
  try { localStorage.setItem('construtor-estilo-zona', JSON.stringify(S.clipZona)); } catch { /* fica só nesta aba */ }
  props();
}
function estiloZonaCopiado() {
  if (S.clipZona) return S.clipZona;
  try { return JSON.parse(localStorage.getItem('construtor-estilo-zona') || 'null'); } catch { return null; }
}
function colarEstiloZona(z) {
  const c = estiloZonaCopiado(); if (!c) return;
  for (const k of Object.keys(z)) if (!ESTILO_FORA.includes(k)) delete z[k];
  Object.assign(z, clone(c));
  // modelo que não existe neste projeto: fica o primeiro
  if (!S.proj.modelos_card.some(m => m.id === z.modelo_card_id)) z.modelo_card_id = S.proj.modelos_card[0] && S.proj.modelos_card[0].id;
  S.sujo = true; render(); props();
}
// partes da zona composta, na ordem (de cima pra baixo, ou da esquerda pra direita)
function formPartes(alvo, z) {
  form(alvo, 'Partes da zona', [
    { rot: 'Divide', k: 'direcao', tipo: 'select', opcoes: [['', 'De cima pra baixo'], ['h', 'Da esquerda pra direita']] },
    { dica: 'Tamanho = peso de cada parte (1 e 1 = metade cada; 2 e 1 = dois terços e um terço).' },
  ], z, () => { if (!z.direcao) delete z.direcao; S.sujo = true; props(); });
  z.partes.forEach((p, i) => {
    const fx = p.tipo === 'fixo';
    form(alvo, `Parte ${i + 1} · ${fx ? 'fixo' : 'elástica'}`, [
      { rot: 'Tipo', k: 'tipo', tipo: 'select', opcoes: [['fixo', 'Fixo'], ['elastica', 'Elástica']] },
      { rot: 'Tamanho', k: 'tam', tipo: 'number', ph: '1' },
      ...(fx ? [
        { rot: 'Lugares lado a lado', k: 'n', tipo: 'number', ph: '1' },
        { rot: 'Prioridade do destaque', k: 'prioridade', tipo: 'number', ph: 'sem' },
        { dica: '1 = recebe o 1º produto da lista; 2 = o 2º… Sem número: entra na ordem de leitura.' },
      ] : [
        { rot: 'Colunas no desenho', k: 'colunas', tipo: 'number', ph: '2' },
        { rot: 'Máximo de linhas', k: 'max_linhas', tipo: 'number', ph: 'automático' },
        { rot: 'Máximo por linha', k: 'max_por_linha', tipo: 'number', ph: 'automático' },
        { dica: 'No editor ela monta as linhas pela quantidade que cair nela. Vazia, o fixo da zona cresce e ocupa o lugar.' },
      ]),
      { rot: '↑ Subir', botao: () => { if (i) { [z.partes[i - 1], z.partes[i]] = [z.partes[i], z.partes[i - 1]]; S.sujo = true; props(); } } },
      { rot: '× Tirar esta parte', botao: () => { if (z.partes.length > 1) { z.partes.splice(i, 1); S.sujo = true; props(); } } },
    ], p, () => { S.sujo = true; props(); });
  });
  form(alvo, 'Nova parte', [
    { rot: '+ Fixo', botao: () => { z.partes.push({ tipo: 'fixo', tam: 1, n: 1 }); S.sujo = true; props(); } },
    { rot: '+ Elástica', botao: () => { z.partes.push({ tipo: 'elastica', tam: 1, colunas: 2 }); S.sujo = true; props(); } },
  ], {}, () => {});
}
const linhasCaixa = [{ rot: 'X', k: 'x', tipo: 'number' }, { rot: 'Y', k: 'y', tipo: 'number' }, { rot: 'Largura', k: 'w', tipo: 'number' }, { rot: 'Altura', k: 'h', tipo: 'number' }];
const linhasBorda = [{ rot: 'Borda', k: 'borda', tipo: 'number', ph: '0 = sem' }, { rot: 'Cor da borda', k: 'borda_cor', tipo: 'color' }];
// texto: fonte, tamanho, cor, borda, alinhamento e estilos ficam no painel Caractere
const linhasTexto = () => [{ caractere: true }];
const linhasForma = (comImagem = true) => [
  { rot: 'Cor', k: 'cor', tipo: 'corT' }, { rot: 'Canto', k: 'raio', tipo: 'number' }, { rot: 'Cantos', k: 'cantos', tipo: 'cantos' },
  ...linhasBorda, ...(comImagem ? [{ rot: 'Imagem', k: 'imagem_url', tipo: 'imagem' }, { dica: 'Com imagem, ela entra no lugar da forma (cor e cantos ficam de lado).' }] : []),
];
// regra do fundo do preço: como ele acompanha o tamanho do valor no editor
const linhasRegra = c => [
  { rot: 'R$ na borda', k: 'na_borda', tipo: 'select', opcoes: [['', 'Não'], ['esq', 'Na borda esquerda do fundo'], ['dir', 'Na borda direita do fundo']] },
  ...(c.na_borda ? [{ dica: 'O R$ e o círculo dele ficam com o meio em cima da borda lateral do fundo do preço. Quando o preço cresce, o fundo estica, o valor fica no meio e o R$ acompanha a borda.' }] : []),
  { dica: '— Quando o preço crescer —' },
  { rot: 'Regra', k: 'regra', tipo: 'select', opcoes: [['fixo', 'Fundo fixo, valor encolhe'], ['estica', 'Fundo estica'], ['estica_encolhe', 'Estica até o limite, depois encolhe o valor']] },
  ...(c.regra && c.regra !== 'fixo' ? [
    { rot: 'Cresce pra', k: 'regra_lado', tipo: 'select', opcoes: [['ambos', 'Os dois lados'], ['esq', 'Esquerda'], ['dir', 'Direita']] },
    { rot: 'Respiro', k: 'respiro', tipo: 'number', ph: '12' },
    { rot: 'Largura máx.', k: 'largura_max', tipo: 'number', ph: 'sem' },
    { dica: 'Largura máxima (pt): até ela o fundo e o R$ crescem com o valor; passou, o grupo do preço inteiro diminui por igual pra caber. Vazio = sem limite.' },
    { rot: 'Encolhe também', k: 'encolhe', tipo: 'check', padrao: false },
    { dica: 'Margem limite: distância mínima, em pt, entre o fundo e cada borda do card quando ele estica.' },
    { rot: 'Cima', k: 'margem_t', tipo: 'number', ph: '8' }, { rot: 'Direita', k: 'margem_r', tipo: 'number', ph: '8' },
    { rot: 'Baixo', k: 'margem_b', tipo: 'number', ph: '8' }, { rot: 'Esquerda', k: 'margem_l', tipo: 'number', ph: '8' },
  ] : []),
];
// sombra: liga e aparecem deslocamento, desfoque, quanto passa da forma e a cor
const linhasSombra = c => [
  { rot: 'Sombra', k: 'sombra', tipo: 'check', padrao: false },
  ...(c && c.sombra ? [
    { rot: 'Desloc. X', k: 'sombra_x', tipo: 'number', ph: '0', un: 'pt' }, { rot: 'Desloc. Y', k: 'sombra_y', tipo: 'number', ph: '0', un: 'pt' },
    { rot: 'Desfoque', k: 'sombra_blur', tipo: 'number', ph: '0', un: 'pt' },
    { rot: 'Largura +', k: 'sombra_largura', tipo: 'number', ph: '0', un: 'pt' }, { rot: 'Altura +', k: 'sombra_altura', tipo: 'number', ph: '0', un: 'pt' },
    { rot: 'Cor da sombra', k: 'sombra_cor', tipo: 'color' },
    { dica: 'Largura + / Altura +: quanto a sombra passa da forma em cada lado (pt). Desfoque 0 = sombra dura.' },
  ] : []),
];
// a borda só aparece com cor: ao pôr a espessura, já vem preta
function bordaPadrao(o, k) { if (k === 'borda' && o.borda && !o.borda_cor) o.borda_cor = '#000000'; }

// ---------------------------------------------------------------- tela principal
const prancheta = () => S.proj.pranchetas[S.pi];
function itemPorId(id) {
  if (ehMulti(id)) { const its = (S.mult || []).map(itemPorId).filter(Boolean); return its.length > 1 ? caixaDe(its) : null; }
  const pr = prancheta();
  return pr.elementos.find(e => e.id === id) || pr.zonas.find(z => z.id === id) || null;
}
let escala = 1;
// zoom = multiplicador sobre o "caber na tela" (1 = prancheta inteira visível)
let zoom = 1;
const ZOOM_MIN = 0.25, ZOOM_MAX = 16;

// muda o zoom mantendo parado o ponto da tela em (cx, cy); sem ponto, usa o centro da área
function aplicarZoom(novo, cx, cy) {
  if (!S.proj) return;
  const wrap = $('#canvas-wrap'), svg = $('#canvas-svg');
  const w = wrap.getBoundingClientRect();
  if (cx == null) { cx = w.left + w.width / 2; cy = w.top + w.height / 2; }
  const a = svg.getBoundingClientRect(), fx = (cx - a.left) / a.width, fy = (cy - a.top) / a.height;
  zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, novo));
  render();
  const b = svg.getBoundingClientRect();
  wrap.scrollLeft += b.left + fx * b.width - cx;
  wrap.scrollTop += b.top + fy * b.height - cy;
}

// ---------------------------------------------------------------- desfazer / refazer (Ctrl+Z / Ctrl+Y)
// Foto do estado depois de cada mudança: render() (e renderModelo, no modal) agenda e, quando a tela
// para de mexer por 350 ms, grava se o JSON mudou. Um arraste inteiro vira um passo só. O modal do
// modelo de card tem a pilha dele (mexe numa cópia, M.m, até Salvar). Datas do servidor não contam.
const SEM_DATAS = (k, v) => (k === 'atualizadoEm' || k === 'criadoEm' || k === 'publicadoEm' ? undefined : v);
function novaPilha() { return { volta: [], vai: [], atual: null, dono: null, t: 0 }; }
const HP = novaPilha(), HM = novaPilha();
function pilhaGrava(H, obj, dono) {
  clearTimeout(H.t); H.t = 0;
  if (!obj) return;
  const s = JSON.stringify(obj, SEM_DATAS);
  if (H.dono !== dono) { Object.assign(H, novaPilha(), { atual: s, dono }); return; } // outro projeto/modelo: começa do zero
  if (s === H.atual) return;
  if (H.atual !== null) { H.volta.push(H.atual); if (H.volta.length > 100) H.volta.shift(); }
  H.atual = s; H.vai = [];
}
function pilhaAgenda(H, pegar) { clearTimeout(H.t); H.t = setTimeout(() => { const [o, d] = pegar(); pilhaGrava(H, o, d); }, 350); }
const projetoAtual = () => [S.proj, S.proj && S.proj.id];
const modeloAtual = () => [M.m, M.m && M.m.id];
function desfazer(volta = true) {
  const modal = $('#modal-overlay').classList.contains('open');
  const H = modal ? HM : HP, [o, d] = modal ? modeloAtual() : projetoAtual();
  if (!o) return;
  pilhaGrava(H, o, d); // grava o que estava pendente antes de voltar
  const de = volta ? H.volta : H.vai, para = volta ? H.vai : H.volta;
  if (!de.length) return;
  para.push(H.atual); H.atual = de.pop();
  const estado = JSON.parse(H.atual);
  if (modal) { M.m = estado; if (M.sel && !campoM(M.sel) && !ehGrupo(M.sel) && !ehMulti(M.sel)) M.sel = null; renderModelo(); return; }
  S.proj = Object.assign(estado, { atualizadoEm: S.proj.atualizadoEm, criadoEm: S.proj.criadoEm, publicadoEm: S.proj.publicadoEm });
  S.pi = Math.min(S.pi, S.proj.pranchetas.length - 1);
  if (ehMulti(S.sel)) { S.mult = S.mult.filter(id => itemPorId(id)); if (S.mult.length < 2) S.sel = S.mult[0] || null; }
  if (S.sel && !itemPorId(S.sel)) S.sel = null;
  S.sujo = true; tudo();
}

function render() {
  const svg = $('#canvas-svg');
  svg.replaceChildren(); SVG_ATUAL = svg;
  if (!S.proj) return;
  pilhaAgenda(HP, projetoAtual);
  const { w: W, h: H } = S.proj.tamanho, pr = prancheta();
  const wrap = $('#canvas-wrap');
  escala = Math.min((wrap.clientWidth - 48) / W, (wrap.clientHeight - 48) / H, 2) * zoom;
  $('#btn-zoom').textContent = Math.round(escala * 100) + '%';
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.style.width = W * escala + 'px'; svg.style.height = H * escala + 'px';
  svg.setAttribute('class', 'mode-' + S.tool);
  if (pr.fundo.tipo === 'imagem' && srcImg(pr.fundo.url)) el('image', { href: srcImg(pr.fundo.url), x: 0, y: 0, width: W, height: H, preserveAspectRatio: pr.fundo.ajuste === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice' }, svg);
  else el('rect', { x: 0, y: 0, width: W, height: H, fill: tinta(pr.fundo.cor || '#ffffff') }, svg);

  for (const e of pr.elementos) {
    if (e.tipo === 'retangulo') forma(svg, e, e, { 'data-id': e.id });
    else if (e.tipo === 'imagem') {
      const src = srcImg(e.url);
      if (src) el('image', { 'data-id': e.id, href: src, x: e.x, y: e.y, width: e.w, height: e.h, preserveAspectRatio: e.ajuste === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet' }, svg);
      el('rect', { 'data-id': e.id, x: e.x, y: e.y, width: e.w, height: e.h, fill: src ? 'transparent' : '#0000001a', stroke: src ? 'none' : '#0004', 'stroke-dasharray': '4 3' }, svg);
      if (e.url && e.url.startsWith('bloco:')) etiquetaBloco(svg, e, e.url.slice(6), escala);
    } else if (e.tipo === 'texto') {
      el('rect', { 'data-id': e.id, x: e.x, y: e.y, width: e.w, height: e.h, fill: 'transparent' }, svg);
      texto(svg, e, e, e.texto);
      // texto com papel (data, aviso…): contorno laranja e etiqueta, só na tela do construtor
      if (e.papel) {
        el('rect', { x: e.x, y: e.y, width: e.w, height: e.h, fill: 'none', stroke: '#ff9800', 'stroke-width': 1.5 / escala, 'stroke-dasharray': `${4 / escala} ${3 / escala}`, 'pointer-events': 'none' }, svg);
        const t = el('text', { x: e.x + 2 / escala, y: e.y - 3 / escala, 'font-size': 10 / escala, fill: '#ff9800', 'font-family': 'system-ui', 'pointer-events': 'none' }, svg);
        t.textContent = { data: 'DATA', aviso: 'AVISO', variavel: 'MUDA' }[e.papel] || '';
      }
    }
  }
  const modelos = new Map(S.proj.modelos_card.map(m => [m.id, m]));
  // produtos de exemplo continuam de uma prancheta pra outra (card 1 da prancheta 2 = depois da 1)
  let nCard = S.proj.pranchetas.slice(0, S.pi).reduce((t, p) => t + zonasAbertas(p).reduce((u, z) => u + Array.from({ length: z.linhas }, (_, r) => itensDaLinha(z, r)).reduce((a, b) => a + b, 0), 0), 0);
  for (const z0 of pr.zonas) for (const z of expandirZona(z0)) {
    const m = modelos.get(z.modelo_card_id), e = z.espaco ?? S.proj.espaco_padrao;
    const ch = (z.h - (z.linhas - 1) * e) / z.linhas;
    const casas = [];
    if (m && ch > 0) for (let r = 0; r < z.linhas; r++) {
      const n = itensDaLinha(z, r), cw = (z.w - (n - 1) * e) / n;
      if (cw > 0) for (let c = 0; c < n; c++) casas.push({ x: z.x + c * (cw + e), y: z.y + r * (ch + e), w: cw, h: ch });
    }
    // divisórias atrás dos cards, como no editor (mesma conta: public/encarte/divisorias.js)
    const dv = z.divisorias;
    if (dv && (dv.v || dv.h) && typeof divisoriasDaZona === 'function') {
      const px = dv.px > 0 ? dv.px : 2, traco = dv.estilo === 'pontilhada' ? `0 ${px * 2}` : dv.estilo === 'tracejada' ? `${px * 3} ${px * 2}` : null;
      for (const l of divisoriasDaZona(casas, { v: dv.v, h: dv.h, recuo: dv.recuo, vaoMax: Math.max(40, e * 3) }))
        el('line', { x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2, stroke: dv.cor || '#000000', 'stroke-width': px, 'stroke-dasharray': traco,
          'stroke-linecap': dv.estilo === 'pontilhada' ? 'round' : 'butt', 'pointer-events': 'none' }, svg);
    }
    for (const b of casas) desenharCard(svg, m, usaHorizontal(m, z, b.w, b.h) ? versaoNaCasa(m, 'horizontal', b, null) : versaoNaCasa(m, 'campos', b, casaDoModelo(m.id, true)), b, false, produtoExemplo(nCard++));
    if (z.parte) {
      // parte da zona composta: fixo laranja cheio, elástica verde tracejada (não seleciona: a zona é que seleciona)
      const fx = z.parte.tipo === 'fixo', cor = fx ? '#D85A30' : '#1D9E75';
      el('rect', { x: z.x, y: z.y, width: z.w, height: z.h, fill: fx ? '#D85A3014' : '#1D9E7514', stroke: cor, 'stroke-width': 1.5 / escala,
        'stroke-dasharray': fx ? null : `${4 / escala} ${3 / escala}`, 'pointer-events': 'none' }, svg);
      const tp = el('text', { x: z.x + 4 / escala, y: z.y + 13 / escala, 'font-size': 11 / escala, fill: cor, 'font-family': 'system-ui', 'font-weight': 600, 'pointer-events': 'none' }, svg);
      tp.textContent = fx ? `Fixo${z.parte.prioridade ? ' · destaque ' + z.parte.prioridade : ''}` : 'Elástica';
      continue;
    }
    rotuloZona(z, m, `${Array.from({ length: z.linhas }, (_, r) => itensDaLinha(z, r)).join('/')} por linha`);
  }
  for (const z of pr.zonas) if (z.tipo === 'composta' && z.partes && z.partes.length)
    rotuloZona(z, modelos.get(z.modelo_card_id), `composta · ${z.partes.map(p => (p.tipo === 'fixo' ? 'F' : 'E')).join(z.direcao === 'h' ? ' | ' : ' / ')}`);
  function rotuloZona(z, m, txt) {
    el('rect', { 'data-id': z.id, x: z.x, y: z.y, width: z.w, height: z.h, fill: 'transparent', stroke: '#7b2ff7', 'stroke-width': 2 / escala, 'stroke-dasharray': `${6 / escala} ${4 / escala}` }, svg);
    const t = el('text', { x: z.x + 4 / escala, y: z.y - 4 / escala, 'font-size': 11 / escala, fill: '#7b2ff7', 'font-family': 'system-ui', 'pointer-events': 'none' }, svg);
    t.textContent = `Zona · ${m ? m.nome : 'sem modelo'} · ${txt}`;
  }
  el('g', { id: 'fantasma' }, svg);
  const s = S.sel && itemPorId(S.sel);
  if (s && ehMulti(S.sel)) {
    for (const it of S.mult.map(itemPorId).filter(Boolean)) desenharSelecao(svg, it, escala, true);
    el('rect', { class: 'sel-rect', x: s.x, y: s.y, width: s.w, height: s.h, 'stroke-width': 1 / escala, 'stroke-dasharray': `${4 / escala} ${3 / escala}`, fill: 'none', 'pointer-events': 'none' }, svg);
  } else if (s) desenharSelecao(svg, s, escala);
  $('#proj-nome-label').textContent = S.proj.nome + (S.sujo ? ' •' : '');
}

function listas() {
  const lp = $('#lista-pranchetas'); lp.replaceChildren();
  S.proj.pranchetas.forEach((pr, i) => lp.append(h('div', { class: 'sb-item' + (i === S.pi ? ' active' : ''), on: { click: () => { S.pi = i; S.sel = null; tudo(); } } },
    `${i + 1}. ${pr.nome}`,
    h('span', { class: 'del', title: 'Duplicar a prancheta (a cópia entra logo depois)', style: 'margin-left:auto', on: { click: ev => { ev.stopPropagation(); duplicarPrancheta(i); } } }, '⧉'),
    h('span', { class: 'del', title: 'Copiar a prancheta (depois cole por cima de outra)', style: 'margin-left:4px', on: { click: ev => { ev.stopPropagation(); S.clipPrancheta = clone(pr); listas(); } } }, '⎘'),
    ...(S.clipPrancheta ? [h('span', { class: 'del', title: `Colar por cima desta a prancheta copiada ("${S.clipPrancheta.nome}"): fundo, elementos e zonas; o nome fica`, style: 'margin-left:4px', on: { click: ev => { ev.stopPropagation(); colarPrancheta(i); } } }, '⇣')] : []),
    h('span', { class: 'del', title: 'Apagar', style: 'margin-left:4px', on: { click: ev => { ev.stopPropagation(); apagarPrancheta(i); } } }, '×'))));
  const lm = $('#lista-modelos'); lm.replaceChildren();
  const clipM = lerClipModelo();
  for (const m of S.proj.modelos_card) lm.append(h('div', { class: 'sb-item', title: [m.especial && 'Tem versão especial (2×2)', m.horizontal && 'Tem versão horizontal'].filter(Boolean).join(' · '), on: { click: () => abrirModelo(m.id) } },
    h('span', { class: 'campo-color', style: `background:${cssCor(m.fundo_cor)};border:1px solid var(--c-border)` }), `${m.nome}${m.especial ? ' ★' : ''}${m.horizontal ? ' ▭' : ''}`,
    h('span', { class: 'del', title: 'Copiar o modelo (cola em qualquer projeto, inclusive neste)', style: 'margin-left:auto', on: { click: ev => { ev.stopPropagation(); copiarModeloClip(m); } } }, '⧉'),
    ...(clipM && !(clipM.projetoId === S.proj.id && clipM.modeloId === m.id) ? [h('span', { class: 'del', title: `Colar o estilo de "${clipM.nome}" neste modelo (o nome e as zonas dele ficam)`, style: 'margin-left:4px', on: { click: ev => { ev.stopPropagation(); if (confirm(`Trocar o desenho de "${m.nome}" pelo de "${clipM.nome}"?`)) colarModeloClip(m.id); } } }, '⇣')] : []),
    h('span', { class: 'del', title: 'Apagar', style: 'margin-left:4px', on: { click: ev => { ev.stopPropagation(); apagarModelo(m.id); } } }, '×')));
  const clip = lerClipModelo();
  $('#btn-colar-modelo').style.display = clip ? '' : 'none';
  $('#btn-colar-modelo').title = clip ? `Colar "${clip.nome}" (de ${clip.projetoNome})` : '';
  for (const b of document.querySelectorAll('[data-tool]')) b.classList.toggle('active', b.dataset.tool === S.tool);
}

function linhaTamanho(alvo) {
  const sel = h('select', {}, h('option', { value: '' }, 'Personalizado'), ...TAMANHOS.map(([v, r]) => h('option', { value: v }, r)));
  sel.value = TAMANHOS.some(([v]) => v === `${S.proj.tamanho.w}x${S.proj.tamanho.h}`) ? `${S.proj.tamanho.w}x${S.proj.tamanho.h}` : '';
  sel.addEventListener('input', () => { if (!sel.value) return; const [w, hh] = sel.value.split('x').map(Number); S.proj.tamanho = { w, h: hh }; S.sujo = true; render(); props(); });
  alvo.querySelector('.prop-section:last-child h3').after(h('div', { class: 'prop-row' }, h('label', {}, 'Tamanho'), sel));
}

// regras que o editor de encarte aplica sozinho (Matheus, 22/10/2026: liga/desliga aqui em vez de
// pedir por prompt). Vão no SVG como data-regras; "Padrão" = sem a chave, o editor segue o
// padroes_mercado.json do cliente e, sem ele, o comportamento de sempre
const REGRAS = [
  { k: 'nome_acima_do_preco', rot: 'Nome acima do preço', dica: 'sobe o nome que ficaria atrás do preço', tipo: 'liga', padrao: 'ligado' },
  { k: 'nome_embaixo_fica', rot: 'Nome embaixo fica embaixo', dica: 'nome que o molde pôs embaixo do preço não sobe', tipo: 'liga', padrao: 'ligado' },
  { k: 'linha_incompleta_embaixo', rot: 'Linha incompleta embaixo', dica: 'linhas cheias em cima, nenhuma com 1 item só', tipo: 'liga', padrao: 'ligado' },
  { k: 'encolhe_card_baixo', rot: 'Encolhe card baixo', dica: 'card mais baixo que o molde diminui nome e preço junto', tipo: 'liga', padrao: 'do cliente' },
  { k: 'logo_auto', rot: 'Logo automático', dica: 'desligado tira a troca de logo do padrão do cliente', tipo: 'liga', padrao: 'do cliente' },
  { k: 'moeda_anda', rot: 'R$ anda', dica: 'o R$ vai pra esquerda quando o valor não cabe', tipo: 'moeda', padrao: 'do cliente' },
  { k: 'titulo_min_pt', rot: 'Nome mínimo (pt)', dica: 'menor tamanho do nome que encolheu sozinho', tipo: 'num', ph: '14' },
  { k: 'primeira_linha_max', rot: 'Máx. na 1ª linha', dica: '0 = sem limite', tipo: 'num', ph: 'do cliente' },
  { k: 'preco_proporcional', rot: 'Preço acompanha a largura', dica: 'card mais estreito encolhe o preço, mais largo aumenta', tipo: 'liga', padrao: 'ligado' },
  { k: 'preco_ajustar_largura', rot: 'Tarja na largura da casa', dica: 'fração da largura (ex. 0.94); 0 = desligado', tipo: 'num', ph: 'do cliente', step: 0.01 },
];
function formRegras(alvo, mudou) {
  const R = S.proj.regras || {};
  const deTela = r => { const v = R[r.k]; if (v === undefined) return ''; if (r.tipo === 'num') return v; return v === true ? 'sim' : v === false ? 'nao' : v; };
  const tela = Object.fromEntries(REGRAS.map(r => [r.k, deTela(r)]));
  form(alvo, 'Regras do editor', [
    { dica: 'O editor aplica essas correções sozinho em toda edição deste template. "Padrão" segue o cliente.' },
    ...REGRAS.map(r => r.tipo === 'num'
      ? { rot: r.rot, k: r.k, tipo: 'number', un: '', ph: r.ph, step: r.step }
      : { rot: r.rot, k: r.k, tipo: 'select', opcoes: [['', `Padrão (${r.padrao})`], ['sim', 'Ligado'], ['nao', 'Desligado'], ...(r.tipo === 'moeda' ? [['fundo', 'Ligado, fundo estica junto']] : [])] }),
  ], tela, k => {
    const v = tela[k];
    const r = REGRAS.find(x => x.k === k);
    const regras = { ...(S.proj.regras || {}) };
    if (v === '' || v === undefined) delete regras[k];
    else regras[k] = r.tipo === 'num' ? v : v === 'sim' ? true : v === 'nao' ? false : v;
    if (Object.keys(regras).length) S.proj.regras = regras; else delete S.proj.regras;
    mudou();
  });
  alvo.lastElementChild.querySelectorAll('.prop-row').forEach((row, i) => { const r = REGRAS[i]; if (r) row.title = r.dica; });
}

function props() {
  if (!$('#modal-overlay').classList.contains('open')) caractere(null);
  const alvo = $('#props-conteudo'); alvo.replaceChildren();
  $('#props-vazio').style.display = 'none'; alvo.style.display = '';
  const it = S.sel && itemPorId(S.sel), pr = prancheta();
  const mudou = k => { if (it) bordaPadrao(it, k); S.sujo = true; render(); };
  if (!it) {
    form(alvo, 'Prancheta', [{ rot: 'Nome', k: 'nome' }], pr, () => { mudou(); listas(); });
    form(alvo, 'Fundo', [{ rot: 'Tipo', k: 'tipo', tipo: 'select', opcoes: [['cor', 'Cor'], ['imagem', 'Imagem']] },
      ...(pr.fundo.tipo === 'imagem' ? [{ rot: 'Imagem', k: 'url', tipo: 'imagem' }, { rot: 'Ajuste', k: 'ajuste', tipo: 'select', opcoes: [['cover', 'Cobrir'], ['contain', 'Caber']] }] : [{ rot: 'Cor', k: 'cor', tipo: 'color' }])],
      pr.fundo, k => { if (k === 'tipo' && pr.fundo.tipo === 'cor' && !pr.fundo.cor) pr.fundo.cor = '#ffffff'; if (k === 'tipo' && !pr.fundo.ajuste) pr.fundo.ajuste = 'cover'; mudou(); props(); });
    // cliente = pasta do cliente no Somado Tarefas (o nome é o da pasta do Drive onde publica)
    const nomesCli = S.clientes.map(c => c.nome);
    if (S.proj.cliente && !nomesCli.includes(S.proj.cliente)) nomesCli.unshift(S.proj.cliente);
    form(alvo, 'Projeto', [
      { rot: 'Nome', k: 'nome' }, { rot: 'Cliente', k: 'cliente', tipo: 'select', opcoes: nomesCli }, { rot: 'Tema', k: 'tema' },
      { rot: 'Espaço', k: 'espaco_padrao', tipo: 'number' },
      // catálogo (tabela de preços em linhas): o editor deixa 1 coluna, sem foto, zona pelo id da lista
      { rot: 'Tipo', k: 'tipo', tipo: 'select', opcoes: [['encarte', 'Encarte'], ['catalogo', 'Catálogo em linhas']] },
    ], S.proj, k => {
      if (k === 'cliente') { const c = S.clientes.find(x => x.nome === S.proj.cliente); S.proj.folderId = c ? c.folderId : null; carregarBlocos().then(render); }
      mudou();
    });
    formRegras(alvo, mudou);
    form(alvo, 'Tamanho da prancheta', [{ rot: 'Largura', k: 'w', tipo: 'number', un: 'px' }, { rot: 'Altura', k: 'h', tipo: 'number', un: 'px' }], S.proj.tamanho, () => { mudou(); props(); });
    linhaTamanho(alvo);
    form(alvo, 'Cliente e biblioteca', [
      { dica: 'Blocos do cliente: logo, selo do tema, elemento lateral, fundo… A imagem vem do cadastro do cliente.' },
      { rot: 'Blocos do cliente…', botao: () => abrirBlocos() },
      { rot: '☆ Salvar como estrutura do cliente…', botao: () => dialogoSalvar({ tipo: 'estrutura' }) },
    ], {}, () => {});
    return;
  }
  if (ehMulti(S.sel)) {
    const its = S.mult.map(itemPorId).filter(Boolean);
    const aplica = novas => { its.forEach((it, i) => { it.x = r1(novas[i].x); it.y = r1(novas[i].y); }); S.sujo = true; render(); props(); };
    const { w: W, h: H } = S.proj.tamanho;
    painelMulti(alvo, its.length, {
      entre: onde => aplica(alinharVarias(its, onde)),
      rotConjunto: 'na prancheta',
      conjunto: onde => { const u = caixaDe(its), n = alinhar(u, { x: 0, y: 0, w: W, h: H }, onde); aplica(its.map(it => ({ x: it.x + n.x - u.x, y: it.y + n.y - u.y }))); },
      apagar: () => apagarSel(),
    });
    return;
  }
  const remover = { rot: 'Apagar', botao: () => apagarSel() };
  const guardar = { rot: '☆ Salvar na biblioteca…', botao: () => dialogoSalvar({ tipo: 'elementos', prancheta: S.pi + 1, ids: [it.id] }) };
  if (it.colunas) {
    const linhaTxt = { por: Array.from({ length: it.linhas }, (_, r) => itensDaLinha(it, r)).join(', ') };
    form(alvo, 'Zona da grade', [
      { rot: 'Modelo', k: 'modelo_card_id', tipo: 'select', opcoes: S.proj.modelos_card.map(m => [m.id, m.nome]) },
      { rot: 'Espaço', k: 'espaco', tipo: 'number', ph: String(S.proj.espaco_padrao) },
      { rot: 'Formato', k: 'formato', tipo: 'select', opcoes: [['', 'Automático (horizontal nas casas largas)'], ['normal', 'Sempre normal'], ['horizontal', 'Sempre horizontal']] },
      ...(S.proj.modelos_card.find(m => m.id === it.modelo_card_id) || {}).horizontal ? [] : [{ dica: 'Esse modelo ainda não tem a versão horizontal (abra o modelo e crie em "+ Horizontal").' }],
      ...linhasCaixa,
      { rot: '☆ Salvar o card desta zona na biblioteca…', botao: () => dialogoSalvar({ tipo: 'card', modelo: it.modelo_card_id }) },
      { rot: '⧉ Duplicar a zona', botao: () => duplicarZona(it) },
      { rot: '⎘ Copiar o estilo da zona', botao: () => copiarEstiloZona(it) },
      ...(estiloZonaCopiado() ? [{ rot: '⇣ Colar o estilo copiado nesta zona', botao: () => colarEstiloZona(it) },
        { dica: 'Estilo = modelo, espaço, formato, linhas/itens por linha, divisórias e partes (zona composta). O lugar e o tamanho da zona ficam.' }] : []),
      remover,
    ], it, mudou);
    alvo.querySelector('.prop-section:last-child').append(linhaAlinhar('na prancheta', onde => {
      const { w: W, h: H } = S.proj.tamanho, n = alinhar(it, { x: 0, y: 0, w: W, h: H }, onde);
      it.x = +n.x.toFixed(1); it.y = +n.y.toFixed(1); S.sujo = true; render(); props();
    }));
    form(alvo, 'Tipo de zona', [
      { rot: 'Tipo', k: 'tipo', tipo: 'select', opcoes: [['', 'Normal (linhas e itens por linha)'], ['composta', 'Composta (partes fixas e elásticas)']] },
      { dica: 'Composta: a zona é dividida em partes. Fixo = lugar que existe sempre (o destaque pela prioridade). Elástica = recebe quantos produtos sobrarem e monta as linhas sozinha no editor.' },
    ], it, () => {
      if (it.tipo === 'composta' && !(it.partes && it.partes.length)) it.partes = [{ tipo: 'fixo', tam: 1, n: 1, prioridade: 1 }, { tipo: 'elastica', tam: 1, colunas: 2 }];
      if (!it.tipo) delete it.tipo;
      mudou(); props();
    });
    if (it.tipo === 'composta') { formPartes(alvo, it); return; }
    form(alvo, 'Itens por linha', [
      { rot: 'Por linha', k: 'por', ph: '3, 2, 4' },
      { dica: 'Um número por linha, de cima pra baixo (ex.: 3, 2, 4). Cada linha ocupa a largura toda da zona.' },
    ], linhaTxt, () => {
      const ns = String(linhaTxt.por).split(/[,;\s]+/).map(Number).filter(n => n >= 1).map(Math.round);
      if (!ns.length) return props();
      it.linhas = ns.length; it.colunas = Math.max(...ns); it.por_linha = ns.every(n => n === ns[0]) ? undefined : ns;
      mudou(); props();
    });
    // divisórias: linhas entre os itens que o editor redesenha pela grade de cada edição
    const dv = { v: false, h: false, cor: '#000000', px: 2, estilo: 'tracejada', recuo: 0, ...(it.divisorias || {}) };
    form(alvo, 'Divisórias', [
      { rot: 'Entre colunas', k: 'v', tipo: 'check', padrao: false },
      { rot: 'Entre linhas', k: 'h', tipo: 'check', padrao: false },
      ...(dv.v || dv.h ? [
        { rot: 'Cor', k: 'cor', tipo: 'color' },
        { rot: 'Espessura', k: 'px', tipo: 'number', un: 'px' },
        { rot: 'Estilo', k: 'estilo', tipo: 'select', opcoes: [['solida', 'Sólida'], ['pontilhada', 'Pontilhada'], ['tracejada', 'Tracejada']] },
        { rot: 'Recuo das pontas', k: 'recuo', tipo: 'number', un: 'pt' },
      ] : []),
      { dica: 'Linha no meio do vão entre os itens: 3 colunas = 2 verticais, 2 colunas = 1. No editor elas mudam de lugar sozinhas quando a grade muda, e tocando numa dá pra mudar cor, espessura e estilo.' },
    ], dv, k => {
      if (dv.v || dv.h) it.divisorias = { v: !!dv.v, h: !!dv.h, cor: dv.cor || '#000000', px: dv.px > 0 ? dv.px : 2, estilo: dv.estilo || 'solida', ...(dv.recuo > 0 ? { recuo: dv.recuo } : {}) };
      else delete it.divisorias;
      mudou(); if (k === 'v' || k === 'h') props();
    });
    return;
  }
  const ordem = [{ rot: 'Trazer pra frente', botao: () => ordenar(1) }, { rot: 'Mandar pra trás', botao: () => ordenar(-1) }];
  if (it.tipo === 'texto') form(alvo, 'Texto', [
    // papel: o editor de encarte marca esse texto até ele ser atualizado na edição da semana
    { rot: 'Papel', k: 'papel', tipo: 'select', opcoes: PAPEIS },
    ...(it.papel ? [{ dica: 'No editor de encarte esse texto fica marcado em laranja até ser atualizado na edição da semana (e o Hermes/Claude sabem que precisam trocar).' }] : []),
    { rot: 'Texto', k: 'texto', tipo: 'textarea' }, ...linhasTexto(), ...linhasSombra(it), ...linhasCaixa, ...ordem, guardar, remover,
  ], it, k => { if (k === 'papel' && !it.papel) delete it.papel; mudou(k); if (k === 'borda' || k === 'papel' || k === 'sombra') props(); });
  if (it.tipo === 'retangulo') form(alvo, 'Forma', [...linhasForma(), ...linhasSombra(it), ...linhasCaixa, ...ordem, guardar, remover], it, k => { mudou(k); props(); });
  if (it.tipo === 'imagem') form(alvo, 'Imagem', [{ rot: 'Imagem', k: 'url', tipo: 'imagem' }, { rot: 'Ajuste', k: 'ajuste', tipo: 'select', opcoes: [['contain', 'Caber'], ['cover', 'Cobrir']] }, ...linhasCaixa, ...ordem, guardar, remover], it, k => { mudou(k); props(); });
  // texto, forma e imagem soltos: alinhar na prancheta
  const sec = alvo.querySelector('.prop-section:last-child');
  if (sec) sec.append(linhaAlinhar('na prancheta', onde => {
    const { w: W, h: H } = S.proj.tamanho, n = alinhar(it, { x: 0, y: 0, w: W, h: H }, onde);
    it.x = +n.x.toFixed(1); it.y = +n.y.toFixed(1); S.sujo = true; render(); props();
  }));
}
function tudo() { render(); listas(); props(); }
const PAPEIS = [['', 'Texto fixo'], ['data', 'Data da oferta (muda toda edição)'], ['aviso', 'Aviso legal (tem data dentro)'], ['variavel', 'Outro texto que muda (telefone, chamada…)']];

function ordenar(dir) {
  const a = prancheta().elementos, i = a.findIndex(e => e.id === S.sel), j = i + dir;
  if (i < 0 || j < 0 || j >= a.length) return;
  [a[i], a[j]] = [a[j], a[i]]; S.sujo = true; render();
}
function apagarSel() {
  const pr = prancheta(), fora = ehMulti(S.sel) ? S.mult : [S.sel];
  pr.elementos = pr.elementos.filter(e => !fora.includes(e.id)); pr.zonas = pr.zonas.filter(z => !fora.includes(z.id));
  S.sel = null; S.sujo = true; tudo();
}
function apagarPrancheta(i) {
  if (S.proj.pranchetas.length < 2) return alert('O template precisa de pelo menos uma prancheta.');
  if (!confirm(`Apagar a prancheta "${S.proj.pranchetas[i].nome}"?`)) return;
  S.proj.pranchetas.splice(i, 1); S.pi = Math.min(S.pi, S.proj.pranchetas.length - 1); S.sel = null; S.sujo = true; tudo();
}
function apagarModelo(id) {
  if (S.proj.pranchetas.some(p => p.zonas.some(z => z.modelo_card_id === id))) return alert('Tem zona usando esse modelo. Troque o modelo da zona antes.');
  S.proj.modelos_card = S.proj.modelos_card.filter(m => m.id !== id); S.sujo = true; listas();
}
function novaPrancheta() {
  S.proj.pranchetas.push({ id: uid('pr'), nome: `Prancheta ${S.proj.pranchetas.length + 1}`, fundo: { tipo: 'cor', cor: '#ffffff' }, elementos: [], zonas: [] });
  S.pi = S.proj.pranchetas.length - 1; S.sel = null; S.sujo = true; tudo();
}
function modeloNovo() {
  const indice = Math.max(0, ...S.proj.modelos_card.map(m => m.indice)) + 1;
  const m = { id: uid('mc'), nome: `Card ${indice}`, indice, fundo_cor: '#ffffff', raio: 0, campos: modeloPadrao() };
  S.proj.modelos_card.push(m); S.sujo = true;
  return m;
}

async function criarNaTela(b) {
  const t = S.tool, pr = prancheta();
  if (!b.w) b = { x: b.x, y: b.y, w: t === 'texto' ? 260 : t === 'zona' ? 400 : 150, h: t === 'texto' ? 50 : t === 'zona' ? 300 : 100 };
  let it;
  if (t === 'zona') {
    if (!S.proj.modelos_card.length) modeloNovo();
    it = { id: uid('z'), ...b, colunas: 3, linhas: 2, modelo_card_id: S.proj.modelos_card[0].id };
    pr.zonas.push(it);
  } else {
    if (t === 'texto') it = { id: uid('txt_'), tipo: 'texto', ...b, texto: 'OFERTAS', fonte: F(), tamanho: Math.round(b.h * 0.8), cor: '#222222', alinhamento: 'start' };
    if (t === 'retangulo') it = { id: uid('forma_'), tipo: 'retangulo', ...b, cor: '#ffcc00', raio: 0 };
    if (t === 'imagem') it = { id: uid('img_'), tipo: 'imagem', ...b, ajuste: 'contain' };
    pr.elementos.push(it);
  }
  S.tool = 'selecionar'; S.sel = it.id; S.sujo = true; tudo();
  if (t === 'imagem') { const r = await enviarImagem(); if (r) { it.url = r; render(); props(); } }
}

// ---------------------------------------------------------------- editor de modelo de card (modal)
const M = { m: null, aba: 'campos', sel: null, comSelo: false, comDe: false };
// o card como está na tela do modal: "Sem selo" ou "Com selo" (preço no lugar com selo + selo)
const emComSelo = () => !!(M.comSelo && M.m[M.aba].selo_valor);
const camposVista = () => vistaSelo(M.m[M.aba], caixaCardModal(), emComSelo(), M.comDe);
// no "Com selo" as peças do preço andam juntas (o grupo), não uma a uma
const precoEmGrupo = k => emComSelo() && PRECO_KS.includes(k);
const campoM = k => {
  if (ehMulti(k)) return null;
  const c = camposVista(), v = k && k[0] === 'x' ? (c.extras || [])[+k.slice(1)] : c[k];
  // "Com selo": a peça do preço mostrada é uma cópia levada pro lugar do grupo. Cor, fonte, borda etc.
  // mexidos nela valem pro desenho de verdade (o normal); medidas em pt voltam pela escala do grupo e
  // lugar/tamanho ficam com o grupo (Matheus, 20/10/2026: não dava pra mudar a cor do preço com selo)
  const real = v && precoEmGrupo(k) && M.m[M.aba][k];
  if (!real) return v;
  // cor, cor da borda e lugar ficam SÓ no preço com selo (com_selo.pecas); fonte e tamanho valem pros dois
  const cs = M.m[M.aba].com_selo, s = (cs && cs.escala) || 1, SO_SELO = ['x', 'y', 'cor', 'borda_cor'];
  const aj = () => { const pc = cs.pecas || (cs.pecas = {}); return pc[k] || (pc[k] = {}); };
  return new Proxy(v, {
    set(t, p, val) {
      t[p] = val;
      if (p === 'w' || p === 'h') return true;
      if (cs && SO_SELO.includes(p)) { aj()[p] = val; return true; }
      real[p] = MEDIDAS_GRUPO.includes(p) && typeof val === 'number' ? Math.round(val / s * 100) / 100 : val;
      return true;
    },
    deleteProperty(t, p) { delete t[p]; if (cs && SO_SELO.includes(p)) { if (cs.pecas && cs.pecas[k]) delete cs.pecas[k][p]; } else if (p !== 'w' && p !== 'h') delete real[p]; return true; },
  });
};
// peças da seleção múltipla do card que se movem (área/foto por regras ficam de fora: as margens mandam)
function pecasMulti() {
  const campos = M.m[M.aba], regras = campos.area && campos.area.modo === 'regras';
  return (M.mult || []).filter(k => campoM(k) && campoM(k).x != null && !precoEmGrupo(k) && !(regras && (k === 'area' || k === 'foto')));
}
// todas as zonas que usam o modelo desenham a versão horizontal (formato "horizontal" ou casa larga):
// o modal abre nela, senão a mudança vai pro normal e não aparece na prancheta
function zonasSoHorizontal(m) {
  const zs = S.proj.pranchetas.flatMap(pr => zonasAbertas(pr).filter(z => z.modelo_card_id === m.id));
  return zs.length > 0 && zs.every(z => {
    const e = z.espaco ?? S.proj.espaco_padrao, n = itensDaLinha(z, 0);
    return usaHorizontal(m, z, (z.w - (n - 1) * e) / n, (z.h - (z.linhas - 1) * e) / z.linhas);
  });
}
function abrirModelo(id) {
  M.zoom = 1;
  M.m = clone(S.proj.modelos_card.find(m => m.id === id)); M.aba = zonasSoHorizontal(M.m) ? 'horizontal' : 'campos'; M.sel = null;
  migrarMolde(M.m);
  M.derivados = {};
  for (const [k, c] of Object.entries(M.m.formatos || {})) M.m['f:' + k] = c;
  delete M.m.formatos;
  prepararPrecoRef();
  Object.assign(HM, novaPilha()); // a pilha do modal começa a cada abertura (Cancelar joga fora)
  $('#modal-overlay').classList.add('open'); renderModelo();
}
// setas movem o campo selecionado no card: 1 pt (Shift: 10 pt), como na prancheta.
// O campo guarda % do card, então o passo em pt vira % do tamanho do card que está na tela.
// Área (e foto) por regras não tem posição própria: as margens é que mandam.
function moverCampoTeclado(e) {
  const passo = e.shiftKey ? 10 : 1, mv = { ArrowLeft: [-passo, 0], ArrowRight: [passo, 0], ArrowUp: [0, -passo], ArrowDown: [0, passo] }[e.key];
  if (mv && ehGrupo(M.sel)) { e.preventDefault(); moverGrupo(M.sel, mv[0], mv[1]); renderModelo(); return; }
  if (mv && ehMulti(M.sel)) { e.preventDefault(); moverPecas(pecasMulti(), mv[0], mv[1]); renderModelo(); return; }
  const c = mv && campoM(M.sel), campos = M.m[M.aba];
  if (!c || c.x == null || ((M.sel === 'area' || M.sel === 'foto') && campos.area && campos.area.modo === 'regras')) return;
  e.preventDefault();
  const card = caixaCardModal();
  c.x = +(c.x + mv[0] / card.w * 100).toFixed(2); c.y = +(c.y + mv[1] / card.h * 100).toFixed(2);
  renderModelo();
}
// clique num campo (na lista ou no card): Shift/Ctrl junta ou tira da seleção; sem tecla, só ele
function selecionarCampo(k, e) {
  if (!(e && (e.shiftKey || e.ctrlKey || e.metaKey)) || !k || ehMulti(k)) { M.sel = k; return; }
  const atual = ehMulti(M.sel) ? M.mult : ehGrupo(M.sel) ? pecasDoGrupo(M.sel) : M.sel ? [M.sel] : [];
  M.mult = alternar(atual, k);
  M.sel = M.mult.length > 1 ? 'm:' : M.mult[0] || null;
}
function caixaCardModal() {
  if (String(M.aba).startsWith('f:')) { const t = tamDaChave(M.aba.slice(2)); return { x: 0, y: 0, w: t.w, h: t.h }; }
  if (M.m.molde && MOLDE_PADRAO[M.aba]) return { x: 0, y: 0, ...MOLDE_PADRAO[M.aba] };
  const c = casaDoModelo(M.m.id, M.aba === 'campos');
  if (M.aba === 'especial') return { x: 0, y: 0, w: c.w * 2 + c.e, h: c.h * 2 + c.e };
  // horizontal: a própria casa, se ela já for larga; senão 2×1 casas (mesma conta do gerador)
  if (M.aba === 'horizontal') return c.w / c.h >= PROPORCAO_HORIZONTAL ? { x: 0, y: 0, w: c.w, h: c.h } : { x: 0, y: 0, w: c.w * 2 + c.e, h: c.h };
  return { x: 0, y: 0, w: c.w, h: c.h };
}
// horizontal = cópia do normal pra começar (as peças ficam esticadas até você rearranjar)
const copiaHorizontal = () => clone(M.m.campos);
// especial = cópia do normal com as letras maiores (o card é 2×2)
function copiaEspecial() {
  const e = clone(M.m.campos);
  for (const c of [...Object.values(e), ...(e.extras || [])]) if (c && c.tamanho) c.tamanho = Math.round(c.tamanho * 1.8);
  return e;
}
let escalaModal = 1;
// o painel do modal é refeito a cada mudança: guarda a rolagem de tudo que rola dentro do modal e devolve
// depois (mexer num número jogava a lista pro topo, Matheus 20/10/2026)
function renderModelo() {
  const modal = $('#modal-overlay');
  const rolados = modal ? [modal, ...modal.querySelectorAll('*')].filter(e => e.scrollTop > 0).map(e => [e.id || null, e.className, e.scrollTop, e]) : [];
  renderModeloCorpo();
  for (const [id, cls, top, e] of rolados) {
    const alvo = e.isConnected ? e : id ? document.getElementById(id) : null;
    if (alvo) alvo.scrollTop = top;
  }
}
function renderModeloCorpo() {
  if (EMB.antesDeDesenhar) EMB.antesDeDesenhar();
  // versão/formato aberto mostra (e guarda) o valor trancado do Normal padrão
  if (M.m && M.aba !== 'campos' && M.m[M.aba] && M.m.travas) {
    const t = comTravas(M.m, M.m[M.aba]);
    if (JSON.stringify(t) !== JSON.stringify(M.m[M.aba])) M.m[M.aba] = t;
  }
  caractere(null);
  pilhaAgenda(HM, modeloAtual);
  const svg = $('#modal-canvas'), card = caixaCardModal(), campos = M.m[M.aba];
  // cabe na área do card (no celular ela é menor que 480×520)
  const mw = $('#modal-canvas-wrap'), cabeW = mw.clientWidth > 64 ? (mw.clientWidth - 32) / card.w : Infinity, cabeH = mw.clientHeight > 64 ? (mw.clientHeight - 32) / card.h : Infinity;
  escalaModal = Math.min(480 / card.w, 520 / card.h, cabeW, cabeH) * (M.zoom || 1);
  svg.setAttribute('viewBox', `0 0 ${card.w} ${card.h}`);
  svg.style.width = card.w * escalaModal + 'px'; svg.style.height = card.h * escalaModal + 'px';
  svg.replaceChildren(); SVG_ATUAL = svg;
  sincronizarNome(campos, card); // caixa do nome = fundo menos as margens
  if (emComSelo()) garantirComSelo(campos, card);
  desenharCard(svg, M.m, campos, card, true, produtoExemplo(M.exIdx || 0), emComSelo(), M.comDe);
  if (ehGrupo(M.sel) && !pecasDoGrupo(M.sel).length) M.sel = null;
  if (ehMulti(M.sel) && pecasMulti().length < 2) M.sel = pecasMulti()[0] || null;
  if (ehMulti(M.sel)) {
    for (const k of pecasMulti()) desenharSelecao(svg, caixaCampoAbs(k), escalaModal, true);
    const u = caixaCampoAbs(M.sel);
    el('rect', { class: 'sel-rect', x: u.x, y: u.y, width: u.w, height: u.h, 'stroke-width': 1 / escalaModal, 'stroke-dasharray': `${4 / escalaModal} ${3 / escalaModal}`, fill: 'none', 'pointer-events': 'none' }, svg);
  } else if (ehGrupo(M.sel)) desenharSelecao(svg, caixaCampoAbs(M.sel), escalaModal, 'cantos');
  else if (M.sel && campoM(M.sel)) desenharSelecao(svg, caixaCampoAbs(M.sel), escalaModal);
  const lista = $('#modal-campos-lista'); lista.replaceChildren();
  const topo = h('div', {});
  form(topo, 'Modelo', [{ rot: 'Nome', k: 'nome' }, { rot: 'Fundo', k: 'fundo_cor', tipo: 'corT' }, { rot: 'Canto', k: 'raio', tipo: 'number' }, ...linhasBorda, ...linhasSombra(M.m),
    { dica: 'O canto do card é sempre nos 4 juntos (o editor estica o card).' },
    { rot: 'Altura mínima do preço', k: 'min_preco_h', tipo: 'number', ph: 'sem', un: 'pt' },
    { dica: 'Em card pequeno, o grupo do preço não fica mais baixo que isso (se couber no card). Formato ajustado à mão fica como você desenhou. O mínimo do título é a regra "Nome mínimo (pt)" do projeto.' },
    ...(M.m.travas && M.m.travas.length ? [{ dica: '🔒 Trancado em todo formato e versão: ' + M.m.travas.join(', ') }] : []),
    { rot: '☆ Salvar o card na biblioteca…', botao: () => dialogoSalvar({ tipo: 'card', modelo: M.m.id }) }], M.m, k => { bordaPadrao(M.m, k); if (k !== 'nome') renderModelo(); });
  const abas = h('div', { class: 'prop-row' },
    h('button', { class: 'btn' + (M.aba === 'campos' ? ' active' : ''), on: { click: () => { M.aba = 'campos'; M.sel = null; renderModelo(); } } }, 'Normal'),
    h('button', { class: 'btn' + (M.aba === 'especial' ? ' active' : ''), on: { click: () => {
      if (!M.m.especial) { M.m.especial = copiaEspecial(); precoRefDaAba('especial', false); }
      M.aba = 'especial'; M.sel = null; renderModelo();
    } } }, M.m.especial ? 'Especial ★' : '+ Especial'));
  if (M.m.especial) abas.append(h('button', { class: 'btn', title: 'Tirar a versão especial', on: { click: () => { if (confirm('Tirar a versão especial deste modelo?')) { delete M.m.especial; M.aba = 'campos'; M.sel = null; renderModelo(); } } } }, '×'));
  abas.append(h('button', { class: 'btn' + (M.aba === 'horizontal' ? ' active' : ''), on: { click: () => {
    if (!M.m.horizontal) { M.m.horizontal = copiaHorizontal(); precoRefDaAba('horizontal'); }
    M.aba = 'horizontal'; M.sel = null; renderModelo();
  } } }, M.m.horizontal ? 'Horizontal ▭' : '+ Horizontal'));
  if (M.m.horizontal) abas.append(h('button', { class: 'btn', title: 'Tirar a versão horizontal', on: { click: () => { if (confirm('Tirar a versão horizontal deste modelo?')) { delete M.m.horizontal; M.aba = 'campos'; M.sel = null; renderModelo(); } } } }, '×'));
  abas.style.flexWrap = 'wrap';
  if (M.m.molde) {
    // os botões de cima são o molde padrão de cada versão; os formatos são os tamanhos deste template
    for (const b of abas.querySelectorAll('button')) {
      const t = b.textContent;
      if (t === 'Normal') b.textContent = `Padrão ${MOLDE_PADRAO.campos.w}×${MOLDE_PADRAO.campos.h}`;
      else if (t.startsWith('Especial')) b.textContent = `Especial ${MOLDE_PADRAO.especial.w}×${MOLDE_PADRAO.especial.h}`;
      else if (t.startsWith('Horizontal')) b.textContent = `Horizontal ${MOLDE_PADRAO.horizontal.w}×${MOLDE_PADRAO.horizontal.h}`;
    }
  }
  lista.append(topo, abas);
  if (M.m.molde) {
    const fs = formatosDoModelo(M.m).filter(f => M.m[f.v]), usados = new Set(fs.map(f => f.k));
    const caixa = h('div', { class: 'formatos' }, h('div', { style: 'font-size:11px;font-weight:600;margin:6px 0 4px' }, 'Formatos deste template'));
    for (const f of fs) {
      const aj = formatoAjustado(f.k), ativo = M.aba === 'f:' + f.k;
      caixa.append(h('button', { class: 'btn' + (ativo ? ' active' : ''), style: 'display:block;width:100%;text-align:left;margin:2px 0',
        title: f.onde.join(' · '), on: { click: () => abrirFormato(f) } },
        `${NOME_VERSAO[f.v]} ${f.w}×${f.h}${f.n ? ` · ${f.n} card${f.n > 1 ? 's' : ''}` : ''} · ${aj ? 'ajustado ●' : 'segue o padrão'}`));
    }
    const sobras = Object.keys(M.m).filter(a => a.startsWith('f:') && !usados.has(a.slice(2)));
    for (const a of sobras) caixa.append(h('div', { class: 'prop-row', style: 'font-size:11px;align-items:center' },
      h('span', { style: 'flex:1' }, `${a.slice(2)} · ajustado, mas não aparece mais nas zonas`),
      h('button', { class: 'btn', title: 'Apagar este formato', on: { click: () => { delete M.m[a]; if (M.aba === a) M.aba = 'campos'; renderModelo(); } } }, '×')));
    if (!fs.length) caixa.append(h('div', { style: 'font-size:11px;color:var(--c-text2)' }, 'Nenhuma zona usa este modelo ainda.'));
    if (fs.filter(f => formatoAjustado(f.k)).length > 1) caixa.append(h('div', { class: 'prop-row' }, h('button', { class: 'btn', style: 'flex:1',
      on: { click: () => {
        if (!confirm('Voltar todos os formatos ao padrão? Os ajustes de cada tamanho são perdidos (desfaz com Ctrl+Z).')) return;
        for (const f of fs) { delete M.m['f:' + f.k]; delete M.derivados[f.k]; }
        if (String(M.aba).startsWith('f:')) M.aba = versaoDaAba(M.aba);
        M.sel = null; renderModelo();
      } } }, 'Voltar todos ao padrão')));
    lista.append(caixa);
    if (String(M.aba).startsWith('f:')) {
      const k = M.aba.slice(2);
      lista.append(h('div', { style: 'font-size:11px;color:var(--c-text2);margin:4px 0' },
        formatoAjustado(k) ? 'Este formato tem desenho próprio: os cards deste tamanho saem dele.' : 'Este formato segue o padrão. Mexa em qualquer coisa pra ele ter desenho próprio.'));
      if (formatoAjustado(k)) lista.append(h('div', { class: 'prop-row' }, h('button', { class: 'btn', style: 'flex:1', on: { click: () => {
        if (!confirm('Voltar este formato ao padrão? O ajuste dele é perdido.')) return;
        delete M.m[M.aba]; delete M.derivados[k]; abrirFormato(tamDaChave(k) && { ...tamDaChave(k), k });
      } } }, 'Voltar ao padrão')));
    }
  }
  // produtos de exemplo: qual deles aparece no card do modelo
  if (S.exemplo && S.exemplo.produtos.length) {
    const n = S.exemplo.produtos.length, i = ((M.exIdx || 0) % n + n) % n, pr = S.exemplo.produtos[i];
    const muda = d => { M.exIdx = i + d; renderModelo(); };
    lista.append(h('div', { class: 'prop-row', style: 'gap:6px;align-items:center' },
      h('button', { class: 'btn', title: 'Produto anterior', on: { click: () => muda(-1) } }, '◀'),
      h('span', { style: 'flex:1;font-size:11px;color:var(--c-text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap', title: pr.nome }, `${i + 1}/${n} · ${pr.nome}`),
      h('button', { class: 'btn', title: 'Próximo produto', on: { click: () => muda(1) } }, '▶')));
  }
  // preço de teste: ver como o grupo do preço se comporta com valores curtos e longos (regra do fundo)
  {
    const pv = v => { M.precoTeste = v; renderModelo(); };
    const inp = h('input', { type: 'text', value: M.precoTeste || '', placeholder: 'outro', style: 'width:64px', on: { change: e => pv(e.target.value.trim() || null) } });
    lista.append(h('div', { class: 'prop-row', style: 'gap:4px;flex-wrap:wrap;align-items:center', title: 'Só a prévia: o template publicado continua com o exemplo' },
      h('span', { style: 'font-size:11px;color:var(--c-text2)' }, 'Preço de teste'),
      ...['9,99', '99,99', '999,99', '9.999,99'].map(v => h('button', { class: 'btn' + (M.precoTeste === v ? ' active' : ''), on: { click: () => pv(M.precoTeste === v ? null : v) } }, v)),
      inp));
  }
  if (M.aba === 'especial' || M.aba === 'horizontal') lista.append(h('div', { class: 'prop-row' }, h('button', { class: 'btn', style: 'flex:1', on: { click: () => {
    if (confirm(`Copiar tudo do card normal pro ${M.aba}? O que você mudou no ${M.aba} é substituído.`)) { M.m[M.aba] = M.aba === 'especial' ? copiaEspecial() : copiaHorizontal(); precoRefDaAba(M.aba, M.aba !== 'especial'); M.sel = null; renderModelo(); }
  } } }, 'Copiar do normal')));
  lista.append(h('div', { style: 'font-size:11px;color:var(--c-text2);margin:4px 0 8px' },
    M.aba === 'especial' ? 'Especial = card 2×2. No editor aparece em "Virar especial". A estrela (★) no nome do modelo quer dizer que ele tem especial.'
      : M.aba === 'horizontal' ? 'Horizontal = card largo e baixo, com as peças no lugar que você quiser. Entra sozinho quando a casa fica larga (2×1, ou linha com poucos produtos) e volta pro normal quando ela estreita. No editor também dá pra escolher em "Virar especial".'
      : zonasSoHorizontal(M.m) ? 'Atenção: as zonas da prancheta usam a versão Horizontal deste modelo. O que mudar aqui no Normal não aparece nelas; edite na aba Horizontal (ou use "Copiar do normal" lá).'
      : String(M.aba).startsWith('f:') ? ''
      : M.m.molde ? `Molde padrão: ${MOLDE_PADRAO.campos.w}×${MOLDE_PADRAO.campos.h} pt, o mesmo card em todos os templates. Os formatos abaixo saem dele (distâncias em pt, tamanho proporcional); abra um pra ver ou ajustar só aquele tamanho.`
      : 'Medidas em pt no card deste tamanho; o card maior (1×2, 2×2) estica junto. No editor o nome fica preso ao topo do card e o preço ao rodapé: nome lá embaixo transborda quando a grade encolhe o card.'));
  // desligar guarda a configuração em campos._guardado (o gerador ignora); ligar devolve como estava
  const guarda = campos._guardado || (campos._guardado = {});
  const desliga = k => { if (campos[k]) { guarda[k] = campos[k]; delete campos[k]; } if (M.sel === k || (k === 'extras' && M.sel && M.sel[0] === 'x')) M.sel = null; };
  const liga = k => { if (!campos[k]) { campos[k] = guarda[k] || clone(camposPadrao()[k]); delete guarda[k]; if (k === 'centavos' && campos.preco) campos.preco.alinhamento = 'end'; } };
  const abertos = M.abertos || (M.abertos = new Set(['produto', 'preco']));
  const ex = campos.extras || [];
  for (const G of GRUPOS) {
    const ks = G.campos || [], ligados = G.extras ? (ex.length ? 1 : 0) : ks.filter(k => campos[k]).length;
    // Preço DE e Selo do clube: o template sempre traz o desenho pro caso do produto ter; a chave só
    // mostra ou esconde no card (como fica o produto com DE / com selo), não liga nem desliga
    const vis = G.id === 'selo' ? 'comSelo' : G.id === 'de' ? 'comDe' : null;
    const on = vis ? ligados > 0 && !!M[vis] : ligados > 0, total = G.extras ? ex.length + (guarda.extras || []).length : ks.length;
    // olho aberto = aparece no card; fechado = escondido (no lugar da chave liga/desliga, pedido do Matheus)
    const chave = h('button', { type: 'button', class: 'chave' + (on ? ' on' : ''),
      title: vis ? (on ? 'Esconder no card (ver o produto sem ' + (vis === 'comDe' ? 'DE' : 'selo') + ')' : 'Mostrar no card como fica o produto com ' + (vis === 'comDe' ? 'DE' : 'selo')) : on ? 'Esconder (tirar do card)' : 'Mostrar (pôr no card)' });
    chave.append(iconeOlho(on));
    chave.addEventListener('click', ev => {
      ev.stopPropagation();
      if (vis) {
        if (!ligados) ks.filter(k => k !== 'selo_rotulo').forEach(liga); // 1ª vez: põe as peças
        M[vis] = !on; if (!on) abertos.add(G.id);
        if (M.sel && (PRECO_KS.includes(M.sel) || SELO_KS.includes(M.sel) || DE_KS.includes(M.sel) || ehGrupo(M.sel) || ehMulti(M.sel))) M.sel = null;
      } else if (G.extras) {
        if (on) { guarda.extras = campos.extras; delete campos.extras; if (M.sel && M.sel[0] === 'x') M.sel = null; }
        else if (guarda.extras) { campos.extras = guarda.extras; delete guarda.extras; }
        else return add('texto');
      } else if (on) ks.forEach(desliga);
      else { ks.forEach(liga); abertos.add(G.id); }
      renderModelo();
    });
    const caixa = h('div', { class: 'grp' + (abertos.has(G.id) ? ' aberto' : '') + ((vis ? ligados > 0 : on) ? '' : ' off') },
      h('div', { class: 'grp-cab', on: { click: () => { abertos.has(G.id) ? abertos.delete(G.id) : abertos.add(G.id); renderModelo(); } } },
        h('span', { class: 'grp-seta' }, '▶'), h('span', { class: 'grp-nome' }, G.rot),
        h('span', { class: 'grp-cont' }, G.extras ? String(ex.length) : `${ligados}/${total}`),
        // seleciona o grupo inteiro pra mover junto (arrastar no card ou setas)
        ...(!G.extras && on ? [h('button', { type: 'button', class: 'grp-mover' + (M.sel === 'g:' + G.id ? ' on' : ''), title: 'Mover o grupo inteiro (arraste no card ou use as setas)',
          on: { click: ev => { ev.stopPropagation(); M.sel = M.sel === 'g:' + G.id ? null : 'g:' + G.id; renderModelo(); } } }, '✥')] : []),
        // guarda o grupo (ou os extras) na biblioteca pra usar em outro card/projeto
        ...(on ? [h('button', { type: 'button', class: 'grp-mover', title: 'Salvar este grupo na biblioteca',
          on: { click: ev => { ev.stopPropagation(); dialogoSalvar(G.extras ? { tipo: 'elementos', modelo: M.m.id, versao: versaoDaAba(M.aba) } : { tipo: 'grupo', modelo: M.m.id, versao: versaoDaAba(M.aba), grupo: G.id }); } } }, '☆')] : []),
        chave));
    const corpo = h('div', { class: 'grp-corpo' });
    if (G.dica) corpo.append(h('div', { style: 'font-size:11px;color:var(--c-text2);margin:0 0 6px' }, G.dica));
    for (const k of ks) {
      const rot = CAMPOS.find(c => c[0] === k)[1];
      const cb = h('input', { type: 'checkbox' }); cb.checked = !!campos[k];
      cb.addEventListener('click', ev => { ev.stopPropagation(); cb.checked ? liga(k) : desliga(k); if (cb.checked) M.sel = k; renderModelo(); });
      corpo.append(h('div', { class: 'campo-item' + (M.sel === k || (ehMulti(M.sel) && M.mult.includes(k)) ? ' active' : ''), on: { click: ev => {
        if (!campos[k]) return;
        // com selo à mostra a peça do preço também se escolhe sozinha (cor/fonte); arrastar move o grupo
        if (precoEmGrupo(k)) M.sel = k;
        else { if (SELO_KS.includes(k)) M.comSelo = true; if (DE_KS.includes(k)) M.comDe = true; selecionarCampo(k, ev); }
        renderModelo();
      } } },
        h('div', { class: 'campo-item-header' }, cb, rot)));
    }
    if (G.extras) {
      ex.forEach((e, i) => corpo.append(h('div', { class: 'campo-item' + (M.sel === 'x' + i || (ehMulti(M.sel) && M.mult.includes('x' + i)) ? ' active' : ''), on: { click: ev => { selecionarCampo('x' + i, ev); renderModelo(); } } },
        h('div', { class: 'campo-item-header' }, { texto: 'T ', retangulo: '□ ', imagem: '⊡ ' }[e.tipo], e.tipo === 'texto' ? e.texto : e.tipo === 'imagem' ? 'Imagem' : 'Forma',
          h('span', { class: 'del', style: 'opacity:.7;margin-left:auto', on: { click: ev => { ev.stopPropagation(); ex.splice(i, 1); if (!ex.length) delete campos.extras; M.sel = null; renderModelo(); } } }, '×')))));
      corpo.append(h('div', { class: 'prop-row' }, ...['texto', 'retangulo', 'imagem'].map(t =>
        h('button', { class: 'btn', style: 'flex:1', on: { click: () => add(t) } }, { texto: '+ Texto', retangulo: '+ Forma', imagem: '+ Imagem' }[t]))));
    }
    caixa.append(corpo);
    lista.append(caixa);
  }
  async function add(tipo) {
    const f = F(), base = { x: 30, y: 40, w: 40, h: 12 };
    const e = tipo === 'texto' ? { tipo, ...base, texto: 'OFERTA', fonte: f, tamanho: 14, cor: '#e30613', alinhamento: 'middle' }
      : tipo === 'retangulo' ? { tipo, ...base, cor: '#ffcc00', raio: 4 } : { tipo, x: 70, y: 3, w: 25, h: 18 };
    if (tipo === 'imagem') { const r = await enviarImagem(); if (!r) return; e.url = r; }
    campos.extras = [...(campos.extras || []), e]; abertos.add('extras'); M.sel = 'x' + (campos.extras.length - 1); renderModelo();
  }

  const pp = $('#modal-campo-props'); pp.replaceChildren();
  if (ehMulti(M.sel)) {
    pp.style.display = '';
    const ks = pecasMulti(), bs = ks.map(caixaCampoAbs), cardM = caixaCardModal();
    const aplica = novas => { ks.forEach((k, i) => { const c = campoM(k); c.x = +(novas[i].x / cardM.w * 100).toFixed(2); c.y = +(novas[i].y / cardM.h * 100).toFixed(2); }); renderModelo(); };
    painelMulti(pp, ks.length, {
      entre: onde => aplica(alinharVarias(bs, onde)),
      rotConjunto: 'no card',
      conjunto: onde => { const u = caixaDe(bs), n = alinhar(u, { x: 0, y: 0, w: cardM.w, h: cardM.h }, onde); aplica(bs.map(b => ({ x: b.x + n.x - u.x, y: b.y + n.y - u.y }))); },
    });
    return;
  }
  if (ehGrupo(M.sel)) {
    // grupo: posição do conjunto em pt (mudar X/Y anda com todas as peças)
    pp.style.display = '';
    const G = GRUPOS.find(g => 'g:' + g.id === M.sel), u = caixaCampoAbs(M.sel), r1 = v => Math.round(v * 10) / 10;
    // preço com o selo à mostra: é o desenho "com selo" (só pro produto com preço do clube) e o Tamanho
    // é em relação ao preço normal; mudar o tamanho prende o canto de baixo à direita (onde o selo apoia)
    const comSelo = M.sel === 'g:preco' && emComSelo(), cs = comSelo && M.m[M.aba].com_selo;
    const escAtual = cs ? Math.round((cs.escala || 1) * 100) : 100;
    const pos = { x: r1(u.x), y: r1(u.y), w: r1(u.w), escala: escAtual, trava: M.m[M.aba].de_trava || 'preco' };
    if (M.sel === 'g:gatilho') pos.ancora = M.m[M.aba].gatilho_ancora || 'auto';
    const trava = M.sel === 'g:de' ? [{ rot: 'Travar em', k: 'trava', tipo: 'select', opcoes: TRAVAS },
      { dica: 'Em que o DE fica preso no editor quando o card muda de tamanho. "Grupo do preço": anda e cresce junto com o preço.' }]
      : M.sel === 'g:gatilho' ? linhasAncoraGatilho() : [];
    form(pp, comSelo ? 'Preço com selo' : 'Grupo ' + G.rot, [
      ...(comSelo ? [{ dica: 'Vale só pro produto com o preço do clube (selo ligado no editor). O preço normal, sem selo, fica como está: esconda o selo (olho) pra ver e mexer nele. Pra mudar cor ou lugar de uma peça só no preço com selo (R$, valor, centavos), dê duplo clique nela ou escolha na lista.' }] : []),
      { dica: `${pecasDoGrupo(M.sel).length} peças juntas: arraste qualquer uma pra mover, puxe um canto pra aumentar ou diminuir tudo na mesma proporção (letras junto), ou use as setas (Shift = 10 pt).` },
      { rot: 'X', k: 'x', tipo: 'number' }, { rot: 'Y', k: 'y', tipo: 'number' },
      { rot: 'Largura', k: 'w', tipo: 'number', un: 'pt' }, { rot: comSelo ? 'Tamanho (do normal)' : 'Tamanho', k: 'escala', tipo: 'number', un: '%' },
      ...(comSelo ? [{ rot: 'Igual ao preço normal (100%)', botao: () => { pos.escala = 100; aplicar('escala'); } }] : []),
      ...trava,
    ], pos, aplicar);
    function aplicar(k) {
      if (k === 'trava') {
        if (pos.trava === 'preco') delete M.m[M.aba].de_trava; else M.m[M.aba].de_trava = pos.trava;
        renderModelo(); return;
      }
      if (k === 'ancora') { mudarAncoraGatilho(pos.ancora); return; }
      if (k === 'x' || k === 'y') moverGrupo(M.sel, k === 'x' ? pos.x - u.x : 0, k === 'y' ? pos.y - u.y : 0);
      // largura nova ou % : o grupo todo muda na mesma proporção, preso no canto de cima à esquerda
      // (com selo: o % é do normal e o canto de baixo à direita fica parado)
      const s = k === 'w' ? pos.w / u.w : k === 'escala' ? pos.escala / escAtual : 0;
      if (s > 0 && isFinite(s)) {
        if (comSelo && k === 'escala') escalarGrupo(baseDoGrupo(M.sel), s, u.x + u.w * (1 - s), u.y + u.h * (1 - s));
        else escalarGrupo(baseDoGrupo(M.sel), s, u.x, u.y);
      }
      renderModelo();
    }
    const cardG = caixaCardModal();
    pp.lastChild.append(linhaAlinhar('no card', onde => {
      const n = alinhar(u, { x: 0, y: 0, w: cardG.w, h: cardG.h }, onde);
      moverGrupo(M.sel, n.x - u.x, n.y - u.y); renderModelo();
    }));
    return;
  }
  const c = campoM(M.sel);
  pp.style.display = c ? '' : 'none';
  if (c) {
    const extra = M.sel[0] === 'x', tipo = extra ? c.tipo : CAMPOS.find(x => x[0] === M.sel)[2];
    const comTexto = ['nome', 'unidade', 'de_rotulo', 'selo_rotulo', 'gatilho', 'limite'].includes(M.sel);
    const linhas = tipo === 'texto' ? [...(extra ? [{ rot: 'Texto', k: 'texto' }] : []), ...linhasTexto(),
      ...(comTexto ? [{ rot: M.sel.endsWith('rotulo') ? 'Texto' : 'Exemplo', k: 'texto_exemplo' }] : []),
      // gatilho: o bloco de linhas fica no meio da caixa por padrão
      { rot: 'Na altura', k: 'alinha_v', tipo: 'select', padrao: M.sel === 'gatilho' ? 'centro' : 'topo', opcoes: [['topo', 'Em cima'], ['centro', 'No meio'], ['baixo', 'Embaixo']] },
      ...(M.sel === 'nome' ? [
        { rot: 'Quebra até', k: 'max_linhas', tipo: 'select', num: true, padrao: '2', opcoes: [['1', '1 linha'], ['2', '2 linhas'], ['3', '3 linhas']] },
        { dica: 'O nome quebra na largura da caixa até esse número de linhas; se ainda não couber, a fonte diminui (nunca abaixo de 15 pt). Enter no nome, no editor, continua mandando na quebra.' }] : []),
      ...(M.sel === 'de_valor' ? [{ rot: 'Riscado', k: 'riscar', tipo: 'check' }] : []),
      ...(M.sel === 'limite' ? [{ rot: 'Dentro do preço', k: 'no_preco', tipo: 'check' },
        { dica: 'O limite entra no grupo do preço, na frente do fundo dele: anda e cresce junto. Suba o fundo do preço pra caber o texto em cima do valor.' }] : []),
      ...linhasSombra(c)]
      : tipo === 'ret' || tipo === 'retangulo' ? [...linhasForma(), ...linhasSombra(c), ...(M.sel === 'preco_fundo' ? linhasRegra(c) : [])]
      : tipo === 'imagem' ? [{ rot: 'Imagem', k: 'url', tipo: 'imagem' }] : [];
    if (M.sel === 'nome_fundo') linhas.push(
      { dica: '— Fundo do nome (tarja atrás do título) —' },
      { rot: 'Regra', k: 'regra', tipo: 'select', opcoes: [['fixo', 'Fixo: o texto se ajusta dentro'], ['estica_encolhe', 'Abraça o texto (até o tamanho desenhado)'], ['estica', 'Abraça e pode crescer até a borda do card']] },
      { dica: 'Margens entre o fundo e o texto (pt). A caixa do nome passa a ser o fundo menos essas margens.' },
      { rot: 'Cima', k: 'margem_t', tipo: 'number', ph: '6', un: 'pt' }, { rot: 'Direita', k: 'margem_r', tipo: 'number', ph: '6', un: 'pt' },
      { rot: 'Baixo', k: 'margem_b', tipo: 'number', ph: '6', un: 'pt' }, { rot: 'Esquerda', k: 'margem_l', tipo: 'number', ph: '6', un: 'pt' },
      ...linhasPreso(c));
    if (M.sel === 'nome' && !campos.nome_fundo) linhas.push(...linhasPreso(c));
    if (M.sel === 'nome' && campos.nome_fundo) linhas.push({ rot: 'Mover o fundo do nome', botao: () => { M.sel = 'nome_fundo'; renderModelo(); } });
    if (M.sel === 'nome' && campos.nome_fundo) linhas.push({ dica: 'Com Fundo do nome ligado, a caixa do nome é o fundo menos as margens: mova ou estique o fundo.' });
    if (M.sel === 'gatilho') linhas.push({ dica: 'Exemplo: "//" quebra a linha (até 2). No editor o texto fica sempre centralizado no card, troca em cada produto e só encolhe se não couber.' });
    if (M.sel === 'moeda_fundo') linhas.push({ dica: 'Forma atrás do R$ (o círculo). No editor ela anda junto com o R$ quando o preço cresce.' });
    if (extra) linhas.push({ dica: `Camada: ${CAMADAS_EXTRA[camadaExtra(c)]}` },
      { rot: 'Trazer pra frente', botao: () => ordenarExtra(1) }, { rot: 'Mandar pra trás', botao: () => ordenarExtra(-1) },
      { dica: 'A ordem do card, de trás pra frente: extras de trás, foto, extras da frente, nome, preço e extras por cima de tudo.' },
      { rot: 'Travar em', k: 'trava', tipo: 'select', opcoes: TRAVAS },
      { dica: 'Em que ele fica preso quando o card muda de tamanho no editor.' });
    if (extra && !c.trava) c.trava = 'auto';
    const titulo = extra ? 'Elemento extra' : CAMPOS.find(x => x[0] === M.sel)[1];
    const regras = M.sel === 'area' || (M.sel === 'foto' && campos.area && campos.area.modo === 'regras');
    if (M.sel === 'area') linhas.push(
      { rot: 'Como funciona', k: 'modo', tipo: 'select', opcoes: [['posicao', 'Posição fixa'], ['regras', 'Por regras (se encaixa sozinha)']] },
      ...(c.modo === 'regras' ? [
        { dica: 'Margens até a borda do card (pt):' },
        { rot: 'Cima', k: 'margem_t', tipo: 'number', ph: '6' }, { rot: 'Direita', k: 'margem_r', tipo: 'number', ph: '6' },
        { rot: 'Baixo', k: 'margem_b', tipo: 'number', ph: '6' }, { rot: 'Esquerda', k: 'margem_l', tipo: 'number', ph: '6' },
        { rot: 'Respeita o nome', k: 'resp_nome', tipo: 'check' },
        { rot: 'Respeita o preço embaixo', k: 'resp_preco_baixo', tipo: 'check' },
        { rot: 'Respeita o preço em cima', k: 'resp_preco_cima', tipo: 'check', padrao: false },
        { rot: 'Espaço do nome/preço', k: 'espaco', tipo: 'number', ph: '6', un: 'pt' },
      ] : []));
    if (M.sel === 'foto' && regras) linhas.push({ dica: 'A área está por regras: a foto ocupa a área inteira.' },
      { rot: 'Editar as regras da área', botao: () => { M.sel = 'area'; renderModelo(); } });
    if (precoEmGrupo(M.sel)) {
      const cs = M.m[M.aba].com_selo, temAj = cs && cs.pecas && cs.pecas[M.sel] && Object.keys(cs.pecas[M.sel]).length;
      linhas.unshift({ dica: 'Preço com selo: cor, cor da borda e lugar desta peça valem só pro produto com selo. Fonte e tamanho valem pros dois.' },
        ...(temAj ? [{ rot: 'Igual ao sem selo', botao: () => { delete cs.pecas[M.sel]; renderModelo(); } }] : []));
    }
    form(pp, titulo, linhas, c, k => { if (k === 'trava' && c.trava === 'auto') delete c.trava; bordaPadrao(c, k); renderModelo(); },
      extra ? null : { campo: M.sel, m: M.m, base: M.aba === 'campos' });
    if ((M.sel === 'area' || M.sel === 'foto') && campos.area) pp.lastChild.append(seletorFotoAlinha(campos.area, renderModelo));
    if (GATILHO_KS.includes(M.sel)) {
      const o = { ancora: campos.gatilho_ancora || 'auto' };
      form(pp, 'Gatilho no card', linhasAncoraGatilho(), o, () => mudarAncoraGatilho(o.ancora));
    }
    if (regras && (M.sel === 'foto' || c.modo === 'regras')) return;
    const card = caixaCardModal(), r1 = v => Math.round(v * 10) / 10;
    const emPt = { x: r1(c.x / 100 * card.w), y: r1(c.y / 100 * card.h), w: r1(c.w / 100 * card.w), h: r1(c.h / 100 * card.h) };
    form(pp, 'Posição e tamanho', linhasCaixa, emPt, k => {
      const base = k === 'x' || k === 'w' ? card.w : card.h;
      if (emPt[k] != null) c[k] = +(emPt[k] / base * 100).toFixed(2);
      renderModelo();
    });
    pp.lastChild.append(linhaAlinhar('no card', onde => {
      const b = caixaCampoAbs(M.sel), n = alinhar(b, { x: 0, y: 0, w: card.w, h: card.h }, onde);
      c.x = +(n.x / card.w * 100).toFixed(2); c.y = +(n.y / card.h * 100).toFixed(2); renderModelo();
    }));
  }
}

// "Segue no card" do gatilho (vai como data-ancora-v na tarja e no texto)
const linhasAncoraGatilho = () => [{ rot: 'Segue no card', k: 'ancora', tipo: 'select', opcoes: ANCORAS_GATILHO },
  { dica: 'Altura do card que o gatilho acompanha no editor quando o card muda de tamanho. Na largura ele fica sempre no meio (a tarja estica).' }];
function mudarAncoraGatilho(v) {
  if (!v || v === 'auto') delete M.m[M.aba].gatilho_ancora; else M.m[M.aba].gatilho_ancora = v;
  renderModelo();
}

// ---------------------------------------------------------------- alinhar (no card ou na prancheta)
/** Caixa b encostada/centralizada dentro de dentro: 'esq'|'centroH'|'dir' mexe x; 'topo'|'meio'|'fundo' mexe y. */
function alinhar(b, dentro, onde) {
  const n = { x: b.x, y: b.y };
  if (onde === 'esq') n.x = dentro.x;
  if (onde === 'centroH') n.x = dentro.x + (dentro.w - b.w) / 2;
  if (onde === 'dir') n.x = dentro.x + dentro.w - b.w;
  if (onde === 'topo') n.y = dentro.y;
  if (onde === 'meio') n.y = dentro.y + (dentro.h - b.h) / 2;
  if (onde === 'fundo') n.y = dentro.y + dentro.h - b.h;
  return n;
}
const ICONES_ALINHA = [
  ['esq', 'Encostar à esquerda', 'M3 2v16M7 6h10v3H7zM7 11h6v3H7z'],
  ['centroH', 'Centralizar na horizontal', 'M10 2v16M4 6h12v3H4zM6 11h8v3H6z'],
  ['dir', 'Encostar à direita', 'M17 2v16M3 6h10v3H3zM7 11h6v3H7z'],
  ['topo', 'Encostar em cima', 'M2 3h16M6 7v10h3V7zM11 7v6h3V7z'],
  ['meio', 'Centralizar na vertical', 'M2 10h16M6 4v12h3V4zM11 6v8h3V6z'],
  ['fundo', 'Encostar embaixo', 'M2 17h16M6 3v10h3V3zM11 7v6h3V7z'],
];
/** Linha com os 6 botões de alinhar (ícones como os do Illustrator). */
function linhaAlinhar(rotulo, aoAlinhar) {
  const botoes = ICONES_ALINHA.map(([k, titulo, d]) => {
    const b = h('button', { type: 'button', class: 'car-tog', title: `${titulo} ${rotulo}`, style: 'flex:1', on: { click: () => aoAlinhar(k) } });
    const sv = el('svg', { viewBox: '0 0 20 20', width: 16, height: 16, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5 }); el('path', { d }, sv); b.append(sv);
    return b;
  });
  return h('div', { class: 'prop-row', style: 'grid-column:1/-1;gap:3px' }, h('label', { title: 'Alinhar ' + rotulo }, 'Alinhar'), ...botoes);
}
// ---------------------------------------------------------------- seleção múltipla (prancheta e card)
const ehMulti = k => k === 'm:';
/** Caixa que envolve todas. */
function caixaDe(bs) {
  if (!bs.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x0 = Math.min(...bs.map(b => b.x)), y0 = Math.min(...bs.map(b => b.y));
  return { x: x0, y: y0, w: Math.max(...bs.map(b => b.x + b.w)) - x0, h: Math.max(...bs.map(b => b.y + b.h)) - y0 };
}
/** Shift/Ctrl + clique: junta ou tira `id` da seleção atual (lista); devolve a lista nova. */
function alternar(lista, id) { return lista.includes(id) ? lista.filter(x => x !== id) : [...lista, id]; }
/** Novas posições (x, y) de cada caixa: alinhar entre elas ('esq'…'fundo') ou distribuir ('distH'/'distV'). */
function alinharVarias(bs, onde) {
  const u = caixaDe(bs);
  if (onde === 'distH' || onde === 'distV') {
    const H = onde === 'distH', ord = bs.map((b, i) => ({ b, i })).sort((a, c) => H ? a.b.x - c.b.x : a.b.y - c.b.y);
    const ocupado = ord.reduce((t, o) => t + (H ? o.b.w : o.b.h), 0), vao = ((H ? u.w : u.h) - ocupado) / Math.max(1, bs.length - 1);
    const out = bs.map(b => ({ x: b.x, y: b.y }));
    let pos = H ? u.x : u.y;
    for (const o of ord) { if (H) out[o.i].x = pos; else out[o.i].y = pos; pos += (H ? o.b.w : o.b.h) + vao; }
    return out;
  }
  return bs.map(b => alinhar(b, u, onde));
}
const ICONES_DIST = [
  ['distH', 'Distribuir na horizontal (mesmo espaço entre eles)', 'M2 3v14M18 3v14M7 6h6v8H7z'],
  ['distV', 'Distribuir na vertical (mesmo espaço entre eles)', 'M3 2h14M3 18h14M6 7v6h8V7z'],
];
/** Painel da seleção múltipla: alinhar entre eles, alinhar o conjunto e distribuir. */
function painelMulti(alvo, n, { entre, conjunto, rotConjunto, apagar }) {
  form(alvo, `${n} itens selecionados`, [
    { dica: 'Shift ou Ctrl + clique junta ou tira um item. Arraste qualquer um pra mover todos; setas movem 1 pt (Shift = 10 pt).' },
    ...(apagar ? [{ rot: 'Apagar os ' + n, botao: apagar }] : []),
  ], {}, () => {});
  const sec = alvo.querySelector('.prop-section:last-child');
  sec.append(linhaAlinhar('entre eles', entre));
  const botoes = ICONES_DIST.map(([k, titulo, d]) => {
    const b = h('button', { type: 'button', class: 'car-tog', title: titulo, style: 'flex:1', on: { click: () => entre(k) } });
    const sv = el('svg', { viewBox: '0 0 20 20', width: 16, height: 16, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5 }); el('path', { d }, sv); b.append(sv);
    return b;
  });
  sec.append(h('div', { class: 'prop-row', style: 'grid-column:1/-1;gap:3px' }, h('label', {}, 'Distribuir'), ...botoes));
  sec.append(linhaAlinhar(rotConjunto, conjunto));
}
const r1 = v => +(+v).toFixed(1);

// ---------------------------------------------------------------- grupo inteiro (Preço, Preço DE, Selo, Produto)
// M.sel = 'g:<id do grupo>': a caixa é a soma das peças ligadas; mover anda com todas juntas (sem
// mudar tamanho). Área e foto por regras ficam de fora: a posição delas vem das margens.
const ehGrupo = k => typeof k === 'string' && k.startsWith('g:');
function pecasDoGrupo(k) {
  const G = GRUPOS.find(g => 'g:' + g.id === k), campos = camposVista();
  if (!G || !G.campos) return [];
  const regras = campos.area && campos.area.modo === 'regras';
  return G.campos.filter(c => campos[c] && !(regras && (c === 'area' || c === 'foto')));
}
function moverGrupo(k, dxPt, dyPt) {
  if (k === 'g:preco' && emComSelo()) {
    const c = M.m[M.aba], card = caixaCardModal(); garantirComSelo(c, card);
    c.com_selo.x = +(c.com_selo.x + dxPt / card.w * 100).toFixed(2); c.com_selo.y = +(c.com_selo.y + dyPt / card.h * 100).toFixed(2);
    return;
  }
  moverPecas(pecasDoGrupo(k), dxPt, dyPt);
}
function moverPecas(ks, dxPt, dyPt) {
  const card = caixaCardModal();
  for (const k of ks) { const c = campoM(k); c.x = +(c.x + dxPt / card.w * 100).toFixed(2); c.y = +(c.y + dyPt / card.h * 100).toFixed(2); }
}
// foto do grupo antes de esticar: a conta parte sempre dela (sem acumular arredondamento a cada pixel)
function baseDoGrupo(k) {
  if (k === 'g:preco' && emComSelo()) { garantirComSelo(M.m[M.aba], caixaCardModal()); return { k, u: caixaCampoAbs(k), selo: { ...M.m[M.aba].com_selo } }; }
  return { k, u: caixaCampoAbs(k), campos: Object.fromEntries(pecasDoGrupo(k).map(c => [c, clone(M.m[M.aba][c])])) };
}
// medidas em pt que crescem junto com o grupo (fonte, contorno, canto, respiro e margens do fundo do preço)
const MEDIDAS_PT = ['tamanho', 'borda', 'raio', 'respiro', 'largura_max', 'margem_t', 'margem_r', 'margem_b', 'margem_l'];
/** Grupo inteiro na escala s, com o canto (ax, ay) parado: posição, tamanho e letras de cada peça. */
function escalarGrupo(base, s, ax, ay) {
  const card = caixaCardModal(), campos = M.m[M.aba], u = base.u, r = v => +v.toFixed(2);
  // preço com selo: só o lugar e o tamanho do grupo (o desenho das peças é o do normal)
  if (base.selo) { campos.com_selo = { x: r(ax / card.w * 100), y: r(ay / card.h * 100), escala: +(base.selo.escala * s).toFixed(4) }; return; }
  for (const [c, o] of Object.entries(base.campos)) {
    const x = o.x / 100 * card.w, y = o.y / 100 * card.h, w = o.w / 100 * card.w, h = o.h / 100 * card.h;
    const n = { ...o, x: r((ax + (x - u.x) * s) / card.w * 100), y: r((ay + (y - u.y) * s) / card.h * 100), w: r(w * s / card.w * 100), h: r(h * s / card.h * 100) };
    for (const m of MEDIDAS_PT) if (typeof o[m] === 'number') n[m] = Math.round(o[m] * s * 10) / 10;
    campos[c] = n;
  }
}
function caixaCampoAbs(k) {
  if (ehMulti(k)) return caixaDe(pecasMulti().map(caixaCampoAbs));
  if (ehGrupo(k)) {
    const bs = pecasDoGrupo(k).map(caixaCampoAbs);
    if (!bs.length) return { x: 0, y: 0, w: 0, h: 0 };
    const x0 = Math.min(...bs.map(b => b.x)), y0 = Math.min(...bs.map(b => b.y));
    return { x: x0, y: y0, w: Math.max(...bs.map(b => b.x + b.w)) - x0, h: Math.max(...bs.map(b => b.y + b.h)) - y0 };
  }
  const card = caixaCardModal(), c = campoM(k);
  const rg = (k === 'area' || k === 'foto') && areaPorRegra(M.m[M.aba], card);
  if (!c) return { x: 0, y: 0, w: 0, h: 0 };
  if (rg) return rg; // por regras: mostra a área calculada
  return { x: c.x / 100 * card.w, y: c.y / 100 * card.h, w: c.w / 100 * card.w, h: c.h / 100 * card.h };
}
// o modelo como ele é gravado (formatos que só seguem o padrão saem). Muda o M.m
function modeloFinal() {
  devolverPrecoOrig();
  const formatos = {};
  for (const a of Object.keys(M.m)) if (a.startsWith('f:')) {
    const k = a.slice(2), c = M.m[a]; delete M.m[a];
    if (M.derivados && M.derivados[k] != null && fotoPreco(c) === M.derivados[k]) continue;
    formatos[k] = c;
  }
  if (Object.keys(formatos).length) M.m.formatos = formatos; else delete M.m.formatos;
  return M.m;
}
function salvarModelo() {
  modeloFinal();
  const i = S.proj.modelos_card.findIndex(m => m.id === M.m.id);
  S.proj.modelos_card[i] = M.m; S.sujo = true;
  $('#modal-overlay').classList.remove('open'); caractere(null); tudo();
}

// ---------------------------------------------------------------- projeto: novo / abrir / salvar / publicar
// cliente: <select> com as pastas do Somado Tarefas, por espaço (valor = folderId)
function seletorCliente(atual) {
  const sel = h('select', {}, h('option', { value: '' }, 'Escolha a pasta do cliente…'));
  const porEspaco = new Map();
  for (const c of S.clientes) { if (!porEspaco.has(c.espaco)) porEspaco.set(c.espaco, []); porEspaco.get(c.espaco).push(c); }
  for (const [esp, cs] of porEspaco) sel.append(h('optgroup', { label: esp }, ...cs.map(c => h('option', { value: c.folderId }, (c.rotulo && c.rotulo !== c.nome ? c.rotulo + ' → ' + c.nome : c.nome) + (c.temDrive ? '' : ' (pasta no Drive será criada)')))));
  if (atual) sel.value = atual;
  return sel;
}
const clientePorPasta = id => S.clientes.find(c => c.folderId === id) || null;

async function criarProjeto() {
  const nome = $('#pf-nome').value.trim(), tema = $('#pf-tema').value.trim(), cli = clientePorPasta($('#pf-cliente').value);
  if (!nome || !cli || !tema) return alert('Preencha nome, cliente e tema.');
  // "Começar de" uma estrutura da biblioteca: o servidor monta o projeto a partir dela
  const estruturaId = $('#pf-estrutura') && $('#pf-estrutura').value;
  const proj = estruturaId ? { estruturaId, nome, cliente: cli.nome, folderId: cli.folderId, tema } : {
    versao: 1, nome, cliente: cli.nome, folderId: cli.folderId, tema, tamanho: { w: +$('#pf-w').value || 1080, h: +$('#pf-h').value || 1350 }, espaco_padrao: +$('#pf-espaco').value || 4,
    modelos_card: [], pranchetas: [{ id: uid('pr'), nome: 'Capa', fundo: { tipo: 'cor', cor: '#ffffff' }, elementos: [], zonas: [] }],
  };
  carregando(true);
  try { S.proj = await api('', { method: 'POST', body: JSON.stringify(proj) }); } finally { carregando(false); }
  S.pi = 0; S.sel = null; S.sujo = false;
  $('#proj-modal').classList.remove('open');
  await carregarBlocos(); tudo();
  // da estrutura: já pede as imagens que mudam a cada tema (selo, elemento lateral, fundo…)
  if (estruturaId && S.blocos.some(b => b.por_tema)) abrirBlocos({ tema: true });
}
async function abrirProjeto(id) {
  S.proj = await api('/' + id); S.pi = 0; S.sel = null; S.sujo = false; $('#abrir-modal').style.display = 'none';
  S.exemplo = null; botaoExemplo();
  await carregarBlocos(); tudo();
  // a edição de exemplo escolhida pra este projeto volta junto
  let ex = null; try { ex = localStorage.getItem(chaveExemplo()); } catch { /* sem storage */ }
  if (ex) carregarExemplo(ex);
}
// "Abrir projeto": agrupado por cliente (a pasta do Somado Tarefas), com busca, duplicar e apagar
async function abrirLista() {
  const lst = await api('');
  const box = $('#abrir-lista'); box.replaceChildren();
  const busca = h('input', { placeholder: 'Buscar por cliente, tema ou nome…', style: 'width:100%;margin-bottom:8px;height:30px;background:var(--c-campo);border:1px solid var(--c-campo-borda);border-radius:4px;color:var(--c-text);padding:0 8px' });
  const lista = h('div', {});
  const desenha = () => {
    lista.replaceChildren();
    const t = busca.value.trim().toLowerCase();
    const vis = lst.filter(p => !t || `${p.cliente} ${p.tema} ${p.nome}`.toLowerCase().includes(t));
    if (!vis.length) lista.append(h('div', { style: 'padding:12px;color:var(--c-text2)' }, lst.length ? 'Nada com essa busca.' : 'Nenhum projeto ainda.'));
    const porCli = new Map();
    for (const p of vis) { if (!porCli.has(p.cliente)) porCli.set(p.cliente, []); porCli.get(p.cliente).push(p); }
    for (const [cli, ps] of porCli) {
      lista.append(h('div', { class: 'sb-header', style: 'padding:10px 8px 4px' }, cli));
      for (const p of ps) lista.append(h('div', { class: 'sb-item', on: { click: () => abrirProjeto(p.id) } },
        h('span', {}, h('b', {}, p.tema), ` · ${p.nome}`),
        h('span', { class: 'del', title: 'Duplicar (outro cliente ou outro tema)', style: 'margin-left:auto', on: { click: ev => { ev.stopPropagation(); dialogoDuplicar(p); } } }, '⧉'),
        h('span', { class: 'del', title: 'Apagar', style: 'margin-left:6px', on: { click: async ev => {
          ev.stopPropagation(); if (!confirm(`Apagar o projeto "${p.nome}"? (o template já publicado continua na pasta)`)) return;
          await api('/' + p.id, { method: 'DELETE' }); abrirLista();
        } } }, '×')));
    }
  };
  busca.addEventListener('input', desenha);
  box.append(busca, lista); desenha();
  $('#abrir-modal').style.display = 'flex';
  busca.focus();
}

// duplicar: pra outro cliente (mesmo tema) ou pro mesmo cliente com outro tema
function dialogoDuplicar(p) {
  const fundo = h('div', { style: 'position:fixed;inset:0;background:#0008;z-index:250;display:flex;align-items:center;justify-content:center' });
  const cli = seletorCliente(p.folderId || (S.clientes.find(c => c.nome === p.cliente) || {}).folderId);
  const tema = h('input', { value: p.tema }), nome = h('input', { value: p.nome });
  const fechar = () => fundo.remove();
  const ok = h('button', { class: 'btn primary', on: { click: async () => {
    const c = clientePorPasta(cli.value);
    if (!c || !tema.value.trim() || !nome.value.trim()) return alert('Escolha o cliente e preencha tema e nome.');
    if (c.nome === p.cliente && tema.value.trim() === p.tema && nome.value.trim() === p.nome) return alert('Mude o cliente, o tema ou o nome.');
    if (S.proj && S.proj.id === p.id && S.sujo) await salvar();
    carregando(true);
    try {
      const n = await api('/' + p.id + '/duplicar', { method: 'POST', body: JSON.stringify({ cliente: c.nome, folderId: c.folderId, tema: tema.value.trim(), nome: nome.value.trim() }) });
      fechar(); await abrirProjeto(n.id);
    } catch (e) { alert('Não duplicou: ' + e.message); } finally { carregando(false); }
  } } }, 'Duplicar');
  fundo.append(h('div', { class: 'dlg-duplicar', style: 'background:var(--c-panel);border:1px solid #111;border-radius:8px;padding:20px;width:min(420px,92vw)' },
    h('h2', { style: 'font-size:14px;margin-bottom:14px' }, `Duplicar "${p.nome}"`),
    h('div', { class: 'prop-row' }, h('label', {}, 'Cliente'), cli),
    h('div', { class: 'prop-row' }, h('label', {}, 'Tema'), tema),
    h('div', { class: 'prop-row' }, h('label', {}, 'Nome'), nome),
    h('div', { style: 'font-size:11px;color:var(--c-text2);margin:4px 0 10px' }, 'Sai uma cópia independente, com as imagens. Publicar grava na pasta TEMPLATES/<tema> do cliente escolhido.'),
    h('div', { style: 'display:flex;gap:8px;justify-content:flex-end' }, h('button', { class: 'btn', on: { click: fechar } }, 'Cancelar'), ok)));
  document.body.append(fundo);
}

// copiar/colar modelo de card entre projetos: a "área de transferência" fica no navegador
const CLIP = 'construtor-modelo-copiado';
function lerClipModelo() { try { return JSON.parse(localStorage.getItem(CLIP) || 'null'); } catch { return null; } }
async function copiarModeloClip(m) {
  if (S.sujo) await salvar(); // o servidor copia do projeto salvo
  try { localStorage.setItem(CLIP, JSON.stringify({ projetoId: S.proj.id, projetoNome: S.proj.nome, modeloId: m.id, nome: m.nome })); } catch { return alert('O navegador não deixou guardar a cópia.'); }
  listas();
}
// sobre = id do modelo deste projeto que recebe o estilo copiado (sem ele, entra um modelo novo)
async function colarModeloClip(sobre) {
  const c = lerClipModelo(); if (!c || !S.proj) return;
  if (typeof sobre !== 'string') sobre = undefined;
  if (S.sujo) await salvar();
  carregando(true);
  try {
    const r = await api('/' + S.proj.id + '/copiar-modelo', { method: 'POST', body: JSON.stringify({ de: c.projetoId, modeloId: c.modeloId, sobre }) });
    S.proj = r.projeto; S.sujo = false; tudo();
  } catch (e) { alert('Não colou: ' + e.message); } finally { carregando(false); }
}
async function salvar() {
  if (!S.proj || EMB.on) return; // embutido: o projeto aberto é o publicado + o ajuste da edição
  carregando(true);
  try { S.proj = await api('/' + S.proj.id, { method: 'PUT', body: JSON.stringify(S.proj) }); S.sujo = false; render(); }
  finally { carregando(false); }
}
async function publicar() {
  if (!S.proj || EMB.on) return;
  if (S.proj.pranchetas.every(p => !p.zonas.length)) return alert('Coloque pelo menos uma zona de grade antes de publicar.');
  await salvar();
  carregando(true);
  try {
    const r = await api('/' + S.proj.id + '/publicar', { method: 'POST' });
    // o editor de encarte aberto neste template ("Editar template") recarrega sozinho
    try { new BroadcastChannel('smd-encarte-template').postMessage({ tipo: 'publicado', projeto: S.proj.id }); } catch { /* navegador sem BroadcastChannel */ }
    alert(`Publicado em:\n${r.pasta}\n\n${r.arquivos.join('\n')}\n\nJá aparece na lista de templates do editor de encarte.`);
  } catch (e) { alert('Não publicou: ' + e.message); }
  finally { carregando(false); }
}

// Zoom e mover a vista no card do modal (Matheus, 20/10/2026): roda do mouse = zoom no ponto do mouse;
// arrastar no fundo cinza, com o botão do meio ou segurando espaço = mover; no celular, pinça = zoom e
// um dedo no fundo cinza ou dois dedos = mover. Botões − / % / + / Ajustar no canto.
function zoomModal(z, cx, cy) {
  const wrap = $('#modal-canvas-wrap'), svg = $('#modal-canvas'), r0 = svg.getBoundingClientRect();
  if (cx == null) { const w = wrap.getBoundingClientRect(); cx = w.left + w.width / 2; cy = w.top + w.height / 2; }
  const fx = r0.width ? (cx - r0.left) / r0.width : 0.5, fy = r0.height ? (cy - r0.top) / r0.height : 0.5;
  M.zoom = Math.max(0.25, Math.min(8, z));
  renderModelo();
  const r1 = svg.getBoundingClientRect();
  wrap.scrollLeft += r1.left + fx * r1.width - cx; wrap.scrollTop += r1.top + fy * r1.height - cy;
  const v = $('#mz-val'); if (v) v.textContent = Math.round(M.zoom * 100) + '%';
}
function ligarZoomModal() {
  const wrap = $('#modal-canvas-wrap');
  // card maior que a área: margin auto centraliza quando cabe e deixa rolar pros dois lados quando não cabe
  wrap.style.alignItems = 'flex-start'; wrap.style.justifyContent = 'flex-start'; wrap.style.position = 'relative'; wrap.style.touchAction = 'none';
  $('#modal-canvas').style.margin = 'auto'; $('#modal-canvas').style.flex = 'none';
  const barra = h('div', { id: 'mz-barra', style: 'position:sticky;left:8px;bottom:8px;align-self:flex-end;z-index:5;display:flex;gap:4px;background:var(--c-surface,#222);border:1px solid var(--c-border,#333);border-radius:8px;padding:3px;margin-left:-200px;order:2' },
    h('button', { class: 'btn', title: 'Menos zoom', on: { click: () => zoomModal((M.zoom || 1) / 1.25) } }, '−'),
    h('span', { id: 'mz-val', style: 'min-width:44px;text-align:center;font-size:12px;align-self:center' }, '100%'),
    h('button', { class: 'btn', title: 'Mais zoom', on: { click: () => zoomModal((M.zoom || 1) * 1.25) } }, '+'),
    h('button', { class: 'btn', title: 'Caber na área', on: { click: () => { M.zoom = 1; renderModelo(); $('#mz-val').textContent = '100%'; } } }, 'Ajustar'));
  wrap.append(barra); // no rodapé, pra não cobrir o nome no topo do card
  wrap.addEventListener('wheel', e => {
    if (!M.m) return;
    e.preventDefault();
    zoomModal((M.zoom || 1) * Math.exp(-Math.max(-100, Math.min(100, e.deltaY)) * 0.002), e.clientX, e.clientY);
  }, { passive: false });
  let espaco = false;
  document.addEventListener('keydown', e => {
    if (e.key !== ' ' || !$('#modal-overlay').classList.contains('open') || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    e.preventDefault(); if (!espaco) { espaco = true; wrap.style.cursor = 'grab'; }
  });
  document.addEventListener('keyup', e => { if (e.key === ' ') { espaco = false; wrap.style.cursor = ''; } });
  const toques = new Map(); let pinca = null, pan = null;
  const noFundo = t => !(t.closest && (t.closest('#modal-canvas') || t.closest('#mz-barra')));
  wrap.addEventListener('pointerdown', e => {
    if (!M.m || (e.target.closest && e.target.closest('#mz-barra'))) return;
    toques.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (toques.size === 2) {
      const [a, b] = [...toques.values()];
      pinca = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: M.zoom || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; pan = null;
      e.preventDefault(); e.stopPropagation(); return;
    }
    if (espaco || e.button === 1 || (e.button === 0 && noFundo(e.target))) {
      pan = { x: e.clientX, y: e.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop };
      wrap.style.cursor = 'grabbing';
      e.preventDefault(); // sem isso o arraste seleciona o texto do painel
      if (espaco || e.button === 1) e.stopPropagation();
    }
  }, true);
  window.addEventListener('pointermove', e => {
    if (!toques.has(e.pointerId)) return;
    toques.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinca && toques.size >= 2) {
      e.stopPropagation();
      const [a, b] = [...toques.values()], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      zoomModal(pinca.z0 * Math.hypot(a.x - b.x, a.y - b.y) / pinca.d0, mx, my);
      wrap.scrollLeft -= mx - pinca.mx; wrap.scrollTop -= my - pinca.my; pinca.mx = mx; pinca.my = my;
    } else if (pan) { wrap.scrollLeft = pan.sl - (e.clientX - pan.x); wrap.scrollTop = pan.st - (e.clientY - pan.y); }
  }, true);
  const solta = e => { toques.delete(e.pointerId); if (toques.size < 2) pinca = null; if (!toques.size) { pan = null; wrap.style.cursor = espaco ? 'grab' : ''; } };
  window.addEventListener('pointerup', solta, true);
  window.addEventListener('pointercancel', solta, true);
}

// ---------------------------------------------------------------- início
async function iniciar() {
  // o card do modal é SVG (o HTML veio com <canvas>)
  const novo = el('svg', { id: 'modal-canvas' });
  novo.style.background = 'repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 0 0 / 16px 16px'; // xadrez: mostra o transparente
  $('#modal-canvas').replaceWith(novo);
  $('#modal-add-campo').remove();
  // novo projeto: tamanho em px com as predefinições
  $('#pf-w').value = 1080; $('#pf-h').value = 1350;
  const pre = h('select', {}, ...TAMANHOS.map(([v, r]) => h('option', { value: v }, r)), h('option', { value: '' }, 'Personalizado'));
  pre.addEventListener('input', () => { if (pre.value) { const [w, hh] = pre.value.split('x'); $('#pf-w').value = w; $('#pf-h').value = hh; } });
  $('#pf-w').closest('.prop-row').before(h('div', { class: 'prop-row' }, h('label', {}, 'Tamanho'), pre));

  $('#btn-novo-proj').onclick = () => $('#proj-modal').classList.add('open');
  $('#btn-abrir-proj').onclick = abrirLista;
  $('#btn-salvar').onclick = salvar;
  $('#btn-publicar').onclick = publicar;
  $('#btn-nova-prancheta').onclick = () => S.proj && novaPrancheta();
  $('#btn-novo-modelo').onclick = () => { if (S.proj) { const m = modeloNovo(); listas(); abrirModelo(m.id); } };
  $('#pf-criar').onclick = criarProjeto;
  $('#pf-cancelar').onclick = () => $('#proj-modal').classList.remove('open');
  $('#abrir-cancelar').onclick = () => { $('#abrir-modal').style.display = 'none'; };
  $('#modal-cancelar').onclick = () => { $('#modal-overlay').classList.remove('open'); caractere(null); props(); };
  $('#modal-salvar').onclick = salvarModelo;
  for (const b of document.querySelectorAll('[data-tool]')) b.onclick = () => { if (!S.proj) return; S.tool = b.dataset.tool; S.sel = null; tudo(); };
  // painéis da barra de ícones: cada um abre/fecha; a coluna aparece quando tem algum aberto
  const abrirPainel = (nome, on) => {
    const sec = $('#painel-' + nome); sec.classList.toggle('aberto', on);
    document.querySelector(`[data-painel="${nome}"]`).classList.toggle('aberto', on);
    $('#sidebar').classList.toggle('aberto', !!document.querySelector('#sidebar .sb-section.aberto'));
    try { localStorage.setItem('construtor-paineis', JSON.stringify([...document.querySelectorAll('#sidebar .sb-section.aberto')].map(e => e.id))); } catch { /* sem storage */ }
    if (S.proj) render();
  };
  for (const b of document.querySelectorAll('[data-painel]')) b.onclick = () => abrirPainel(b.dataset.painel, !$('#painel-' + b.dataset.painel).classList.contains('aberto'));
  // no celular os painéis abrem por cima da tela: começam fechados e fecham ao tocar na tela
  const CELULAR = matchMedia('(max-width: 768px)');
  if (!CELULAR.matches) try { for (const id of JSON.parse(localStorage.getItem('construtor-paineis') || '["painel-pranchetas"]')) abrirPainel(id.replace('painel-', ''), true); } catch { abrirPainel('pranchetas', true); }
  const fecharPaineisCelular = () => {
    if (!CELULAR.matches || !$('#sidebar').classList.contains('aberto')) return;
    for (const el of document.querySelectorAll('#sidebar, #sidebar .aberto, [data-painel].aberto')) el.classList.remove('aberto');
    render();
  };
  $('#canvas-wrap').addEventListener('pointerdown', fecharPaineisCelular, true);
  // escolher uma prancheta ou um modelo na lista também fecha (o × de apagar não)
  $('#sidebar').addEventListener('click', e => { if (e.target.closest('.sb-item') && !e.target.closest('.del')) fecharPaineisCelular(); });
  window.addEventListener('resize', () => S.proj && render());
  // a roda do mouse (e a pinça do trackpad) dá zoom no ponto do mouse
  const wrap = $('#canvas-wrap');
  wrap.addEventListener('wheel', e => {
    if (!S.proj) return;
    e.preventDefault();
    aplicarZoom(zoom * Math.exp(-Math.max(-100, Math.min(100, e.deltaY)) * 0.002), e.clientX, e.clientY);
  }, { passive: false });
  // mover a vista: segurar espaço e arrastar, ou arrastar com o botão do meio (como no Photoshop)
  let espaco = false;
  document.addEventListener('keydown', e => {
    if (e.key !== ' ' || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || $('#modal-overlay').classList.contains('open')) return;
    e.preventDefault(); if (!espaco) { espaco = true; wrap.style.cursor = 'grab'; }
  });
  document.addEventListener('keyup', e => { if (e.key === ' ') { espaco = false; wrap.style.cursor = ''; } });
  wrap.addEventListener('pointerdown', e => {
    if (!S.proj || !(espaco || e.button === 1)) return;
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX, y0 = e.clientY, sl = wrap.scrollLeft, st = wrap.scrollTop;
    try { wrap.setPointerCapture(e.pointerId); } catch { /* ponteiro já solto */ }
    wrap.style.cursor = 'grabbing';
    wrap.onpointermove = ev => { wrap.scrollLeft = sl - (ev.clientX - x0); wrap.scrollTop = st - (ev.clientY - y0); };
    wrap.onpointerup = () => { wrap.onpointermove = wrap.onpointerup = null; wrap.style.cursor = espaco ? 'grab' : ''; };
  }, true);
  $('#btn-zoom-mais').onclick = () => aplicarZoom(zoom * 1.25);
  $('#btn-zoom-menos').onclick = () => aplicarZoom(zoom / 1.25);
  $('#btn-zoom').onclick = () => aplicarZoom(1);
  window.addEventListener('beforeunload', e => { if (S.sujo) e.preventDefault(); });
  document.addEventListener('keydown', e => {
    // caixinha marcada (ligar/desligar campo) não segura as setas: elas movem o campo selecionado
    const ae = document.activeElement;
    if (/INPUT|TEXTAREA|SELECT/.test(ae.tagName) && !(ae.type === 'checkbox' && e.key.startsWith('Arrow'))) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); salvar(); return; }
    // desfazer/refazer (no campo de texto quem desfaz é o próprio campo: o return acima já deixou passar)
    if ((e.ctrlKey || e.metaKey) && /^[zy]$/i.test(e.key)) { e.preventDefault(); desfazer(e.key.toLowerCase() === 'z' && !e.shiftKey); return; }
    if ($('#modal-overlay').classList.contains('open')) { if (M.sel) moverCampoTeclado(e); return; }
    if (!S.proj) return;
    // zoom no lugar do zoom do navegador: Ctrl + / Ctrl − / Ctrl 0 (caber na tela)
    if (e.ctrlKey || e.metaKey) {
      const z = { '=': zoom * 1.25, '+': zoom * 1.25, '-': zoom / 1.25, '0': 1 }[e.key];
      if (z) { e.preventDefault(); aplicarZoom(z); return; }
    }
    if (e.key === 'Escape') { S.tool = 'selecionar'; S.sel = null; tudo(); }
    // atalhos das ferramentas, como no Photoshop
    const atalho = !e.ctrlKey && !e.metaKey && !e.altKey && { v: 'selecionar', t: 'texto', r: 'retangulo', i: 'imagem', z: 'zona' }[e.key.toLowerCase()];
    if (atalho) { S.tool = atalho; S.sel = null; tudo(); return; }
    const it = S.sel && itemPorId(S.sel); if (!it) return;
    if (e.key === 'Delete') { e.preventDefault(); apagarSel(); }
    const passo = e.shiftKey ? 10 : 1, mv = { ArrowLeft: [-passo, 0], ArrowRight: [passo, 0], ArrowUp: [0, -passo], ArrowDown: [0, passo] }[e.key];
    if (mv) { e.preventDefault(); for (const o of ehMulti(S.sel) ? S.mult.map(itemPorId).filter(Boolean) : [it]) { o.x += mv[0]; o.y += mv[1]; } S.sujo = true; render(); props(); }
  });

  const pegar = alvo => (alvo.closest && alvo.closest('[data-id]') || { dataset: {} }).dataset.id || null;
  const arrasteTela = ligarArraste($('#canvas-svg'), {
    // vários: guarda onde cada um estava no começo do arraste (mover = mesma distância pra todos)
    caixa: id => { if (ehMulti(id)) S.baseMulti = S.mult.map(k => { const it = itemPorId(k); return it && { it, x: it.x, y: it.y }; }).filter(Boolean); return itemPorId(id); },
    selecionado: () => S.sel, ferramenta: () => S.tool,
    pegar: alvo => { const id = pegar(alvo); return ehMulti(S.sel) && S.mult.includes(id) ? 'm:' : id; },
    setCaixa: (id, b) => {
      if (ehMulti(id)) { const u = caixaDe(S.baseMulti.map(o => ({ x: o.x, y: o.y, w: o.it.w, h: o.it.h }))); for (const o of S.baseMulti) { o.it.x = r1(o.x + b.x - u.x); o.it.y = r1(o.y + b.y - u.y); } }
      else Object.assign(itemPorId(id), b);
      S.sujo = true;
    },
    selecionar: (id, e) => {
      if (e && (e.shiftKey || e.ctrlKey || e.metaKey) && id) {
        const atual = ehMulti(S.sel) ? S.mult : S.sel && !ehMulti(S.sel) ? [S.sel] : [];
        const lista = alternar(atual, pegar(e.target)).filter(Boolean); // o item clicado, mesmo dentro de 'm:'
        S.mult = lista; S.sel = lista.length > 1 ? 'm:' : lista[0] || null;
        render(); props(); return null; // Shift + clique só seleciona, não arrasta
      }
      if (id !== S.sel) { S.sel = id; render(); props(); if (id) $('#props').classList.add('aberto'); }
    },
    criar: criarNaTela, redesenhar: render,
    fantasma: b => { const g = $('#fantasma'); if (!g) return; g.replaceChildren(); if (b) el('rect', { class: 'sel-rect', x: b.x, y: b.y, width: b.w, height: b.h, 'stroke-width': 1.5 / escala }, g); },
  });
  // toque: pinça dá zoom e move; um dedo no fundo (fora dos elementos) move a vista.
  // Mouse: segurar o botão esquerdo no fundo (fora dos elementos) e arrastar também move a vista
  const toques = new Map();
  let pinca = null, panUm = null;
  wrap.addEventListener('pointerdown', e => {
    if (!S.proj) return;
    // mouse: só o botão esquerdo, e sem espaço (espaço e botão do meio têm o arraste próprio acima)
    if (e.pointerType !== 'touch' && (e.button !== 0 || espaco)) return;
    toques.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (toques.size === 2) {
      arrasteTela.cancelar(); panUm = null;
      const [a, b] = [...toques.values()];
      pinca = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: zoom, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      e.preventDefault(); e.stopPropagation();
    } else if (toques.size === 1 && S.tool === 'selecionar' && !(e.target.closest && e.target.closest('[data-id],[data-handle]')))
      panUm = { x: e.clientX, y: e.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop };
    if (panUm) wrap.style.cursor = $('#canvas-svg').style.cursor = 'grabbing';
  }, true);
  // move/solta escutados na janela: o elemento tocado pode sumir no redesenho e o evento não chegar na tela
  window.addEventListener('pointermove', e => {
    if (!toques.has(e.pointerId)) return;
    toques.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinca && toques.size >= 2) {
      e.stopPropagation();
      const [a, b] = [...toques.values()], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      aplicarZoom(pinca.z0 * Math.hypot(a.x - b.x, a.y - b.y) / pinca.d0, mx, my);
      wrap.scrollLeft -= mx - pinca.mx; wrap.scrollTop -= my - pinca.my; pinca.mx = mx; pinca.my = my;
    } else if (panUm) { wrap.scrollLeft = panUm.sl - (e.clientX - panUm.x); wrap.scrollTop = panUm.st - (e.clientY - panUm.y); }
  }, true);
  const soltaToque = e => {
    if (!toques.delete(e.pointerId)) return;
    if (pinca) e.stopPropagation();
    if (toques.size < 2) pinca = null;
    if (!toques.size) { if (panUm) { wrap.style.cursor = espaco ? 'grab' : ''; $('#canvas-svg').style.cursor = ''; } panUm = null; }
  };
  window.addEventListener('pointerup', soltaToque, true);
  window.addEventListener('pointercancel', soltaToque, true);
  $('#props-alca').onclick = () => $('#props').classList.toggle('aberto');
  ligarArraste($('#modal-canvas'), {
    // no começo de cada arraste do grupo guarda a foto dele (base da conta de mover/esticar)
    caixa: k => {
      if (ehGrupo(k)) { M.baseGrupo = baseDoGrupo(k); return M.baseGrupo.u; }
      if (ehMulti(k)) M.baseMulti = pecasMulti().map(c => ({ k: c, x: campoM(c).x, y: campoM(c).y }));
      return caixaCampoAbs(k);
    },
    selecionado: () => M.sel, ferramenta: () => 'selecionar',
    // com um grupo selecionado, pegar qualquer peça dele arrasta o grupo todo
    // fundo do nome selecionado: arrastar em cima do texto (que fica por cima dele) move o fundo
    pegar: alvo => { const id = pegar(alvo); if (M.sel === 'nome_fundo' && id === 'nome') return 'nome_fundo'; if (precoEmGrupo(id)) return M.sel === id ? id : 'g:preco'; return (ehGrupo(M.sel) && pecasDoGrupo(M.sel).includes(id)) || (ehMulti(M.sel) && M.mult.includes(id)) ? M.sel : id; },
    setCaixa: (k, b) => {
      if (ehMulti(k)) {
        // mover todos a mesma distância, a partir de onde estavam no começo do arraste
        const card = caixaCardModal(), u0 = caixaDe(M.baseMulti.map(o => ({ ...caixaCampoAbs(o.k), x: o.x / 100 * card.w, y: o.y / 100 * card.h })));
        for (const o of M.baseMulti) { const c = campoM(o.k); c.x = +(o.x + (b.x - u0.x) / card.w * 100).toFixed(2); c.y = +(o.y + (b.y - u0.y) / card.h * 100).toFixed(2); }
        return;
      }
      if (ehGrupo(k)) {
        const base = M.baseGrupo && M.baseGrupo.k === k ? M.baseGrupo : (M.baseGrupo = baseDoGrupo(k)), u = base.u;
        const igual = (a, c) => Math.abs(a - c) < 0.2; // o arraste arredonda a caixa pra 0,1 pt
        if (igual(b.w, u.w) && igual(b.h, u.h)) { escalarGrupo(base, 1, b.x, b.y); return; } // só mover
        // alça do canto: mesma proporção nos dois eixos; o canto oposto à alça fica parado
        const s = Math.max(0.1, (b.w / u.w + b.h / u.h) / 2);
        const ax = igual(b.x, u.x) ? u.x : u.x + u.w - u.w * s, ay = igual(b.y, u.y) ? u.y : u.y + u.h - u.h * s;
        escalarGrupo(base, s, ax, ay); return;
      }
      const card = caixaCardModal(); Object.assign(campoM(k), { x: +(b.x / card.w * 100).toFixed(1), y: +(b.y / card.h * 100).toFixed(1), w: +(b.w / card.w * 100).toFixed(1), h: +(b.h / card.h * 100).toFixed(1) });
    },
    selecionar: (k, e) => {
      if (e && (e.shiftKey || e.ctrlKey || e.metaKey) && k) { selecionarCampo(pegar(e.target), e); renderModelo(); return null; }
      if (k !== M.sel) { M.sel = k; renderModelo(); }
    },
    criar: () => {}, redesenhar: renderModelo, fantasma: () => {},
  });
  ligarZoomModal();
  // duplo clique numa peça seleciona o grupo dela inteiro (de novo: volta pra peça)
  $('#modal-canvas').addEventListener('dblclick', e => {
    const id = pegar(e.target), G = id && GRUPOS.find(g => g.campos && g.campos.includes(id));
    if (!G) return;
    M.sel = M.sel === 'g:' + G.id ? id : 'g:' + G.id; renderModelo();
  });
  // painel de propriedades acompanha no fim do arraste (não a cada pixel)
  $('#canvas-svg').addEventListener('pointerup', () => S.proj && props());

  carregando(true);
  await carregarFontes();
  try {
    S.clientes = await api('?clientes=1');
    // "Novo projeto": o cliente é a pasta do Somado Tarefas, não texto livre
    const sel = seletorCliente(); sel.id = 'pf-cliente';
    $('#pf-cliente').replaceWith(sel);
  } catch { /* 401 já avisou */ }
  $('#btn-duplicar-proj').onclick = () => S.proj && dialogoDuplicar(S.proj);
  // produtos de exemplo: botão na barra, ao lado de Duplicar
  $('#btn-duplicar-proj').after(h('button', { class: 'btn', id: 'btn-exemplo', on: { click: dialogoExemplo } }));
  botaoExemplo();
  $('#btn-desfazer').onclick = () => desfazer(true);
  $('#btn-refazer').onclick = () => desfazer(false);
  $('#modal-desfazer').onclick = () => desfazer(true);
  $('#modal-refazer').onclick = () => desfazer(false);
  $('#btn-colar-modelo').onclick = ev => { ev.stopPropagation(); colarModeloClip(); };
  iniciarBiblioteca(); // biblioteca.js
  carregando(false);
  if (EMB.on) return iniciarEmbutido(); // embutido.js
  // link direto pro projeto (o MCP devolve .../construtor-template/index.html#<id>)
  const doLink = decodeURIComponent(location.hash.slice(1));
  if (doLink) { try { await abrirProjeto(doLink); return; } catch { /* id que não existe: cai na lista */ } }
  try { const lst = await api(''); if (lst.length) abrirLista(); else $('#proj-modal').classList.add('open'); } catch { /* */ }
}
iniciar();
