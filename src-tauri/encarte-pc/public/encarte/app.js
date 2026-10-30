// Somado Encarte — MVP do editor web.
// O template é o SVG exportado do Illustrator, inserido direto na página. O editor mexe no
// DOM do SVG e guarda a edição como uma "ficha" (estado de cada produto, dos textos da arte e
// dos fundos), que reaplica sobre o template quando a edição é aberta de novo.
'use strict';

const NS = 'http://www.w3.org/2000/svg';
const XL = 'http://www.w3.org/1999/xlink';
const $ =(s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const S = {
  edicao: null,
  svg: null,
  produtos: [], porId: {},
  textos: [], porChave: {},   // textos da arte (fora dos produtos)
  paginas: [],                // [{x,y,w,h,g,fundo,nome}] — pranchetas do template, ou grupos ENCARTE_
  zonas: [], porZona: {},     // zonas de grade: [{chave, pagina, ret, el}] (uma por grid_area)
  zonaAtiva: null,            // chave da zona que o painel Grade mostra
  pagina: 0,
  vb: null,
  // seleção
  multi: false,
  sel: null,                  // produto principal
  selProds: new Set(),        // vários produtos
  selImgs: [],                // fotos selecionadas
  bloco: null,                // {p, tipo:'preco'|'nome'}
  selTexto: null,
  selFundo: null,             // índice da página
  trocandoLugar: null,
  desfazer: [],
  ui: null,
  indice: null, raizBanco: '',
  molde: null,                // card limpo do template (pra criar produto novo)
  grades: {},                 // por zona: {<chave>: {colunas, espaco, cheiasEmCima, linha1, area, linhas?}}
  linhas: [],                 // linhas divisórias (ver linhas.js e a seção "linhas divisórias")
  selLinha: null,             // id da linha selecionada (a 1ª, quando são várias: é a referência)
  selLinhas: [],              // as outras linhas selecionadas junto (Shift ou "Vários")
  camadasLinha: null,         // <g class="ed-linhas"> de cada página
};

// título (nome do produto) nunca abaixo de 15 pt, em nenhum cliente (regra do Matheus, 15/10/2026;
// 14 → 15 pt em 17/10/2026).
// Vale só pro título: preço, R$, UND/KG, selo e o resto ficam como o template desenhou.
// 1 unidade do SVG raiz = 1 pt do Illustrator. O cliente pode ter piso maior (titulo.min_pt).
const PISO_PT = 15;

// ---------------------------------------------------------------- util
const guardar = {
  ler(k, pad) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : pad; } catch (e) { return pad; } },
  pôr(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sem storage */ } },
};
function aviso(txt, ms = 2200) {
  const a = $('#aviso'); a.textContent = txt; a.classList.remove('oculto');
  clearTimeout(aviso.t); aviso.t = setTimeout(() => a.classList.add('oculto'), ms);
}
function el(tag, attrs = {}) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}
function matriz(e) {
  const t = e.transform && e.transform.baseVal.consolidate();
  const m = t ? t.matrix : { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  return { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f };
}
// caixa dos textos do nome no espaço do grupo do nome (cada <text> tem o próprio transform)
function bbTextosNome(p) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const t of p.nomeTxts) {
    let b; try { b = t.getBBox(); } catch (e) { continue; }
    if (!b.width && !b.height) continue;
    const m = matriz(t);
    for (const [x, y] of [[b.x, b.y], [b.x + b.width, b.y + b.height]]) {
      const X = m.a * x + m.c * y + m.e, Y = m.b * x + m.d * y + m.f;
      x0 = Math.min(x0, X); y0 = Math.min(y0, Y); x1 = Math.max(x1, X); y1 = Math.max(y1, Y);
    }
  }
  return x0 === Infinity ? { x: 0, y: 0, width: 0, height: 0 } : { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
// ---------------------------------------------------------------- servidor (Somado Tarefas)
// Todas as rotas moram em /api/encarte/… e exigem o usuário logado no Somado Tarefas.
const API = '/api/encarte';
const URLP = new URLSearchParams(location.search);
// ?exportar=1 = aberto pela VPS só pra gerar as pranchetas (somado-encarte exportar): nunca grava a
// ficha, pra não passar por cima do que alguém mexeu depois do pedido
const SO_EXPORTAR = URLP.get('exportar') === '1';
// volta = endereço da tarefa; só aceita caminho do próprio site (nada de mandar pra fora)
const VOLTA = (() => {
  const v = URLP.get('volta'); if (!v) return '';
  try {
    const u = new URL(v, location.origin);
    if (u.origin === location.origin) return u.pathname + u.search + u.hash;
    // app do PC: o editor roda no servidor do encarte (127.0.0.1) e a tarefa no programa (#/list/…);
    // o servidor manda caminho que não é dele de volta pro programa (local/encarte-pc/servidor.ts)
    return /^#\/[^/]/.test(u.hash) ? u.hash.slice(1) : '';
  }
  catch (e) { return ''; }
})();
function alerta(txt) {
  const a = $('#alerta'); if (!a) return;
  a.querySelector('span').textContent = txt; a.classList.toggle('oculto', !txt);
}
function sessaoExpirou() { alerta('Sua sessão expirou. Entre de novo no Somado Tarefas e reabra o encarte.'); }
// fetch com o prefixo, sessão e aviso claro de erro de rede / login vencido.
// Devolve a Response (ok ou não); lança só quando não deu nem pra falar com o servidor ou a sessão caiu.
async function api(rota, opts = {}) {
  let r;
  try { r = await fetch(API + rota, { credentials: 'same-origin', ...opts }); }
  catch (e) { alerta('Sem conexão com o servidor. Confira a internet; o que você mexeu continua na tela.'); throw e; }
  // middleware do Next manda pro /login: o fetch segue o redirect e volta HTML
  if (r.status === 401 || (r.redirected && /\/login/i.test(r.url))) { sessaoExpirou(); throw new Error('sessao'); }
  alerta('');
  return r;
}
async function apiJson(rota, opts) {
  const r = await api(rota, opts);
  if (!r.ok) throw new Error(`${rota} → ${r.status}`);
  return r.json();
}
function urlImg(arq, w = 700) { return `${API}/img?w=${w}&p=${encodeURIComponent(arq)}`; }
function setHref(img, url) { img.setAttribute('href', url); img.setAttributeNS(XL, 'xlink:href', url); }
function nomeArq(arq) { return (arq || '').split(/[\\/]/).pop().replace(/\.[^.]+$/, ''); }
function pastaDe(arq) { return (arq || '').replace(/\\/g, '/').replace(/\/[^/]*$/, ''); }
function arred(n) { return Math.round(n * 100) / 100; }
function agora() { return new Date().toISOString(); }
function novoId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function normPreco(v) {
  v = String(v || '').trim().replace(/^R\$\s*/i, '').replace('.', ',');
  if (/^\d+$/.test(v)) return v + ',00';
  if (/^\d+,\d$/.test(v)) return v + '0';
  return v;
}

// ---------------------------------------------------------------- início
// A edição nasce pela tarefa no Somado Tarefas; aqui é só a lista pra abrir.
async function telaInicio() {
  S.edicao = null;
  $('#editor').classList.add('oculto'); $('#inicio').classList.remove('oculto');
  const ul = $('#lista-edicoes');
  ul.innerHTML = '<li><span class="dica">carregando…</span></li>';
  let eds, tpls;
  try {
    [eds, tpls] = await Promise.all([apiJson('/edicoes'), apiJson('/templates').catch(() => [])]);
  } catch (e) {
    ul.innerHTML = '<li><span class="dica">Não consegui carregar as edições.</span></li>'; return;
  }
  eds = Array.isArray(eds) ? eds : (eds && eds.edicoes) || [];
  const nomeTpl = Object.fromEntries((tpls || []).map(t => [t.id, t.nome]));
  ul.innerHTML = eds.length ? '' : '<li><span class="dica">Nenhuma edição ainda. A edição nasce pela tarefa, na seção Encarte.</span></li>';
  for (const e of eds) {
    const li = document.createElement('li'); li.className = 'clicavel';
    const quando = e.atualizadoEm ? new Date(e.atualizadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
    li.innerHTML = `<img class="mini-ed oculto" alt=""><div class="info"><b></b><small></small></div>`;
    li.querySelector('b').textContent = e.titulo || '(sem nome)';
    li.querySelector('small').textContent = [nomeTpl[e.template] || e.template, quando].filter(Boolean).join(' · ');
    if (e.temMiniatura) {
      const im = li.querySelector('img');
      im.onload = () => im.classList.remove('oculto');
      im.src = `${API}/edicoes/${encodeURIComponent(e.id)}/miniatura?t=${encodeURIComponent(e.atualizadoEm || '')}`;
    }
    li.addEventListener('click', () => abrirEdicao(e.id));
    ul.appendChild(li);
  }
}

// ---------------------------------------------------------------- abrir edição
// op.ed: reabre com a ficha que já está na memória, sem buscar (prévia do modelo do card, modelo-card.js)
async function abrirEdicao(id, op = {}) {
  let ed = op.ed;
  if (!ed) try {
    const d = await apiJson('/edicoes/' + encodeURIComponent(id));
    ed = d && d.id ? d : d && d.edicao;
    if (!ed) throw new Error('edição vazia');
  } catch (e) {
    if (e.message === 'sessao') return;
    if (!S.edicao) await telaInicio();   // telaInicio limpa o alerta quando carrega: avisa depois
    alerta('Não consegui abrir essa edição (ela pode ter sido apagada).');
    return;
  }
  // a URL passa a apontar pra edição (recarregar a página reabre ela)
  try { const u = new URL(location.href); u.searchParams.set('edicao', ed.id); history.replaceState(null, '', u); } catch (e) { /* ok */ }
  // S.carregado = false enquanto a ficha não foi reaplicada: salvar antes disso gravaria a ficha vazia
  S.edicao = ed; S.desfazer = []; S.mexeuDesdeMini = false; S.carregado = false;
  limparSelecao();
  $('#f-extras').dataset.de = ''; // outro template pode repetir o id do produto
  $('#inicio').classList.add('oculto'); $('#editor').classList.remove('oculto');
  $('#ed-titulo').textContent = ed.titulo; $('#ed-salvo').textContent = 'carregando…';

  S.template = (await apiJson('/templates').catch(() => [])).find(x => x.id === ed.template) || null;
  let svgTxt;
  try {
    const r = await api(`/templates/${encodeURIComponent(ed.template)}/svg`, ajPedido()); // ajPedido: modelo do card ajustado (modelo-card.js)
    if (!r.ok) throw new Error(r.status);
    svgTxt = await r.text();
  } catch (e) {
    $('#ed-salvo').textContent = 'erro';
    if (e.message !== 'sessao') alerta('Não achei o template desta edição (o SVG saiu da pasta TEMPLATES do cliente?).');
    return;
  }
  const palco = $('#palco');
  palco.innerHTML = svgTxt.replace(/^<\?xml[^>]*>/, '');
  S.svg = $('svg', palco);
  S.svg.removeAttribute('width'); S.svg.removeAttribute('height');
  S.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  // template feito no construtor: "Editar template" abre o projeto (data-projeto do SVG ou .projeto.json do lado)
  S.projetoTpl = S.svg.getAttribute('data-projeto') || (S.template && S.template.projeto) || null;
  // catálogo em linhas (SMD-1053, data-tipo do construtor): tabela de preços, não encarte. Liga a grade de
  // 1 coluna sem a regra "nunca linha com 1", card sem área sem foto, ZONA da lista pelo id da zona, preço
  // em texto e nome de 2 linhas que aumenta a linha em vez de invadir a de baixo
  S.catalogo = S.svg.getAttribute('data-tipo') === 'catalogo';
  $('#ed-template').classList.toggle('oculto', !S.projetoTpl);
  await esperarFontes();
  aplicarVariaveis(S.svg);
  limparExport(S.svg); // sombra exportada como imagem e FUNDO no lugar de MARGEM_GRID (limpeza.js)
  aplicarModeloAjPt(ed.modeloAjPt); // template do Illustrator: modelo do card ajustado só nesta edição (modelo-card.js)
  // divisórias desenhadas pelo construtor na grade padrão: o editor redesenha pela grade da edição
  // (refazerDivisorias, a partir do data-divisorias da grid_area)
  $$('g.divisorias-tpl', S.svg).forEach(g => g.remove());

  // pranchetas do .ai (quando o servidor sabe); sem elas, as páginas saem dos grupos ENCARTE_
  const pr = await apiJson(`/templates/${encodeURIComponent(ed.template)}/pranchetas`).catch(() => null);
  const prs = pr && Array.isArray(pr.pranchetas) && pr.pranchetas.length ? pr.pranchetas : null;
  // páginas extras (cópia da página 1) entram no SVG antes de ler o template
  const temEncarte = !!$(':scope > g[id^="ENCARTE_"]', S.svg), base = paginasBase(prs);
  const novas = aplicarPaginasExtras(ed.paginasExtras, base);
  S.paginasTpl = base.length;
  lerTemplate();
  await carregarEspeciais(ed.template);
  S.padrao = ((await apiJson(`/templates/${encodeURIComponent(ed.template)}/padrao`).catch(() => null)) || {}).padrao || null;
  S.regras = lerRegrasTpl();
  // estilo salvo no template ("Salvar no template"): vale em toda edição dele, abaixo do estilo da edição
  S.estiloTpl = ((await apiJson(`/templates/${encodeURIComponent(ed.template)}/estilo?edicao=${encodeURIComponent(ed.id)}`).catch(() => null)) || {}).estilo || {};
  montarPaginas(prs ? [...prs, ...novas] : novas.length && !temEncarte ? [...base, ...novas] : null);
  montarCamadasLinhas(); // antes da ficha: mede a página de cada card pela posição do template
  aplicarCampanha(ed.campanha); // faixa de campanha: muda a grid_area da página antes das zonas
  // molde do especial deixado fora da prancheta (J Meroto): não sai na arte, só confunde na tela
  // (o clone em S.moldes continua servindo pra "Virar especial")
  for (const g of $$('g[id^="PRODUTO_ESPECIAL_"]', S.svg)) {
    const b = retSvgBBox(g), cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    if (!S.paginas.some(pg => cx >= pg.x && cx <= pg.x + pg.w && cy >= pg.y && cy <= pg.y + pg.h)) g.style.display = 'none';
  }
  S.grades = {}; S.zonaAtiva = null;
  esconderEmpilhados();
  montarZonas();
  atribuirZonas();
  for (const z of S.zonas) S.grades[z.chave] = detectarGrade(z.chave);
  for (const z of S.zonas) { const d = divisoriasDoTemplate(z); if (d) S.grades[z.chave].divisorias = d; }
  S.gradesOrig = Object.fromEntries(Object.entries(S.grades).map(([k, g]) => [k, { ...g, area: { ...g.area } }]));
  // tamanho do especial em casas, medido pelos cards normais da MESMA zona; zona só de
  // especiais (faixa de destaques) = cada um é uma casa
  for (const z of S.zonas) {
    const ps = ativosDaZona(z.chave), nor = ps.filter(p => p.molde === 'normal'), e = S.grades[z.chave].espaco;
    if (!nor.length) { for (const p of ps) p.span = { c: 1, r: 1 }; continue; }
    const med = a => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
    const bw = Math.min(...nor.map(p => p.cell.w)), bh = med(nor.map(p => p.cell.h));
    for (const p of ps) if (p.molde !== 'normal') p.span = {
      c: Math.max(1, Math.min(S.grades[z.chave].colunas, Math.round((p.cell.w + e) / (bw + e)))),
      r: Math.max(1, Math.round((p.cell.h + e) / (bh + e))),
    };
  }
  S.editArea = false; S.editAreaImg = false; S.editCard = false;
  // card que virou horizontal sozinho (autoH) renasce do card normal de onde veio: com o molde geral ele
  // perdia o modelo (data-modelo) e voltava como o card da faixa azul no Super Mais (17/10/2026)
  for (const est of ed.produtos || []) if (est.novo && !S.porId[est.id]) criarProduto(est.id, est.num, est.molde || 'normal', est.moldeDe || (est.autoH && !est.molde ? est.origemNormal : null) || null);
  let aplicados = 0;
  for (const est of ed.produtos || []) if (S.porId[est.id]) { aplicarEstado(S.porId[est.id], est); aplicados++; }
  for (const p of S.produtos) levarParaPagina(p); // card trocado de folha volta pro grupo da página dele
  // trava (17/10/2026, SMD-747): a ficha tinha produtos e nenhum casou com os cards do template (servidor
  // lento, template trocado no meio): a tela fica com o template cru e salvar gravaria ele por cima da
  // edição. Não deixa salvar e pede pra recarregar.
  if ((ed.produtos || []).length && !aplicados) {
    $('#ed-salvo').textContent = 'não carregou';
    alerta('Não consegui aplicar os produtos desta edição no template. Recarregue a página (F5) antes de mexer: nada será salvo daqui.');
    return;
  }
  aplicarGradesDaFicha(ed.grades);
  atribuirZonas(); // a ficha mexeu nas células e nas áreas
  const usados = new Set();
  for (const est of ed.textos || []) { const tx = textoDaFicha(est, usados); if (tx) { usados.add(tx); aplicarTexto(tx, est); } }
  for (const est of ed.fundos || []) { const i = paginaDoFundo(est); if (i >= 0) aplicarFundo(i, est.arq); }
  S.coresTpl = null;
  aplicarLinhas((Array.isArray(ed.linhas) ? ed.linhas : []).map(l => normalizarLinha(l)).filter(Boolean)
    .map(l => ({ ...l, id: l.id || novoId(), pagina: Math.min(l.pagina, S.paginas.length - 1) })));
  refazerDivisorias();
  S.estilo = { ...(ed.estilo && typeof ed.estilo === 'object' ? ed.estilo : {}) };
  prepararBordaNome();
  aplicarBordaNome();
  // template do construtor com regra (fundo do preço / área da foto): o card sai do jeito que a regra
  // manda já na abertura, sem esperar mexer nele
  for (const p of S.produtos) if (!p.removido && (regraFundo(p) || p.areaRegra)) render(p);
  for (const p of S.produtos) assentarFotosDaFicha(p);
  ordenarCamadas();
  avisoTemplateMudou();
  irPagina(guardar.ler('pag:' + ed.id, 0));
  painel();
  S.carregado = true;
  $('#ed-salvo').textContent = ed.atualizadoEm ? 'salvo ' + new Date(ed.atualizadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
}

// as famílias vêm do próprio /fontes.css (o servidor põe lá as fontes que tem); o texto é
// guardado pra exportação reaproveitar
function textoFontesCss() {
  if (!textoFontesCss.p) textoFontesCss.p = api('/fontes.css').then(r => {
    if (!r.ok) throw new Error('fontes.css → ' + r.status);
    return r.text();
  }).catch(e => { textoFontesCss.p = null; throw e; });
  return textoFontesCss.p;
}
async function familiasDasFontes() {
  const css = await textoFontesCss().catch(() => '');
  return [...new Set([...css.matchAll(/font-family:\s*['"]([^'"]+)['"]/g)].map(m => m[1]))];
}

// medir o template com a fonte reserva desalinha tudo: só lê depois que as fontes de verdade
// estão carregadas E aplicadas no layout
async function esperarFontes() {
  const fams = await familiasDasFontes();
  await Promise.all(fams.map(f => document.fonts.load(`20px "${f}"`).catch(() => null)));
  await document.fonts.ready;
  for (let i = 0; i < 40; i++) {
    // fonte que falhou ('error') não trava a abertura: espera só as que ainda estão vindo
    const faltam = [...document.fonts].filter(f => fams.includes(f.family.replace(/["']/g, '')) && (f.status === 'loading' || f.status === 'unloaded'));
    if (!faltam.length) break;
    await new Promise(r => setTimeout(r, 100));
  }
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
}

// instância de fonte variável: o Illustrator grava o nome PostScript da instância
// ("AcuminConcept-ExtraCondBold") e o servidor serve o arquivo variável; aqui cada texto
// ganha a largura/peso/inclinação daquela instância
const LARG_ACUMIN = { ExtraCond: 50, Cond: 67.5, SemiCond: 90, '': 100, Wide: 115 };
const PESO_ACUMIN = { Thin: 100, ExtraLight: 200, Light: 300, '': 400, Medium: 500, Semibold: 600, Bold: 700, Black: 800, UltraBlack: 900 };
function eixosDaFonte(fam) {
  const m = fam.match(/^AcuminConcept-(ExtraCond|SemiCond|Cond|Wide)?(Thin|ExtraLight|Light|Medium|Semibold|Bold|Black|UltraBlack)?(Italic)?$/);
  if (!m) return null;
  return `"wdth" ${LARG_ACUMIN[m[1] || '']}, "wght" ${PESO_ACUMIN[m[2] || '']}, "slnt" ${m[3] ? 12 : 0}`;
}
function aplicarVariaveis(raiz) {
  for (const t of $$('text, tspan', raiz)) {
    const fam = (getComputedStyle(t).fontFamily || '').split(',')[0].replace(/["']/g, '').trim();
    const eixos = eixosDaFonte(fam);
    if (eixos) t.style.fontVariationSettings = eixos;
  }
}

// ---------------------------------------------------------------- leitura do template
function achar(g, suf) {
  const re = new RegExp(`^produto_\\d+_${suf}(-\\d+)?$`);
  return $$('[id]', g).find(e => re.test(e.id)) || null;
}
function bbSeguro(e) { try { const b = e.getBBox(); return b.width > 0 ? { x: b.x, y: b.y, width: b.width, height: b.height } : null; } catch (er) { return null; } }
// procura primeiro dentro do grupo do preço e depois no card, fora do selo ("de/por" à parte)
function acharPeca(sel, ...raizes) {
  for (const r of raizes) {
    if (!r) continue;
    const e = $$(sel, r).find(x => !x.closest('[id*="_selo"]'));
    if (e) return e;
  }
  return null;
}
// campo de texto = um <text> ou um <g> com a pilha de cópias (contorno + sombra + preenchimento)
function textosDe(e) { return !e ? [] : e.tagName === 'text' ? [e] : $$('text', e); }
function textoTopo(e) { const ts = textosDe(e); return ts[ts.length - 1] || null; }
// escreve em todas as cópias da pilha, cada uma com a própria matriz
function escreverCampo(e, linhas, x, ancora, fonte, entre) {
  for (const t of textosDe(e)) escreverTexto(t, linhas, x, ancora, fonte, entre, matriz(t));
}

function lerTemplate() {
  const svg = S.svg;
  S.produtos = []; S.porId = {};
  // PRODUTO_N (normal) e PRODUTO_N_ESPECIAL (destaque vivo na grade); PRODUTO_ESPECIAL_1 é molde
  const grupos = $$('g[id^="PRODUTO_"]', svg).filter(g => /^PRODUTO_\d+(_ESPECIAL)?(-\d+)?$/.test(g.id));
  const normais = grupos.filter(g => !/_ESPECIAL/.test(g.id));
  const modelo = normais[normais.length - 1] || grupos[0];
  if (modelo) { S.molde = modelo.cloneNode(true); S.molde.parentGroup = modelo.parentNode; }
  // card novo numa zona copia um card da própria zona (faixa azul do Super Mais tem nome claro e sem
  // moldura; o molde geral é o card branco): guarda cada card do template como veio. Os destaques
  // vivos (PRODUTO_N_ESPECIAL, ex. IMBATÍVEL do Super Mais) entram também, pra servir de origem do
  // "Copiar estilo" (tarja vermelha); card novo da zona continua vindo só de card normal.
  S.limpos = {};
  for (const g of grupos) { const c = g.cloneNode(true); c.parentGroup = g.parentNode; S.limpos[g.id] = c; }
  for (const g of grupos) {
    try { const p = lerProduto(g); S.produtos.push(p); S.porId[p.id] = p; }
    catch (e) { console.warn('produto ignorado', g.id, e); }
  }
  // repetidos (ex.: dois PRODUTO_88) ganham rótulo próprio
  const vistos = {};
  for (const p of S.produtos) { vistos[p.num] = (vistos[p.num] || 0) + 1; if (vistos[p.num] > 1) p.rotulo = `${p.num} (${vistos[p.num]}º)`; }
  // o template escreve os nomes em maiúscula? (a maioria decide; sem nome nenhum, maiúscula)
  const nomes = S.produtos.map(p => p.nome).filter(n => n && /[a-zà-ú]/i.test(n));
  S.nomesMaiusculos = !nomes.length || nomes.filter(n => n === n.toUpperCase()).length * 2 >= nomes.length;
  prepararSelos();
  prepararLogos();
  // fotos de <defs> sem uso depois da normalização: tira o href pra não pesar. As que algum <use>
  // ainda aponta (círculo do preço e tapete do Lima) ficam.
  const usadas = new Set($$('use', svg).map(u => (u.getAttribute('href') || u.getAttributeNS(XL, 'href') || '').replace(/^#/, '')));
  for (const im of $$('defs image', svg)) {
    if (usadas.has(im.id)) continue;
    im.removeAttribute('href'); im.removeAttributeNS(XL, 'href');
  }
  lerTextosDaArte();
  S.ui = el('g', { id: 'ed-ui', 'pointer-events': 'none' });
  svg.appendChild(S.ui);
}

function lerTexto(t) {
  if (!t) return null;
  if (t.tagName !== 'text') { // <g> com a pilha: mede a de cima, as outras só acertam o espaçamento
    const ts = textosDe(t);
    ts.slice(0, -1).forEach(lerTexto);
    t = ts[ts.length - 1];
    if (!t) return null;
  }
  const m = matriz(t);
  const linhas = {}; const ys = [];
  // só as folhas: o Illustrator às vezes aninha <tspan> dentro de <tspan>; sem y = herda
  const spans = $$('tspan', t).filter(s => !s.querySelector('tspan'));
  if (!spans.length) { linhas[0] = t.textContent; ys.push(0); }
  let yAtual = 0;
  for (const s of spans) {
    let dono = s, y = null;
    while (dono && dono !== t && y === null) { if (dono.hasAttribute('y')) y = parseFloat(dono.getAttribute('y')); dono = dono.parentNode; }
    if (y === null) y = yAtual;
    yAtual = y;
    if (!(y in linhas)) { linhas[y] = ''; ys.push(y); }
    linhas[y] += s.textContent;
  }
  ys.sort((a, b) => a - b);
  const bb = t.getBBox();
  // espaçamento entre letras: o Illustrator põe nos <tspan>; guarda o que mais aparece
  const conta = {};
  for (const s of spans) { const ls = getComputedStyle(s).letterSpacing; conta[ls] = (conta[ls] || 0) + s.textContent.length; }
  const espaco = Object.keys(conta).sort((a, b) => conta[b] - conta[a])[0];
  if (espaco && espaco !== 'normal') t.style.letterSpacing = espaco;
  return {
    m, fonte: parseFloat(getComputedStyle(t).fontSize) || 16,
    linhas: ys.map(y => linhas[y].replace(/\s+/g, ' ').trim()),
    entre: ys.length > 1 ? ys[1] - ys[0] : null,
    bb: { x: bb.x, y: bb.y, w: bb.width, h: bb.height },
    // limites no espaço do card
    esq: m.e + bb.x * m.a, dir: m.e + (bb.x + bb.width) * m.a, larg: bb.width * m.a,
  };
}

function lerProduto(g) {
  const num = (g.getAttribute('data-name') || g.id).match(/\d+/)[0];
  const mg = $('[id^="MARGEM_GRID"]', g);
  const areaEl = achar(g, 'area');
  let nomeG = achar(g, 'nome');
  if (nomeG && nomeG.tagName === 'text') { // nome solto: embrulha num <g> pra poder mover
    const w = el('g', { id: nomeG.id + '_g' }); nomeG.before(w); w.appendChild(nomeG); nomeG = w;
  }
  const nomeTxts = nomeG ? $$('text', nomeG) : [];
  // preço num texto só (Marcelino) ou dividido em real + centavos (Lima, Juarez, Rodrigues)
  const preco = achar(g, 'preco');
  let real = preco ? null : achar(g, 'preco_real'), cent = real ? achar(g, 'preco_centavos') : null;
  // preço duplo (Juarez): grupo produto_NN_preco_duplo com real + centavos por variante
  // (produto_NN_preco_real_peça / _pedaço); a 1ª variante é o preço principal do card
  const duploG = !preco && !real ? achar(g, 'preco_duplo') : null;
  const variantes = [];
  if (duploG) {
    for (const e of $$('[id]', duploG)) {
      const m = e.id.match(/^produto_\d+_preco_real_(.+?)(-\d+)?$/);
      const c = m && $$('[id]', duploG).find(x => new RegExp(`^produto_\\d+_preco_centavos_${m[1]}(-\\d+)?$`).test(x.id));
      if (c) variantes.push({ suf: m[1], real: e, cent: c });
    }
    if (variantes.length) { real = variantes[0].real; cent = variantes[0].cent; }
  }
  const precoRef = preco || real;
  const precoG = duploG && variantes.length ? duploG
    : precoRef ? (precoRef.closest('[id^="PRECO"], [id^="PREÇO"]') || precoRef.parentNode) : null;
  // nome dentro do grupo do preço (Juarez): sai do grupo, senão anda junto com o preço
  if (nomeG && precoG && precoG !== g && precoG.contains(nomeG) && !precoG.hasAttribute('transform')) precoG.after(nomeG);
  const formato = achar(g, 'formato');
  const qtd = achar(g, 'qtd_max');
  // tarja do atacado (Juarez): "NA COMPRA DE / 5 KG OU MAIS!" em produto_NN_gatilho, e a faixa
  // colorida atrás dela (produto_NN_tarja_fundo) estica com a largura do card
  const tarjaEl = achar(g, 'gatilho') || achar(g, 'tarja'), tarjaFundo = achar(g, 'tarja_fundo');
  const moeda = acharPeca('[id^="moeda"]', precoG !== g ? precoG : null, g);
  const fundo = acharPeca('[id^="fundo_preco"]', precoG !== g ? precoG : null, g);
  // selo "Clube" (Super Mais, 007): grupo produto_NN_selo com o preço do clube em *valor_selo
  const seloG = achar(g, 'selo');
  // DE/POR: grupo produto_NN_de (aparece só com DE) e, no modelo de 2 tags, produto_NN_preco_padrao
  // (o oposto); o valor do DE em produto_NN_preco_de ou _preco_de_real + _preco_de_centavos
  const padraoG = achar(g, 'preco_padrao');
  const dePreco = achar(g, 'preco_de'), deReal = dePreco ? null : achar(g, 'preco_de_real');
  const deCent = deReal ? achar(g, 'preco_de_centavos') : null;
  // sem produto_NN_de, o bloco do DE é o maior grupo em volta do valor que não tem o preço principal
  // (Bandeirantes: PREÇO_DE com fundo, R$ e o número riscado): desligar o DE esconde tudo junto
  let deG = achar(g, 'de');
  if (!deG && (dePreco || deReal)) {
    for (let a = (dePreco || deReal).parentNode; a && a !== g && a.tagName === 'g'; a = a.parentNode) {
      if (precoRef && a.contains(precoRef)) break;
      deG = a;
    }
  }

  // card = o MARGEM_GRID; sem ele (ou vazio), a união de área + nome + preço
  let card = null, margemOk = false;
  const mgRet = mg && (mg.tagName === 'rect' ? mg : mg.querySelector('rect'));
  if (mgRet) { const b = mgRet.getBBox(); if (b.width > 1 && b.height > 1) { card = b; margemOk = true; } }
  if (!card) {
    const caixas = [areaEl, nomeG, precoG !== g ? precoG : null].filter(Boolean).map(e => e.getBBox()).filter(b => b.width > 0 && b.height > 0);
    if (caixas.length) {
      const x0 = Math.min(...caixas.map(b => b.x)), y0 = Math.min(...caixas.map(b => b.y));
      const x1 = Math.max(...caixas.map(b => b.x + b.width)), y1 = Math.max(...caixas.map(b => b.y + b.height));
      card = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    } else card = g.getBBox();
  }
  const area = areaEl ? areaEl.getBBox() : { x: card.x + 6, y: card.y + 30, width: card.width - 12, height: card.height - 36 };

  const margemG = mg;
  const p = {
    id: g.id, num, rotulo: num, g,
    card: { x: card.x, y: card.y, w: card.width, h: card.height },   // onde o template pôs
    cell: { x: card.x, y: card.y, w: card.width, h: card.height },   // onde está agora
    areaOrig: { x: area.x, y: area.y, w: area.width, h: area.height },
    area: { x: area.x, y: area.y, w: area.width, h: area.height },
    margem: margemOk ? mgRet : null,
    molde: /_ESPECIAL/.test(g.id) ? 'tpl' : 'normal', span: /_ESPECIAL/.test(g.id) ? { c: 2, r: 2 } : { c: 1, r: 1 },
    desenho: g.getAttribute('data-formato') || null, // 'horizontal' = desenho de card largo (construtor)
    nomeG, nomeTxts, preco, real, cent, dividido: !!(real && cent), formato, qtd, tarja: tarjaEl, moeda, fundo, precoG,
    base: {}, escNome: 1, escPreco: 1, fundoW: 1, fundoH: 1,
    precoDx: 0, precoDy: 0, nomeDx: 0, nomeDy: 0, nomeCaixa: 1, nomeEntre: 1, nomeAlinha: null, nomeLinhas: null, removido: false, novo: false,
  };
  if (p.margem) p.base.margem = { x: +p.margem.getAttribute('x') || 0, y: +p.margem.getAttribute('y') || 0 };
  // contorno num 2º rect do mesmo tamanho dentro do MARGEM_GRID (J Meroto Segunda e Terça, Juarez
  // Segunda Maluca, 09/10/2026): estica junto com o fundo, senão fica parado no lugar do template
  p.margemExtras = p.margem && mg !== p.margem ? $$('rect', mg).filter(r => {
    if (r === p.margem) return false;
    const b = r.getBBox();
    return Math.abs(b.width - card.width) < 2 && Math.abs(b.height - card.height) < 2;
  }) : [];
  const n0 = lerTexto(nomeTxts[nomeTxts.length - 1]);
  if (n0) {
    const bbG = nomeG.getBBox();
    p.base.nome = { ...n0, cx: bbG.x + bbG.width / 2, ms: nomeTxts.map(matriz) };
    p.nome = n0.linhas.join('\n');
    // caixa do nome desenhada no construtor (data-* do gerador, no espaço do card): o x do transform
    // é a âncora e o y a baseline, que o gerador põe a 78% da altura da caixa. data-alinha-v = onde o
    // bloco de linhas assenta na altura dela; data-linhas = até quantas linhas quebra antes de encolher
    const tn = nomeTxts[nomeTxts.length - 1], cw = +tn.getAttribute('data-largura');
    if (cw > 0) {
      const ch = +tn.getAttribute('data-altura') || 0, an = tn.getAttribute('text-anchor') || 'start', m = n0.m;
      p.base.nome.caixa = { x: an === 'middle' ? m.e - cw / 2 : an === 'end' ? m.e - cw : m.e, w: cw, y: ch ? m.f - ch * 0.78 : null, h: ch, ancora: an,
        v: tn.getAttribute('data-alinha-v') || 'topo', linhas: +tn.getAttribute('data-linhas') || 0 };
    }
  }
  let pr = lerTexto(preco);
  if (pr) { p.base.preco = pr; p.precoTxt = pr.linhas.join(''); }
  if (p.dividido) {
    // "22" + ",99" → "22,99"; guarda se os centavos vinham com a vírgula pra escrever igual
    const re = lerTexto(real), ce = lerTexto(cent);
    if (re && ce) {
      const tr = re.linhas.join('').trim(), tc = ce.linhas.join('').trim();
      const sep = (tc.match(/^[,.]/) || [''])[0];
      // o inteiro termina antes dos centavos: com a fonte do template faltando (Roc Grotesk do Juarez,
      // 07/10/2026) a medida sai da fonte de reserva, mais larga, e o "4" invadia o ",99"
      if (re.dir > ce.esq) { re.dir = ce.esq - re.fonte * Math.abs(re.m.a || 1) * 0.03; re.larg = re.dir - re.esq; }
      p.base.real = re; p.base.cent = { ...ce, sep };
      p.precoTxt = tr + ',' + tc.replace(/^[,.]\s*/, '');
      pr = re;
    } else p.dividido = false;
  }
  const fo = lerTexto(formato);
  if (fo) { p.base.formato = fo; p.formatoTxt = fo.linhas.join(''); }
  const qt = lerTexto(qtd);
  // limite do construtor (data-exemplo): o texto é só exemplo, cada produto começa vazio; o alinhamento
  // segue o do template (Illustrator não marca text-anchor e continua encostado à direita)
  if (qt) {
    // o limite anda dentro de um <g> próprio: arrastar/tamanho (qtdDx/Dy/Esc) e a camada (qtdZ) mexem nele
    p.qtdWrap = qtd.parentNode.getAttribute('data-qtd-wrap') ? qtd.parentNode : (() => { const w = el('g', { 'data-qtd-wrap': 1 }); qtd.before(w); w.appendChild(qtd); return w; })();
    p.base.qtd = qt;
    p.base.qtd.ancora = (textoTopo(qtd) || qtd).getAttribute('text-anchor') || 'end';
    p.qtdTxt = qtd.hasAttribute('data-exemplo') ? '' : qt.linhas.join(' ');
  }
  const tj = lerTexto(tarjaEl);
  if (tj) {
    const txt = tj.linhas.join(' ');
    p.base.tarja = { ...tj, cxl: tj.bb.x + tj.bb.w / 2, maius: txt === txt.toUpperCase() };
    p.tarjaTxt = tj.linhas.join('\n');
  } else p.tarja = null;
  if (moeda && pr) { const mo = lerTexto(moeda); p.base.moeda = { ...mo, folga: pr.esq - mo.dir }; }
  // R$ e o que fica em volta dele (círculo do Rodrigues): andam juntos quando o padrão deixa
  // (moeda_anda) e o valor não cabe
  if (moeda && precoG && precoG !== g) {
    const rm = retSvgBBox(moeda), cruza = r => r.x < rm.x + rm.w && rm.x < r.x + r.w && r.y < rm.y + rm.h && rm.y < r.y + r.h;
    // forma pequena em volta do R$ (círculo do Rodrigues) anda com ele; forma grande que o contém é o
    // fundo do preço (elipse do Super Mais Horti): fica parada e vira o limite de até onde o valor cresce
    const area = r => r.w * r.h, am = area(rm);
    const formas = $$('circle, ellipse, rect, path, polygon', precoG).filter(e => !moeda.contains(e)).map(e => ({ e, r: retSvgBBox(e) })).filter(o => cruza(o.r));
    // enfeite em imagem do lado do R$ (balões do Lima Dia das Crianças, laço do Outubro Rosa) anda com ele
    const enfeites = $$('image, use', precoG).filter(e => !moeda.contains(e)).filter(e => { const r = retSvgBBox(e); return r.x + r.w / 2 < rm.x + rm.w; });
    // fundo_moeda_NN (fundo do R$ do construtor) anda com o R$ mesmo quando é bem maior que ele
    const doR = o => /^fundo_moeda/.test(o.e.id || '') || area(o.r) <= am * 4;
    p.moedaPecas = [moeda, ...formas.filter(doR).map(o => o.e), ...enfeites].map(e => ({ el: e, tr: e.getAttribute('transform') || '' }));
    const fundoForma = formas.filter(o => !doR(o)).sort((a, b) => area(b.r) - area(a.r))[0];
    p.precoFundoForma = fundoForma ? fundoForma.e : null;
  }
  // fundo do preço pode ser um <use> com posição própria (círculo do Lima): a medida e o ajuste de
  // tamanho são no espaço do pai, e o transform original continua por dentro
  const medirFundo = e => {
    const tr = e.getAttribute('transform') || '', b = e.getBBox(), m = matriz(e);
    return { x: m.e + b.x * m.a, y: m.f + b.y * m.d, w: b.width * m.a, h: b.height * m.d, tr };
  };
  if (fundo) p.base.fundo = medirFundo(fundo);
  // o que Fundo ↔ ↕ e Mover fundo mexem: o fundo_preco ou, sem ele, a forma grande em volta do
  // valor (elipse do Super Mais Horti, que não tem fundo_preco e nada mexia nela)
  p.fundoAlvo = fundo || p.precoFundoForma || null;
  if (p.fundoAlvo) p.base.fundoAlvo = fundo ? p.base.fundo : medirFundo(p.fundoAlvo);
  if (precoG) {
    const b = precoG.getBBox();
    p.base.precoG = { x: b.x + b.width, y: b.y + b.height };
    p.base.precoTopoDir = { x: b.x + b.width, y: b.y }; // onde o selo se apoia
    p.base.precoW = b.width;
    // template do construtor: lugar do preço quando o produto tem o selo do clube ("s dx dy": escala em
    // volta do canto de baixo-direito e quanto anda, em pt)
    const cs = (precoG.getAttribute('data-com-selo') || '').trim().split(/\s+/).map(Number);
    p.comSelo = cs.length >= 3 && cs.every(isFinite) && cs[0] > 0 ? { s: cs[0], dx: cs[1], dy: cs[2] } : null;
  }
  if (nomeG && p.base.nome) {
    const b = nomeG.getBBox(); p.base.nome.cy = b.y + b.height / 2;
    // nome alinhado à esquerda no template (cards de baixo do Preço Certo horti: nome e preço à
    // esquerda, foto à direita): perto da borda esquerda e longe do centro do card
    const esq = b.x - card.x, centro = Math.abs(b.x + b.width / 2 - (card.x + card.width / 2));
    p.base.nome.esquerda = esq < card.width * 0.15 && centro > card.width * 0.12;
  }
  // preso ao preço (data-preso="gap esq dir", "-" = lado livre), no fundo do nome ou no texto sem fundo:
  // ver nomePresoAoPreco
  const presoEl = nomeG && (nomeG.hasAttribute('data-preso') ? nomeG : nomeG.querySelector('[data-preso]'));
  if (presoEl) {
    const ps = presoEl.getAttribute('data-preso').trim().split(/\s+/), lim = v => (v == null || v === '-' || !isFinite(+v) ? null : +v);
    if (ps[0] && isFinite(+ps[0])) p.base.preso = { gap: +ps[0], esq: lim(ps[1]), dir: lim(ps[2]) };
  }
  // tarja atrás do nome (Redemais Hora Mais: o preenchimento da caixa de texto do Illustrator sai
  // como <rect> dentro do grupo do nome): guarda o respiro em volta do texto pra a tarja acompanhar
  // o nome escrito, e se ela vem colada em cima do preço o nome passa a andar com o preço
  // Fundo do nome do construtor (fundo_nome_NN, rect/path/image): a regra e as margens vêm no data-*
  // (fixo = parado, o texto se ajusta dentro; estica_encolhe = abraça o texto até o tamanho desenhado;
  // estica = abraça e pode passar do desenhado até a borda do card)
  const fundoN = nomeG && p.base.nome ? [...nomeG.children].find(e => /^fundo_nome/.test(e.id || '')) : null;
  const caixaN = fundoN || (nomeG && p.base.nome ? [...nomeG.children].find(e => e.tagName === 'rect') : null);
  if (fundoN) {
    const rb = fundoN.getBBox(), [mt, mr, mb, ml] = (fundoN.getAttribute('data-margem') || '6 6 6 6').split(/\s+/).map(Number);
    p.caixaNome = fundoN;
    p.base.caixaNome = { construtor: true, regra: fundoN.getAttribute('data-regra') || 'fixo', m: { t: mt || 0, r: mr || 0, b: mb || 0, l: ml || 0 },
      x: rb.x, y: rb.y, w: rb.width, h: rb.height };
  } else if (caixaN) {
    const rb = caixaN.getBBox(), tb = bbTextosNome(p);
    p.caixaNome = caixaN;
    p.base.caixaNome = { pl: tb.x - rb.x, pt: tb.y - rb.y, pb: rb.y + rb.height - (tb.y + tb.height) };
    if (p.base.fundo) {
      const f = p.base.fundo, gap = f.y - (rb.y + rb.height);
      if (gap > -15 && gap < 25 && rb.x < f.x + f.w && rb.x + rb.width > f.x)
        p.base.nomeNoPreco = { gap, dir: f.x + f.w - (rb.x + rb.width), topoDir: { x: f.x + f.w, y: f.y } };
    }
  }

  // demais variantes do preço duplo: cada uma com o próprio texto e medida
  p.extras = variantes.slice(1).map(v => {
    const re = lerTexto(v.real), ce = lerTexto(v.cent);
    if (!re || !ce) return null;
    const tc = ce.linhas.join('').trim();
    return { suf: v.suf, real: v.real, cent: v.cent, base: { real: re, cent: { ...ce, sep: (tc.match(/^[,.]/) || [''])[0] } },
      txt: re.linhas.join('').trim() + ',' + tc.replace(/^[,.]\s*/, '') };
  }).filter(Boolean);
  if (variantes.length) p.rotuloPreco = variantes[0].suf.toUpperCase();
  // outras unidades dentro do preço duplo (produto_nn_formato do PEDAÇO): seguem o formato do card
  p.formatosExtra = duploG ? $$('[id]', duploG).filter(e => e !== formato && /^produto_(\d+|nn)_formato/i.test(e.id))
    .map(e => ({ el: e, base: lerTexto(e) })).filter(f => f.base) : [];

  // modelo de 2 tags (DE e padrão com os mesmos nomes de preço): o POR da outra tag é escrito junto
  p.gemeos = [];
  if (deG && padraoG) {
    const mesmos = suf => $$('[id]', g).filter(e => new RegExp(`^produto_\\d+_${suf}(-\\d+)?$`).test(e.id));
    if (p.dividido) {
      const rs = mesmos('preco_real'), cs = mesmos('preco_centavos');
      rs.forEach((r, i) => { if (r !== real && cs[i]) { const re = lerTexto(r), ce = lerTexto(cs[i]); if (re && ce) p.gemeos.push({ real: r, cent: cs[i], base: { real: re, cent: { ...ce, sep: p.base.cent.sep } } }); } });
    } else if (preco) {
      for (const e of mesmos('preco')) if (e !== preco) { const b = lerTexto(e); if (b) p.gemeos.push({ preco: e, base: { preco: b } }); }
    }
  }

  if (deG || dePreco || deReal) {
    const vis = e => !!e && getComputedStyle(e).display !== 'none';
    const dp = lerTexto(dePreco), dr = lerTexto(deReal), dc = lerTexto(deCent);
    const txt = dp ? dp.linhas.join('') : dr && dc ? dr.linhas.join('').trim() + ',' + dc.linhas.join('').trim().replace(/^[,.]\s*/, '') : '';
    // rótulo do DE ("R$" do construtor) à esquerda do valor: anda junto quando o valor cresce pra esquerda
    // (Mais Perto, SMD-773: "26,90" cobria o R$ desenhado pro exemplo "0,00")
    const rot = deG && dp ? $('[id^="de_rotulo"]', deG) : null, br = rot && lerTexto(rot);
    p.de = {
      g: deG, padraoG, preco: dePreco, real: dr ? deReal : null, cent: dc ? deCent : null,
      base: { preco: dp, real: dr, cent: dc && { ...dc, sep: (dc.linhas.join('').trim().match(/^[,.]/) || [''])[0] } },
      rotulo: br && br.dir <= dp.esq + 1 ? { el: rot, tr: rot.getAttribute('transform') || '' } : null,
    };
    // com as 2 tags, começa como o template mostra; com o bloco só, ligado
    p.deOn = deG ? vis(deG) && !(padraoG && vis(padraoG)) : true;
    p.deTxt = txt;
  }

  if (seloG) {
    const val = $$('[id]', seloG).find(e => /valor_selo/i.test(e.id)) || $$('text', seloG).find(t => !t.closest('[id^="moeda"]'));
    const mo = $('[id^="moeda"]', seloG);
    const bv = lerTexto(val);
    p.selo = { g: seloG, val, base: bv, moeda: mo ? lerTexto(mo) : null, tr: seloG.getAttribute('transform') || '' };
    p.seloOn = getComputedStyle(seloG).display !== 'none';
    p.seloTpl = true;
    p.seloTxt = bv ? bv.linhas.join('') : '';
  }

  // fotos: <image> e <use> viram <image> simples com x/y/largura/altura no espaço do card
  const fotosEl = $$('[id]', g).filter(e => /_var_\d+_imagem(-\d+)?$/.test(e.id));
  // foto nova entra logo atrás do que vier primeiro entre nome e preço (no J Meroto o preço vem
  // antes do nome: ancorar só no nome punha a foto na frente da tarja)
  // (extra do construtor com data-frente, como a tarja do nome, também fica na frente da foto)
  p.ancoraFotos = [nomeG, precoG, ...[...g.children].filter(c => c.hasAttribute('data-frente'))].filter(e => e && e.parentNode === g)
    .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))[0] || nomeG || null;
  for (const f of fotosEl) {
    let ref = f;
    if (f.tagName === 'use') {
      ref = S.svg.getElementById((f.getAttributeNS(XL, 'href') || f.getAttribute('href') || '').slice(1));
      if (!ref) continue;
    }
    const x0 = parseFloat(f.getAttribute('x') || 0), y0 = parseFloat(f.getAttribute('y') || 0);
    const W = parseFloat(ref.getAttribute('width')), H = parseFloat(ref.getAttribute('height'));
    const m = matriz(f);
    const im = novaFoto(ref.getAttribute('data-arq'), { x: m.e + x0 * m.a, y: m.f + y0 * m.d, w: W * m.a, h: H * m.d });
    f.replaceWith(im);
  }
  p.fotos = $$('image.ed-img', g);
  // tapete/apoio da foto (Lima: base_fundo, o pano xadrez): ocupa a largura do card, no pé dele, e a
  // foto fica apoiada em cima. Guarda a geometria pra reposicionar quando o card muda de tamanho
  const apoiosEl = [...g.children].filter(c => /^base_fundo/.test(c.id || ''));
  const geo = el => { const bb = el.getBBox(), m = matriz(el); return { bb: { x: bb.x, y: bb.y, w: bb.width, h: bb.height }, X: m.e + bb.x * m.a, Y: m.f + bb.y * m.d, W: bb.width * m.a, H: bb.height * m.d }; };
  p.apoiosExtra = [];
  if (apoiosEl.length) {
    const G = geo(apoiosEl[0]);
    if (G.W > 1 && G.H > 1) {
      p.apoio = { el: apoiosEl[0], bb: G.bb, prop: G.H / G.W };
      // 2º tapete do template (Lima: leite e acém têm dois empilhados): mesma relação com o principal
      for (const el of apoiosEl.slice(1)) {
        const E = geo(el); if (E.W < 1 || E.H < 1) continue;
        p.apoiosExtra.push({ el, bb: E.bb, prop: E.H / E.W, rw: E.W / G.W, rx: (E.X - G.X) / G.W, ry: (E.Y - G.Y) / G.H });
      }
    }
  }
  lerLogo(p, g, [nomeG, precoG !== g ? precoG : null]);
  // o selo solto no card anda com o preço (apoiado no canto de cima dele), quando o preço tem grupo
  // próprio; selo dentro do grupo do preço já anda junto
  const seloSegue = !!(p.selo && precoG && precoG !== g && seloG.parentNode === g);
  if (p.selo) p.selo.segue = seloSegue;
  // o que não é fundo/nome/preço/fotos/logo (selo solto, enfeite…) acompanha o canto de cima.
  // Grupo que só embrulha o fundo (sombra do Illustrator: <g class="…"><rect id="MARGEM_GRID">) fica
  // parado: o fundo já vai pra célula pelo x/y dele, e mover o grupo levava o fundo duas vezes
  // (Super Mais Quinta da Carne, SMD-645, 13/10/2026)
  p.outros = [...g.children].filter(c => c !== margemG && !(margemG && c.contains(margemG)) && c !== areaEl && c !== nomeG && c !== precoG && !c.classList.contains('ed-img') && !c.classList.contains('ed-logo') && !(seloSegue && c === seloG) && !(p.apoio && c === p.apoio.el) && !p.apoiosExtra.some(a => a.el === c))
    .map(c => ({ el: c, tr: c.getAttribute('transform') || '', estica: c === tarjaFundo, ancora: c.getAttribute('data-ancora') || '', ancoraV: c.getAttribute('data-ancora-v') || '', trava: c.getAttribute('data-trava') || '',
      // tarja do gatilho do construtor (com data-ancora): estica com as margens em pt até as laterais do card
      estBB: c === tarjaFundo && c.hasAttribute('data-ancora') && !c.getAttribute('transform') ? bbSeguro(c) : null }));
  // trava no título: guarda onde o pé do nome estava no template (o bloco anda o que o nome andar)
  if (nomeG && p.outros.some(o => o.trava === 'nome')) p.base.nomeTrava = caixaNoCard(p, nomeG);
  // área em posição fixa do construtor (data-fixa): distâncias em pt até as bordas do card, sem seguir o nome
  p.areaFixa = !!(areaEl && areaEl.dataset && areaEl.dataset.fixa === '1');
  p.semArea = !areaEl; // catálogo: card sem produto_NN_area não recebe foto (nem placeholder)
  p.areaM0 = medirAreaTpl(p);
  p.areaRegra = lerAreaRegra(areaEl);
  p.fotoAlinha = lerFotoAlinha(areaEl);
  p.areaAj = null;
  return p;
}

// ---------------------------------------------------------------- área da imagem
// A área da foto é o card MENOS distâncias fixas (pt do Illustrator) até as bordas, medidas no
// template — não porcentagem: card mais largo, mais alto, mais quadrado, as distâncias ficam e só a
// área muda. O topo conta do pé do nome quando o nome fica em cima da foto (nome de 1 linha = foto
// mais alta). tn negativo = a foto entra por baixo do título. Ajuste à mão: p.areaAj (ficha: areaImg).
function medirAreaTpl(p) {
  const A = p.areaOrig, k = p.card;
  const M = { t: A.y - k.y, b: k.y + k.h - (A.y + A.h), l: A.x - k.x, r: k.x + k.w - (A.x + A.w), tn: null };
  if (p.nomeG && p.base.nome && !p.base.nome.esquerda && !p.areaFixa) {
    // medido como se o nome do template tivesse 1 linha: o exemplo de 1, 2 ou 3 linhas dá a mesma
    // distância (o designer pôs a área no mesmo lugar em todos os cards)
    const n = p.nomeG.getBBox(), nl = Math.max(1, p.base.nome.linhas.length);
    if (n.height > 0 && n.y + n.height / 2 < A.y + A.h * 0.25) M.tn = A.y - (n.y + n.height / nl);
  }
  return M;
}
function areaM(p) { return p.areaAj || p.areaM0; }
// o topo segue o nome só quando o nome é o título de cima do card (não tarja, não rodapé, não canto)
function topoPeloNome(p, M = areaM(p)) {
  return M.tn != null && p.nomeBase != null && !!String(p.nome || '').trim() && !p.caixaNome && !p.base.nomeNoPreco
    && !nomeNaTarja(p) && !(S.padrao && S.padrao.titulo && regra('titulo').y === 'bottom');
}
// regras ligadas/desligadas no construtor (data-regras na raiz do SVG, 22/10/2026). Valem acima do
// padroes_mercado.json; chave que o template não traz segue o padrão do cliente / do código.
function lerRegrasTpl() {
  try { const r = JSON.parse(S.svg.getAttribute('data-regras') || 'null'); return r && typeof r === 'object' ? r : null; } catch { return null; }
}
function regraTpl(chave, atual) {
  return S.regras && Object.prototype.hasOwnProperty.call(S.regras, chave) ? S.regras[chave] : atual;
}
// área por regras (template do construtor, data-regra na produto_NN_area): margens até a borda do
// card, começa abaixo do nome e termina antes do preço (ou depois do preço que fica em cima).
// Ajuste de área feito à mão no editor (areaAj) continua valendo por cima.
function lerAreaRegra(a) {
  const d = a && a.dataset;
  if (!d || d.regra !== '1') return null;
  const m = (d.margem || '').split(/\s+/).map(Number);
  return { t: m[0] || 0, r: m[1] || 0, b: m[2] || 0, l: m[3] || 0, nome: d.nome === '1', baixo: d.precoBaixo === '1', cima: d.precoCima === '1', gap: +d.espaco || 0 };
}
// onde a foto assenta dentro da área (template do construtor: data-foto-alinha="baixo esq");
// sem a marca vale o de sempre (uma foto: embaixo no centro; várias: no meio)
function lerFotoAlinha(a) {
  const v = a && a.dataset && a.dataset.fotoAlinha;
  if (!v) return null;
  const [y, x] = v.split(/\s+/);
  return { y: ['cima', 'centro', 'baixo'].includes(y) ? y : 'centro', x: ['esq', 'centro', 'dir'].includes(x) ? x : 'centro' };
}
function calcAreaRegra(p) {
  const R = p.areaRegra, c = p.cell;
  let top = c.y + R.t, bot = c.y + c.h - R.b;
  if (R.nome && p.nomeBase != null && String(p.nome || '').trim()) top = Math.max(top, p.nomeBase + R.gap);
  if (p.precoG && p.precoG !== p.g && (R.baixo || R.cima)) {
    const b = retSvgBBox(p.precoG);
    if (b.h > 0) {
      if (b.y + b.h / 2 > c.y + c.h / 2) { if (R.baixo) bot = Math.min(bot, b.y - R.gap); }
      else if (R.cima) top = Math.max(top, b.y + b.h + R.gap);
    }
  }
  const x = c.x + R.l, w = Math.max(20, c.w - R.l - R.r);
  p.area = { x, y: top, w, h: Math.max(20, bot - top) };
}
function calcArea(p) {
  if (p.areaRegra && !p.areaAj) return calcAreaRegra(p);
  const c = p.cell, M = areaM(p);
  const x = c.x + M.l, w = Math.max(20, c.w - M.l - M.r), y1 = c.y + c.h - M.b;
  // nunca acima do topo do card: tn muito negativo + nome de 1 linha jogava a foto pra fora (Super Mais, 17/10/2026)
  const y = Math.min(Math.max(c.y, topoPeloNome(p, M) ? p.nomeBase + M.tn : c.y + M.t), y1 - 20);
  p.area = { x, y, w, h: y1 - y };
}
// cards "do mesmo tipo" = mesmo molde e, no template, mesma distância em cima e embaixo (os lados
// mudam com a largura da casa; especiais e cards de outro desenho ficam de fora)
function mesmaArea(a, b) {
  const A = a.areaM0, B = b.areaM0, perto = (x, y) => Math.abs(x - y) < 1.5;
  return a.molde === b.molde && perto(A.t, B.t) && perto(A.b, B.b) && (A.tn == null) === (B.tn == null);
}
function alvosAreaImg(p, todos) {
  // vários selecionados: a área vale exatamente pra seleção (ajusta um, muda todos)
  if (S.selProds.size > 1) return [...S.selProds];
  return todos ? S.produtos.filter(q => mesmaArea(q, p)) : [p];
}
// card novo herda o ajuste que os do mesmo tipo já têm
function herdarAreaImg(n) {
  const q = S.produtos.find(o => o !== n && o.areaAj && !o.removido && mesmaArea(o, n));
  if (q) n.areaAj = { ...q.areaAj };
}
function mudarAreaImg(alvos, M, arruma = true) {
  const v = M ? { t: arred(M.t), b: arred(M.b), l: arred(M.l), r: arred(M.r), tn: M.tn == null ? null : arred(M.tn) } : null;
  // quem mexe na área quer as fotos ocupando ela: rearruma (a foto ajeitada à mão volta pro arranjo)
  for (const q of alvos) {
    q.areaAj = v ? { ...v } : null;
    if (q.removido) continue;
    render(q);
    if (arruma && q.fotos.length) { arranjar(q, 'auto'); render(q); }
  }
}
function arrumarFotosArea(alvos) { for (const q of alvos) if (!q.removido && q.fotos.length) { arranjar(q, 'auto'); render(q); } }
// borda de um retângulo sob o dedo: 'l','r','t','b', cantos ('tl'…) ou 'm' (bolinha do meio = mover)
function bordaDoRet(A, cx, cy) {
  const p = pontoSvg(cx, cy), tol = 22 / S.svg.getScreenCTM().a;
  const dentroX = p.x > A.x - tol && p.x < A.x + A.w + tol, dentroY = p.y > A.y - tol && p.y < A.y + A.h + tol;
  if (!dentroX || !dentroY) return null;
  if (Math.hypot(p.x - (A.x + A.w / 2), p.y - (A.y + A.h / 2)) < tol * 1.3) return 'm';
  let b = '';
  if (Math.abs(p.y - A.y) < tol) b += 't'; else if (Math.abs(p.y - (A.y + A.h)) < tol) b += 'b';
  if (Math.abs(p.x - A.x) < tol) b += 'l'; else if (Math.abs(p.x - (A.x + A.w)) < tol) b += 'r';
  return b || null;
}
// card (do selecionado e da seleção) cuja borda da área está sob o dedo; o selecionado tem prioridade
function cardDaBordaArea(cx, cy) {
  const ps = [S.sel, ...[...S.selProds].filter(q => q !== S.sel)].filter(q => q && !q.removido && q.area);
  for (const p of ps) { const b = bordaDoRet(p.area, cx, cy); if (b) return { p, b }; }
  return null;
}
// move as bordas da área: d = quanto cada borda andou (x pra direita, y pra baixo)
function moverBordasArea(p, M0, bordas, dx, dy) {
  const M = { ...M0 }, nome = topoPeloNome(p, M0);
  const topo = d => { if (nome) M.tn += d; else M.t += d; };
  if (bordas === 'm') { M.l += dx; M.r -= dx; topo(dy); M.b -= dy; return M; }
  if (bordas.includes('l')) M.l += dx;
  if (bordas.includes('r')) M.r -= dx;
  if (bordas.includes('t')) topo(dy);
  if (bordas.includes('b')) M.b -= dy;
  return M;
}
function desenharAreaImg(ui, p) {
  const A = p.area, r = 8 / S.svg.getScreenCTM().a, cor = '#22c55e';
  for (const q of alvosAreaImg(p, $('#ai-todos').checked)) if (q !== p && !q.removido) ui.appendChild(el('rect', { x: q.area.x, y: q.area.y, width: q.area.w, height: q.area.h,
    fill: 'none', stroke: cor, 'stroke-opacity': 0.55, 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke', 'stroke-dasharray': '3 4' }));
  ui.appendChild(el('rect', { x: A.x, y: A.y, width: A.w, height: A.h, fill: 'rgba(34,197,94,.10)', stroke: cor,
    'stroke-width': 2, 'vector-effect': 'non-scaling-stroke', 'stroke-dasharray': '8 5' }));
  const pts = [[A.x, A.y], [A.x + A.w / 2, A.y], [A.x + A.w, A.y], [A.x, A.y + A.h / 2], [A.x + A.w, A.y + A.h / 2],
               [A.x, A.y + A.h], [A.x + A.w / 2, A.y + A.h], [A.x + A.w, A.y + A.h]];
  for (const [x, y] of pts) ui.appendChild(el('circle', { cx: x, cy: y, r, fill: '#fff', stroke: cor, 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }));
  ui.appendChild(el('circle', { cx: A.x + A.w / 2, cy: A.y + A.h / 2, r: r * 1.3, fill: cor, stroke: '#fff', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }));
}
// ---------------------------------------------------------------- área do produto (o card inteiro)
// Mesmo gesto da área da imagem, só que no card (p.cell): bordas, cantos e a bolinha do meio (mover).
// Vale só pra esta edição (fica no cell da ficha); a grade reorganizada volta tudo pro automático.
// Alvos: vários selecionados = a seleção; um só = este, os do mesmo formato ou todos (#ac-alvo).
function alvosCard(p) {
  if (S.selProds.size > 1) return [...S.selProds].filter(q => !q.removido);
  const modo = $('#ac-alvo').value;
  if (modo === 'todos') return S.produtos.filter(q => !q.removido);
  if (modo === 'formato') {
    const perto = (a, c) => Math.abs(a - c) <= Math.max(4, c * 0.03);
    return S.produtos.filter(q => !q.removido && q.molde === p.molde && perto(q.cell.w, p.cell.w) && perto(q.cell.h, p.cell.h));
  }
  return [p];
}
// Card do lado (#ac-vizinho): 'cobre' = fica por baixo, 'divide' = a borda entre os dois anda junto
// (o vizinho encolhe/cresce), 'empurra' = os cards daquele lado andam inteiros. Mesma zona, mesma
// faixa (sobreposição > 30% na outra direção); quem é alvo não é vizinho.
function sobrepoe(a0, a1, b0, b1) { return Math.min(a1, b1) - Math.max(a0, b0) > 0.3 * Math.min(a1 - a0, b1 - b0); }
function distLado(A, Q, lado) {
  const fx = sobrepoe(A.y, A.y + A.h, Q.y, Q.y + Q.h), fy = sobrepoe(A.x, A.x + A.w, Q.x, Q.x + Q.w);
  if (lado === 'r' && fx) return Q.x - (A.x + A.w);
  if (lado === 'l' && fx) return A.x - (Q.x + Q.w);
  if (lado === 'b' && fy) return Q.y - (A.y + A.h);
  if (lado === 't' && fy) return A.y - (Q.y + Q.h);
  return null;
}
function planoCards(alvos, bordas) {
  const sel = $('#ac-vizinho'), modo = sel ? sel.value : 'cobre';
  const plano = { alvos, base: alvos.map(q => ({ ...q.cell })), viz: new Map(), modo };
  if (modo !== 'cobre' && bordas !== 'm') alvos.forEach((a, i) => {
    const A = plano.base[i];
    for (const lado of bordas) {
      const cand = S.produtos.filter(q => !q.removido && !alvos.includes(q) && q.zona === a.zona)
        .map(q => ({ q, d: distLado(A, q.cell, lado) })).filter(o => o.d != null && o.d > -2);
      if (!cand.length) continue;
      const m = Math.min(...cand.map(o => o.d));
      for (const o of cand) if (modo === 'empurra' || o.d <= m + 2) {
        const v = plano.viz.get(o.q) || { base: { ...o.q.cell }, lados: [] };
        if (!v.lados.includes(lado)) v.lados.push(lado);
        plano.viz.set(o.q, v);
      }
    }
  });
  for (const q of [...alvos, ...plano.viz.keys()]) if (!q.cellAuto) q.cellAuto = { ...q.cell }; // casa da grade antes do 1º ajuste
  return plano;
}
function todosDoPlano(plano) { return [...plano.alvos, ...plano.viz.keys()]; }
function celulaVizinha(v, modo, dx, dy) {
  const c = { ...v.base };
  for (const lado of v.lados) {
    const d = lado === 'l' || lado === 'r' ? dx : dy;
    if (modo === 'empurra') { if (lado === 'l' || lado === 'r') c.x += d; else c.y += d; continue; }
    if (lado === 'r') { c.x += d; c.w -= d; }
    if (lado === 'l') c.w += d;
    if (lado === 'b') { c.y += d; c.h -= d; }
    if (lado === 't') c.h += d;
  }
  return c;
}
// ajuste do card = quanto cada borda está fora da casa que a grade deu (cellAj, na ficha). Com
// "manter ajustes ao reorganizar" a grade reaplica isso na casa nova.
function registrarAj(q) {
  const a = q.cellAuto, c = q.cell; if (!a) return;
  const aj = { l: arred(c.x - a.x), t: arred(c.y - a.y), r: arred(c.x + c.w - a.x - a.w), b: arred(c.y + c.h - a.y - a.h) };
  q.cellAj = Object.values(aj).some(v => Math.abs(v) > 0.3) ? aj : null;
}
function comAjuste(c, aj) { return { x: c.x + aj.l, y: c.y + aj.t, w: c.w - aj.l + aj.r, h: c.h - aj.t + aj.b }; }
// casa que a grade deu ao card: guarda como referência e, se a zona mantém ajustes, reaplica o dele
function celulaDaGrade(k, p, cell) {
  p.cellAuto = { ...cell };
  const g = S.grades[k];
  if (g && g.manterAjuste && p.cellAj) { const c = comAjuste(cell, p.cellAj); if (c.w >= 30 && c.h >= 30) cell = c; }
  else p.cellAj = null;
  mudarCelula(p, cell);
}
// cada alvo anda/estica as mesmas bordas, a partir da célula dele
function moverBordasCard(c0, bordas, dx, dy) {
  const c = { ...c0 };
  if (bordas === 'm') { c.x += dx; c.y += dy; return c; }
  if (bordas.includes('l')) { c.x += dx; c.w -= dx; }
  if (bordas.includes('r')) c.w += dx;
  if (bordas.includes('t')) { c.y += dy; c.h -= dy; }
  if (bordas.includes('b')) c.h += dy;
  return c;
}
// plano = alvos + células de antes do gesto + vizinhos (planoCards); arruma = rearranja as fotos
function mudarCards(plano, bordas, dx, dy, arruma) {
  const muda = plano.alvos.map((q, i) => [q, moverBordasCard(plano.base[i], bordas, dx, dy)]);
  for (const [q, v] of plano.viz) muda.push([q, celulaVizinha(v, plano.modo, dx, dy)]);
  if (muda.some(([, c]) => c.w < 30 || c.h < 30)) return false;
  for (const [q, c] of muda) { q.cell = { ...c }; render(q); }
  if (arruma) arrumarFotosCard(plano);
  return true;
}
function arrumarFotosCard(plano) {
  const bases = new Map(plano.alvos.map((q, i) => [q, plano.base[i]]));
  for (const [q, v] of plano.viz) bases.set(q, v.base);
  for (const [q, b] of bases) {
    registrarAj(q);
    const mudouTam = Math.abs(b.w - q.cell.w) > 0.5 || Math.abs(b.h - q.cell.h) > 0.5;
    if (mudouTam && q.fotos.length) { arranjar(q, 'auto'); render(q); }
  }
}
function cardDaBordaCard(cx, cy) {
  const ps = [S.sel, ...[...S.selProds].filter(q => q !== S.sel)].filter(q => q && !q.removido);
  for (const p of ps) { const b = bordaDoRet(p.cell, cx, cy); if (b) return { p, b }; }
  return null;
}
function desenharAreaCard(ui, p) {
  const A = p.cell, r = 8 / S.svg.getScreenCTM().a, cor = '#f97316';
  for (const q of alvosCard(p)) if (q !== p) ui.appendChild(el('rect', { x: q.cell.x, y: q.cell.y, width: q.cell.w, height: q.cell.h,
    fill: 'none', stroke: cor, 'stroke-opacity': 0.6, 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke', 'stroke-dasharray': '3 4' }));
  ui.appendChild(el('rect', { x: A.x, y: A.y, width: A.w, height: A.h, fill: 'rgba(249,115,22,.08)', stroke: cor,
    'stroke-width': 2, 'vector-effect': 'non-scaling-stroke', 'stroke-dasharray': '8 5' }));
  const pts = [[A.x, A.y], [A.x + A.w / 2, A.y], [A.x + A.w, A.y], [A.x, A.y + A.h / 2], [A.x + A.w, A.y + A.h / 2],
               [A.x, A.y + A.h], [A.x + A.w / 2, A.y + A.h], [A.x + A.w, A.y + A.h]];
  for (const [x, y] of pts) ui.appendChild(el('circle', { cx: x, cy: y, r, fill: '#fff', stroke: cor, 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }));
  ui.appendChild(el('circle', { cx: A.x + A.w / 2, cy: A.y + A.h / 2, r: r * 1.3, fill: cor, stroke: '#fff', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }));
}
// "Ver blocos": o contorno de cada card da página (a casa dele na grade) com o número, e a área da
// grade de cada zona, pra ver como o template foi pensado. Tocar num bloco seleciona; as bolinhas
// laranja mexem nele.
function desenharBlocos(ui) {
  const zs = zonasDaPagina(S.pagina).map(z => z.chave), esc = S.svg.getScreenCTM().a, cor = '#f97316';
  for (const k of zs) if (S.grades[k]) {
    const B = S.grades[k].area;
    ui.appendChild(el('rect', { x: B.x, y: B.y, width: B.w, height: B.h, fill: 'none', stroke: '#a855f7', 'stroke-opacity': 0.6,
      'stroke-width': 1, 'vector-effect': 'non-scaling-stroke', 'stroke-dasharray': '6 4' }));
  }
  for (const q of S.produtos) {
    if (q.removido || !zs.includes(q.zona) || q === S.sel) continue;
    const c = q.cell;
    ui.appendChild(el('rect', { x: c.x, y: c.y, width: c.w, height: c.h, fill: 'rgba(249,115,22,.06)', stroke: cor, 'stroke-opacity': 0.7,
      'stroke-width': 1, 'vector-effect': 'non-scaling-stroke', 'stroke-dasharray': '4 3' }));
    const t = el('text', { x: c.x + 6 / esc, y: c.y + 16 / esc, fill: cor, 'font-size': 13 / esc, 'font-weight': 700,
      'font-family': 'system-ui, sans-serif', stroke: '#fff', 'stroke-width': 3 / esc, 'paint-order': 'stroke' });
    t.textContent = q.rotulo || q.num; ui.appendChild(t);
  }
}
function painelAreaCard(p) {
  $('#gr-blocos').classList.toggle('ativa', !!S.editCard);
  $('#gr-blocos').textContent = S.editCard ? '✓ Esconder blocos' : '▦ Ver blocos dos produtos';
  const on = !!S.editCard;
  for (const [b, box, nome] of [['#pp-card', '#pp-card-box', 'Área do produto'], ['#pv-card', '#pv-card-box', 'Área dos produtos']]) {
    $(b).classList.toggle('ativa', on);
    $(b).textContent = on ? `✓ Terminar ${nome.toLowerCase()}` : `▭ ${nome}`;
    $(box).classList.toggle('oculto', !on);
  }
  if (!on || !p) return;
  const n = v => String(arred(v)).replace('.', ',');
  const alvos = alvosCard(p);
  const txt = `${n(p.cell.w)} × ${n(p.cell.h)} pt · x ${n(p.cell.x)} · y ${n(p.cell.y)}`;
  $('#ac-valores').textContent = txt + (S.selProds.size > 1 ? '' : ` · mexe em ${alvos.length === 1 ? 'só este' : alvos.length + ' cards'}`);
  $('#pv-ac-valores').textContent = txt + ` · vale pros ${alvos.length} selecionados`;
  for (const id of ['#ac-w', '#pv-ac-w']) if (document.activeElement !== $(id)) $(id).value = arred(p.cell.w);
  for (const id of ['#ac-h', '#pv-ac-h']) if (document.activeElement !== $(id)) $(id).value = arred(p.cell.h);
}
function painelAreaImg(p) {
  const on = !!S.editAreaImg;
  $('#pv-areaimg').classList.toggle('ativa', on);
  $('#pv-areaimg').textContent = on ? '✓ Terminar área da imagem' : '▭ Área da imagem';
  $('#pv-areaimg-box').classList.toggle('oculto', !on);
  $('#pp-areaimg').classList.toggle('ativa', on);
  $('#pp-areaimg').textContent = on ? '✓ Terminar área da imagem' : '▭ Área da imagem';
  $('#pp-areaimg-box').classList.toggle('oculto', !on);
  if (!on || !p) return;
  const M = areaM(p), n = v => String(arred(v)).replace('.', ',');
  const topo = topoPeloNome(p, M) ? (M.tn < 0 ? `${n(-M.tn)} por baixo do nome` : `${n(M.tn)} abaixo do nome`) : `${n(M.t)} do topo do card`;
  $('#ai-valores').textContent = `Topo: ${topo} · Base ${n(M.b)} · Esq. ${n(M.l)} · Dir. ${n(M.r)}${p.areaAj ? '' : ' (do template)'}`;
  $('#ai-qtd').textContent = $('#ai-todos').checked ? `${alvosAreaImg(p, true).filter(q => !q.removido).length} cards` : 'só este';
  if ($('#pv-ai-valores')) $('#pv-ai-valores').textContent = $('#ai-valores').textContent + ` · vale pros ${S.selProds.size} selecionados`;
}

// posiciona o card na célula: só o fundo (MARGEM_GRID) estica; nome fica no topo-centro, preço no
// canto inferior-direito e as fotos acompanham a área — igual ao montarGrade do Illustrator
function aplicarCelula(p) {
  const c = p.cell, k = p.card;
  calcArea(p);
  if (p.margem) {
    const m = p.margem;
    if (!p.base.margemWH) p.base.margemWH = { w: +m.getAttribute('width'), h: +m.getAttribute('height') };
    for (const r of [m, ...(p.margemExtras || [])]) {
      r.setAttribute('x', arred(c.x)); r.setAttribute('y', arred(c.y));
      r.setAttribute('width', arred(c.w)); r.setAttribute('height', arred(c.h));
    }
  }
  const dx = c.x - k.x, dy = c.y - k.y;
  // enfeite do construtor (data-ancora) segue o canto mais perto dele; sem a marca, o de cima-esquerdo
  // (data-ancora-v: na altura, o de cima, o do meio ou o de baixo)
  const dxDe = o => o.ancora === 'dir' ? c.x + c.w - (k.x + k.w) : o.ancora === 'centro' ? c.x + c.w / 2 - (k.x + k.w / 2) : dx;
  const dyDe = o => o.ancoraV === 'baixo' ? c.y + c.h - (k.y + k.h) : o.ancoraV === 'meio' ? c.y + c.h / 2 - (k.y + k.h / 2) : dy;
  for (const o of p.outros) o.el.setAttribute('transform', o.estica && o.estBB
    // tarja do gatilho (construtor): mesma distância em pt das laterais e a altura do data-ancora-v
    ? `translate(${arred(c.x + o.estBB.x - k.x)} ${arred(dyDe(o))}) scale(${+((o.estBB.width + c.w - k.w) / o.estBB.width).toFixed(5)} 1) translate(${arred(-o.estBB.x)} 0)`
    : o.estica
    ? `translate(${arred(c.x)} ${arred(dyDe(o))}) scale(${arred(c.w / k.w)} 1) translate(${arred(-k.x)} 0) ${o.tr}`.trim()
    : `translate(${arred(dxDe(o))} ${arred(dyDe(o))}) ${o.tr}`.trim());
  posLogo(p);
}

// Logo da marca no card (Granja Meroto nos suínos do Lima e do J Meroto, 06/10/2026): o elemento do
// card com "logo" no id (produto_NN_logo_imagem do gerador, logo_suino…) vira um <image class="ed-logo">
// solto no card, preso ao canto de cima-direito, que liga e desliga por produto (p.logoOn). A regra
// do mercado (padrão logo_auto) liga sozinha quando o nome casa (ex.: suíno).
function multMatriz(m, n) {
  return { a: m.a * n.a + m.c * n.b, b: m.b * n.a + m.d * n.b, c: m.a * n.c + m.c * n.d, d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e, f: m.b * n.e + m.d * n.f + m.f };
}
function lerLogo(p, g, fora) {
  const ehLogo = e => /(^|_)logo(_|-|$)/i.test(e.id || '') && /^(image|use|g)$/.test(e.tagName);
  const orig = $$('[id]', g).find(e => ehLogo(e) && !fora.some(f => f && f.contains(e)));
  if (!orig) return;
  const img = orig.tagName === 'g' ? $('image, use', orig) : orig;
  if (!img) return;
  const ref = img.tagName === 'use' ? S.svg.getElementById((img.getAttributeNS(XL, 'href') || img.getAttribute('href') || '').slice(1)) : img;
  if (!ref) return;
  const x0 = parseFloat(img.getAttribute('x') || 0), y0 = parseFloat(img.getAttribute('y') || 0);
  const W = parseFloat(ref.getAttribute('width')), H = parseFloat(ref.getAttribute('height'));
  if (!(W > 0 && H > 0)) return;
  const m = img === orig ? matriz(img) : multMatriz(matriz(orig), matriz(img));
  const r = { x: m.e + x0 * m.a, y: m.f + y0 * m.d, w: W * m.a, h: H * m.d };
  const vis = getComputedStyle(orig).display !== 'none' && orig.getAttribute('visibility') !== 'hidden';
  const im = el('image', { class: 'ed-logo', preserveAspectRatio: 'xMidYMid meet' });
  im.dataset.arq = ref.getAttribute('data-arq') || '';
  orig.remove();
  g.appendChild(im);
  p.logo = { el: im, base: { dr: p.card.x + p.card.w - (r.x + r.w), dt: r.y - p.card.y, w: r.w, h: r.h } };
  p.logoArq = im.dataset.arq; p.logoOn = vis;
}
function posLogo(p) {
  const L = p.logo; if (!L) return;
  const c = p.cell, k = p.card, s = Math.min(c.w / k.w, c.h / k.h), e = p.logoEsc || 1;
  const w0 = L.base.w * s, h0 = L.base.h * s, w = w0 * e, h = h0 * e;
  const x = c.x + c.w - L.base.dr * s - w0 + (w0 - w) / 2 + (p.logoDx || 0), y = c.y + L.base.dt * s + (h0 - h) / 2 + (p.logoDy || 0);
  L.el.setAttribute('x', arred(x)); L.el.setAttribute('y', arred(y));
  L.el.setAttribute('width', arred(Math.max(w, 1))); L.el.setAttribute('height', arred(Math.max(h, 1)));
}
function renderLogo(p) {
  const L = p.logo; if (!L) return;
  const arq = p.logoArq || '';
  if (arq && (L.el.dataset.arq !== arq || !L.el.getAttribute('href'))) { L.el.dataset.arq = arq; setHref(L.el, urlImg(arq, 400)); }
  L.el.style.display = p.logoOn && arq ? '' : 'none';
  posLogo(p);
}
// molde da logo do template (o 1º card que tem): posição e tamanho em fração do card
function prepararLogos() {
  const src = S.produtos.find(q => q.logo);
  S.logoMolde = src ? { dr: src.logo.base.dr / src.card.w, dt: src.logo.base.dt / src.card.h, w: src.logo.base.w / src.card.w,
    k: src.logo.base.h / src.logo.base.w, arq: src.logoArq } : null;
}
function regrasLogo() { if (regraTpl('logo_auto', true) === false) return []; const r = S.padrao && S.padrao.logo_auto; return Array.isArray(r) ? r : []; }
function podeLogo(p) { return !!(p.logo || S.logoMolde || regrasLogo().length); }
function garantirLogo(p) {
  if (p.logo) return true;
  if (!podeLogo(p)) return false;
  // sem logo no template: canto de cima-direito, 22% da largura do card
  const M = S.logoMolde || { dr: 0.03, dt: 0.12, w: 0.22, k: 1 };
  const w = M.w * p.card.w;
  const im = el('image', { class: 'ed-logo', preserveAspectRatio: 'xMidYMid meet' });
  p.g.appendChild(im);
  p.logo = { el: im, base: { dr: M.dr * p.card.w, dt: M.dt * p.card.h, w, h: w * M.k } };
  p.logoArq = p.logoArq || M.arq || (regrasLogo().find(r => r.logo) || {}).logo || '';
  p.logoOn = false;
  return true;
}
// regra do padrão do mercado: nome que casa com "se" (e não com "nao") pede a logo daquela regra
function logoAuto(nome) {
  for (const r of regrasLogo()) {
    try { if (new RegExp(r.se, 'i').test(nome) && !(r.nao && new RegExp(r.nao, 'i').test(nome))) return r; }
    catch (e) { console.warn('regra de logo inválida', r, e); }
  }
  return null;
}
// marca = true/false vindo da lista ("logo: sim"); sem marca, vale a regra do mercado. Sem marca e
// sem regra, o card fica como está.
function aplicarLogoAuto(p, marca) {
  const r = marca === undefined ? logoAuto(p.nome || '') : null;
  if (marca === undefined && !regrasLogo().length) return;
  const liga = marca !== undefined ? !!marca : !!r;
  if (liga && !garantirLogo(p)) return;
  if (!p.logo) return;
  p.logoOn = liga;
  if (r && r.logo) p.logoArq = r.logo;
}
// card que troca de desenho (especial, copiar estilo) leva a logo como estava
function levarLogo(p, n) {
  if (p.logo && p.logoOn) { if (garantirLogo(n)) { n.logoOn = true; n.logoArq = p.logoArq || n.logoArq; n.logoDx = p.logoDx || 0; n.logoDy = p.logoDy || 0; n.logoEsc = p.logoEsc || 1; } }
  else if (n.logo) n.logoOn = false;
}

// fotos acompanham a mudança de área (mesma posição relativa, escala uniforme)
// Parte sempre da mesma referência (área + fotos de antes da sequência de mudanças), não da última
// posição: nome descendo encolhe a foto e, subindo de novo, ela volta ao tamanho de antes (de
// passo em passo o min(largura, altura) só encolhia). Foto mexida à mão no meio vira referência nova.
function remapearFotos(p, A0, A1) {
  if (!(A0.w > 1 && A0.h > 1)) return;
  const atuais = p.fotos.map(retFoto), R = p.fotosRef;
  const perto = (a, b) => ['x', 'y', 'w', 'h'].every(k => Math.abs(a[k] - b[k]) < 0.5);
  const segue = R && R.ims.length === p.fotos.length && R.ims.every((im, i) => im === p.fotos[i]) && atuais.every((r, i) => perto(r, R.ult[i]));
  const ref = segue ? R : { A: { ...A0 }, rs: atuais, ims: [...p.fotos] };
  const auto = fotosDoArranjo(p);
  const s = Math.min(A1.w / ref.A.w, A1.h / ref.A.h);
  p.fotos.forEach((im, i) => {
    const r = ref.rs[i];
    const cx = (r.x + r.w / 2 - ref.A.x) / ref.A.w, base = (r.y + r.h - ref.A.y) / ref.A.h;
    const w = r.w * s, h = r.h * s;
    posFoto(im, { x: A1.x + cx * A1.w - w / 2, y: A1.y + base * A1.h - h, w, h });
  });
  p.fotosRef = { ...ref, ult: p.fotos.map(retFoto) };
  if (auto) marcarArranjo(p, p.fotosAuto.tipo);
}

function mudarCelula(p, cell) {
  const c0 = { ...p.cell };
  p.cell = { ...cell };
  levarParaPagina(p);
  render(p); // célula + nome; as fotos acompanham a área nova (render → remapearFotos)
  // mudou de tamanho: as fotos se rearranjam pra ocupar a área nova
  const mudouTam = Math.abs(c0.w - cell.w) > c0.w * 0.02 || Math.abs(c0.h - cell.h) > c0.h * 0.02;
  if (mudouTam && p.fotos.length) { arranjar(p, 'auto'); render(p); }
}

// card que mudou de página (trocar de lugar entre folhas) vai pro grupo da prancheta nova: no template
// do construtor cada PRANCHETA_N é um grupo, e o fundo da página seguinte pinta por cima do card que
// ficou no grupo da anterior (buraco em branco). Só troca entre grupos com o mesmo transform.
function levarParaPagina(p) {
  const i = paginaDe(p); if (i < 0) return;
  const q = S.produtos.find(o => o !== p && !o.removido && o.g.parentNode && o.g.parentNode !== p.g.parentNode && paginaDe(o) === i);
  // fica onde está se o grupo dele é o que mais tem cards da página. Não basta "algum outro card do
  // grupo na página": dois cards novos na mesma folha nascem juntos no grupo da prancheta 1 ao abrir
  // a edição e um travava o outro (Marcelino Quinta da Economia, 21/10/2026: buraco na exportação)
  const naPagina = pai => S.produtos.filter(o => o !== p && o.g.parentNode === pai && paginaDe(o) === i).length;
  // folha sem nenhum card do template (todos trocados por cards novos, Redemais 22/10/2026): sem vizinho
  // pra seguir, o card ficava no grupo da prancheta 1, recortado e invisível. Vai pro grupo da prancheta dele.
  const pg = S.paginas[i], grupo = pg && (pg.g || (pg.fundo && pg.fundo.closest('g[id^="PRANCHETA_"]')));
  const destino = grupo || (q && q.g.parentNode);
  if (!destino || destino === p.g.parentNode) return;
  if (!grupo && naPagina(p.g.parentNode) >= naPagina(q.g.parentNode)) return;
  const a = matrizAteRaiz(p.g.parentNode), b = matrizAteRaiz(destino);
  if (['a', 'b', 'c', 'd', 'e', 'f'].some(k => Math.abs(a[k] - b[k]) > 1e-6)) return;
  destino.appendChild(p.g);
}

// Trazer pra frente / Mandar pra trás (Matheus, 26/10/2026): ordem de pilha do card inteiro entre os
// cards (p.z na ficha: 0 = a do template, maior = mais na frente). Só os cards trocam de lugar entre si,
// nas posições que os cards já ocupam no grupo: o fundo da página e a arte continuam por baixo, e a
// ordem foto/nome/preço dentro do card não muda. Grupo sem nenhum z fica como o template desenhou.
// ordem de baixo pra cima: z, e no empate a ordem dos produtos (a do template, novos no fim)
function ordemCamadas(itens) {
  return itens.map((o, k) => ({ o, k })).sort((a, b) => (a.o.z || 0) - (b.o.z || 0) || a.o.i - b.o.i || a.k - b.k).map(x => x.o);
}
const paisComCamada = new WeakSet();
function ordenarCamadas() {
  if (!S.produtos) return;
  const porPai = new Map();
  S.produtos.forEach((p, i) => {
    const pai = p.g && p.g.parentNode; if (!pai) return;
    const l = porPai.get(pai) || []; l.push({ p, z: p.z || 0, i }); porPai.set(pai, l);
  });
  for (const [pai, l] of porPai) {
    if (l.some(o => o.z)) paisComCamada.add(pai); else if (!paisComCamada.has(pai)) continue;
    const atual = [...pai.children].map(n => l.find(o => o.p.g === n)).filter(Boolean);
    const quer = ordemCamadas(atual);
    if (quer.every((o, k) => o === atual[k])) continue;
    // marca o lugar de cada card e põe os cards de volta na ordem nova
    const marcas = atual.map(o => { const m = document.createComment(''); pai.insertBefore(m, o.p.g); return m; });
    quer.forEach((o, k) => marcas[k].replaceWith(o.p.g));
  }
}
// automação (somado-encarte ajustar --frente/--tras): camadaCard(p, 'frente'|'tras') → z novo
function camadaCard(p, lado) {
  const pg = paginaDe(p), outros = S.produtos.filter(o => o !== p && !o.removido && paginaDe(o) === pg).map(o => o.z || 0);
  if (lado === 'frente') p.z = Math.max(0, ...outros) + 1;
  else if (lado === 'tras') p.z = Math.min(0, ...outros) - 1;
  else p.z = 0;
  ordenarCamadas();
  return p.z;
}
function camadaSel(lado) {
  const ps = [...new Set([S.sel, ...S.selProds])].filter(p => p && p.g);
  if (!ps.length) return;
  marcar(...ps);
  for (const p of ps) camadaCard(p, lado);
  mudou(); painel();
  aviso(lado === 'frente' ? 'Card na frente dos outros' : 'Card atrás dos outros');
}

// textos fora dos produtos (validade, telefone, endereço, chamadas): cada "pilha" de cópias
// iguais (contorno + sombra + preenchimento) vira um texto editável só
function lerTextosDaArte() {
  S.textos = []; S.porChave = {};
  const soltos = $$('text', S.svg).filter(t => !t.closest('g[id^="PRODUTO_"]') && !t.closest('defs'));
  const pilhas = new Map();
  for (const t of soltos) {
    const k = [t.parentNode === S.svg ? 'raiz' : '', t.getAttribute('transform') || '', t.textContent].join('|');
    const chaveDom = pilhas.get(t.parentNode) || new Map();
    pilhas.set(t.parentNode, chaveDom);
    if (!chaveDom.has(k)) chaveDom.set(k, []);
    chaveDom.get(k).push(t);
  }
  let i = 0;
  for (const mapa of pilhas.values()) for (const txts of mapa.values()) {
    const info = lerTexto(txts[txts.length - 1]);
    for (const t of txts.slice(0, -1)) lerTexto(t); // espaçamento entre letras de cada cópia
    const al = alinhamentoOrig(txts[txts.length - 1]);
    const tx = {
      chave: 'tx' + (i++), txts, info, orig: info.linhas.join('\n'), linhas: info.linhas.join('\n'),
      ancora: al, ancoraOrig: al, mexido: false,
      trs: txts.map(t => t.getAttribute('transform') || ''), dx: 0, dy: 0, esc: 1, centro: centroTexto(txts[txts.length - 1]),
      // papel do texto no construtor (data, aviso, variavel): muda toda edição; ok = id da edição em que foi conferido
      papel: (txts.find(t => t.getAttribute('data-papel')) || { getAttribute: () => null }).getAttribute('data-papel'), ok: null,
    };
    S.textos.push(tx); S.porChave[tx.chave] = tx;
  }
}

// centro do texto no espaço do pai (getBBox é antes do transform do próprio <text>)
function centroTexto(t) {
  const b = t.getBBox(), c = t.transform.baseVal.consolidate(), m = c ? c.matrix : { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}
function textoMexido(tx) { return tx.linhas !== tx.orig || tx.ancora !== tx.ancoraOrig || !!tx.dx || !!tx.dy || tx.esc !== 1 || !!tx.ok; }
// texto com papel (data da oferta, aviso…) que ainda não foi conferido NESTA edição (a da semana que vem
// nasce duplicada com o ok da anterior, então volta a ficar pendente)
function textoPendente(tx) { return !!tx.papel && (!S.edicao || tx.ok !== S.edicao.id); }
function conferirTexto(tx) { if (tx.papel && S.edicao) { tx.ok = S.edicao.id; tx.mexido = true; } }
// posição e tamanho do texto da arte: por fora do transform original
function posTexto(tx) {
  const c = tx.centro, partes = [];
  if (tx.dx || tx.dy) partes.push(`translate(${arred(tx.dx)} ${arred(tx.dy)})`);
  if (tx.esc !== 1) partes.push(`translate(${arred(c.x)} ${arred(c.y)}) scale(${tx.esc}) translate(${arred(-c.x)} ${arred(-c.y)})`);
  tx.txts.forEach((t, i) => {
    const tr = (partes.join(' ') + ' ' + tx.trs[i]).trim();
    if (tr) t.setAttribute('transform', tr); else t.removeAttribute('transform');
  });
}

function novaFoto(arq, r) {
  const im = el('image', { class: 'ed-img', preserveAspectRatio: 'none' });
  im.dataset.arq = arq || '';
  posFoto(im, r);
  im.addEventListener('error', () => { im.dataset.erro = '1'; });
  // sem arquivo não pede nada ao servidor (img?p=null dava 403); marca como foto que não carregou
  if (arq) setHref(im, urlImg(arq)); else im.dataset.erro = '1';
  return im;
}
function posFoto(im, r) {
  im.setAttribute('x', arred(r.x)); im.setAttribute('y', arred(r.y));
  im.setAttribute('width', arred(Math.max(r.w, 1))); im.setAttribute('height', arred(Math.max(r.h, 1)));
}
function retFoto(im) {
  return { x: +im.getAttribute('x'), y: +im.getAttribute('y'), w: +im.getAttribute('width'), h: +im.getAttribute('height') };
}

// ---------------------------------------------------------------- páginas e câmera
function prepararFundo(fundo) {
  fundo.classList.add('ed-fundo');
  fundo.dataset.arqOrig = fundo.getAttribute('data-arq') || '';
  fundo.dataset.arq = fundo.dataset.arqOrig;
  // geometria do template, pra voltar a ela quando a imagem nova não for de página inteira
  fundo.dataset.geo = JSON.stringify(['x', 'y', 'width', 'height', 'transform'].map(a => fundo.getAttribute(a)));
  if (fundo.dataset.arq) setHref(fundo, urlImg(fundo.dataset.arq, 2000)); // fundo em resolução boa
}
// a mesma imagem em várias pranchetas sai do Illustrator como 1 <image> em <defs> + um <use> por página.
// O fundo escolhido vira uma <image> de verdade no lugar do <use>, pra cada página trocar o seu sozinha.
function alvoImagem(u) {
  const id = (u.getAttribute('href') || u.getAttributeNS(XL, 'href') || '').replace(/^#/, '');
  const a = id && S.svg.querySelector(`[id="${CSS.escape(id)}"]`);
  return a && a.tagName.toLowerCase() === 'image' ? a : null;
}
function soltarUse(u) {
  const orig = alvoImagem(u); if (!orig) return u;
  const im = orig.cloneNode(false);
  const ux = +u.getAttribute('x') || 0, uy = +u.getAttribute('y') || 0;
  const tr = [u.getAttribute('transform'), ux || uy ? `translate(${ux} ${uy})` : '', orig.getAttribute('transform')].filter(Boolean).join(' ');
  if (tr) im.setAttribute('transform', tr); else im.removeAttribute('transform');
  if (u.id) im.id = u.id; else im.removeAttribute('id');
  for (const at of ['class', 'style', 'opacity']) if (u.hasAttribute(at)) im.setAttribute(at, u.getAttribute(at));
  u.replaceWith(im);
  return im;
}
// pranchetas = [{nome,x,y,w,h}] em coordenadas do SVG (do servidor) ou null
function montarPaginas(pranchetas) {
  if (pranchetas) {
    // fundo da prancheta = a maior imagem da arte (fora dos produtos) que cai ≥ 80% dentro dela e cobre ≥ 30% dela
    const fora = e => !e.classList.contains('ed-img') && !e.closest('defs') && !e.closest('g[id^="PRODUTO_"]');
    const imgs = [...$$('image', S.svg).filter(fora), ...$$('use', S.svg).filter(fora).filter(alvoImagem)]
      .map(im => ({ im, r: retSvgBBox(im) })).filter(o => o.r.w > 0 && o.r.h > 0);
    const usados = new Set();
    S.paginas = pranchetas.map(pc => {
      const pg = { x: +pc.x, y: +pc.y, w: +pc.w, h: +pc.h, g: null, fundo: null, nome: pc.nome || '' };
      let melhor = null;
      for (const o of imgs) {
        if (usados.has(o.im)) continue;
        const ix = Math.max(0, Math.min(o.r.x + o.r.w, pg.x + pg.w) - Math.max(o.r.x, pg.x));
        const iy = Math.max(0, Math.min(o.r.y + o.r.h, pg.y + pg.h) - Math.max(o.r.y, pg.y));
        if (ix * iy < o.r.w * o.r.h * 0.8) continue;
        if (ix * iy < pg.w * pg.h * 0.3) continue; // logo/selo solto não é fundo
        if (!melhor || o.r.w * o.r.h > melhor.r.w * melhor.r.h) melhor = o;
      }
      if (melhor) { usados.add(melhor.im); pg.fundo = soltarUse(melhor.im); prepararFundo(pg.fundo); }
      return pg;
    });
  } else {
    const encs = $$(':scope > g[id^="ENCARTE_"]', S.svg);
    S.paginas = encs.map(g => {
      const fundo = $('image', g);
      if (!fundo) { const b = g.getBBox(); return { x: b.x, y: b.y, w: b.width, h: b.height, g, fundo: null }; }
      const b = fundo.getBBox(), m = matriz(fundo);
      prepararFundo(fundo);
      return { x: m.e + b.x * m.a, y: m.f + b.y * m.d, w: b.width * m.a, h: b.height * m.d, g, fundo };
    }).sort((a, b) => a.x - b.x);
    if (!S.paginas.length) { const b = S.svg.getBBox(); S.paginas = [{ x: b.x, y: b.y, w: b.width, h: b.height }]; }
  }
  for (const tx of S.textos) {
    const r = tx.txts[0].getBoundingClientRect(), c = pontoSvg(r.left + r.width / 2, r.top + r.height / 2);
    let i = S.paginas.findIndex(pg => c.x >= pg.x && c.x <= pg.x + pg.w && c.y >= pg.y && c.y <= pg.y + pg.h);
    if (i < 0) i = S.paginas.findIndex(pg => c.x >= pg.x && c.x <= pg.x + pg.w);
    tx.pagina = Math.max(0, i);
  }
  const nav = $('#paginas');
  // ＋ Página = cópia da página 1 (paginasExtras); ✕ só aparece na última página extra
  const extras = (S.edicao && S.edicao.paginasExtras || []).length;
  nav.innerHTML = S.paginas.map((_, i) => `<button data-p="${i}">Página ${i + 1}</button>`).join('')
    + `<button id="pg-duplicar" title="Nova página, cópia da página 1">＋ Página</button>`
    + (extras ? `<button id="pg-apagar" class="oculto" title="Apagar esta página (cópia da página 1)">✕</button>` : '');
  nav.onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.p) return irPagina(+b.dataset.p);
    if (b.id === 'pg-duplicar') {
      if (confirm('Criar uma página nova, cópia da página 1 do template?')) await duplicarPagina(0);
    } else if (b.id === 'pg-apagar') {
      if (confirm(`Apagar a página ${S.pagina + 1}? Os produtos dela saem da edição.`)) await apagarPaginasExtras(1);
    }
  };
}

// -1 = fora das páginas (card de reserva largado fora da prancheta)
function paginaDe(p) {
  const cx = p.cell.x + p.cell.w / 2, cy = p.cell.y + p.cell.h / 2;
  return S.paginas.findIndex(pg => cx >= pg.x && cx <= pg.x + pg.w && cy >= pg.y && cy <= pg.y + pg.h);
}

// ---------------------------------------------------------------- páginas extras (duplicar a página 1)
// Lista com mais "=== PAGINA ===" que pranchetas no template: a página 1 do template é clonada numa
// prancheta nova à direita (regra do Matheus, 07/10/2026; a SMD-658 foi duplicada à mão no .ai).
// A ficha guarda só o pedido (paginasExtras: [{de: 0}, …]); ao abrir, o clone é refeito no SVG do
// template ANTES de ler cards e textos, então cards, textos da arte, fundo e grid_area da página nova
// entram como se viessem do .ai. Os clones vão pro fim do SVG: textos e cards das páginas que já
// existiam mantêm a ordem (e as chaves da ficha).
const VAO_PRANCHETAS = 20; // vão padrão do Illustrator entre pranchetas
function paginasBase(pr) {
  if (pr) return pr.map(pc => ({ nome: pc.nome || '', x: +pc.x, y: +pc.y, w: +pc.w, h: +pc.h }));
  const encs = $$(':scope > g[id^="ENCARTE_"]', S.svg);
  if (encs.length) return encs.map(g => ({ ...retSvgBBox($('image', g) || g), nome: g.id })).sort((a, b) => a.x - b.x);
  const b = S.svg.getBBox();
  return [{ nome: '', x: b.x, y: b.y, w: b.width, h: b.height }];
}
// recorte, máscara ou filtro (a sombra do Illustrator tem região fixa em coordenada do usuário): o
// deslocamento tem que ir NESSE elemento, senão o conteúdo sai da região e some. Lê o estilo computado
// (a sombra vem pela classe), então o elemento já tem que estar no documento.
function recortado(e) {
  const cs = getComputedStyle(e);
  return (cs.clipPath && cs.clipPath !== 'none') || (cs.mask && cs.mask !== 'none') || (cs.filter && cs.filter !== 'none')
    || e.hasAttribute('clip-path') || e.hasAttribute('mask') || e.hasAttribute('filter');
}
// grupo sem transform: o editor escreve nos filhos em coordenada da raiz (célula, nome, preço), então
// o deslocamento desce até os filhos; o resto ganha translate (rect/image/use soltos, x += dx)
function deslocar(e, dx) {
  const tr = e.getAttribute('transform');
  if (e.tagName === 'g' && !tr && !recortado(e)) { for (const c of e.children) deslocar(c, dx); return; }
  if (!tr && !recortado(e) && /^(rect|image|use)$/.test(e.tagName)) { e.setAttribute('x', arred((+e.getAttribute('x') || 0) + dx)); return; }
  e.setAttribute('transform', `translate(${arred(dx)} 0)${tr ? ' ' + tr : ''}`);
}
// ids da página nova: PRODUTO_N continua a numeração (produto_NN_* acompanha), grid_area_NN também;
// o resto ganha "-pN" (N = número da página nova)
function renomeador(n) {
  const num = g => +(((g.getAttribute('data-name') || g.id).match(/\d+/) || [0])[0]);
  let prox = Math.max(0, ...$$('g[id^="PRODUTO_"]', S.svg).filter(g => /^PRODUTO_\d+/.test(g.id)).map(num)) + 1;
  let ga = Math.max(0, ...$$('[id^="grid_area"]', S.svg).map(e => +((e.id.match(/(\d+)$/) || [0, 0])[1])));
  const usados = new Set($$('[id]', S.svg).map(e => e.id));
  const unico = id => { while (usados.has(id)) id += '_'; usados.add(id); return id; };
  const pad = k => String(k).padStart(2, '0');
  const um = (e, card) => {
    if (!e.id) return card;
    if (e.tagName === 'g' && /^PRODUTO_\d+/.test(e.id)) {
      card = prox++;
      e.id = unico(e.id.replace(/^PRODUTO_\d+/, 'PRODUTO_' + card));
      if (e.hasAttribute('data-name')) e.setAttribute('data-name', e.getAttribute('data-name').replace(/\d+/, card));
    } else if (card != null && /^produto_\d+_/.test(e.id)) e.id = unico(e.id.replace(/^produto_\d+_/, `produto_${pad(card)}_`));
    else if (/^grid_area/.test(e.id) && /\d+$/.test(e.id)) e.id = unico(e.id.replace(/\d+$/, pad(++ga)));
    else e.id = unico(e.id + '-p' + n);
    return card;
  };
  const tudo = (e, card) => { card = um(e, card); for (const c of e.children) tudo(c, card); };
  return { casca: e => um(e, null), tudo: e => tudo(e, null) };
}
// clona o que é da prancheta pg (≥ 80% dentro, ou o centro dentro) deslocado dx; camada que mistura
// páginas vira uma casca (mesma classe/estilo, sem filhos) e desce
function clonarPagina(pg, dx, n) {
  const inter = r => Math.max(0, Math.min(r.x + r.w, pg.x + pg.w) - Math.max(r.x, pg.x)) * Math.max(0, Math.min(r.y + r.h, pg.y + pg.h) - Math.max(r.y, pg.y));
  const centro = r => { const cx = r.x + r.w / 2, cy = r.y + r.h / 2; return cx >= pg.x && cx <= pg.x + pg.w && cy >= pg.y && cy <= pg.y + pg.h; };
  const PULA = /^(defs|metadata|style|title|desc|script|linearGradient|radialGradient|clipPath|mask|filter|symbol|pattern)$/;
  const ids = renomeador(n);
  const visita = (e, destino) => {
    if (PULA.test(e.tagName) || e.id === 'ed-ui') return;
    let r; try { r = retSvgBBox(e); } catch (er) { return; }
    if (!(r.w > 0 || r.h > 0)) return;
    const a = r.w * r.h, q = a > 1 ? inter(r) / a : centro(r) ? 1 : 0;
    if (q <= 0) return;
    if (q < 0.8 && e.tagName === 'g' && !e.hasAttribute('transform') && !recortado(e)) {
      const casca = e.cloneNode(false); ids.casca(casca); destino.appendChild(casca);
      for (const c of [...e.children]) visita(c, casca);
      if (!casca.children.length) casca.remove();
      return;
    }
    if (q < 0.8 && !centro(r)) return;
    const c = e.cloneNode(true);
    destino.appendChild(c); deslocar(c, dx); ids.tudo(c);
  };
  for (const c of [...S.svg.children]) visita(c, S.svg);
}
// refaz as páginas extras da ficha sobre o SVG do template; devolve as pranchetas novas
function aplicarPaginasExtras(extras, base) {
  const novas = [];
  if (!Array.isArray(extras) || !base.length) return novas;
  for (const ex of extras) {
    const todas = [...base, ...novas], src = base[Math.max(0, Math.min(base.length - 1, (ex && ex.de) | 0))];
    const ord = todas.slice().sort((a, b) => a.x - b.x);
    let vao = Infinity;
    for (let k = 1; k < ord.length; k++) { const v = ord[k].x - (ord[k - 1].x + ord[k - 1].w); if (v > 0) vao = Math.min(vao, v); }
    if (!isFinite(vao)) vao = VAO_PRANCHETAS;
    const x = Math.max(...todas.map(p => p.x + p.w)) + vao;
    clonarPagina(src, x - src.x, todas.length + 1);
    novas.push({ nome: `Prancheta ${todas.length + 1}`, x, y: src.y, w: src.w, h: src.h, extra: true });
  }
  return novas;
}
// Automação (page.evaluate): duplicarPagina(de, quantas) → true/false; apagarPaginasExtras(quantas) →
// true/false. Os dois salvam a edição e reabrem (o clone é refeito do template, igual ao abrir).
async function duplicarPagina(de = 0, quantas = 1) {
  const ed = S.edicao; if (!ed || !S.carregado || !(quantas > 0)) return false;
  const antes = ed.paginasExtras || [], n = S.paginas.length;
  ed.paginasExtras = [...antes, ...Array.from({ length: quantas }, () => ({ de }))];
  if (!await salvar()) { ed.paginasExtras = antes; aviso('Não consegui salvar: a página não foi duplicada'); return false; }
  await abrirEdicao(ed.id);
  if (!S.carregado) return false;
  irPagina(n);
  aviso(quantas > 1 ? `${quantas} páginas novas (cópias da página ${de + 1})` : `Página ${n + 1} criada (cópia da página ${de + 1})`);
  return true;
}
// tira as últimas páginas extras: cards, grades e linhas delas saem da ficha junto
async function apagarPaginasExtras(quantas = 1) {
  const ed = S.edicao; if (!ed || !S.carregado) return false;
  const ex = ed.paginasExtras || []; quantas = Math.min(quantas, ex.length);
  if (!(quantas > 0)) return false;
  const fica = S.paginas.length - quantas;
  const prods = S.produtos, grades = S.grades, linhas = S.linhas;
  S.produtos = prods.filter(p => { const i = paginaDe(p); return i < 0 || i < fica; });
  S.grades = Object.fromEntries(Object.entries(grades).filter(([k]) => paginaDaZona(k) < fica));
  S.linhas = linhas.filter(l => l.pagina < fica);
  ed.paginasExtras = ex.slice(0, ex.length - quantas);
  const ok = await salvar();
  if (!ok) { S.produtos = prods; S.grades = grades; S.linhas = linhas; ed.paginasExtras = ex; aviso('Não consegui salvar: a página ficou'); return false; }
  await abrirEdicao(ed.id);
  if (S.carregado) irPagina(Math.min(S.pagina, S.paginas.length - 1));
  return S.carregado;
}

// ---------------------------------------------------------------- faixa de campanha
// ficha.campanha = {pagina, n, selo, borda}: a 1ª fileira da página vira a faixa da campanha (fundo
// vermelho + moldura + selo à esquerda) com uma zona própria (grid_area_sorteio) pra n cards (1 ou 2);
// a grid_area da página desce pro resto. Vale pra qualquer template: quem decide página e n é o
// somado-encarte montar, pela lista (mercados.json → campanhas_promocionais.<x>.editor). Regra do
// Matheus de 06/10/2026 (sorteio de Natal do Marcelino). Medidas tiradas da Quarta da Padaria dele.
const ZONA_CAMPANHA = 'grid_area_sorteio';
function aplicarCampanha(c) {
  if (!c || !(c.n > 0) || !S.paginas[c.pagina] || $('#' + ZONA_CAMPANHA, S.svg)) return;
  const pg = S.paginas[c.pagina];
  const dentro = r => { const cx = r.x + r.w / 2, cy = r.y + r.h / 2; return cx >= pg.x && cx <= pg.x + pg.w && cy >= pg.y && cy <= pg.y + pg.h; };
  const ga = $$('[id^="grid_area"]', S.svg).filter(e => !e.closest('defs') && e.tagName.toLowerCase() === 'rect')
    .map(e => ({ e, r: retSvgBBox(e) })).filter(o => o.r.w > 1 && o.r.h > 1 && dentro(o.r)).sort((a, b) => a.r.y - b.r.y)[0];
  if (!ga) return;
  const A = ga.r, esp = 4, pai = ga.e.parentNode;
  // altura da faixa = a fileira típica da página (mediana dos cards), entre 22% e 40% da área
  const hs = S.produtos.filter(p => paginaDe(p) === c.pagina).map(p => p.card.h).sort((a, b) => a - b);
  let h = hs.length ? hs[Math.floor(hs.length / 2)] : A.h / 3;
  h = Math.min(Math.max(h, A.h * 0.22), A.h * 0.4);
  // coordenadas do pai da grid_area (quase sempre as da raiz)
  const inv = matrizAteRaiz(pai).inverse();
  const loc = (x, y) => { const q = S.svg.createSVGPoint(); q.x = x; q.y = y; return q.matrixTransform(inv); };
  const ret = (el, x, y, w, hh) => {
    const a = loc(x, y), b = loc(x + w, y + hh);
    el.setAttribute('x', a.x); el.setAttribute('y', a.y); el.setAttribute('width', b.x - a.x); el.setAttribute('height', b.y - a.y);
    return el;
  };
  const novo = (tag, at = {}) => { const el = document.createElementNS(NS, tag); for (const k in at) el.setAttribute(k, at[k]); return el; };
  const img = (arq, ar) => { const im = novo('image', { preserveAspectRatio: ar, 'data-arq': arq }); setHref(im, urlImg(arq, 1600)); return im; };
  let defs = $('defs', S.svg); if (!defs) { defs = novo('defs'); S.svg.insertBefore(defs, S.svg.firstChild); }
  if (!$('#campanha_grad', S.svg)) {
    const gr = novo('linearGradient', { id: 'campanha_grad', x1: '0', y1: '0.3', x2: '1', y2: '0.7' });
    gr.append(novo('stop', { offset: '0.0125', 'stop-color': '#c1261b' }), novo('stop', { offset: '1', 'stop-color': '#dd0000' }));
    defs.append(gr);
  }
  if (!$('#campanha_css', S.svg)) {
    const st = novo('style', { id: 'campanha_css' });
    st.textContent = '.ed-campanha [id^="MARGEM_GRID"],.ed-campanha [id^="MARGEM_GRID"] *{fill:none!important;stroke:none!important}'
      + '.ed-campanha [id$="_nome"] text,.ed-campanha [id$="_nome"] tspan{fill:#fff8e7!important;stroke:#5a0b0b!important;'
      + 'stroke-width:6px!important;paint-order:stroke!important;stroke-linejoin:round!important}';
    defs.append(st);
  }
  const g = novo('g', { id: 'campanha_faixa' });
  g.append(ret(novo('rect', { fill: 'url(#campanha_grad)', rx: h * 0.3, ry: h * 0.3 }), A.x, A.y - 2, A.w, h));
  if (c.borda) g.append(ret(img(c.borda, 'none'), A.x - h * 0.051, A.y - h * 0.045, A.w + h * 0.106, h * 1.11));
  const sx = A.x + A.w * 0.036, sw = h * 0.955;
  if (c.selo) g.append(ret(img(c.selo, 'none'), sx, A.y - h * 0.043, sw, h * 1.057));
  // zona: 1 produto = 2 espaços à direita do selo; 2 produtos = do selo até a borda
  const zx = Math.max(c.n >= 2 ? A.x + A.w * 0.311 : A.x + A.w * 0.4536, sx + sw + 10);
  const zr = c.n >= 2 ? A.x + A.w * 0.957 : A.x + A.w * 0.9269;
  const zona = ret(novo('rect', { id: ZONA_CAMPANHA, fill: 'none' }), zx, A.y + h * 0.031, zr - zx, h * 0.943);
  pai.insertBefore(g, ga.e.nextSibling);
  pai.insertBefore(zona, g.nextSibling);
  ret(ga.e, A.x, A.y + h + esp, A.w, A.h - h - esp);
}

// ---------------------------------------------------------------- zonas da grade
// Cada grid_area é uma zona (ex.: 007 tem a faixa de destaques e a de normais na mesma
// página). Página sem grid_area = uma zona só, a união dos cards (como era antes).
function montarZonas() {
  S.zonas = []; S.porZona = {};
  const gas = $$('[id^="grid_area"]', S.svg).filter(e => !e.closest('defs'))
    .map(e => ({ el: e, r: retSvgBBox(e) })).filter(o => o.r.w > 1 && o.r.h > 1);
  S.paginas.forEach((pg, i) => {
    const minhas = gas.filter(o => {
      const cx = o.r.x + o.r.w / 2, cy = o.r.y + o.r.h / 2;
      return cx >= pg.x && cx <= pg.x + pg.w && cy >= pg.y && cy <= pg.y + pg.h;
    });
    // ordem de leitura: faixas de cima pra baixo (tolerância de 60), dentro da faixa da esquerda pra direita.
    // A faixa conta do topo da prancheta: no construtor as pranchetas ficam uma embaixo da outra e o y
    // absoluto jogava zonas da mesma linha em faixas diferentes
    const faixa = o => Math.round((o.r.y - pg.y) / 60);
    minhas.sort((a, b) => faixa(a) - faixa(b) || a.r.x - b.r.x);
    if (!minhas.length) minhas.push({ el: null, r: null });
    for (const o of minhas) {
      let chave = o.el ? o.el.id : 'pag:' + (pg.nome || i + 1);
      while (S.porZona[chave]) chave += '+';
      const z = { chave, pagina: i, ret: o.r, el: o.el };
      S.zonas.push(z); S.porZona[chave] = z;
    }
  });
}
function zonasDaPagina(i) { return S.zonas.filter(z => z.pagina === i); }
// área atual da zona (a editada, ou a grid_area do template)
function areaDaZona(z) { return (S.grades[z.chave] && S.grades[z.chave].area) || z.ret; }
// zona = a que contém o centro do card (a menor, se mais de uma); senão a mais próxima da página
function zonaPorCentro(p) {
  const i = paginaDe(p); if (i < 0) return null;
  const zs = zonasDaPagina(i);
  if (zs.length <= 1) return zs[0] ? zs[0].chave : null;
  const cx = p.cell.x + p.cell.w / 2, cy = p.cell.y + p.cell.h / 2;
  const com = zs.map(z => ({ z, r: areaDaZona(z) })).filter(o => o.r);
  const dentro = com.filter(({ r }) => cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h);
  if (dentro.length) return dentro.sort((a, b) => a.r.w * a.r.h - b.r.w * b.r.h)[0].z.chave;
  const dist = r => Math.hypot(Math.max(r.x - cx, 0, cx - (r.x + r.w)), Math.max(r.y - cy, 0, cy - (r.y + r.h)));
  com.sort((a, b) => dist(a.r) - dist(b.r));
  return com.length ? com[0].z.chave : zs[0].chave;
}
// card repetido exatamente embaixo de outro (o .ai da semana anterior deixa a cópia velha
// escondida atrás da nova): fica só o de cima (o último no SVG), senão a grade conta os dois
function esconderEmpilhados() {
  const ps = S.produtos, igual = (a, b) => ['x', 'y', 'w', 'h'].every(k => Math.abs(a.card[k] - b.card[k]) < 2);
  ps.forEach((p, i) => {
    if (ps.slice(i + 1).some(q => igual(p, q))) { p.removido = true; p.empilhado = true; p.g.style.display = 'none'; }
  });
}
function atribuirZonas(ps = S.produtos) {
  for (const p of ps) { p.zona = zonaPorCentro(p); p.g.classList.toggle('ed-campanha', p.zona === ZONA_CAMPANHA); }
}
function ativosDaZona(k) { return ordemLeitura(S.produtos.filter(p => !p.removido && p.zona === k)); }
function paginaDaZona(k) { return S.porZona[k] ? S.porZona[k].pagina : -1; }
// zona que o painel Grade mostra: a do produto selecionado, senão a escolhida, senão a 1ª da página
function zonaAtual() {
  const zs = zonasDaPagina(S.pagina);
  if (S.sel && S.sel.zona && zs.some(z => z.chave === S.sel.zona)) S.zonaAtiva = S.sel.zona;
  if (!zs.some(z => z.chave === S.zonaAtiva)) S.zonaAtiva = zs[0] ? zs[0].chave : null;
  return S.zonaAtiva;
}
function produtosDaZona(k) { return S.produtos.filter(p => p.zona === k); }

// ficha: {<chaveZona>: {...}}; a antiga era um array por página (→ a zona única daquela página,
// com a página contada na ordem antiga, da esquerda pra direita)
function aplicarGradesDaFicha(gr) {
  S.gradesPend = {}; S.gradesLegado = new Set();
  if (!gr) return;
  const pares = [];
  if (Array.isArray(gr)) gr.forEach((g, i) => {
    const pg = paginaLegada(i), zs = pg >= 0 ? zonasDaPagina(pg) : [];
    if (g && zs.length === 1) pares.push([zs[0].chave, g]);
  });
  else for (const k in gr) pares.push([k, gr[k]]);
  for (const [k, g] of pares) {
    if (!g || !S.grades[k]) continue;
    const pg = S.paginas[paginaDaZona(k)], A = g.area;
    const ok = A && pg && A.w > pg.w * 0.05 && A.h > pg.h * 0.05 && A.x >= pg.x - pg.w * 0.1 && A.x + A.w <= pg.x + pg.w * 1.1;
    // template republicado com a zona em outro lugar/tamanho (areaTpl = a zona do template quando a ficha
    // foi gravada): a edição abre como estava e a mudança fica pendente pro "Atualizar template"
    const T = S.grades[k].area, T0 = g.areaTpl;
    if (ok && T0 && !mesmaCaixa(T0, T, 0.5)) S.gradesPend[k] = { ...T0 };
    if (ok && !T0) S.gradesLegado.add(k);
    const { areaTpl, ...resto } = g;
    // linha incompleta sempre embaixo: vale também pras fichas salvas antes da regra
    Object.assign(S.grades[k], resto, { area: ok ? A : T, cheiasEmCima: regraTpl('linha_incompleta_embaixo', true), linha1: S.grades[k].linha1 });
  }
}
// índice da página na ordem antiga (ENCARTE_ da esquerda pra direita)
function paginaLegada(i) {
  const ord = S.paginas.map((pg, k) => k).sort((a, b) => S.paginas[a].x - S.paginas[b].x || S.paginas[a].y - S.paginas[b].y);
  return ord[i] != null ? ord[i] : -1;
}
// fundo trocado: acha a página pela imagem original (orig); ficha antiga só tem o índice
function paginaDoFundo(est) {
  if (est.orig) {
    const is = S.paginas.map((pg, i) => i).filter(i => S.paginas[i].fundo && S.paginas[i].fundo.dataset.arqOrig === est.orig);
    return is.includes(est.pagina) ? est.pagina : is.length ? is[0] : -1;
  }
  return paginaLegada(est.pagina);
}

function irPagina(i) {
  S.pagina = Math.max(0, Math.min(i, S.paginas.length - 1));
  guardar.pôr('pag:' + S.edicao.id, S.pagina);
  $$('#paginas button[data-p]').forEach((b, k) => b.classList.toggle('ativa', k === S.pagina));
  const ap = $('#pg-apagar'); if (ap) ap.classList.toggle('oculto', S.pagina !== S.paginas.length - 1 || S.pagina < (S.paginasTpl || 1));
  const pg = S.paginas[S.pagina];
  const pad = pg.w * 0.02;
  camera({ x: pg.x - pad, y: pg.y - pad, w: pg.w + pad * 2, h: pg.h + pad * 2 });
  painel();
}

function camera(vb) {
  S.vb = vb;
  S.svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  desenharSelecao();
}

function pontoSvg(cx, cy) {
  const pt = S.svg.createSVGPoint(); pt.x = cx; pt.y = cy;
  return pt.matrixTransform(S.svg.getScreenCTM().inverse());
}
// retângulo de qualquer elemento no espaço do SVG (já com todas as transformações)
function retSvg(e) {
  const r = e.getBoundingClientRect();
  const a = pontoSvg(r.left, r.top), b = pontoSvg(r.right, r.bottom);
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
}

// ---------------------------------------------------------------- texto
function escreverTexto(t, linhas, x, ancora, fonte, entre, m) {
  // x no espaço do card (convertido pela matriz do texto); m = null → x já é local
  const xl = m ? (x - m.e) / m.a : x;
  t.textContent = '';
  t.setAttribute('text-anchor', ancora);
  if (fonte) t.style.fontSize = fonte + 'px';
  linhas.forEach((ln, i) => {
    const s = document.createElementNS(NS, 'tspan');
    s.setAttribute('x', arred(xl));
    s.setAttribute('y', arred(i * entre));
    s.textContent = ln;
    t.appendChild(s);
  });
  // confere onde o texto caiu de verdade e compensa (espaçamento herdado da classe,
  // métrica da fonte etc. deslocam o ponto de ancoragem)
  try {
    const bb = t.getBBox();
    const real = ancora === 'end' ? bb.x + bb.width : ancora === 'middle' ? bb.x + bb.width / 2 : bb.x;
    const d = xl - real;
    if (Math.abs(d) > 0.05) for (const s of t.children) s.setAttribute('x', arred(+s.getAttribute('x') + d));
  } catch (e) { /* invisível: sem medida */ }
}
function largura(t, m) { try { return t.getBBox().width * m.a; } catch (e) { return 0; } }

function quebrarEmDuas(txt) {
  const pal = txt.split(' ');
  if (pal.length < 2) return [txt];
  let melhor = null;
  for (let i = 1; i < pal.length; i++) {
    const a = pal.slice(0, i).join(' '), b = pal.slice(i).join(' ');
    const d = Math.abs(a.length - b.length);
    if (!melhor || d < melhor.d) melhor = { d, l: [a, b] };
  }
  return melhor.l;
}
// k linhas de tamanho parecido (a linha mais comprida a menor possível)
function quebrarEm(txt, k) {
  const pal = txt.split(' ').filter(Boolean);
  if (pal.length < k) return [txt];
  let melhor = null;
  const corta = (ini, resto, acc) => {
    if (resto === 1) { const l = [...acc, pal.slice(ini).join(' ')], m = Math.max(...l.map(s => s.length)); if (!melhor || m < melhor.m) melhor = { m, l }; return; }
    for (let i = ini + 1; i <= pal.length - resto + 1; i++) corta(i, resto - 1, [...acc, pal.slice(ini, i).join(' ')]);
  };
  corta(0, k, []);
  return melhor.l;
}

// ---------------------------------------------------------------- renderização do produto
function larguraCaixaNome(p) { return p.area.w * 0.98 * p.nomeCaixa; }
// caixa do nome do construtor; com fundo do nome que estica, o texto pode ir além dela até 4 pt da
// borda do card (menos as margens do fundo), pro lado que o alinhamento deixa crescer
function larguraCaixaConstrutor(p, cx) {
  const c = p.base.caixaNome;
  if (!c || !c.construtor || c.regra !== 'estica') return cx.w;
  const L = p.card.x + 4 + c.m.l, R = p.card.x + p.card.w - 4 - c.m.r;
  const disp = cx.ancora === 'end' ? cx.x + cx.w - L : cx.ancora === 'middle' ? 2 * Math.min(cx.x + cx.w / 2 - L, R - (cx.x + cx.w / 2)) : R - cx.x;
  return Math.max(cx.w, disp);
}
// nome que mora na tarja do preço (J Meroto Terça da Feira): padrão do tema com titulo.segue = "preco"
// Card do construtor com Fundo do nome de verdade não entra nessa regra: a tarja é dele e a posição
// é a que o construtor desenhou (Redemais Quarta do Filé, 20/10/2026: a regra prendia o nome no R$ e
// travava a fonte)
function nomeNaTarja(p) { return !!(S.padrao && S.padrao.titulo && S.padrao.titulo.segue === 'preco' && p.precoG && p.precoG !== p.g && !(p.base.caixaNome && p.base.caixaNome.construtor)); }
function renderNome(p) {
  const b = p.base.nome; if (!b) return;
  // na tarja: alinhado à esquerda onde o template pôs, até perto do R$
  const tarja = nomeNaTarja(p);
  // tarja alargada (fundoW > 1) cresce pros dois lados: o nome anda junto com a borda esquerda
  const alarga = tarja && p.base.fundo ? (p.fundoW - 1) * p.base.fundo.w / 2 : 0;
  // sem regra de posição do cliente, o nome que o template alinhou à esquerda continua à esquerda
  // com tarja própria (p.caixaNome) o texto fica alinhado à esquerda dentro dela, como no template
  const esquerda = !tarja && !!(p.caixaNome || (b.esquerda && !(S.padrao && S.padrao.titulo)));
  // caixa desenhada no construtor: o nome fica nela, com o alinhamento que o template deu
  const cx = !tarja && b.caixa ? b.caixa : null;
  // preso ao preço: o texto segue o alinhamento do nome no construtor (Matheus: direita travada, texto à
  // esquerda); quem obedece aos limites é a caixa inteira, em nomePresoAoPreco
  const preso = !tarja ? p.base.preso || null : null;
  const auto = cx ? cx.ancora : preso || tarja || esquerda ? 'start' : 'middle';
  const x0 = cx ? cx.x + cx.w * (auto === 'middle' ? 0.5 : auto === 'end' ? 1 : 0) : tarja ? b.esq - alarga : esquerda ? b.esq : b.cx;
  // alinhamento escolhido à mão (p.nomeAlinha: start|middle|end); sem ele, o editor decide (auto)
  const ancora = ['start', 'middle', 'end'].includes(p.nomeAlinha) ? p.nomeAlinha : auto;
  p.nomeX = tarja ? x0 : null;
  // na tarja o nome cresce/encolhe junto com ela (fatorTarja), pra caber no mesmo lugar, e
  // "Caixa ↔" nunca leva o nome pra menos de 10 do R$
  const kt = tarja ? fatorTarja(p) : 1;
  const livre = tarja && p.base.moeda ? p.base.moeda.esq - x0 : 0;
  const cm = preso ? (p.base.caixaNome && p.base.caixaNome.m) || { l: 0, r: 0 } : null;
  let maxW = preso ? Math.max(20, p.cell.w - (preso.esq || 0) - (preso.dir || 0) - cm.l - cm.r) * p.nomeCaixa
    : tarja && p.base.moeda ? Math.min((livre - 14) * p.nomeCaixa, livre - 10) * kt * p.escPreco
    // caixa do construtor (card horizontal: nome na tarja à direita da foto): acompanha a largura do card
    : cx ? larguraCaixaConstrutor(p, cx) * (p.cell.w / p.card.w) * p.nomeCaixa
    : p.caixaNome ? Math.max(b.larg, p.cell.w * 0.45) * p.nomeCaixa // tarja do nome: no canto, sem cobrir a foto
    : esquerda ? Math.max(b.larg, p.cell.w * 0.48) * p.nomeCaixa // divide o card com a foto à direita
    // a caixa do nome nunca é menor que a largura que o próprio template já dava ao nome (a área da
    // foto pode ser mais estreita que o título: Ovos Cartela do Preço Certo)
    : Math.max(larguraCaixaNome(p), Math.min(b.larg * (p.cell.w / p.card.w), p.cell.w * 0.96) * p.nomeCaixa);
  // alinhado à mão: o texto encosta na esquerda, no meio ou na direita da caixa do nome (a mesma
  // largura máxima de sempre, então continua cabendo no mesmo lugar)
  // tamanho aumentado à mão manda: a caixa alarga junto (até a largura do card) em vez de o editor
  // encolher a fonte de volta pra caber na largura antiga
  if (p.escNome > 1 && !tarja) maxW = Math.max(maxW, Math.min(maxW * p.escNome, p.cell.w - 8));
  let x = x0;
  if (ancora !== auto) {
    const L = auto === 'start' ? x0 : auto === 'end' ? x0 - maxW : x0 - maxW / 2;
    x = ancora === 'start' ? L : ancora === 'end' ? L + maxW : L + maxW / 2;
  }
  let linhas = (p.nome || '').split('\n').map(s => s.trim()).filter(Boolean);
  if (!linhas.length) linhas = [''];
  const passo = (b.entre || b.fonte) / b.fonte * p.nomeEntre; // entrelinha proporcional à fonte
  const ultimo = p.nomeTxts[p.nomeTxts.length - 1];
  const m = b.ms[b.ms.length - 1];
  const tenta = (ls, f) => { escreverTexto(ultimo, ls, x, ancora, f, f * passo, m); return largura(ultimo, m); };
  let fonte = b.fonte * p.escNome * kt * fatorCardBaixo(p);
  let w = tenta(linhas, fonte);
  // "Caixa ↕" (p.nomeLinhas, escolhido à mão): o nome usa até essa quantidade de linhas antes de
  // encolher, com o menor número de linhas que couber. Quebra digitada (Enter) continua mandando.
  // A caixa do construtor traz o padrão do template (data-linhas; sem ele, 2, como mostra o construtor);
  // o "Caixa ↕" vale por cima.
  const maxL = linhas.length === 1 ? p.nomeLinhas || (S.catalogo ? 2 : 0) || (cx && (cx.linhas || 2)) || 0 : 0;
  if (maxL) {
    let melhor = null;
    for (let k = 1; k <= maxL; k++) {
      const ls = k === 1 ? [linhas[0]] : quebrarEm(linhas[0], k); if (ls.length !== k) break;
      const wk = tenta(ls, fonte);
      if (!melhor || wk < melhor.w) melhor = { ls, w: wk };
      if (wk <= maxW) break;
    }
    if (melhor) { linhas = melhor.ls; w = tenta(linhas, fonte); }
  } else {
    if (w > maxW && linhas.length === 1) { const duas = quebrarEmDuas(linhas[0]); if (duas.length === 2) { linhas = duas; w = tenta(linhas, fonte); } }
    // tarja do nome: nome comprido desce pra 3 linhas antes de encolher (regra dos 17 pt da Redemais)
    if (w > maxW && p.caixaNome && linhas.length === 2) { const tres = quebrarEm(linhas.join(' '), 3); if (tres.length === 3) { linhas = tres; w = tenta(linhas, fonte); } }
  }
  p.encolheu = 1;
  // nome nunca fica abaixo de PISO_PT (15 pt, regra do Matheus), nem com tamanho escolhido à mão
  // ou template menor. O piso do cliente (titulo.min_pt: Marcelino 15, Redemais 17) vale pra o nome
  // que encolheu sozinho; tamanho pedido menor que ele fica, desde que não passe do piso. Com 2 linhas
  // abaixo do mínimo, tenta 3 antes de encolher. O mínimo é em pt da página: a fonte do <text> é
  // local e o texto pode ter escala própria.
  const minCli = regraTpl('titulo_min_pt', S.padrao && S.padrao.titulo && S.padrao.titulo.min_pt);
  const kl = escalaAteRaiz(ultimo) || 1;
  const minPt = Math.max(PISO_PT / kl, Math.min((minCli || PISO_PT) / kl, b.fonte * p.escNome));
  if (!maxL && w > maxW && !tarja && linhas.length === 2 && fonte * maxW / w < minPt) {
    const tres = quebrarEm(linhas.join(' '), 3);
    if (tres.length === 3) { const w3 = tenta(tres, fonte); if (w3 < w) { linhas = tres; w = w3; } }
  }
  if (w > maxW) { p.encolheu = maxW / w; fonte *= p.encolheu; }
  // passa da caixa antes de ficar ilegível
  if (fonte < minPt) { p.encolheu *= minPt / fonte; fonte = minPt; }
  // na tarja também cabe na altura: até ~80% dela, que é o que o template usa com 2 linhas
  if (tarja && p.base.fundo) {
    const maxH = p.base.fundo.h * p.fundoH * kt * p.escPreco * 0.8;
    escreverTexto(ultimo, linhas, x, ancora, fonte, fonte * passo, m);
    let h = 0; try { h = ultimo.getBBox().height * Math.abs(m.d); } catch (e) { /* sem medida */ }
    if (h > maxH) { p.encolheu *= maxH / h; fonte *= maxH / h; }
    if (fonte < PISO_PT / kl) { p.encolheu *= PISO_PT / kl / fonte; fonte = PISO_PT / kl; }
  }
  p.nomeTxts.forEach((t, i) => escreverTexto(t, linhas, x, ancora, fonte, fonte * passo, b.ms[i]));
  // catálogo: 2 linhas não passam da altura da linha (aperta a entrelinha até 0,9 antes de invadir a de baixo)
  if (S.catalogo && linhas.length > 1) {
    for (let ps2 = passo, k = 0; k < 8; k++) {
      const tb = bbTextosNome(p); if (!tb.height || tb.height <= p.cell.h - 2 || ps2 <= 0.9) break;
      ps2 = Math.max(0.9, ps2 - 0.05);
      p.nomeTxts.forEach((t, i) => escreverTexto(t, linhas, x, ancora, fonte, fonte * ps2, b.ms[i]));
    }
  }
  p.nomeNLinhas = linhas.length; // quantas saíram (o "Caixa ↕" parte daqui)
  p.nomeAncora = ancora; // o fundo do nome que abraça o texto cresce a partir desse lado
  if (cx && cx.y != null) assentarNomeNaCaixa(p, cx);
  ajustarCaixaNome(p);
  posNome(p);
}
// bloco de linhas no topo, no meio ou no pé da caixa do construtor (2 ou 3 linhas descem, crescem pros
// dois lados ou sobem), sem subir além do topo do card. posNome mantém o topo.
function assentarNomeNaCaixa(p, cx) {
  const tb = bbTextosNome(p); if (!tb.height) return;
  const folga = cx.h - tb.height;
  const topo = Math.max(cx.y + (cx.v === 'baixo' ? folga : cx.v === 'centro' ? folga / 2 : 0), p.card.y + 2), d = topo - tb.y;
  if (Math.abs(d) < 0.05) return;
  for (const t of p.nomeTxts) {
    const k = matriz(t).d || 1;
    for (const s of t.children) s.setAttribute('y', arred(+s.getAttribute('y') + d / k));
  }
}
// tarja do nome abraça o texto escrito, com o mesmo respiro do template
function ajustarCaixaNome(p) {
  const r = p.caixaNome, c = p.base.caixaNome; if (!r || !c) return;
  if (c.construtor) return ajustarFundoNome(p, r, c);
  const tb = bbTextosNome(p); if (!tb.width) return;
  r.setAttribute('x', arred(tb.x - c.pl)); r.setAttribute('y', arred(tb.y - c.pt));
  r.setAttribute('width', arred(tb.width + 2 * c.pl)); r.setAttribute('height', arred(tb.height + c.pt + c.pb));
}
// fundo do nome do construtor: fixo fica como o template desenhou (o texto já coube na caixa dele);
// os outros abraçam o texto com as margens, a partir do lado do alinhamento (início, meio ou fim) e
// com o texto no meio da altura. estica_encolhe nunca passa do tamanho desenhado. Forma com só alguns
// cantos arredondados (path) não muda de tamanho: fica como fixo.
function ajustarFundoNome(p, r, c) {
  const volta = () => { r.setAttribute('x', arred(c.x)); r.setAttribute('y', arred(c.y)); r.setAttribute('width', arred(c.w)); r.setAttribute('height', arred(c.h)); };
  if (r.tagName === 'path') return;
  if (c.regra !== 'estica' && c.regra !== 'estica_encolhe') return volta();
  const tb = bbTextosNome(p); if (!tb.width) return volta();
  let w = tb.width + c.m.l + c.m.r, h = tb.height + c.m.t + c.m.b;
  if (c.regra === 'estica_encolhe') { w = Math.min(w, c.w); h = Math.min(h, c.h); }
  const an = p.nomeAncora || 'start';
  const x = an === 'end' ? tb.x + tb.width + c.m.r - w : an === 'middle' ? tb.x + tb.width / 2 - w / 2 : tb.x - c.m.l;
  const y = tb.y + tb.height / 2 - h / 2;
  r.setAttribute('x', arred(x)); r.setAttribute('y', arred(y)); r.setAttribute('width', arred(w)); r.setAttribute('height', arred(h));
}
// nome: topo-centro da célula (+ ajuste manual)
// regra do cliente (padroes_mercado.json): margem/âncora por elemento
function regra(el) {
  const P = S.padrao || {}, R = P[el] || {};
  const m = R.margem_px != null ? R.margem_px : (P.margem_px != null ? P.margem_px : 8);
  return { x: R.x || 'center', y: R.y || 'top', mx: R.margem_x_px != null ? R.margem_x_px : m, my: R.margem_y_px != null ? R.margem_y_px : m, gap: R.gap_web_px != null ? R.gap_web_px : R.gap_px != null ? R.gap_px : 10 };
}
function posNome(p) {
  const c = p.cell, k = p.card;
  let dx, dy;
  const b = p.nomeG.getBBox();
  if (nomeNaTarja(p)) {
    // anda com o grupo do preço: a borda esquerda fica onde o template pôs e as linhas (1 ou 2)
    // centradas na altura da tarja (fundo_preco), tudo levado pelo mesmo deslocamento do preço
    const d = deslocPreco(p), bn = p.base.nome, f = p.base.fundo;
    const P0 = { x: p.nomeX != null ? p.nomeX : bn.esq, y: f ? f.y + f.h * p.fundoH / 2 : bn.cy };
    dx = d.a.x + (P0.x - d.a.x) * d.s + d.tx - P0.x;
    dy = d.a.y + (P0.y - d.a.y) * d.s + d.ty - (b.y + b.height / 2);
  } else if (p.base.nomeNoPreco && p.precoG && p.precoG !== p.g) {
    // tarja do nome colada em cima do preço (Redemais Hora Mais): o canto inferior-direito dela
    // segue o canto de cima-direito do fundo do preço, onde quer que a grade leve o preço
    const d = deslocPreco(p), np = p.base.nomeNoPreco, P0 = np.topoDir;
    const X = d.a.x + (P0.x - d.a.x) * d.s + d.tx, Y = d.a.y + (P0.y - d.a.y) * d.s + d.ty;
    dx = X - np.dir * d.s - (b.x + b.width);
    dy = Y - np.gap * d.s - (b.y + b.height);
  } else if (S.padrao && S.padrao.titulo && S.padrao.titulo.segue !== 'preco') {
    const R = regra('titulo');
    // alinhamento escolhido à mão vale por cima da regra do cliente (mesma margem)
    const rx = { start: 'left', middle: 'center', end: 'right' }[p.nomeAlinha] || R.x;
    dx = rx === 'left' ? c.x + R.mx - b.x : rx === 'right' ? c.x + c.w - R.mx - (b.x + b.width) : (c.x + c.w / 2) - (b.x + b.width / 2);
    dy = R.y === 'bottom' ? c.y + c.h - R.my - (b.y + b.height) : c.y + R.my - b.y;
  } else if (p.base.nome && p.base.nome.esquerda && !p.base.nome.caixa) { dx = c.x - k.x; dy = c.y + (b.y - k.y) * fatorCardBaixo(p) - b.y; } // nome à esquerda: anda com o canto de cima-esquerdo
  else if (p.base.nome && p.base.nome.caixa && k.w > 0 && k.h > 0) {
    // caixa do construtor: o nome fica na mesma fração do card, não na mesma distância do centro. O
    // molde horizontal/especial é largo; num card mais estreito ou mais baixo que ele o nome caía fora
    // do card (Redemais Quarta do Filé, 20/10/2026)
    const cx = p.base.nome.caixa, an = cx.ancora;
    const P = cx.x + cx.w * (an === 'middle' ? 0.5 : an === 'end' ? 1 : 0);
    dx = c.x + (P - k.x) * (c.w / k.w) - P;
    const y0 = cx.y != null ? cx.y : b.y;
    dy = c.y + (y0 - k.y) * Math.min(1, c.h / k.h) - y0;
  } else { dx = (c.x + c.w / 2) - (k.x + k.w / 2); dy = c.y + (b.y - k.y) * fatorCardBaixo(p) - b.y; }
  // catálogo: o nome (1 ou 2 linhas) fica no meio da altura da linha, alinhado com o preço
  if (S.catalogo) dy = c.y + c.h / 2 - (b.y + b.height / 2);
  dx += p.nomeDx; dy += p.nomeDy;
  p.nomeTopo = b.y + dy; p.nomeBase = b.y + b.height + dy;
  // guarda o deslocamento: as regras de depois (nome acima do preço, preso ao preço) somam a partir dele. Ler
  // de volta do atributo falhava no Firefox e o nome ficava parado ao mover o card ou mudar o preço
  p.nomeT = { x: dx || 0, y: dy || 0 };
  p.nomeG.setAttribute('transform', dx || dy ? `translate(${arred(dx)} ${arred(dy)})` : '');
}

// card do construtor menor que o molde (especial/horizontal numa casa mais baixa): o nome desce na
// proporção do card mas o preço continua do tamanho do molde, e a 2ª linha do nome sumia atrás da
// caixa do preço ("PATINHO KG" sem o KG, Redemais 20/10/2026). Sobe o nome até ficar 2 pt acima do
// preço, sem passar do topo do card. Nome arrastado à mão (nomeDx/Dy) fica onde a pessoa pôs.
// fundo do nome preso ao preço (construtor, Matheus 22/10/2026): o pé do fundo fica gap pt acima do grupo
// do preço; na largura, o lado com limite fica a esse tanto da borda do card e o lado livre cresce com o
// título; os dois livres = centrado no preço. Arraste à mão (nomeDx/Dy) vale por cima.
function nomePresoAoPreco(p) {
  const pr = p.base.preso;
  if (!pr || !p.nomeG || nomeNaTarja(p)) return false;
  const alvo = p.fundoAlvo || p.precoG; if (!alvo || alvo === p.g) return false;
  const tx = p.nomeT ? p.nomeT.x : 0, ty = p.nomeT ? p.nomeT.y : 0;
  const n = retSvgBBox(p.nomeG), f = retSvgBBox(alvo); if (!n.w || !f.w) return false;
  const cel = p.cell;
  const X = pr.dir != null ? cel.x + cel.w - pr.dir - n.w : pr.esq != null ? cel.x + pr.esq : f.x + f.w / 2 - n.w / 2;
  const Y = f.y - pr.gap - n.h;
  const k = matrizAteRaiz(p.nomeG.parentNode), kx = Math.abs(k.a) || 1, ky = Math.abs(k.d) || 1;
  const dx = tx + (X - n.x) / kx + p.nomeDx, dy = ty + (Y - n.y) / ky + p.nomeDy;
  p.nomeT = { x: dx, y: dy };
  p.nomeG.setAttribute('transform', `translate(${arred(dx)} ${arred(dy)})`);
  p.nomeTopo += (Y - n.y) / ky + p.nomeDy; p.nomeBase += (Y - n.y) / ky + p.nomeDy;
  return true;
}
function nomeAcimaDoPreco(p) {
  if (!regraTpl('nome_acima_do_preco', true)) return;
  if (!p.nomeG || !p.base.nome || !p.base.nome.caixa || nomeNaTarja(p) || p.nomeDx || p.nomeDy) return;
  const alvo = p.fundoAlvo || p.precoG; if (!alvo || alvo === p.g) return;
  const n = retSvgBBox(p.nomeG), f = retSvgBBox(alvo); if (!n.w || !f.w) return;
  if (n.x >= f.x + f.w || n.x + n.w <= f.x) return; // não ficam um em cima do outro
  // nome que o molde pôs embaixo do preço fica embaixo (Juarez Final de Semana, 22/10/2026: a regra
  // jogava o nome pra cima do preço em todo card)
  if (regraTpl('nome_embaixo_fica', true) && n.y + n.h / 2 >= f.y + f.h / 2) return;
  const sobra = n.y + n.h - (f.y - 2); if (sobra <= 0) return;
  const topo = retSvgBBox(p.g.querySelector('[id^="MARGEM_GRID"]') || p.g).y + 2;
  const sobe = Math.min(sobra, Math.max(0, n.y - topo)); if (sobe < 0.05) return;
  const k = Math.abs(matrizAteRaiz(p.nomeG.parentNode).d) || 1;
  const dx = p.nomeT ? p.nomeT.x : 0, dy = (p.nomeT ? p.nomeT.y : 0) - sobe / k;
  p.nomeT = { x: dx, y: dy };
  p.nomeG.setAttribute('transform', `translate(${arred(dx)} ${arred(dy)})`);
  p.nomeTopo -= sobe / k; p.nomeBase -= sobe / k;
}

// limite do valor: o R$ fica parado onde o template pôs; o valor cresce pra esquerda até encostar nele
function limiteValor(b, moeda, reserva) {
  return moeda ? b.dir - (moeda.dir + Math.min(4, Math.max(1, b.esq - moeda.dir))) : reserva;
}
function desenharSimples(e, b, txt, moeda) {
  escreverTexto(e, [txt], b.dir, 'end', b.fonte, 0, b.m);
  const w = largura(e, b.m), maxW = limiteValor(b, moeda, b.larg * 1.3);
  if (w > maxW) escreverTexto(e, [txt], b.dir, 'end', b.fonte * maxW / w, 0, b.m);
}
// preço dividido: o real fica encostado nos centavos (borda direita parada) e cresce pra
// esquerda até o R$; os centavos ficam parados pela borda esquerda
// Com o padrão moeda_anda (Preço Certo Horti), o valor que não cabe empurra o R$ pra esquerda até
// a borda do card; o que ainda sobrar empurra os centavos e a unidade pra direita (até 1/4 do card).
// Só encolhe se nem assim couber — senão "29,99" sai com o 29 miúdo e o ,99 grande.
function desenharDividido(realEl, centEl, br, bc, txt, moeda, kr = 1, kc = 1, p = null) {
  const { real, cent } = partesPreco(txt);
  const anda = p && p.moedaPecas && regraTpl('moeda_anda', S.padrao && S.padrao.moeda_anda);
  if (anda) {
    for (const o of p.moedaPecas) { o.el.dataset.mvx = 0; o.el.dataset.mvy = 0; if (o.tr) o.el.setAttribute('transform', o.tr); else o.el.removeAttribute('transform'); }
    p.empurraCent = 0;
    esticarFundoPreco(p, 0);
  }
  escreverCampo(realEl, [real], br.dir, 'end', br.fonte * kr, 0);
  escreverCampo(centEl, [bc.sep + cent], bc.esq, 'start', bc.fonte * kc, 0);
  const topo = textoTopo(realEl), w = largura(topo, matriz(topo));
  let maxW = limiteValor(br, moeda, br.fonte * 1.8 * kr);
  if (w > maxW && anda) {
    const rm = retSvgBBox(p.moeda), sc = Math.abs(matrizAteRaiz(p.moeda).a) || 1;
    // limite: a borda do fundo do preço (elipse), senão a borda do card
    const caixa = p.precoFundoForma ? retSvgBBox(p.precoFundoForma) : { x: p.cell.x + 8, w: p.cell.w - 16 };
    // moeda_anda "fundo" (Lima, pedido do Matheus 06/10/2026): o fundo do preço estica pra esquerda junto
    // com o R$ até perto da borda do card, em vez de o valor encolher
    const estica = anda === 'fundo' && p.precoFundoForma && p.precoFundoForma.tagName === 'rect';
    const folgaR = rm.x - caixa.x; // R$ → borda esquerda do fundo, como o template desenhou
    const limiteEsq = estica ? Math.min(caixa.x + 2, p.cell.x + 4 + folgaR) : caixa.x + 2;
    const d = Math.max(0, Math.min(w - maxW, (rm.x - limiteEsq) / sc));
    if (d) {
      for (const o of p.moedaPecas) o.el.setAttribute('transform', `translate(${arred(-d)} 0) ${o.tr}`.trim());
      maxW += d;
      if (estica) esticarFundoPreco(p, Math.max(0, caixa.x - (rm.x - d * sc - folgaR)));
    }
    const rc = retSvgBBox(centEl);
    const folgaDir = p.precoFundoForma ? (caixa.x + caixa.w - 2 - (rc.x + rc.w)) / sc : p.cell.w * 0.25 / sc;
    const resto = Math.max(0, Math.min(w - maxW, folgaDir));
    if (resto) {
      p.empurraCent = resto;
      escreverCampo(realEl, [real], br.dir + resto, 'end', br.fonte * kr, 0);
      escreverCampo(centEl, [bc.sep + cent], bc.esq + resto, 'start', bc.fonte * kc, 0);
      maxW += resto;
    }
  }
  if (w > maxW) {
    escreverCampo(realEl, [real], br.dir + ((p && p.empurraCent) || 0), 'end', br.fonte * kr * maxW / w, 0);
    topoPreco(realEl, centEl, bc.sep + cent, bc.esq + ((p && p.empurraCent) || 0), bc.fonte * kc);
  }
}
// fundo do preço (rect) mais largo pra esquerda: ext em unidades da raiz do SVG; 0 volta ao template
function esticarFundoPreco(p, ext) {
  const f = p && p.precoFundoForma;
  if (!f || f.tagName !== 'rect') return;
  if (!f.dataset.x0) { f.dataset.x0 = f.getAttribute('x') || '0'; f.dataset.w0 = f.getAttribute('width') || '0'; }
  const k = Math.abs(matrizAteRaiz(f).a) || 1, e = ext / k;
  f.setAttribute('x', arred(+f.dataset.x0 - e)); f.setAttribute('width', arred(+f.dataset.w0 + e));
}
// Real que encolheu (regra do Matheus, 06/10/2026): nunca menor que os centavos — se ficar, os
// centavos descem pra 80% do real — e alinhado pelo topo com eles (encolher pela linha de base
// deixava um vão em cima do "35" no "35,99").
function topoPreco(realEl, centEl, txtCent, xCent, fonteCent) {
  const rt = textoTopo(realEl), ct = textoTopo(centEl); if (!rt || !ct) return;
  const R = retSvgBBox(rt); let C = retSvgBBox(ct);
  if (!(R.h > 0 && C.h > 0)) return;
  if (R.h < C.h) {
    escreverCampo(centEl, [txtCent], xCent, 'start', fonteCent * (R.h * 0.8) / C.h, 0);
    C = retSvgBBox(ct);
  }
  const d = R.y - C.y; // > 0: o topo do real ficou abaixo do topo dos centavos
  if (d <= 0.3) return;
  for (const t of textosDe(realEl)) {
    const k = Math.abs(matrizAteRaiz(t).d) || 1;
    for (const s of t.querySelectorAll('tspan')) s.setAttribute('y', arred(+s.getAttribute('y') - d / k));
  }
}

// preço sem número ("Consultar", "Sob consulta"): sai o texto no lugar do valor, sem R$ e sem ",00"
function precoEmTexto(txt) { return !!String(txt || '').trim() && !/\d/.test(txt); }
function renderPrecoTexto(p, txt) {
  const b = p.base.real || p.base.preco, el = p.real || p.preco; if (!b || !el) return;
  const dir = p.base.cent ? p.base.cent.dir : b.dir;
  escreverCampo(el, [txt], dir, 'end', b.fonte * 0.8, 0);
  if (p.cent) p.cent.style.display = 'none';
  if (p.moeda) p.moeda.style.display = 'none';
}
function renderPreco(p) {
  const txt = p.precoTxt || '';
  const emTexto = precoEmTexto(txt);
  if (p.cent) p.cent.style.display = '';
  if (p.moeda) p.moeda.style.display = '';
  if (emTexto && !p.deOn && !p.seloOn) { renderPrecoTexto(p, txt.trim()); renderDe(p); renderSelo(p); return; }
  if (regraFundo(p)) desenharValorRegra(p, txt, p.regraK || 1);
  else if (p.dividido) desenharDividido(p.real, p.cent, p.base.real, p.base.cent, txt, p.base.moeda, p.escReal || 1, p.escCent || 1, p);
  else if (p.base.preco) desenharSimples(p.preco, p.base.preco, txt, p.base.moeda);
  // a outra tag (DE/padrão) tem o mesmo POR
  for (const gm of p.gemeos || []) {
    if (gm.real) desenharDividido(gm.real, gm.cent, gm.base.real, gm.base.cent, txt, null);
    else desenharSimples(gm.preco, gm.base.preco, txt, null);
  }
  // preço duplo: as outras variantes (PEDAÇO…), cada uma no seu lugar
  for (const v of p.extras || []) desenharDividido(v.real, v.cent, v.base.real, v.base.cent, v.txt || '', null);
  renderDe(p);
  renderSelo(p);
}

// DE/POR: liga/desliga o bloco do DE (e alterna com a tag padrão) e escreve o valor
function renderDe(p) {
  const d = p.de; if (!d) return;
  if (d.g) d.g.style.display = p.deOn ? '' : 'none';
  if (d.padraoG) d.padraoG.style.display = p.deOn ? 'none' : '';
  if (!d.g) for (const e of [d.preco, d.real, d.cent]) if (e) e.style.display = p.deOn ? '' : 'none';
  if (!p.deOn) return;
  const txt = p.deTxt || '';
  if (d.real && d.cent && d.base.real && d.base.cent) desenharDividido(d.real, d.cent, d.base.real, d.base.cent, txt, null);
  else if (d.preco && d.base.preco) {
    desenharSimples(d.preco, d.base.preco, txt, null);
    if (d.rotulo) {
      const b = d.base.preco, dx = b.dir - largura(d.preco, b.m) - b.esq;
      d.rotulo.el.setAttribute('transform', `${Math.abs(dx) > 0.05 ? `translate(${arred(dx)} 0) ` : ''}${d.rotulo.tr}`.trim());
    }
  }
}

// Selo do clube fora do card que o template desenhou (Super Mais, 007): o selo só existia em alguns
// cards e o preço desses cards é menor. Guarda um molde do selo por tipo de card (normal/destaque) e
// quanto o preço encolhe com selo; item com selo em card sem selo ganha uma cópia presa ao preço, e o
// card que perde o selo volta ao tamanho de preço dos outros.
function tipoCard(p) { return p.molde === 'normal' ? 'normal' : 'tpl'; }
function fontePreco(p) { const b = p.base.real || p.base.preco; return b ? b.fonte * Math.abs(b.m ? b.m.a : 1) : 0; }
function prepararSelos() {
  S.seloMoldes = {}; S.seloK = {};
  const med = v => { const o = v.slice().sort((a, b) => a - b); return o.length ? o[Math.floor(o.length / 2)] : 0; };
  for (const t of ['normal', 'tpl']) {
    const ps = S.produtos.filter(q => tipoCard(q) === t && fontePreco(q) > 0);
    const com = ps.filter(q => q.seloTpl), sem = ps.filter(q => !q.seloTpl);
    if (com.length && sem.length) S.seloK[t] = med(com.map(fontePreco)) / med(sem.map(fontePreco));
    const src = com.find(q => q.selo && q.selo.segue && q.base.precoTopoDir);
    if (src) S.seloMoldes[t] = { g: src.selo.g.cloneNode(true), tr: src.selo.tr, p0: { ...src.base.precoTopoDir }, k: fontePreco(src) };
  }
  for (const t of ['normal', 'tpl']) { if (!S.seloK[t]) S.seloK[t] = S.seloK.normal || S.seloK.tpl || 0; if (!S.seloMoldes[t]) S.seloMoldes[t] = S.seloMoldes.normal || S.seloMoldes.tpl; }
}
// o card pode ganhar o selo do clube? (o template tem selo pra esse tipo de card e o card tem grupo PREÇO)
function podeSelo(p) {
  if (p.selo) return true;
  const M = S.seloMoldes && S.seloMoldes[tipoCard(p)];
  return !!(M && p.base.precoTopoDir && p.precoG && p.precoG !== p.g);
}
function garantirSelo(p) {
  if (p.selo) return true;
  if (!podeSelo(p)) return false;
  const M = S.seloMoldes[tipoCard(p)];
  const c = M.g.cloneNode(true);
  c.id = `produto_${p.num}_selo`;
  for (const e of $$('[id]', c)) e.id = e.id + '-s' + p.num;
  c.style.display = '';
  p.g.appendChild(c);
  // mesmo lugar em relação ao canto de cima-direito do preço que no card de onde veio
  const dx = p.base.precoTopoDir.x - M.p0.x, dy = p.base.precoTopoDir.y - M.p0.y;
  const tr = `translate(${arred(dx)} ${arred(dy)}) ${M.tr}`.trim();
  c.setAttribute('transform', tr);
  const val = $$('[id]', c).find(e => /valor_selo/i.test(e.id)) || $$('text', c).find(t => !t.closest('[id^="moeda"]'));
  const mo = $('[id^="moeda"]', c);
  p.selo = { g: c, val, base: lerTexto(val), moeda: mo ? lerTexto(mo) : null, tr, segue: true, copia: true };
  p.outros = p.outros.filter(o => o.el !== c);
  return true;
}
// preço do card que ganhou ou perdeu o selo em relação ao template
function fatorSelo(p) {
  // construtor: o card traz o preço normal e o lugar dele com selo (data-com-selo); não há card sem
  // selo pra comparar, então a escala vem do template
  if (p.comSelo) return p.selo && p.seloOn ? p.comSelo.s : 1;
  const k = S.seloK && S.seloK[tipoCard(p)];
  if (!k) return 1;
  const tem = !!(p.selo && p.seloOn);
  return tem === !!p.seloTpl ? 1 : tem ? k : 1 / k;
}

// peças do preço com ajuste só pro produto com selo (construtor: com_selo.pecas → data-selo-d/-cor/-borda):
// com selo ligado ganham o deslocamento (CSS translate, no espaço do grupo) e a cor; sem selo voltam
function seloPecas(p) {
  if (!p.precoG) return;
  const on = !!(p.comSelo && p.selo && p.seloOn);
  for (const e of p.precoG.querySelectorAll('[data-selo-d],[data-selo-cor],[data-selo-borda]')) {
    const d = (e.getAttribute('data-selo-d') || '').split(/\s+/).map(Number);
    e.style.translate = on && d.length === 2 && d.every(isFinite) ? `${d[0]}px ${d[1]}px` : '';
    e.style.fill = on && e.getAttribute('data-selo-cor') ? e.getAttribute('data-selo-cor') : '';
    e.style.stroke = on && e.getAttribute('data-selo-borda') ? e.getAttribute('data-selo-borda') : '';
  }
}
// selo do clube: aparece só nos itens marcados, com o valor do clube
function renderSelo(p) {
  const s = p.selo; if (!s) return;
  s.g.style.display = p.seloOn ? '' : 'none';
  if (p.seloOn && s.val && s.base) desenharSimples(s.val, s.base, p.seloTxt || '', s.moeda);
}

// "8,99" → real "8" + centavos "99" (sempre 2 dígitos)
function partesPreco(txt) {
  const m = String(txt || '').trim().match(/^(\d*)\s*(?:[,.]\s*(\d*))?/) || [];
  return { real: m[1] || '', cent: (m[2] || '').padEnd(2, '0').slice(0, 2) };
}

function renderSimples(p, chave, e, txt, dx = 0, esc = 1) {
  const b = p.base[chave]; if (!b || !e) return;
  e.style.display = txt ? '' : 'none';
  const an = b.ancora || 'end', x = an === 'middle' ? (b.esq + b.dir) / 2 : an === 'start' ? b.esq : b.dir;
  escreverCampo(e, [txt || ''], x + dx, an, b.fonte * esc, 0);
}
// limite: texto + tamanho (qtdEsc) + lugar arrastado (qtdDx/Dy, no grupo próprio) + camada (qtdZ = posição
// entre os filhos do card; Frente/Trás no painel do bloco)
function posQtd(p) {
  if (!p.qtd) return;
  renderSimples(p, 'qtd', p.qtd, p.qtdTxt, 0, p.qtdEsc || 1);
  const w = p.qtdWrap; if (!w) return;
  const partes = [];
  if (p.qtdDx || p.qtdDy) partes.push(`translate(${p.qtdDx || 0} ${p.qtdDy || 0})`);
  // o gerador desenha o limite fora do grupo do preço: anda e escala junto com o preço, senão fica onde
  // o template pôs quando a grade muda (Dia D do Marcelino, SMD-1517, 29/10/2026)
  if (p.precoG && p.base.precoG && p.precoG !== p.g && !p.precoG.contains(w)) {
    const { a, s, tx, ty } = deslocPreco(p);
    if (tx || ty) partes.push(`translate(${arred(tx)} ${arred(ty)})`);
    if (s !== 1) partes.push(`translate(${a.x} ${a.y}) scale(${s}) translate(${-a.x} ${-a.y})`);
  }
  if (partes.length) w.setAttribute('transform', partes.join(' ')); else w.removeAttribute('transform');
  const pai = w.parentNode, filhos = pai ? [...pai.children] : [];
  if (p.qtdZ != null && filhos.indexOf(w) !== p.qtdZ) {
    const resto = filhos.filter(n => n !== w), i = Math.max(0, Math.min(resto.length, p.qtdZ));
    pai.insertBefore(w, resto[i] || null);
  }
}
// Frente/Trás do limite: passa por cima (ou por baixo) da próxima peça visível do card; tudo = topo/fundo
function camadaQtd(frente, tudo) {
  const ps = blocoPs(); if (!ps.length) return;
  marcar(...ps);
  for (const p of ps) {
    const w = p.qtdWrap; if (!w || !w.parentNode) continue;
    const pai = w.parentNode, vis = n => n !== w && n.getAttribute('display') !== 'none' && n.style.display !== 'none' && !(n.getAttribute('fill') === 'transparent');
    const filhos = [...pai.children];
    if (tudo) { if (frente) pai.appendChild(w); else pai.insertBefore(w, pai.firstElementChild); }
    else if (frente) { const prox = filhos.slice(filhos.indexOf(w) + 1).find(vis); if (prox) prox.after(w); }
    else { const ant = filhos.slice(0, filhos.indexOf(w)).reverse().find(vis); if (ant) ant.before(w); }
    p.qtdZ = [...pai.children].indexOf(w);
  }
  mudou(); desenharSelecao();
}
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-camada-qtd]'); if (!b || !S.bloco || S.bloco.tipo !== 'qtd') return;
  camadaQtd(b.dataset.camadaQtd === 'frente', e.shiftKey);
});

// tarja do atacado: linhas como o usuário escreveu (quebra com Enter ou "//"); sem quebra, segue o
// template — "NA COMPRA DE" em cima e o resto embaixo, ou duas linhas parecidas
function linhasTarja(p) {
  const b = p.base.tarja;
  let t = String(p.tarjaTxt || '').trim();
  if (!t) return [];
  if (b.maius) t = t.toUpperCase();
  if (/\n|\/\//.test(t)) return t.split(/\s*(?:\n|\/\/)\s*/).filter(Boolean);
  if (b.linhas.length < 2) return [t];
  // "NA COMPRA DE" sozinho em cima só quando o resto é curto; senão, duas linhas parecidas
  const m = t.match(/^(NA COMPRA DE|PARA QUALQUER)\s+(.+)$/i);
  return m && m[2].length <= 24 ? [m[1], m[2]] : quebrarEmDuas(t);
}
// centrada onde o template pôs (acompanha o meio do card); encolhe só se não couber no card
function renderTarja(p) {
  const b = p.base.tarja, e = p.tarja; if (!b || !e) return;
  const linhas = linhasTarja(p);
  e.style.display = linhas.length ? '' : 'none';
  if (!linhas.length) return;
  const ts = textosDe(e), entre0 = b.entre || b.fonte * 1.2;
  const xl = b.cxl + (p.cell.w - p.card.w) / 2 / (b.m.a || 1);
  const lim = Math.max(b.larg * p.cell.w / p.card.w, p.cell.w - 12);
  const escreve = f => { for (const t of ts) escreverTexto(t, linhas, xl, 'middle', f, entre0 * f / b.fonte, null); };
  let fonte = b.fonte;
  escreve(fonte);
  const w = Math.max(0, ...ts.map(t => largura(t, b.m)));
  if (w > lim) { fonte = arred(fonte * lim / w); escreve(fonte); }
  // menos linhas que o template: fica no meio do espaço que as linhas do template ocupavam
  const d = (b.linhas.length - linhas.length) * entre0 * fonte / b.fonte / 2;
  if (d) for (const t of ts) for (const s of t.children) s.setAttribute('y', arred(+s.getAttribute('y') + d));
}

// ---------------------------------------------------------------- regra do fundo do preço
// Template do construtor (SMD-954) leva a regra no próprio fundo_preco: data-regra (estica |
// estica_encolhe), data-lado (esq | dir | ambos), data-respiro, data-encolhe (1 = fundo também
// diminui com preço curto), data-margem ("cima dir baixo esq", limite dentro do card). O valor sai
// no tamanho do template, o R$ anda junto, e o fundo cresce/encolhe em volta; só encolhe o valor
// (estica_encolhe) se nem esticando até a margem couber. Template sem data-regra não muda nada.
function regraFundo(p) {
  const f = p.fundoAlvo, d = f && f.dataset;
  if (!d || !d.regra || d.regra === 'fixo') return null;
  const m = (d.margem || '').split(/\s+/).map(Number);
  return {
    modo: d.regra, lado: d.lado || 'ambos', borda: d.borda === 'esq' || d.borda === 'dir' ? d.borda : '', respiro: +d.respiro || 0, encolhe: d.encolhe === '1', max: +d.max || 0,
    margem: { t: m[0] || 0, r: m[1] || 0, b: m[2] || 0, l: m[3] || 0 },
    raio: +d.raio || 0, cantos: (d.cantos || '1111').split('').map(c => c === '1'),
  };
}
const pecasValor = p => [p.dividido ? p.real : p.preco, p.dividido ? p.cent : null, p.formato].filter(Boolean);
const pecasMoeda = p => (p.moedaPecas || (p.moeda ? [{ el: p.moeda, tr: p.moeda.getAttribute('transform') || '' }] : []));
function trBase(e) { if (e.dataset.tr0 == null) e.dataset.tr0 = e.getAttribute('transform') || ''; return e.dataset.tr0; }
function moverLocal(e, dx, dy) {
  const k = Math.abs(matrizAteRaiz(e.parentNode).a) || 1, tr = trBase(e);
  e.dataset.mvx = dx || 0; e.dataset.mvy = dy || 0;
  if (dx || dy) e.setAttribute('transform', `translate(${arred(dx / k)} ${arred(dy / k)}) ${tr}`.trim());
  else if (tr) e.setAttribute('transform', tr); else e.removeAttribute('transform');
}
// geometria do fundo no espaço local dele (rect/image: x y width height; path: data-x… do construtor)
function geoFundoRegra(f) {
  if (f.dataset.gx == null) {
    const t = f.tagName.toLowerCase(), a = n => +(f.getAttribute(n) || 0);
    const g = t === 'path' ? { x: +f.dataset.x, y: +f.dataset.y, w: +f.dataset.w, h: +f.dataset.h } : { x: a('x'), y: a('y'), w: a('width'), h: a('height') };
    Object.assign(f.dataset, { gx: g.x, gy: g.y, gw: g.w, gh: g.h });
  }
  return { x: +f.dataset.gx, y: +f.dataset.gy, w: +f.dataset.gw, h: +f.dataset.gh };
}
function pintarFundo(f, g, rf) {
  if (f.tagName.toLowerCase() !== 'path') {
    f.setAttribute('x', arred(g.x)); f.setAttribute('y', arred(g.y)); f.setAttribute('width', arred(g.w)); f.setAttribute('height', arred(g.h));
    return;
  }
  const r = Math.min(rf.raio, g.w / 2, g.h / 2), [tl, tr, br, bl] = rf.cantos.map(c => (c ? r : 0)), { x, y, w, h } = g;
  const arco = (k, ex, ey) => (k ? ` A${arred(k)} ${arred(k)} 0 0 1 ${arred(ex)} ${arred(ey)}` : ` L${arred(ex)} ${arred(ey)}`);
  f.setAttribute('d', `M${arred(x + tl)} ${arred(y)} H${arred(x + w - tr)}${arco(tr, x + w, y + tr)} V${arred(y + h - br)}${arco(br, x + w - br, y + h)}`
    + ` H${arred(x + bl)}${arco(bl, x, y + h - bl)} V${arred(y + tl)}${arco(tl, x + tl, y)} Z`);
}
function zerarRegraFundo(p, rf) {
  pintarFundo(p.fundoAlvo, geoFundoRegra(p.fundoAlvo), rf);
  for (const e of pecasValor(p)) moverLocal(e, 0, 0);
  for (const o of pecasMoeda(p)) moverLocal(o.el, 0, 0);
}
// valor no tamanho do template (k < 1 só quando a regra mandar encolher)
function desenharValorRegra(p, txt, k) {
  if (p.dividido) {
    const { real, cent } = partesPreco(txt), br = p.base.real, bc = p.base.cent;
    escreverCampo(p.real, [real], br.dir, 'end', br.fonte * (p.escReal || 1) * k, 0);
    escreverCampo(p.cent, [bc.sep + cent], bc.esq, 'start', bc.fonte * (p.escCent || 1) * k, 0);
  } else if (p.base.preco) escreverTexto(p.preco, [txt], p.base.preco.dir, 'end', p.base.preco.fonte * k, 0, p.base.preco.m);
}
const uniao = rs => {
  const x0 = Math.min(...rs.map(r => r.x)), y0 = Math.min(...rs.map(r => r.y));
  return { x: x0, y: y0, w: Math.max(...rs.map(r => r.x + r.w)) - x0, h: Math.max(...rs.map(r => r.y + r.h)) - y0 };
};
function aplicarRegraFundo(p, rf) {
  const f = p.fundoAlvo, vis = e => getComputedStyle(e).display !== 'none' && retSvgBBox(e).w > 0;
  const medir = () => {
    // R$ na borda (Matheus, 22/10/2026): o R$ (com o círculo) não encosta no valor, fica preso na borda
    // lateral do fundo; o bloco é só o valor
    if (rf.borda) {
      for (const o of pecasMoeda(p)) moverLocal(o.el, 0, 0);
      return uniao(pecasValor(p).filter(vis).map(retSvgBBox));
    }
    // R$ encostado no começo do valor, nos dois sentidos (preço curto: ele chega perto; longo: sai da frente)
    const val = retSvgBBox(p.dividido ? p.real : p.preco), moedas = pecasMoeda(p);
    if (p.moeda && vis(p.moeda)) {
      for (const o of moedas) moverLocal(o.el, 0, 0);
      const rm = retSvgBBox(p.moeda), folga = Math.max(2, val.h * 0.12);
      const dx = val.x - folga - (rm.x + rm.w);
      for (const o of moedas) moverLocal(o.el, dx, 0);
    }
    return uniao([...pecasValor(p), ...moedas.map(o => o.el)].filter(vis).map(retSvgBBox));
  };
  let bloco = medir();
  const F0 = retSvgBBox(f), sc = (Math.abs(matrizAteRaiz(f).a) || 1) / (Math.abs(matrizAteRaiz(f.parentNode).a) || 1);
  const c = p.cell, m = rf.margem, L = { x: c.x + m.l, y: c.y + m.t, w: c.w - m.l - m.r, h: c.h - m.t - m.b };
  const r = rf.respiro;
  // valor maior que o limite: estica_encolhe reduz o valor até caber; estica deixa passar
  if (bloco.w + 2 * r > L.w && rf.modo === 'estica_encolhe') {
    const k = Math.max(0.3, (p.regraK || 1) * (L.w - 2 * r) / bloco.w);
    p.regraK = k; desenharValorRegra(p, p.precoTxt || '', k);
    renderSimples(p, 'formato', p.formato, p.formatoTxt, 0);
    bloco = medir();
  } else if ((p.regraK || 1) !== 1 && bloco.w / (p.regraK || 1) + 2 * r <= L.w) {
    p.regraK = 1; desenharValorRegra(p, p.precoTxt || '', 1); renderSimples(p, 'formato', p.formato, p.formatoTxt, 0); bloco = medir();
  }
  // R$ na borda: metade dele entra no fundo, o valor fica no meio do que sobra
  const ms = rf.borda ? pecasMoeda(p).map(o => o.el).filter(vis).map(retSvgBBox) : [];
  const meiaM = ms.length ? uniao(ms).w / 2 : 0;
  let W = bloco.w + 2 * r + meiaM;
  if (!rf.encolhe) W = Math.max(W, F0.w);
  if (rf.max) {
    // no espaço local do fundo (pt do template, sem a escala do grupo): passou do máximo, o grupo diminui
    const kl = F0.w ? geoFundoRegra(f).w / F0.w : 1, Wl = W * kl;
    p.regraSNovo = Wl > rf.max * 1.01 ? rf.max / Wl : 1; // 1% de folga: não encolhe por arredondamento
  } else p.regraSNovo = null;
  W = Math.min(W, Math.max(F0.w, L.w));
  // posição pelo card, não pelo grupo do preço (o editor ancora o grupo no canto inferior-direito e,
  // com o card mais estreito, o centralizado escorregava): esq mantém a distância da borda direita do
  // card, dir a da esquerda, os dois lados o centro na mesma fração do card que o template desenhou
  const g0 = geoFundoRegra(f), k0 = p.card;
  let x = rf.lado === 'esq' ? c.x + c.w - (k0.x + k0.w - (g0.x + g0.w)) - W
    : rf.lado === 'dir' ? c.x + (g0.x - k0.x)
    : c.x + c.w * ((g0.x + g0.w / 2 - k0.x) / k0.w) - W / 2;
  x = Math.max(L.x, Math.min(x, L.x + L.w - W));
  let y = Math.max(L.y, Math.min(F0.y, L.y + L.h - F0.h));
  // fundo novo (no espaço local dele)
  const g = geoFundoRegra(f), kx = F0.w ? g.w / F0.w : 1 / sc;
  pintarFundo(f, { x: g.x + (x - F0.x) * kx, y: g.y + (y - F0.y) * kx, w: W * kx, h: g.h }, rf);
  // conteúdo dentro do fundo, com o respiro: dois lados = centrado; senão encostado no lado que não cresce
  const alvoX = rf.lado === 'ambos' ? x + (W - bloco.w) / 2 : rf.lado === 'esq' ? Math.min(bloco.x, x + W - r - bloco.w) : Math.max(bloco.x, x + r);
  const dy = y - F0.y;
  if (rf.borda) {
    // valor no meio da parte do fundo que o R$ não cobre; R$ (e o círculo) com o meio na borda lateral
    const ix = x + (rf.borda === 'esq' ? meiaM : 0), iw = W - meiaM;
    const dxv = ix + (iw - bloco.w) / 2 - bloco.x;
    for (const e of pecasValor(p)) moverLocal(e, dxv, dy);
    if (ms.length) {
      const M = uniao(ms), dxm = (rf.borda === 'esq' ? x : x + W) - (M.x + M.w / 2);
      for (const o of pecasMoeda(p)) moverLocal(o.el, dxm, dy);
    }
  }
  const dx = Math.max(x + r, Math.min(alvoX, x + W - r - bloco.w)) - bloco.x;
  if (!rf.borda && (dx || dy)) {
    for (const e of pecasValor(p)) moverLocal(e, dx, dy);
    for (const o of pecasMoeda(p)) {
      // soma ao deslocamento do R$ que medir() já pôs
      // o deslocamento que o moverLocal já pôs fica guardado nele (data-mvx/mvy). Ler de volta do atributo
      // falhava no Firefox, que reescreve o transform: o R$ caía em cima do valor (Redemais 23/10/2026)
      moverLocal(o.el, +(o.el.dataset.mvx || 0) + dx, +(o.el.dataset.mvy || 0) + dy);
    }
  }
  // o Chrome às vezes não repinta o <text> que só mudou de transform: o R$ ficava na tela no lugar
  // antigo (fora do fundo) com o DOM certo. Mexer no estilo força a pintura nova.
  for (const e of [f, ...pecasValor(p), ...pecasMoeda(p).map(o => o.el)]) {
    e.style.opacity = '0.999';
    requestAnimationFrame(() => { e.style.opacity = ''; });
  }
}
// tarja que acompanha a largura da célula (padrão preco.ajustar_largura = fração da largura,
// ex. 0.94 no J Meroto): card de molde grande ou pequeno sai com a tarja do mesmo tamanho
function fatorTarja(p) {
  const f = regraTpl('preco_ajustar_largura', S.padrao && S.padrao.preco && S.padrao.preco.ajustar_largura);
  return f && p.base.precoW ? (f * p.cell.w) / p.base.precoW : 1;
}
// quanto o grupo do preço anda (tx, ty) e a escala dele (s, em volta do canto inferior-direito a)
// padrão encolhe_card_baixo: card mais baixo que o do template (grade com mais linhas) reduz nome e
// preço na mesma proporção, senão o preço sobe por cima do nome
function fatorCardBaixo(p) {
  return regraTpl('encolhe_card_baixo', S.padrao && S.padrao.encolhe_card_baixo) && p.card.h > 0 ? Math.min(1, p.cell.h / p.card.h) : 1;
}

// preço proporcional à largura do card (Matheus, 26/10/2026): o grupo do preço ocupa a mesma fração da
// largura que tinha no card do template — card mais estreito encolhe o preço, mais largo aumenta (sem
// crescer mais que a altura do card cresceu). Ligado por padrão nos templates do construtor (regra
// preco_proporcional); o ajustar_largura (J Meroto) já acompanha a casa pela tarja e manda
function fatorLarguraPreco(p) {
  if (!regraTpl('preco_proporcional', !!S.projetoTpl) || fatorTarja(p) !== 1) return 1;
  const k = p.card, c = p.cell; if (!(k && k.w > 0 && k.h > 0)) return 1;
  const kw = c.w / k.w;
  return kw <= 1 ? kw : Math.max(1, Math.min(kw, c.h / k.h));
}
// escala do preço pelo tamanho do card: mais estreito e mais baixo ao mesmo tempo vale o que encolheu
// mais (não multiplica as duas reduções)
function fatorCardPreco(p) {
  const kc = fatorCardBaixo(p), kl = fatorLarguraPreco(p);
  return kl > 1 ? kl * kc : Math.min(kl, kc);
}

function deslocPreco(p) {
  const kc = fatorCardBaixo(p);
  const a = p.base.precoG, s = p.escPreco * fatorTarja(p) * fatorCardPreco(p) * fatorSelo(p) * (p.regraS || 1);
  const c = p.cell, k = p.card;
  let tx, ty;
  if (S.padrao && S.padrao.preco) {
    // caixa do grupo PREÇO já com a escala (em volta do canto inferior-direito original)
    const b = p.precoG.getBBox();
    const L = a.x + (b.x - a.x) * s, Rr = a.x + (b.x + b.width - a.x) * s, T = a.y + (b.y - a.y) * s, B = a.y + (b.y + b.height - a.y) * s;
    const R = regra('preco');
    tx = R.x === 'left' ? c.x + R.mx - L : R.x === 'center' ? c.x + c.w / 2 - (L + Rr) / 2 : c.x + c.w - R.mx - Rr;
    ty = R.y === 'top' ? c.y + R.my - T : R.y === 'above_titulo' && !nomeNaTarja(p) ? (p.nomeTopo != null ? p.nomeTopo : c.y) - R.gap - B : c.y + c.h - R.my - B;
  } else if (S.padrao && S.padrao.preco_ancora === 'perto') {
    // cada card segue o próprio desenho: o preço fica preso ao lado do card mais perto dele no
    // template (esquerda/centro/direita × topo/meio/pé), à mesma distância (Preço Certo Horti)
    const b = p.precoG.getBBox();
    const L = a.x + (b.x - a.x) * s, Rr = a.x + (b.x + b.width - a.x) * s, T = a.y + (b.y - a.y) * s, B = a.y + (b.y + b.height - a.y) * s;
    const fx = (b.x + b.width / 2 - k.x) / k.w, fy = (b.y + b.height / 2 - k.y) / k.h;
    tx = fx < 0.35 ? c.x + (b.x - k.x) * kc - L
      : fx > 0.65 ? c.x + c.w - (k.x + k.w - b.x - b.width) * kc - Rr
      : c.x + c.w / 2 + (b.x + b.width / 2 - k.x - k.w / 2) * kc - (L + Rr) / 2;
    ty = fy < 0.35 ? c.y + (b.y - k.y) * kc - T
      : fy > 0.65 ? c.y + c.h - (k.y + k.h - b.y - b.height) * kc - B
      : c.y + c.h / 2 + (b.y + b.height / 2 - k.y - k.h / 2) * kc - (T + B) / 2;
  } else { tx = (c.x + c.w) - (k.x + k.w); ty = (c.y + c.h) - (k.y + k.h); } // canto inferior-direito como no template
  // com selo (template do construtor): o grupo vai pro lugar desenhado pra esse caso
  const cs = p.comSelo && p.selo && p.seloOn ? p.comSelo : null;
  return { a, s, tx: tx + p.precoDx + (cs ? cs.dx : 0), ty: ty + p.precoDy + (cs ? cs.dy : 0) };
}

// fundo do preço: tamanho (Fundo ↔ ↕) e posição própria (fundoDx/Dy, "Mover fundo" no painel do preço),
// sem mexer no valor
function renderFundoPreco(p) {
  if (!p.fundoAlvo || !p.base.fundoAlvo) return;
  const f = p.base.fundoAlvo;
  const cx = f.x + f.w / 2, top = f.y, dx = p.fundoDx || 0, dy = p.fundoDy || 0;
  const partes = [];
  if (dx || dy) partes.push(`translate(${arred(dx)} ${arred(dy)})`);
  if (p.fundoW !== 1 || p.fundoH !== 1) partes.push(`translate(${cx} ${top}) scale(${p.fundoW} ${p.fundoH}) translate(${-cx} ${-top})`);
  p.fundoAlvo.setAttribute('transform', `${partes.join(' ')} ${f.tr || ''}`.trim());
}

// formato (KG, UND) fica onde o template pôs, encostado à direita embaixo dos centavos; "UND" é mais
// largo que o "KG" do template e entrava no real ("4,99 UND" do abacaxi, Super Mais, 09/10/2026).
// Encolhe até caber entre o real e a borda direita dele.
function formatoSemInvadir(p) {
  const b = p.base.formato, e = p.formato;
  if (!b || !e || !p.dividido || !p.real || !p.formatoTxt || e.style.display === 'none') return;
  const rt = textoTopo(p.real), ft = textoTopo(e); if (!rt || !ft) return;
  const R = retSvgBBox(rt), F = retSvgBBox(ft);
  if (!(R.w > 0 && F.w > 0)) return;
  if (F.y >= R.y + R.h || R.y >= F.y + F.h) return; // não estão na mesma altura
  const folga = F.h * 0.12, cabe = F.x + F.w - (R.x + R.w) - folga;
  if (F.x >= R.x + R.w + folga || cabe <= 0) return;
  const k = Math.max(0.6, cabe / F.w);
  escreverCampo(e, [p.formatoTxt], b.dir + (p.empurraCent || 0), 'end', b.fonte * k, 0);
}

function renderGrupoPreco(p) {
  renderFundoPreco(p);
  if (p.precoG && p.base.precoG && p.precoG !== p.g) {
    const { a, s, tx, ty } = deslocPreco(p); // s já inclui o ajuste da tarja à célula
    const partes = [];
    if (tx || ty) partes.push(`translate(${arred(tx)} ${arred(ty)})`);
    if (s !== 1) partes.push(`translate(${a.x} ${a.y}) scale(${s}) translate(${-a.x} ${-a.y})`);
    p.precoG.setAttribute('transform', partes.join(' '));
    // selo solto: apoiado no canto de cima-direito do preço, onde ele cair, e com a mesma escala que
    // o preço tirando o fatorSelo (que só iguala o preço ao dos cards com selo do template). Antes o
    // selo ficava no tamanho do template e diminuir o preço só encolhia o preço normal (Super Mais,
    // Nescau SMD-452, 12/10/2026)
    if (p.selo && p.selo.segue && p.base.precoTopoDir) {
      // template do construtor com o preço "com selo": o selo fica onde foi desenhado em relação ao preço
      // NORMAL (é o preço que vai pro lugar dele com selo, não o selo que segue o preço menor)
      const cs = p.comSelo && p.seloOn ? p.comSelo : null;
      const sN = cs ? s / cs.s : s, txN = cs ? tx - cs.dx : tx, tyN = cs ? ty - cs.dy : ty;
      const P0 = p.base.precoTopoDir, ss = cs ? sN : s / fatorSelo(p);
      const nx = a.x + (P0.x - a.x) * sN + txN, ny = a.y + (P0.y - a.y) * sN + tyN;
      const esc = Math.abs(ss - 1) < 1e-4 ? '' : ` scale(${arred(ss)})`;
      p.selo.g.setAttribute('transform', `translate(${arred(nx)} ${arred(ny)})${esc} translate(${arred(-P0.x)} ${arred(-P0.y)}) ${p.selo.tr}`.trim());
    }
    if (nomeNaTarja(p)) posNome(p); // o nome mora na tarja: vai junto
  }
  aplicarTravas(p);
}

// caixa de um elemento no espaço do card (o mesmo de p.cell, p.area e dos transform dos filhos)
function caixaNoCard(p, el) {
  const R = retSvgBBox(el), m = matrizAteRaiz(p.g), sx = m.a || 1, sy = m.d || 1;
  return { x: (R.x - m.e) / sx, y: (R.y - m.f) / sy, w: R.w / sx, h: R.h / sy };
}
// blocos travados (data-trava do construtor; o DE vem preso no preço): o aplicarCelula já os levou pelo
// canto do card, aqui vão pro lugar certo — com o grupo do preço (mesmo transform, escala junto), com o pé
// do título, ou no mesmo lugar relativo dentro da área da foto (Mais Perto, SMD-773, 17/10/2026: o DE
// seguia o canto de cima-esquerdo e ficava longe do preço nos cards mais largos)
function aplicarTravas(p) {
  for (const o of p.outros || []) {
    if (!o.trava || o.estica) continue;
    let tr = null;
    if (o.trava === 'preco' && p.precoG && p.precoG !== p.g) tr = `${p.precoG.getAttribute('transform') || ''} ${o.tr}`;
    else if (o.trava === 'nome' && p.nomeG && p.base.nomeTrava) {
      const B = p.base.nomeTrava, N = caixaNoCard(p, p.nomeG);
      tr = `translate(${arred(N.x + N.w / 2 - (B.x + B.w / 2))} ${arred(N.y + N.h - (B.y + B.h))}) ${o.tr}`;
    } else if (o.trava === 'imagem' && p.area && p.areaOrig) {
      const A = p.areaOrig, Z = p.area, b = o.el.getBBox(), cx = b.x + b.width / 2, cy = b.y + b.height / 2;
      const nx = Z.x + (cx - A.x) / (A.w || 1) * Z.w, ny = Z.y + (cy - A.y) / (A.h || 1) * Z.h;
      tr = `translate(${arred(nx - cx)} ${arred(ny - cy)}) ${o.tr}`;
    }
    if (tr != null) o.el.setAttribute('transform', tr.trim());
  }
}

// tapete/apoio: largura do card, proporção do desenho, e a borda de baixo um pouco abaixo da base
// das fotos (padrão imagem.apoio_afunda, fração da altura do tapete; 0,2 no template do Lima) —
// a foto parece apoiada em cima. Não passa do pé do card.
function posApoio(p) {
  const a = p.apoio; if (!a) return;
  const c = p.cell, I = (S.padrao && S.padrao.imagem) || {};
  let w = c.w, h = w * a.prop; const afunda = typeof I.apoio_afunda === 'number' ? I.apoio_afunda : 0.2;
  const fb = p.fotos.length ? Math.max(...p.fotos.map(im => { const r = retFoto(im); return r.y + r.h; })) : c.y + c.h - afunda * h;
  const base = Math.min(fb + afunda * h, c.y + c.h + 4);
  const k = p.apoioEsc || 1, w0 = w, h0 = h, xb = c.x, yb = base - h0;
  (p.apoiosExtra || []).forEach((e, i) => {
    const n = 'apoio' + (i + 1), ke = p[n + 'Esc'] || 1;
    const ew0 = w0 * e.rw, ew = ew0 * ke, eh = ew * e.prop, eh0 = ew0 * e.prop;
    const ex = xb + e.rx * w0 + (ew0 - ew) / 2 + (p[n + 'Dx'] || 0), ey = yb + e.ry * h0 + (eh0 - eh) + (p[n + 'Dy'] || 0);
    e.el.setAttribute('transform', `translate(${arred(ex)} ${arred(ey)}) scale(${ew / e.bb.w} ${eh / e.bb.h}) translate(${-e.bb.x} ${-e.bb.y})`);
    e.el.style.display = p[n + 'Off'] ? 'none' : '';
  });
  a.el.style.display = p.apoioOff ? 'none' : '';
  w = w0 * k; h = w * a.prop; // cresce a partir do centro de baixo
  const x = c.x + (w0 - w) / 2 + (p.apoioDx || 0), y = base - h + (p.apoioDy || 0);
  a.el.setAttribute('transform', `translate(${arred(x)} ${arred(y)}) scale(${w / a.bb.w} ${h / a.bb.h}) translate(${-a.bb.x} ${-a.bb.y})`);
}

function render(p) {
  p.g.style.display = p.removido ? 'none' : '';
  p.g.classList.toggle('ed-campanha', p.zona === ZONA_CAMPANHA);
  if (p.removido) return;
  const A0 = p.area ? { ...p.area } : null;
  aplicarCelula(p);
  posApoio(p);
  renderNome(p);
  bordaDoProduto(p);
  calcArea(p); // o topo da área depende do pé do nome que acabou de ser escrito
  // a área mudou (célula, nome com mais/menos linhas, ajuste da área): as fotos vão junto. Logo
  // depois de abrir a ficha (areaSegue = false) as fotos salvas valem como estão.
  if (p.areaSegue && A0 && p.fotos && p.fotos.length && ['x', 'y', 'w', 'h'].some(k => Math.abs(A0[k] - p.area[k]) > 0.05)) remapearFotos(p, A0, p.area);
  p.areaSegue = true;
  // o valor mede o fundo como o template desenhou: mexer no fundo (tamanho/posição) não mexe no preço
  if (p.fundoAlvo) { const tr = p.base.fundoAlvo.tr; if (tr) p.fundoAlvo.setAttribute('transform', tr); else p.fundoAlvo.removeAttribute('transform'); }
  const rf = regraFundo(p);
  if (rf) zerarRegraFundo(p, rf);
  renderPreco(p);
  renderSimples(p, 'formato', p.formato, p.formatoTxt, p.empurraCent || 0);
  formatoSemInvadir(p);
  for (const f of p.formatosExtra || []) {
    f.el.style.display = p.formatoTxt ? '' : 'none';
    escreverCampo(f.el, [p.formatoTxt || ''], f.base.dir, 'end', f.base.fonte, 0);
  }
  renderTarja(p);
  renderGrupoPreco(p);
  posQtd(p); // depois do preço: o limite segue o grupo dele
  if (rf) { try { aplicarRegraFundo(p, rf); } catch (e) { console.warn('regra do fundo', p.id, e); } }
  seloPecas(p);
  // largura máxima do fundo: o grupo do preço inteiro diminui por igual (p.regraS) e é desenhado de novo
  if (rf && rf.max && p.regraSNovo != null && p.regraSNovo !== (p.regraS || 1) && (p.regraSNovo === 1 || Math.abs(p.regraSNovo - (p.regraS || 1)) > 0.003)) {
    p.regraS = p.regraSNovo; zerarRegraFundo(p, rf); renderGrupoPreco(p);
    try { aplicarRegraFundo(p, rf); } catch (e) { console.warn('regra do fundo', p.id, e); }
  }
  if (!nomePresoAoPreco(p)) nomeAcimaDoPreco(p);
  // a área por regras olha o preço já no lugar final: refaz e leva as fotos junto
  if (p.areaRegra && !p.areaAj) {
    const A1 = { ...p.area }; calcArea(p);
    if (p.fotos && p.fotos.length && ['x', 'y', 'w', 'h'].some(k => Math.abs(A1[k] - p.area[k]) > 0.05)) remapearFotos(p, A1, p.area);
  }
  renderLogo(p);
  aplicarTravas(p); // a área pode ter mudado depois do preço
}

// ---------------------------------------------------------------- tamanho em pt na página
// escala do elemento até a raiz do SVG (média dos eixos): fonte local × escala = pt na página
function escalaAteRaiz(e) {
  if (!e) return 1;
  const m = matrizAteRaiz(e);
  return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
}
function ptDoTexto(t) {
  const f = parseFloat(t.style.fontSize || getComputedStyle(t).fontSize) || 0;
  return f * escalaAteRaiz(t);
}

// troca as palavras dentro das linhas que o Illustrator já posicionou (cada linha mantém x/y, o
// alinhamento e as cópias de contorno/sombra): é o certo pra data de validade, telefone etc.
// linhas do <text>: folhas agrupadas pelo y herdado
function linhasDoTexto(t) {
  const folhas = $$('tspan', t).filter(s => !s.querySelector('tspan'));
  const grupos = []; let yAtual = null;
  for (const s of folhas) {
    let dono = s, y = null;
    while (dono && dono !== t && y === null) { if (dono.hasAttribute('y')) y = dono.getAttribute('y'); dono = dono.parentNode; }
    if (y === null) y = yAtual;
    if (y !== yAtual || !grupos.length) { grupos.push([]); yAtual = y; }
    grupos[grupos.length - 1].push(s);
  }
  return grupos;
}
// quem guarda o x da linha (a folha ou um tspan pai dela)
function donoX(t, s) { let d = s; while (d && d !== t) { if (d.hasAttribute('x')) return d; d = d.parentNode; } return null; }
function larguraLinha(g) { return g.reduce((a, s) => a + (s.textContent ? s.getComputedTextLength() : 0), 0); }
function alinhamentoOrig(t) {
  const gs = linhasDoTexto(t);
  if (gs.length < 2) return 'start';
  const ls = gs.map(g => { const d = donoX(t, g[0]); const x = d ? +d.getAttribute('x').split(/[ ,]+/)[0] : 0; return { x, w: larguraLinha(g) }; });
  const perto = f => { const v = ls.map(f); return Math.max(...v) - Math.min(...v) < 2; };
  if (perto(l => l.x)) return 'start';
  if (perto(l => l.x + l.w / 2)) return 'middle';
  if (perto(l => l.x + l.w)) return 'end';
  return 'start';
}
function trocarNoLugar(t, linhas, ancora) {
  if (!$$('tspan', t).length) { if (linhas.length !== 1) return false; t.textContent = linhas[0]; return true; }
  let gs = linhasDoTexto(t);
  if (!t._lin0) {
    // caixa original das linhas (no espaço do texto) pra realinhar depois
    const ls = gs.map(g => { const d = donoX(t, g[0]); const x = d ? +d.getAttribute('x').split(/[ ,]+/)[0] : 0; return { x, w: larguraLinha(g) }; });
    t._lin0 = { L: Math.min(...ls.map(l => l.x)), R: Math.max(...ls.map(l => l.x + l.w)), xs: ls.map(l => l.x) };
  }
  // linha a mais: clona a última (mesmo estilo) uma entrelinha abaixo; a menos: some com as do fim
  while (gs.length < linhas.length) {
    const ult = gs[gs.length - 1], pen = gs[gs.length - 2];
    let topo = ult[0]; while (topo.parentNode !== t) topo = topo.parentNode;
    const yDe = g => { let d = g[0]; while (d && d !== t) { if (d.hasAttribute('y')) return +d.getAttribute('y'); d = d.parentNode; } return 0; };
    const passo = pen ? yDe(ult) - yDe(pen) : (t.getBBox().height || 20);
    const novo = topo.cloneNode(true);
    const comY = novo.hasAttribute('y') ? novo : novo.querySelector('[y]');
    if (comY) comY.setAttribute('y', arred(yDe(ult) + passo));
    t.appendChild(novo);
    t._lin0.xs.push(t._lin0.xs[t._lin0.xs.length - 1]);
    const antes = gs.length;
    gs = linhasDoTexto(t);
    // linha sem y (texto em <textPath>): o clone não vira linha nova; junta o resto na última
    if (gs.length <= antes) { novo.remove(); t._lin0.xs.pop(); gs = linhasDoTexto(t); linhas = [...linhas.slice(0, gs.length - 1), linhas.slice(gs.length - 1).join(' ')]; break; }
  }
  gs.forEach((g, i) => {
    if (i >= linhas.length) { g.forEach(s => { s.textContent = ''; }); return; }
    g[0].textContent = linhas[i]; g.slice(1).forEach(s => { s.textContent = ''; });
  });
  // alinhamento: cada linha move o próprio x dentro da caixa original
  const { L, R, xs } = t._lin0;
  gs.forEach((g, i) => {
    const d = donoX(t, g[0]); if (!d || i >= linhas.length) return;
    const w = larguraLinha(g);
    const x = ancora === 'middle' ? (L + R) / 2 - w / 2 : ancora === 'end' ? R - w : (ancora === 'start' && t._alOrig === 'start' ? xs[i] : L);
    const resto = d.getAttribute('x').split(/[ ,]+/).slice(1);
    d.setAttribute('x', [arred(x), ...resto].join(' '));
  });
  return true;
}
function renderTexto(tx) {
  const linhasNo = (tx.linhas || '').split('\n');
  // troca no lugar, sem reescrever: cada linha guarda cor, tamanho e contorno do template
  tx.txts.forEach(t => { t._alOrig = tx.ancoraOrig; });
  if (tx.txts.every(t => trocarNoLugar(t, linhasNo, tx.ancora))) return;
  const b = tx.info.bb;
  const x = tx.ancora === 'end' ? b.x + b.w : tx.ancora === 'middle' ? b.x + b.w / 2 : b.x;
  const linhas = (tx.linhas || '').split('\n');
  const entre = tx.info.entre || tx.info.fonte * 1.1;
  for (const t of tx.txts) escreverTexto(t, linhas, x, tx.ancora, null, entre, null);
}

// ---------------------------------------------------------------- estado (ficha) e desfazer
function estado(p) {
  return {
    tipo: 'p', id: p.id, num: p.num, novo: p.novo || undefined, molde: p.molde !== 'normal' ? p.molde : undefined, moldeDe: p.moldeDe || undefined,
    autoH: p.autoH || undefined, origemNormal: p.origemNormal || undefined, fixoNormal: p.fixoNormal || undefined,
    span: p.span.c > 1 || p.span.r > 1 ? { ...p.span } : undefined,
    cell: { x: arred(p.cell.x), y: arred(p.cell.y), w: arred(p.cell.w), h: arred(p.cell.h) },
    nome: p.nome, preco: p.precoTxt, formato: p.formatoTxt, qtd: p.qtdTxt, tarja: p.tarja ? p.tarjaTxt : undefined,
    escNome: p.escNome, escPreco: p.escPreco, fundoW: p.fundoW, fundoH: p.fundoH, fundoDx: p.fundoDx || undefined, fundoDy: p.fundoDy || undefined, nomeCaixa: p.nomeCaixa, nomeEntre: p.nomeEntre, nomeAlinha: p.nomeAlinha || undefined, nomeLinhas: p.nomeLinhas || undefined, nomeBorda: p.nomeBorda ?? undefined, nomeBordaCor: p.nomeBordaCor || undefined,
    precoDx: arred(p.precoDx), precoDy: arred(p.precoDy), nomeDx: arred(p.nomeDx), nomeDy: arred(p.nomeDy),
    qtdDx: p.qtdDx ? arred(p.qtdDx) : undefined, qtdDy: p.qtdDy ? arred(p.qtdDy) : undefined,
    qtdEsc: p.qtdEsc && p.qtdEsc !== 1 ? p.qtdEsc : undefined, qtdZ: p.qtdZ ?? undefined,
    removido: p.removido || undefined, z: p.z || undefined,
    escReal: p.escReal && p.escReal !== 1 ? p.escReal : undefined, escCent: p.escCent && p.escCent !== 1 ? p.escCent : undefined,
    apoioDx: p.apoioDx ? arred(p.apoioDx) : undefined, apoioDy: p.apoioDy ? arred(p.apoioDy) : undefined,
    apoioEsc: p.apoioEsc && p.apoioEsc !== 1 ? p.apoioEsc : undefined,
    apoiosAj: (p.apoiosExtra || []).length ? p.apoiosExtra.map((_, i) => { const n = 'apoio' + (i + 1); return { dx: arred(p[n + 'Dx'] || 0), dy: arred(p[n + 'Dy'] || 0), esc: p[n + 'Esc'] || 1, off: p[n + 'Off'] || undefined }; }) : undefined,
    apoioOff: p.apoioOff || undefined,
    precosExtra: p.extras && p.extras.length ? Object.fromEntries(p.extras.map(v => [v.suf, v.txt])) : undefined,
    de: p.de ? { on: !!p.deOn, preco: p.deTxt } : undefined,
    selo: p.selo ? { on: !!p.seloOn, preco: p.seloTxt } : undefined,
    logo: p.logo ? { on: !!p.logoOn, arq: p.logoArq || undefined, dx: p.logoDx ? arred(p.logoDx) : undefined,
      dy: p.logoDy ? arred(p.logoDy) : undefined, esc: p.logoEsc && p.logoEsc !== 1 ? p.logoEsc : undefined } : undefined,
    areaImg: p.areaAj ? { ...p.areaAj } : undefined,
    cellAj: p.cellAj ? { ...p.cellAj } : undefined,
    // foto relativa à área da imagem (SMD-829, 19/10/2026): ao abrir, a posição sai da área do template atual.
    // x/y/w/h absolutos ficam pra quem lê a ficha de fora e pra abrir igual quando a área não mudou
    fotoArea: p.fotos.length && p.area ? (p.fotoPend ? { ...p.fotoPend.area } : areaArred(p)) : undefined,
    fotoAlinha: p.fotos.length ? (p.fotoPend ? p.fotoPend.alinha : alinhaFoto(p)) : undefined,
    fotoMao: p.fotos.length && !fotosDoArranjo(p) ? true : undefined,
    fotoArranjo: p.fotos.length && fotosDoArranjo(p) && p.fotosAuto.tipo !== 'auto' ? p.fotosAuto.tipo : undefined,
    fotos: p.fotos.map(im => { const r = retFoto(im); return { arq: im.dataset.arq, ...r, rel: p.area ? fotoRelativa(r, p.fotoPend ? p.fotoPend.area : areaArred(p)) : undefined }; }),
  };
}
// a área como vai pra ficha: a fração sai dela (e não da área com todas as casas) pra salvar e reabrir dar igual
const alinhaFoto = p => (p.fotoAlinha ? `${p.fotoAlinha.y} ${p.fotoAlinha.x}` : undefined);
// a ficha gravou a foto numa área (ou alinhamento) que o template atual não tem mais: pendente
function pendenciaFoto(p, area, alinha, mao) {
  if (!area || !p.fotos.length || !p.area) return null;
  return !mesmaCaixa(area, p.area) || (!mao && alinha !== alinhaFoto(p)) ? { area: { ...area }, alinha } : null;
}
function areaArred(p) { const A = p.area; return { x: arred(A.x), y: arred(A.y), w: arred(A.w), h: arred(A.h) }; }
// Atualizar template (opcional, Matheus 19/10/2026): a edição abre como foi gravada; se o template foi
// republicado com outra zona ou outra área/alinhamento da foto, aparece o aviso e quem decide é ele.
// Atualizar = zonas pela zona nova do template (com o que a edição tinha mexido nela por cima; ficha antiga
// sem areaTpl volta pra zona do template), cards nas casas novas com o ajuste à mão (cellAj) por cima, foto
// do arranjo no encaixe automático da área nova e foto mexida à mão na mesma posição relativa. Desfaz.
function temAtualizacaoTpl() { return Object.keys(S.gradesPend || {}).length > 0 || S.produtos.some(p => p.fotoPend && !p.removido); }
function avisoTemplateMudou() {
  const b = $('#tpl-novo'); if (!b) return;
  b.classList.toggle('oculto', !temAtualizacaoTpl() || !!S.tplAvisoFechado);
}
function atualizarTemplate() {
  const lote = [{ tipo: 'pendTpl', grades: { ...(S.gradesPend || {}) } }];
  for (const k in S.grades) { const g = S.grades[k]; lote.push({ tipo: 'grade', zona: k, g: { ...g, area: { ...g.area }, linhas: g.linhas ? [...g.linhas] : null } }); }
  lote.push(...S.produtos.map(estado));
  S.desfazer.push(lote);
  // antes de mexer: onde cada foto está e em que área ela foi posta
  const antes = new Map(S.produtos.filter(p => !p.removido && p.fotos.length).map(p => [p, {
    rs: p.fotos.map(retFoto), area: p.fotoPend ? p.fotoPend.area : { ...p.area }, auto: fotosDoArranjo(p) ? p.fotosAuto.tipo : null }]));
  let zonas = 0;
  for (const k in S.grades) {
    const g = S.grades[k], T = S.gradesOrig && S.gradesOrig[k] && S.gradesOrig[k].area, T0 = S.gradesPend && S.gradesPend[k];
    if (!T) continue;
    let area = null;
    if (T0) area = { x: T.x + (g.area.x - T0.x), y: T.y + (g.area.y - T0.y), w: T.w + (g.area.w - T0.w), h: T.h + (g.area.h - T0.h) };
    else if (S.gradesLegado && S.gradesLegado.has(k) && !mesmaCaixa(g.area, T, 0.5)) area = { ...T };
    if (!area) continue;
    if (!(area.w > 40 && area.h > 40)) area = { ...T };
    g.area = area;
    const manter = g.manterAjuste; g.manterAjuste = true; montarGrade(k); g.manterAjuste = manter;
    zonas++;
  }
  S.gradesPend = {}; if (S.gradesLegado) S.gradesLegado.clear();
  atribuirZonas();
  let fotos = 0;
  for (const [p, a] of antes) {
    render(p);
    if (a.auto) arranjar(p, a.auto);
    else p.fotos.forEach((im, i) => { if (a.rs[i]) posFoto(im, fotoNaArea(fotoRelativa(a.rs[i], a.area), a.area, p.area)); });
    if (!a.auto) p.fotosAuto = null;
    if (p.fotoPend || !mesmaCaixa(a.area, p.area)) fotos++;
    p.fotoPend = null; p.fotosRef = null;
    render(p);
  }
  S.tplAvisoFechado = false; avisoTemplateMudou();
  mudou(); painel(); desenharSelecao();
  aviso(zonas || fotos ? `Atualizado pelo template: ${zonas} zona(s), ${fotos} card(s) com foto. Desfazer volta.` : 'A edição já está igual ao template', 3500);
}

// foto em fração da área: centro e pé (como o remapearFotos), largura e altura
const f5 = v => Math.round(v * 1e5) / 1e5;
function fotoRelativa(r, A) {
  return { cx: f5((r.x + r.w / 2 - A.x) / A.w), pe: f5((r.y + r.h - A.y) / A.h), w: f5(r.w / A.w), h: f5(r.h / A.h) };
}
// a foto relativa (rel, em fração da área de referência R) na área A: mesma escala nos dois sentidos
function fotoNaArea(rel, R, A) {
  const s = Math.min(A.w / R.w, A.h / R.h), w = rel.w * R.w * s, h = rel.h * R.h * s;
  return { x: A.x + rel.cx * A.w - w / 2, y: A.y + rel.pe * A.h - h, w, h };
}
function fotografarFotos(p) {
  return { ims: [...p.fotos], rs: p.fotos.map(retFoto), pais: p.fotos.map(im => im.parentNode), prox: p.fotos.map(im => im.nextSibling),
    card: { fundoW: p.fundoW, fundoH: p.fundoH, nomeCaixa: p.nomeCaixa } };
}
function restaurarFotos(p, f) {
  for (const im of p.fotos) if (!f.ims.includes(im)) im.remove();
  for (let i = f.ims.length - 1; i >= 0; i--) {
    const im = f.ims[i], ref = f.prox[i], pai = f.pais[i];
    if (ref && ref.parentNode === pai) pai.insertBefore(im, ref); else pai.appendChild(im);
    posFoto(im, f.rs[i]);
  }
  p.fotos = [...f.ims];
  Object.assign(p, f.card);
}
const mesmaCaixa = (a, b, tol = 0.05) => !!a && !!b && ['x', 'y', 'w', 'h'].every(k => Math.abs(a[k] - b[k]) <= tol);
// fotos da ficha no lugar final, depois que célula, nome, preço e regras da abertura já assentaram a área.
// Área igual à gravada = posições gravadas (abre idêntico). Área mudou (template republicado, zona
// mexida): foto do arranjo volta pro encaixe automático na área nova; mexida à mão segue a área na mesma
// posição relativa. Ficha antiga (sem fotoArea): a referência é a célula gravada e a foto vale como mexida
// à mão, a não ser que esteja exatamente onde o arranjo automático poria.
function assentarFotosDaFicha(p) {
  const e = p.fichaFotos; p.fichaFotos = null; p.fotoPend = null;
  if (!e || p.removido || !p.fotos.length || !p.area) return;
  const abs = e.fotos.map(f => ({ x: f.x, y: f.y, w: f.w, h: f.h }));
  const recolocar = rs => p.fotos.forEach((im, i) => { if (rs[i]) posFoto(im, rs[i]); });
  recolocar(abs);
  if (e.area) {
    // a área (ou o alinhamento, foto_alinha do construtor) do template mudou: fica pro "Atualizar template"
    p.fotoPend = pendenciaFoto(p, e.area, e.alinha, e.mao);
    if (!e.mao) marcarArranjo(p, e.arranjo || 'auto');
  } else {
    // estava onde o arranjo automático poria? então é do arranjo (testa e desfaz: o arranjo pode tirar
    // cópia, mudar a ordem e o padrão do card)
    const snap = fotografarFotos(p), antes = assinaturaFotos(p);
    arranjar(p, 'auto');
    const B = assinaturaFotos(p), igual = snap.ims.length === p.fotos.length && snap.ims.every((im, i) => im === p.fotos[i])
      && antes.every((r, i) => r.every((v, k) => Math.abs(v - B[i][k]) < 0.5));
    restaurarFotos(p, snap);
    if (igual) marcarArranjo(p, 'auto'); else p.fotosAuto = null;
  }
  p.fotosRef = null;
  render(p);
}
function aplicarEstado(p, e) {
  p.areaAj = e.areaImg ? { ...e.areaImg } : null;
  p.areaSegue = false; // as fotos da ficha já estão onde devem
  if (e.cell) p.cell = { ...e.cell };
  else p.cell = { ...p.card, x: p.card.x + (e.dx || 0), y: p.card.y + (e.dy || 0) }; // ficha antiga
  p.cellAj = e.cellAj ? { ...e.cellAj } : null;
  p.cellAuto = p.cellAj ? comAjuste(p.cell, { l: -p.cellAj.l, t: -p.cellAj.t, r: -p.cellAj.r, b: -p.cellAj.b }) : null;
  aplicarCelula(p);
  if (e.nome != null) p.nome = e.nome;
  if (e.preco != null) p.precoTxt = e.preco;
  if (e.formato != null) p.formatoTxt = e.formato;
  if (e.qtd != null) p.qtdTxt = e.qtd;
  if (e.tarja != null && p.tarja) p.tarjaTxt = e.tarja;
  p.escNome = e.escNome || 1; p.escPreco = e.escPreco || 1; p.fundoW = e.fundoW || 1; p.fundoH = e.fundoH || 1; p.fundoDx = e.fundoDx || 0; p.fundoDy = e.fundoDy || 0;
  p.nomeCaixa = e.nomeCaixa || 1; p.nomeEntre = e.nomeEntre || 1; p.nomeAlinha = e.nomeAlinha || null; p.nomeLinhas = e.nomeLinhas || null; p.nomeBorda = typeof e.nomeBorda === 'number' ? e.nomeBorda : null; p.nomeBordaCor = e.nomeBordaCor || null;
  p.precoDx = e.precoDx || 0; p.precoDy = e.precoDy || 0; p.nomeDx = e.nomeDx || 0; p.nomeDy = e.nomeDy || 0;
  p.qtdDx = e.qtdDx || 0; p.qtdDy = e.qtdDy || 0; p.qtdEsc = e.qtdEsc || 1; p.qtdZ = e.qtdZ ?? null;
  p.escReal = e.escReal || 1; p.escCent = e.escCent || 1; p.apoioDx = e.apoioDx || 0; p.apoioDy = e.apoioDy || 0; p.apoioEsc = e.apoioEsc || 1;
  (p.apoiosExtra || []).forEach((_, i) => { const n = 'apoio' + (i + 1), a = (e.apoiosAj || [])[i] || {}; p[n + 'Dx'] = a.dx || 0; p[n + 'Dy'] = a.dy || 0; p[n + 'Esc'] = a.esc || 1; p[n + 'Off'] = !!a.off; });
  p.apoioOff = !!e.apoioOff;
  p.removido = !!e.removido || !!p.empilhado; p.novo = !!e.novo; p.z = e.z || 0;
  p.autoH = !!e.autoH; p.origemNormal = e.origemNormal || null; p.fixoNormal = !!e.fixoNormal;
  if (e.precosExtra) for (const v of p.extras || []) if (e.precosExtra[v.suf] != null) v.txt = e.precosExtra[v.suf];
  if (e.de && p.de) { p.deOn = !!e.de.on; if (e.de.preco != null) p.deTxt = e.de.preco; }
  if (e.selo && e.selo.on) garantirSelo(p);
  if (e.selo && p.selo) { p.seloOn = !!e.selo.on; if (e.selo.preco != null) p.seloTxt = e.selo.preco; }
  if (e.logo && e.logo.on) garantirLogo(p);
  if (e.logo && p.logo) { p.logoOn = !!e.logo.on; if (e.logo.arq) p.logoArq = e.logo.arq; }
  p.logoDx = (e.logo && e.logo.dx) || 0; p.logoDy = (e.logo && e.logo.dy) || 0; p.logoEsc = (e.logo && e.logo.esc) || 1;
  if (e.span) p.span = { ...e.span }; else if (p.molde === 'normal') p.span = { c: 1, r: 1 };
  if (e.fotos) {
    p.fotos.forEach(im => im.remove());
    p.fotos = e.fotos.map(f => novaFoto(f.arq, f));
    for (const im of p.fotos) inserirFoto(p, im);
    p.fotosAuto = null;
    // abrindo a edição: a passada final (assentarFotosDaFicha) recoloca pela área do template atual.
    // Desfazer/refazer (S.carregado) volta exatamente pro que estava
    p.fichaFotos = S.carregado ? null : { fotos: e.fotos, area: e.fotoArea || null, mao: !!e.fotoMao, arranjo: e.fotoArranjo || null, cell: e.cell || null, alinha: e.fotoAlinha };
    if (S.carregado && !e.fotoMao && e.fotoArea) marcarArranjo(p, e.fotoArranjo || 'auto');
  }
  render(p);
  if (S.carregado) p.fotoPend = pendenciaFoto(p, e.fotoArea, e.fotoAlinha, !!e.fotoMao);
}

// texto da ficha → texto da arte. A chave (tx0, tx1…) é a ordem no SVG e muda quando o template ganha
// um texto antes (Preço Certo Fim de Semana, 09/10/2026: a data virou <text> e o rodapé salvo em tx0
// caiu na data, travando a página). Vale o texto original; ficha antiga sem ele usa a chave só se o
// número de linhas bate, senão o 1º texto livre com o mesmo número de linhas.
function textoDaFicha(est, usados) {
  const livre = t => t && !usados.has(t);
  if (est.orig != null) return S.textos.find(t => livre(t) && t.orig === est.orig) || null;
  const n = (est.linhas || '').split('\n').length, nLin = t => t.orig.split('\n').length;
  const tx = S.porChave[est.chave];
  if (livre(tx) && (est.linhas == null || nLin(tx) === n)) return tx;
  return S.textos.find(t => livre(t) && nLin(t) === n && n > 1) || null;
}
function estadoTexto(tx) {
  return { tipo: 't', v: 2, chave: tx.chave, orig: tx.orig, linhas: tx.linhas, ancora: tx.ancora, dx: arred(tx.dx) || undefined, dy: arred(tx.dy) || undefined, esc: tx.esc !== 1 ? tx.esc : undefined, ok: tx.ok || undefined };
}
function aplicarTexto(tx, e) {
  tx.ok = e.ok || null;
  tx.linhas = e.linhas != null ? e.linhas : tx.orig;
  tx.ancora = e.ancora && (e.v || e.ancora !== 'start') ? e.ancora : tx.ancoraOrig;
  tx.dx = e.dx || 0; tx.dy = e.dy || 0; tx.esc = e.esc || 1;
  tx.mexido = textoMexido(tx);
  if (!tx.mexido) tx.ancora = tx.ancoraOrig;
  renderTexto(tx); posTexto(tx);
}

function estadoFundo(i) { const f = S.paginas[i].fundo; return { tipo: 'f', pagina: i, arq: f ? f.dataset.arq : '', orig: f ? f.dataset.arqOrig : '' }; }
function aplicarFundo(i, arq) {
  const pg = S.paginas[i], f = pg && pg.fundo; if (!f || !arq) return;
  f.dataset.arq = arq;
  setHref(f, urlImg(arq, 2000));
  geoFundo(f, null);
  // imagem nova com outra proporção cobre a mesma área da original
  f.setAttribute('preserveAspectRatio', arq === f.dataset.arqOrig ? 'none' : 'xMidYMid slice');
  if (arq === f.dataset.arqOrig) return;
  // fundo do template só no topo (Super Mais: cabeçalho de 1021×490) e imagem nova do tamanho da
  // prancheta (CAPA.jpg 1080×1350): a nova cobre a página inteira, não só a área do cabeçalho
  proporcao(arq, 0).then(ar => {
    if (f.dataset.arq !== arq || !ar) return;
    const box = retSvgBBox(f), arPg = pg.w / pg.h, perto = (a, b) => Math.abs(a / b - 1) < 0.03;
    if (perto(ar, arPg) && !perto(box.w / box.h, arPg)) geoFundo(f, pg);
  });
}
// ret = área no espaço do SVG raiz (página inteira), ou null = volta à geometria do template
function geoFundo(f, ret) {
  if (!ret) {
    const g = f.dataset.geo ? JSON.parse(f.dataset.geo) : null; if (!g) return;
    ['x', 'y', 'width', 'height', 'transform'].forEach((a, k) => g[k] == null ? f.removeAttribute(a) : f.setAttribute(a, g[k]));
    return;
  }
  const inv = matrizAteRaiz(f.parentNode).inverse();
  const pt = (x, y) => { const p = S.svg.createSVGPoint(); p.x = x; p.y = y; return p.matrixTransform(inv); };
  const a = pt(ret.x, ret.y), c = pt(ret.x + ret.w, ret.y + ret.h);
  f.removeAttribute('transform');
  f.setAttribute('x', arred(Math.min(a.x, c.x))); f.setAttribute('y', arred(Math.min(a.y, c.y)));
  f.setAttribute('width', arred(Math.abs(c.x - a.x))); f.setAttribute('height', arred(Math.abs(c.y - a.y)));
}

function inserirFoto(p, im, depoisDe) {
  if (depoisDe && depoisDe.parentNode) depoisDe.after(im);
  else if (p.ancoraFotos && p.ancoraFotos.parentNode === p.g) p.g.insertBefore(im, p.ancoraFotos);
  else p.g.appendChild(im);
}
function relerFotos(p) { p.fotos = $$('image.ed-img', p.g); }

// antes de cada ação: guarda o estado do que ela mexe (produtos, textos, fundos; marcar(S.linhas) = as linhas)
function marcar(...itens) {
  const lote = [];
  for (const it of itens) {
    if (!it) continue;
    if (it.g && it.base) lote.push(estado(it));
    else if (it.txts) lote.push(estadoTexto(it));
    else if (typeof it.fundo === 'number') lote.push(estadoFundo(it.fundo));
    else if (it === S.linhas) lote.push(estadoLinhas());
  }
  if (!lote.length) return;
  S.desfazer.push(lote);
  if (S.desfazer.length > 80) S.desfazer.shift();
}
function desfazer() {
  const lote = S.desfazer.pop();
  if (!lote) return aviso('Nada pra desfazer');
  for (const e of lote) {
    if (e.tipo === 'p') { aplicarEstado(S.porId[e.id], e); levarParaPagina(S.porId[e.id]); }
    if (e.tipo === 't') aplicarTexto(S.porChave[e.chave], e);
    if (e.tipo === 'f') aplicarFundo(e.pagina, e.arq);
    if (e.tipo === 'novo') { const p = S.porId[e.id]; if (p) { p.removido = true; render(p); } }
    if (e.tipo === 'grade' && S.grades[e.zona]) Object.assign(S.grades[e.zona], e.g);
    if (e.tipo === 'pendTpl') { S.gradesPend = { ...e.grades }; avisoTemplateMudou(); }
    if (e.tipo === 'l') aplicarLinhas(e.linhas);
  }
  // a célula voltou: a zona acompanha (ex.: desfazer uma troca de lugar entre zonas)
  atribuirZonas(lote.filter(e => e.tipo === 'p' && S.porId[e.id]).map(e => S.porId[e.id]));
  S.selImgs = S.selImgs.filter(im => im.isConnected);
  mudou(); painel();
}

let tSalvar = null;
// borda do nome: o template pode trazer a regra no <style> (contorno por fora, paint-order: stroke)
// com a espessura em var(--nome-borda, Npx) e a cor em var(--nome-borda-cor, #hex). Template SEM a
// regra ganha uma do editor (só vale no nome com a classe ed-borda, ou seja, que mudou; o contorno
// que o template já desenha é lido como ponto de partida e fica quando nada mudou). Metade do traço fica embaixo do
// preenchimento, então o stroke-width é o dobro dos pt visíveis. 0 = sem borda.
// Níveis (o mais específico manda): produto (p.nomeBorda/p.nomeBordaCor) > grupo da edição
// (estilo.grupos.destaque|normal) > edição (estilo.nomeBorda/nomeBordaCor) > salvo no template
// (S.estiloTpl, mesmo formato) > o que o SVG traz.
function lerBordaNomeTpl() {
  for (const st of $$('style', S.svg)) {
    const m = (st.textContent || '').match(/--nome-borda\s*,\s*([\d.]+)px/);
    if (m) return +m[1] / 2;
  }
  return null;
}
function lerBordaCorTpl() {
  for (const st of $$('style', S.svg)) {
    const m = (st.textContent || '').match(/--nome-borda-cor\s*,\s*(#[0-9a-fA-F]{3,8})/);
    if (m) return m[1].length === 4 ? '#' + [...m[1].slice(1)].map(c => c + c).join('') : m[1].slice(0, 7);
  }
  return null;
}
const COR_BORDA_NOVA = '#ffffff';
function prepararBordaNome() {
  const b = lerBordaNomeTpl();
  S.bordaNativa = b != null;
  S.bordaTpl = S.bordaNativa ? b : 0;
  S.bordaCorTpl = lerBordaCorTpl() || COR_BORDA_NOVA;
  // sem a regra, o nome pode já ter contorno desenhado (Marcelino: branco): ele é o ponto de partida
  if (!S.bordaNativa) {
    const t = (S.produtos || []).map(p => p.nomeG && p.nomeG.querySelector('text')).find(Boolean);
    const cs = t && getComputedStyle(t), sw = cs ? parseFloat(cs.strokeWidth) || 0 : 0;
    if (cs && cs.stroke && cs.stroke !== 'none' && sw > 0) {
      S.bordaTpl = Math.round(sw / 2 * 2) / 2;
      const m = cs.stroke.match(/\d+/g);
      if (m) S.bordaCorTpl = '#' + m.slice(0, 3).map(v => (+v).toString(16).padStart(2, '0')).join('');
    }
  }
  if (!S.bordaNativa && !$('#ed-borda-css', S.svg)) {
    const st = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    st.id = 'ed-borda-css';
    st.textContent = `.ed-borda, .ed-borda text, .ed-borda tspan { stroke: var(--nome-borda-cor, ${COR_BORDA_NOVA}); stroke-width: var(--nome-borda, 0px); paint-order: stroke; stroke-linejoin: round; }`;
    S.svg.insertBefore(st, S.svg.firstChild);
  }
  if (!S.bordaAlvo) S.bordaAlvo = 'todos';
  const c = $('#nb-corpo'); if (c && !c.firstChild) c.innerHTML = bordaHtml('geral');
}
// destaque = card especial ou que ocupa mais de uma casa
// (o horizontal é outro desenho do card comum: só é destaque se ocupar mais de uma casa)
function ehDestaque(p) { return (p.molde !== 'normal' && p.desenho !== 'horizontal') || (p.span && (p.span.c > 1 || p.span.r > 1)); }
function grupoDe(p) { return ehDestaque(p) ? 'destaque' : 'normal'; }
document.addEventListener('click', e => {
  const b = e.target.closest('[data-alvo]'); if (!b || !S.bloco) return;
  S.alvo = b.dataset.alvo; painel();
  const n = blocoPs().length; aviso(`${n} ${S.bloco.tipo === 'preco' ? 'preço(s)' : 'nome(s)'}`, 900);
});
const num = v => typeof v === 'number' ? v : undefined;
// valor de um nível pra baixo: 'todos' ignora grupo e produto; 'destaque'/'normal' ignora produto
function bordaNivel(nivel, k) {
  const ed = S.estilo || {}, tp = S.estiloTpl || {};
  const g = nivel === 'destaque' || nivel === 'normal' ? nivel : null;
  const pega = k === 'cor' ? (o => o && o.nomeBordaCor) : (o => o && num(o.nomeBorda));
  const v = [g && ed.grupos && ed.grupos[g], ed, g && tp.grupos && tp.grupos[g], tp].map(pega).find(x => x != null);
  return v != null ? v : (k === 'cor' ? S.bordaCorTpl : S.bordaTpl);
}
function bordaDe(p) { return num(p.nomeBorda) != null ? p.nomeBorda : bordaNivel(grupoDe(p), 'b'); }
function bordaCorDe(p) { return p.nomeBordaCor || bordaNivel(grupoDe(p), 'cor'); }
function bordaPadrao() { const v = num(S.estiloTpl && S.estiloTpl.nomeBorda); return v != null ? v : S.bordaTpl; }
function fmtBorda(pt) { return pt ? String(pt).replace('.', ',') + ' pt' : 'sem'; }
function bordaDoProduto(p) {
  if (!p.nomeG || S.bordaTpl == null) return;
  const b = bordaDe(p), cor = bordaCorDe(p);
  if (b !== S.bordaTpl || !S.bordaNativa) p.nomeG.style.setProperty('--nome-borda', (b * 2) + 'px'); else p.nomeG.style.removeProperty('--nome-borda');
  if (cor !== S.bordaCorTpl || !S.bordaNativa) p.nomeG.style.setProperty('--nome-borda-cor', cor); else p.nomeG.style.removeProperty('--nome-borda-cor');
  // borda do editor só entra quando mudou; igual ao template, vale o contorno que ele já desenha
  if (!S.bordaNativa) p.nomeG.classList.toggle('ed-borda', b !== S.bordaTpl || cor !== S.bordaCorTpl);
}
function aplicarBordaNome() {
  if (S.bordaTpl == null) return;
  for (const p of S.produtos || []) bordaDoProduto(p);
  mostrarBorda();
}

// ---- alvo: 'este' (o que está selecionado) | 'destaque' | 'normal' | 'todos'
// No painel do nome o alvo é o S.alvo (o mesmo do tamanho e da posição); no painel sem seleção, S.bordaAlvo.
function alvoBorda(el) { return el && el.closest('[data-borda-ctx="bloco"]') ? (S.alvo || 'este') : S.bordaAlvo; }
function valorDoAlvo(alvo) {
  if (alvo === 'este') { const p = S.bloco ? S.bloco.p : S.sel; return p ? { b: bordaDe(p), cor: bordaCorDe(p) } : null; }
  return { b: bordaNivel(alvo, 'b'), cor: bordaNivel(alvo, 'cor') };
}
// muda o nível escolhido e tira o que é mais específico que ele (senão a mudança não aparece)
function mudarBorda(alvo, fn) {
  const st = S.estilo;
  if (alvo === 'este') {
    const ps = S.bloco ? blocoPs() : S.sel ? [S.sel] : []; if (!ps.length) return;
    marcar(...ps); for (const p of ps) { const v = fn({ b: bordaDe(p), cor: bordaCorDe(p) }); p.nomeBorda = v.b; p.nomeBordaCor = v.cor; }
  } else {
    const v = fn(valorDoAlvo(alvo));
    const afetados = S.produtos.filter(p => alvo === 'todos' || grupoDe(p) === alvo);
    marcar(...afetados.filter(p => num(p.nomeBorda) != null || p.nomeBordaCor));
    for (const p of afetados) { p.nomeBorda = null; p.nomeBordaCor = null; }
    if (alvo === 'todos') { st.nomeBorda = v.b; st.nomeBordaCor = v.cor; delete st.grupos; }
    else st.grupos = { ...(st.grupos || {}), [alvo]: { nomeBorda: v.b, nomeBordaCor: v.cor } };
  }
  aplicarBordaNome(); mudou();
}
function voltarBorda(alvo) {
  const st = S.estilo;
  const limpa = p => { p.nomeBorda = null; p.nomeBordaCor = null; };
  if (alvo === 'este') { const ps = S.bloco ? blocoPs() : S.sel ? [S.sel] : []; marcar(...ps); ps.forEach(limpa); }
  else if (alvo === 'todos') { delete st.nomeBorda; delete st.nomeBordaCor; delete st.grupos; S.produtos.forEach(limpa); }
  else { if (st.grupos) delete st.grupos[alvo]; S.produtos.filter(p => grupoDe(p) === alvo).forEach(limpa); }
  aplicarBordaNome(); mudou();
}
// mostra o valor do alvo de cada bloco de borda (painel sem seleção e painel do nome)
function mostrarBorda() {
  if (S.bordaTpl == null) return;
  for (const box of $$('[data-borda-ctx]')) {
    const v = valorDoAlvo(alvoBorda(box.firstElementChild || box)) || valorDoAlvo('todos');
    $$('[data-borda-val]', box).forEach(e => { e.textContent = fmtBorda(v.b); });
    $$('[data-borda-cor]', box).forEach(e => { if (document.activeElement !== e) e.value = v.cor; });
  }
  $$('[data-borda-alvo]').forEach(b => b.classList.toggle('ativa', b.dataset.bordaAlvo === S.bordaAlvo));
  const info = $('#nb-info'); if (info) info.textContent = 'template: ' + fmtBorda(bordaPadrao()) + (S.bordaNativa ? '' : ' · borda do editor');
  marcarAlvos();
}
// botões "Aplicar em": destaque desligado quando o encarte não tem
function marcarAlvos() {
  const nD = (S.produtos || []).filter(p => !p.removido && ehDestaque(p)).length;
  $$('[data-borda-alvo="destaque"], [data-alvo="destaque"]').forEach(b => { b.disabled = !nD; b.title = nD ? `${nD} destaque(s): cards especiais ou de mais de uma casa` : 'Este encarte não tem destaque'; });
  $$('[data-alvo]').forEach(b => b.classList.toggle('ativa', b.dataset.alvo === (S.alvo || 'este')));
}
function bordaHtml(ctx) {
  return `<div data-borda-ctx="${ctx}">
    <div class="pp-lin">${icone('borda')}<span>Borda</span><span class="stp"><button class="step" data-borda-mais="-0.5" aria-label="Borda mais fina">−</button><b class="val" data-borda-val></b><button class="step" data-borda-mais="0.5" aria-label="Borda mais grossa">+</button></span></div>
    <div class="pp-lin">${icone('cor')}<span>Cor da borda</span><span class="stp"><input type="color" class="cor-in" data-borda-cor aria-label="Cor da borda"></span></div>
    <div class="linha-btn"><button class="btn sec" data-borda-voltar>Voltar ao padrão</button><button class="btn sec" data-borda-salvar title="Grava a borda de todos e dos grupos como padrão do template: toda edição dele abre assim">Salvar no template</button></div>
  </div>`;
}
document.addEventListener('click', e => {
  if (S.bordaTpl == null) return;
  const a = e.target.closest('[data-borda-alvo]');
  if (a) { S.bordaAlvo = a.dataset.bordaAlvo; mostrarBorda(); return; }
  const m = e.target.closest('[data-borda-mais]');
  if (m) { const d = +m.dataset.bordaMais; mudarBorda(alvoBorda(m), v => ({ ...v, b: Math.max(0, Math.round((v.b + d) * 2) / 2) })); return; }
  const vt = e.target.closest('[data-borda-voltar]');
  if (vt) { voltarBorda(alvoBorda(vt)); return; }
  if (e.target.closest('[data-borda-salvar]')) salvarBordaNoTemplate();
});
document.addEventListener('input', e => {
  if (!e.target.matches('[data-borda-cor]') || S.bordaTpl == null) return;
  const cor = e.target.value;
  mudarBorda(alvoBorda(e.target), v => ({ b: v.b > 0 ? v.b : 1, cor })); // escolher cor sem borda já liga 1 pt
});
// grava o nível da edição (todos + grupos) como padrão do template; borda trocada em um produto só
// fica nesta edição
async function salvarBordaNoTemplate() {
  const st = S.estilo, tp = S.estiloTpl || {};
  const novo = { ...tp, nomeBorda: bordaNivel('todos', 'b'), nomeBordaCor: bordaNivel('todos', 'cor') };
  // "todos" mexido nesta edição zera os grupos que vinham do template; grupo mexido aqui substitui o de lá
  const grupos = { ...(st.nomeBorda != null || st.nomeBordaCor ? {} : tp.grupos || {}), ...(st.grupos || {}) };
  if (Object.keys(grupos).length) novo.grupos = grupos; else delete novo.grupos;
  try {
    const r = await api(`/templates/${encodeURIComponent(S.edicao.template)}/estilo`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ edicao: S.edicao.id, estilo: novo }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || r.status);
    S.estiloTpl = d.estilo || {};
    delete st.nomeBorda; delete st.nomeBordaCor; delete st.grupos;
    aplicarBordaNome(); mudou();
    aviso('Borda salva no template: as próximas edições já abrem assim', 2500);
  } catch (e) { aviso(e.message === 'sessao' ? 'Sessão expirou: entre de novo no Somado Tarefas.' : 'Não salvou no template: ' + e.message, 3000); }
}

function mudou() {
  // foto mexida (arrastar, tamanho, arranjo): o tapete do card vai junto
  for (const p of new Set([S.sel, ...S.selProds, ...S.selImgs.map(prodDe)])) if (p && p.apoio) posApoio(p);
  refazerDivisorias(); // grade mexida: as divisórias vão pros vãos novos
  ordenarCamadas(); // card novo, trocado de página ou desfeito: volta pra camada dele
  desenharSelecao();
  $('#ed-salvo').textContent = 'alterado…';
  S.mexeuDesdeMini = true;
  clearTimeout(tSalvar); tSalvar = setTimeout(salvar, 1200);
}
// PUT /api/encarte/edicoes/[id] — versao:true pede uma versão no histórico (pasta de trabalho)
// Um salvamento por vez (Matheus, 17/10/2026): mexer enquanto o anterior ainda ia pro servidor mandava o
// 2º com a hora antiga (base) e o servidor respondia 409 — o aviso "alterada em outro lugar" aparecia
// sem ninguém mais mexendo. Agora o 2º espera o 1º terminar e sai com a hora nova.
let filaSalvar = Promise.resolve();
async function salvar(opc = {}) {
  if (opc.saindo) return salvarJa(opc); // fechando a aba: manda já (keepalive)
  clearTimeout(tSalvar); tSalvar = null;
  const vez = filaSalvar.then(() => salvarJa(opc));
  filaSalvar = vez.catch(() => false);
  return vez;
}
async function salvarJa(opc = {}) {
  const ed = S.edicao; if (!ed || !S.carregado) return false;
  clearTimeout(tSalvar); tSalvar = null;
  if (SO_EXPORTAR) return false;
  ed.produtos = S.produtos.map(estado);
  ed.textos = S.textos.filter(t => t.mexido).map(estadoTexto);
  ed.fundos = S.paginas.map((pg, i) => pg.fundo && pg.fundo.dataset.arq !== pg.fundo.dataset.arqOrig ? estadoFundo(i) : null).filter(Boolean);
  ed.grades = Object.fromEntries(Object.entries(S.grades).map(([k, g]) => [k, { colunas: g.colunas, espaco: g.espaco, cheiasEmCima: g.cheiasEmCima, area: g.area, ...(S.gradesPend && S.gradesPend[k] ? { areaTpl: S.gradesPend[k] } : S.gradesOrig && S.gradesOrig[k] ? { areaTpl: S.gradesOrig[k].area } : {}), ...(g.linhas && g.linhas.length ? { linhas: g.linhas } : {}), ...(g.manterAjuste ? { manterAjuste: true } : {}), ...(g.divisorias ? { divisorias: g.divisorias } : {}) }]));
  ed.linhas = listarLinhas();
  // taskId/serieId vêm do servidor e voltam intactos
  const corpo = {
    id: ed.id, titulo: ed.titulo, template: ed.template,
    taskId: ed.taskId ?? null, serieId: ed.serieId ?? null, pastaTrabalho: ed.pastaTrabalho || null,
    produtos: ed.produtos, textos: ed.textos, fundos: ed.fundos, grades: ed.grades, linhas: ed.linhas,
    paginasExtras: Array.isArray(ed.paginasExtras) ? ed.paginasExtras : [],
    estilo: S.estilo || {},
    // modelo do card ajustado só nesta edição (modelo-card.js): construtor em %, Illustrator em pt
    // painel do modelo do card aberto: o que está na tela é prévia, grava o de antes (modelo-card.js)
    modelosAj: MC.quadro ? MC.ajOrig : Array.isArray(ed.modelosAj) ? ed.modelosAj : [],
    modeloAjPt: Array.isArray(ed.modeloAjPt) ? ed.modeloAjPt : [],
  };
  if (opc.versao) corpo.versao = true;
  // trava: o servidor recusa (409) se a edição mudou em outro lugar depois do que esta tela conhece
  if (ed.atualizadoEm && !opc.porCima) corpo.base = ed.atualizadoEm;
  if (opc.porCima) corpo.porCima = true; // o servidor guarda a outra como versão antes
  const txt = JSON.stringify(corpo);
  try {
    // ao fechar a aba só o keepalive garante o envio (limite ~64 KB)
    const extra = opc.saindo && txt.length < 60000 ? { keepalive: true } : {};
    const r = await api('/edicoes/' + encodeURIComponent(ed.id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: txt, ...extra });
    if (r.status === 409 && !opc.saindo) return conflito(r, opc);
    if (!r.ok) throw new Error(r.status);
    const d = await r.json().catch(() => null);
    // a hora que vale é a do banco (é ela que a trava compara)
    if (d && d.atualizadoEm) ed.atualizadoEm = d.atualizadoEm;
    $('#ed-salvo').textContent = 'salvo ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return true;
  } catch (e) {
    $('#ed-salvo').textContent = e.message === 'sessao' ? 'não salvo (sessão expirou)' : 'erro ao salvar';
    if (e.message !== 'sessao' && !opc.saindo) alerta('Não consegui salvar a edição. Tento de novo na próxima alteração.');
    return false;
  }
}

// a edição mudou em outro lugar (outra aba, o celular, um agente): não grava por cima sem perguntar
async function conflito(r, opc) {
  const d = await r.json().catch(() => ({}));
  const quando = d.atualizadoEm ? new Date(d.atualizadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
  $('#ed-salvo').textContent = 'não salvo (mudou em outro lugar)';
  const recarregar = confirm(`Esta edição foi alterada em outro lugar${quando ? ' às ' + quando : ''}.\n\n` +
    'OK = recarregar e ver a versão nova (o que você mexeu aqui depois disso se perde).\n' +
    'Cancelar = manter a sua e gravar por cima da outra.');
  if (recarregar) { location.reload(); return false; }
  return salvarJa({ ...opc, porCima: true }); // já está na vez dele na fila: não entra de novo
}

// miniatura da edição pra tarefa: página 1, ~480 px de largura, jpg. Na exportação vem o canvas
// da prancheta 1 já desenhado (só reduz, sem outro render)
async function gerarMiniatura(canvasPg1 = null) {
  const ed = S.edicao, pg = S.paginas[0];
  if (!ed || !pg || !S.carregado) return false;
  try {
    let b;
    if (canvasPg1) {
      const cv = document.createElement('canvas');
      cv.width = 480; cv.height = Math.round(canvasPg1.height * 480 / canvasPg1.width);
      const ctx = cv.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(canvasPg1, 0, 0, cv.width, cv.height);
      b = await blobDoCanvas(cv, 'image/jpeg', 0.82);
    } else b = await renderPng(pg, 480 / pg.w, null, 'image/jpeg', 0.82);
    const r = await api(`/edicoes/${encodeURIComponent(ed.id)}/miniatura`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: b });
    if (!r.ok) throw new Error(r.status);
    S.mexeuDesdeMini = false;
    return true;
  } catch (e) { console.warn('miniatura', e); return false; }
}

// ---------------------------------------------------------------- seleção e painel
function prodDe(e) {
  const g = e && e.closest && e.closest('g[id^="PRODUTO_"]');
  if (!g) return null;
  let p = S.porId[g.id];
  if (!p) { const pai = g.parentNode.closest && g.parentNode.closest('g[id^="PRODUTO_"]'); p = pai && S.porId[pai.id]; }
  return p || null;
}

function limparSelecao() {
  S.sel = null; S.selProds = new Set(); S.selImgs = []; S.bloco = null; S.selTexto = null; S.selFundo = null; S.trocandoLugar = null;
  S.selLinha = null; S.selLinhas = [];
}

// ---------------------------------------------------------------- área da grade
function marcarGrade(k) {
  const g = S.grades[k]; if (!g) return;
  S.desfazer.push([{ tipo: 'grade', zona: k, g: { ...g, area: { ...g.area }, linhas: g.linhas ? [...g.linhas] : null } }, ...produtosDaZona(k).map(estado)]);
}
let rafGrade = 0;
function agendarGrade(k) {
  if (rafGrade) return;
  rafGrade = requestAnimationFrame(() => { rafGrade = 0; montarGrade(k); desenharSelecao(); });
}
// qual borda da área está sob o dedo: 'l','r','t','b', cantos ('tl'…) ou 'm' (bolinha do meio = mover)
function bordaDaArea(cx, cy) {
  const g = S.grades[zonaAtual()]; return g ? bordaDoRet(g.area, cx, cy) : null;
}
function desenharArea(ui) {
  const k = zonaAtual(), A = S.grades[k].area, r = 9 / S.svg.getScreenCTM().a;
  // as outras zonas da página, de leve, pra saber onde cada uma começa
  for (const z of zonasDaPagina(S.pagina)) if (z.chave !== k && S.grades[z.chave]) {
    const B = S.grades[z.chave].area;
    ui.appendChild(el('rect', { x: B.x, y: B.y, width: B.w, height: B.h, fill: 'none', stroke: '#a855f7', 'stroke-opacity': 0.5,
      'stroke-width': 1, 'vector-effect': 'non-scaling-stroke', 'stroke-dasharray': '3 4' }));
  }
  ui.appendChild(el('rect', { x: A.x, y: A.y, width: A.w, height: A.h, fill: 'rgba(168,85,247,.08)', stroke: '#a855f7',
    'stroke-width': 2, 'vector-effect': 'non-scaling-stroke', 'stroke-dasharray': '8 5' }));
  const pts = [[A.x, A.y], [A.x + A.w / 2, A.y], [A.x + A.w, A.y], [A.x, A.y + A.h / 2], [A.x + A.w, A.y + A.h / 2],
               [A.x, A.y + A.h], [A.x + A.w / 2, A.y + A.h], [A.x + A.w, A.y + A.h]];
  for (const [x, y] of pts) ui.appendChild(el('circle', { cx: x, cy: y, r, fill: '#fff', stroke: '#a855f7', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }));
  ui.appendChild(el('circle', { cx: A.x + A.w / 2, cy: A.y + A.h / 2, r: r * 1.3, fill: '#a855f7', stroke: '#fff', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }));
}

function desenharSelecao() {
  const ui = S.ui; if (!ui) return;
  ui.innerHTML = '';
  ui.parentNode.appendChild(ui);
  const ret = (r, cor, tracejado) => ui.appendChild(el('rect', {
    x: r.x, y: r.y, width: r.w, height: r.h, fill: 'none', stroke: cor, 'stroke-width': 2.5,
    'vector-effect': 'non-scaling-stroke', 'stroke-dasharray': tracejado ? '6 4' : '',
  }));
  const card = p => p.cell;
  if (S.trocandoLugar) ret(card(S.trocandoLugar), '#ff5a1f', true);
  for (const p of S.selProds) ret(card(p), '#00a3ff');
  if (S.sel && !S.selProds.has(S.sel)) ret(card(S.sel), '#00a3ff');
  for (const im of S.selImgs) if (im.isConnected) ret(retSvg(im), '#ffcc00');
  if (S.bloco) for (const q of blocoPs()) { const el = elBloco(q, S.bloco.tipo); if (el) ret(retSvg(el), '#ffcc00'); }
  if (S.bloco && S.bloco.tipo === 'nome' && blocoPs().length === 1) { // a caixa do nome: até onde o texto pode ir antes de quebrar/encolher
    const p = S.bloco.p, r = retSvg(p.nomeG), w = larguraCaixaNome(p);
    ret({ x: r.x + r.w / 2 - w / 2, y: r.y - 2, w, h: r.h + 4 }, '#00a3ff', true);
  }
  if (S.selTexto) ret(retSvg(S.selTexto.txts[0].parentNode.tagName === 'g' && S.selTexto.txts.length > 1 ? S.selTexto.txts[S.selTexto.txts.length - 1] : S.selTexto.txts[0]), '#a855f7');
  // data/aviso do template que ainda não foi conferido nesta edição: laranja tracejado (só na tela)
  for (const tx of S.textos || []) if (tx !== S.selTexto && textoPendente(tx)) ret(retSvg(tx.txts[tx.txts.length - 1]), '#ff9800', true);
  if (S.selFundo != null) { const pg = S.paginas[S.selFundo]; ret(pg, '#a855f7', true); }
  const lns = linhasSel();
  for (const ln of lns) // contorno tracejado; com uma só, bolinhas nas pontas (esticar/girar)
    ui.appendChild(el('line', { x1: ln.x1, y1: ln.y1, x2: ln.x2, y2: ln.y2, stroke: '#00a3ff', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke', 'stroke-dasharray': '6 4' }));
  if (lns.length === 1) {
    const ln = lns[0], r = 9 / S.svg.getScreenCTM().a;
    for (const [x, y] of [[ln.x1, ln.y1], [ln.x2, ln.y2]]) ui.appendChild(el('circle', { cx: x, cy: y, r, fill: '#fff', stroke: '#00a3ff', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }));
  }
  if (S.editArea && S.grades[zonaAtual()]) desenharArea(ui);
  if (S.editAreaImg && S.sel && !S.sel.removido) {
    for (const q of S.selProds) if (q !== S.sel && !q.removido) desenharAreaImg(ui, q);
    desenharAreaImg(ui, S.sel);
  }
  if (S.editCard) desenharBlocos(ui);
  if (S.editCard && S.sel && !S.sel.removido) {
    for (const q of S.selProds) if (q !== S.sel && !q.removido) desenharAreaCard(ui, q);
    desenharAreaCard(ui, S.sel);
  }
}

function painel() {
  const secs = ['p-nada', 'p-produto', 'p-varios', 'p-imagem', 'p-bloco', 'p-texto', 'p-fundo', 'p-linha'];
  let ativa = 'p-nada';
  if (linhaSel()) ativa = 'p-linha';
  else if (S.selImgs.length) ativa = 'p-imagem';
  else if (S.bloco) ativa = 'p-bloco';
  else if (S.selTexto) ativa = 'p-texto';
  else if (S.selFundo != null) ativa = 'p-fundo';
  else if (S.selProds.size > 1) ativa = 'p-varios';
  else if (S.sel) ativa = 'p-produto';
  for (const s of secs) $('#' + s).classList.toggle('oculto', s !== ativa);
  zonaAtual(); // o produto selecionado passa a ser a zona da grade

  const p = S.sel;
  if (ativa === 'p-produto') {
    $('#pp-num').textContent = 'Produto ' + p.rotulo;
    const at = document.activeElement;
    if (at !== $('#f-nome')) $('#f-nome').value = p.nome || '';
    if (at !== $('#f-preco')) $('#f-preco').value = p.precoTxt || '';
    if (at !== $('#f-formato')) $('#f-formato').value = p.formatoTxt || '';
    if (at !== $('#f-qtd')) $('#f-qtd').value = p.qtdTxt || '';
    $('#f-tarja-box').classList.toggle('oculto', !p.tarja);
    if (at !== $('#f-tarja')) $('#f-tarja').value = p.tarja ? p.tarjaTxt || '' : '';
    $('#f-preco-rot').textContent = p.rotuloPreco ? 'Preço ' + p.rotuloPreco : 'Preço';
    camposExtras(p);
  }
  if (ativa === 'p-produto') {
    const esp = p.molde !== 'normal';
    $('#pp-esp-virar').classList.toggle('oculto', esp); $('#pp-esp-molde').classList.toggle('oculto', esp);
    $('#pp-esp-normal').classList.toggle('oculto', !esp); $('#pp-span').classList.toggle('oculto', !esp);
    $$('[data-span]').forEach(x => x.classList.toggle('ativa', x.dataset.span === `${p.span.c}x${p.span.r}`));
    $('#pp-casas-box').classList.toggle('oculto', !p.zona);
    painelEstilo(p);
    $('#pp-casa-c').textContent = fmtCasa(p.span.c); $('#pp-casa-r').textContent = fmtCasa(p.span.r);
    painelAreaImg(p); painelAreaCard(p);
  }
  if (ativa === 'p-produto' || ativa === 'p-bloco') setTimeout(() => { mostrarPt(); mostrarBorda(); }, 0);
  if (ativa === 'p-varios') { $('#pv-titulo').textContent = `${S.selProds.size} produtos selecionados`; painelAreaImg(S.sel); painelAreaCard(S.sel); }
  if (ativa === 'p-imagem') {
    $('#pi-nome').textContent = S.selImgs.length > 1 ? `${S.selImgs.length} fotos` : nomeArq(S.selImgs[0].dataset.arq);
    $('#pi-trocar').textContent = S.selImgs.length > 1 ? 'Trocar todas' : 'Trocar';
    $('#pi-duplicar').disabled = S.selImgs.length > 1;
    $('#pi-alinhar').classList.toggle('oculto', S.selImgs.length < 2);
  }
  if (S.bloco !== S.blocoAlvo) { S.blocoAlvo = S.bloco; S.alvo = 'este'; }
  if (ativa === 'p-bloco') {
    const b = S.bloco;
    marcarAlvos();
    const n = blocoPs().length;
    const rot = ehApoio(b.tipo) ? ['Tapete' + (b.tipo === 'apoio' ? '' : ' de trás'), 'Tapetes'] : { preco: ['Preço', 'Preços'], nome: ['Nome', 'Nomes'], logo: ['Logo', 'Logos'], qtd: ['Limite', 'Limites'] }[b.tipo];
    $('#pb-titulo').textContent = n > 1 ? `${rot[1]} · ${n} produtos` : rot[0] + ' · produto ' + b.p.rotulo;
    $('#pb-voltar').textContent = n > 1 ? '‹ produtos' : '‹ produto';
    $('#pb-alinhar').classList.toggle('oculto', n < 2);
    const pt = '<input id="pb-pt" class="pt" inputmode="decimal"><small>pt</small>';
    const val = k => `<b class="val" data-v="${k}"></b>`;
    $('#pb-tam').innerHTML = b.tipo === 'logo'
      ? linhaAj('tam', 'Tamanho', 'logo', val('logo')) + `<div class="linha-btn"><button class="btn sec perigo" data-apaga-logo>Apagar logo</button></div>`
      : ehApoio(b.tipo)
      ? linhaAj('tam', 'Tamanho', b.tipo, val(b.tipo)) + `<div class="linha-btn"><button class="btn sec perigo" data-apaga-apoio>Apagar tapete</button></div>`
      : b.tipo === 'preco'
      ? linhaAj('R$', 'Tamanho', 'preco', pt)
        + (b.p.dividido ? linhaAj('22', 'Inteiro', 'real', val('real')) + linhaAj(',99', 'Centavos', 'cent', val('cent')) : '')
        + linhaAj('larg', 'Fundo largura', 'fundoW', val('fundoW'))
        + linhaAj('alt', 'Fundo altura', 'fundoH', val('fundoH'))
        + `<div class="pp-lin" title="Move só o fundo do preço, sem mexer no valor">${icone('mover')}<span>Mover fundo</span><span class="stp">
             <button class="ic" data-aj="fundoX:-1" aria-label="Fundo pra esquerda">${icone('esq')}</button><button class="ic" data-aj="fundoY:-1" aria-label="Fundo pra cima">${icone('cima')}</button>
             <button class="ic" data-aj="fundoY:1" aria-label="Fundo pra baixo">${icone('baixo')}</button><button class="ic" data-aj="fundoX:1" aria-label="Fundo pra direita">${icone('dir')}</button></span></div>`
      : linhaAj('nome', 'Tamanho', 'nome', pt)
        + linhaAj('caixa', 'Largura da caixa', 'caixa', val('caixa'))
        + linhaAj('entre', 'Entrelinha', 'entre', val('entre'))
        + linhaAj('linhas', 'Linhas', 'linhas', '<b class="val nl-val">auto</b>')
        + (S.bordaTpl != null ? bordaHtml('bloco') : '')
        + `<div class="pp-lin">${icone('alinha')}<span>Alinhar</span></div>
           <div class="segs" id="pb-alinha" title="Alinhamento do nome (Auto = o editor decide)">
           ${[['', 'Auto'], ['start', '⇤ Esq.'], ['middle', 'Centro'], ['end', 'Dir. ⇥']].map(([v, t]) =>
             `<label><input type="radio" name="nome-alinha" value="${v}"${(b.p.nomeAlinha || '') === v ? ' checked' : ''}><span>${t}</span></label>`).join('')}
         </div>`;
    // limite: tamanho em pt + camada (Frente/Trás); a posição é a de todo bloco (arrastar e setas)
    if (b.tipo === 'qtd') {
      const box = $('#pb-tam'); box.textContent = '';
      box.insertAdjacentHTML('beforeend', linhaAj('nome', 'Tamanho', 'qtd', pt)
        + `<div class="pp-lin" title="Shift + clique: direto pro topo / pro fundo do card"><span>Camada</span><span class="stp">
             <button class="btn sec" data-camada-qtd="frente">Frente</button><button class="btn sec" data-camada-qtd="tras">Trás</button></span></div>`);
    }
  }
  if (ativa === 'p-texto') {
    const tx = S.selTexto;
    if (document.activeElement !== $('#ft-texto')) $('#ft-texto').value = tx.linhas;
    $$('input[name="alinha"]').forEach(r => { r.checked = r.value === tx.ancora; });
    const iguais = textosIguais(tx).length - 1;
    $('#ft-todas-l').classList.toggle('oculto', iguais < 1);
    $('#ft-todas-txt').textContent = `Mudar também nas outras ${iguais} página(s) com esse mesmo texto`;
    // texto com papel (template do construtor): aviso no topo do painel + "Está certo" sem precisar mudar nada
    let av = $('#ft-papel');
    if (!av) {
      av = document.createElement('div'); av.id = 'ft-papel';
      av.style.cssText = 'margin:0 0 10px;padding:8px 10px;border-radius:8px;border:1px solid #ff9800;background:rgba(255,152,0,.10);font-size:13px;display:flex;gap:8px;align-items:center;justify-content:space-between';
      $('#p-texto').prepend(av);
    }
    const nomes = { data: 'Data da oferta', aviso: 'Aviso legal (tem data)', variavel: 'Texto que muda toda edição' };
    av.classList.toggle('oculto', !tx.papel);
    if (tx.papel) {
      const pend = textoPendente(tx);
      av.replaceChildren(Object.assign(document.createElement('span'), { textContent: `${nomes[tx.papel] || 'Muda toda edição'}${pend ? ' — confira pra esta semana' : ' — conferido ✓'}` }));
      if (pend) {
        const b = Object.assign(document.createElement('button'), { className: 'btn', textContent: 'Está certo' });
        b.onclick = () => { marcar(tx); conferirTexto(tx); mudou(); desenharSelecao(); painel(); };
        av.append(b);
      }
    }
  }
  if (ativa === 'p-fundo') {
    const f = S.paginas[S.selFundo].fundo;
    $('#pf-titulo').textContent = 'Fundo da página ' + (S.selFundo + 1);
    $('#pf-arq').textContent = f ? nomeArq(f.dataset.arq) : 'O fundo desta página é desenho do template (cor/vetor), não imagem. Esse só muda no Illustrator.';
    for (const b of ['#pf-pasta', '#pf-enviar']) $(b).classList.toggle('oculto', !f);
    $('#pf-zerar').classList.toggle('oculto', !f || f.dataset.arq === f.dataset.arqOrig);
  }
  if (ativa === 'p-linha') painelLinha();
  if (ativa === 'p-nada') painelGrade();
  $('#ed-varios').classList.toggle('on', S.multi);
  $('#ed-varios').textContent = (S.multi ? '☑' : '☐') + ' Vários';
  desenharSelecao();
}

// ícones do painel (traço, 24x24) e linha "ícone · rótulo · − valor +"
const ICONES = {
  nome: '<path d="M5 7V4h14v3M12 4v16M9 20h6"/>',
  tam: '<path d="M4 20L20 4M14 4h6v6M10 20H4v-6"/>',
  larg: '<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/>',
  alt: '<path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/>',
  caixa: '<rect x="3" y="7" width="18" height="10" rx="1.5"/><path d="M7 12h10"/>',
  entre: '<path d="M4 6h10M4 12h10M4 18h10M19 4v16M17 6l2-2 2 2M17 18l2 2 2-2"/>',
  linhas: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  alinha: '<path d="M4 6h16M7 12h10M4 18h16"/>',
  borda: '<path d="M5 18V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v11"/><path d="M9 18V9h6v9"/>',
  cor: '<path d="M12 21a9 9 0 1 1 9-9c0 2-1.5 3-3 3h-2a2 2 0 0 0-1 3.7A1.5 1.5 0 0 1 12 21"/><circle cx="8" cy="10" r="1"/><circle cx="12" cy="7" r="1"/><circle cx="16" cy="10" r="1"/>',
  mover: '<path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
  esq: '<path d="M15 6l-6 6 6 6"/>', dir: '<path d="M9 6l6 6-6 6"/>', cima: '<path d="M6 15l6-6 6 6"/>', baixo: '<path d="M6 9l6 6 6-6"/>',
};
function icone(n) { return ICONES[n] ? `<svg class="si" viewBox="0 0 24 24">${ICONES[n]}</svg>` : `<b class="si-txt">${n}</b>`; }
function linhaAj(ic, rot, chave, meio) {
  return `<div class="pp-lin">${icone(ic)}<span>${rot}</span><span class="stp"><button class="step" data-aj="${chave}:-1" aria-label="Diminuir ${rot}">−</button>${meio}<button class="step" data-aj="${chave}:1" aria-label="Aumentar ${rot}">+</button></span></div>`;
}

function selecionarProduto(p) {
  limparSelecao();
  if (p) { S.sel = p; S.selProds.add(p); }
  painel();
}

$$('[data-limpa]').forEach(b => b.onclick = () => { limparSelecao(); painel(); });
$('#pi-voltar').onclick = () => { S.selImgs = []; painel(); };
$('#pb-voltar').onclick = () => { S.bloco = null; painel(); };
function elBloco(q, t) {
  if (t === 'preco') return q.precoG;
  if (t === 'logo') return q.logo && q.logo.el;
  if (t === 'qtd') return q.qtdWrap && q.qtdTxt ? q.qtdWrap : null;
  if (t === 'apoio') return q.apoio && q.apoio.el;
  const m = t.match(/^apoio(\d+)$/); if (m) { const e = (q.apoiosExtra || [])[+m[1] - 1]; return e && e.el; }
  return q.nomeG;
}
function ehApoio(t) { return /^apoio\d*$/.test(t); }
// nome preso ao preço: arrastar só o nome ou só o preço refaz a trava (senão o título voltava pro lugar do
// molde, ou ficava parado com o preço andando; Matheus, 30/10/2026)
function posBloco(q, t) {
  if (t === 'preco') renderGrupoPreco(q); else if (t === 'logo') posLogo(q); else if (t === 'qtd') posQtd(q); else if (ehApoio(t)) posApoio(q); else posNome(q);
  if (t !== 'logo' && t !== 'qtd' && !ehApoio(t)) nomePresoAoPreco(q);
}
// "Aplicar em" do painel do nome/preço (S.alvo): este (o que foi tocado) | destaque | normal | todos.
// Vale pra tamanho, posição, arrastar e borda; os grupos pegam o encarte inteiro.
function blocoPs() {
  if (!S.bloco) return [];
  const a = S.alvo || 'este';
  if (a === 'este') return S.bloco.ps && S.bloco.ps.length ? S.bloco.ps : [S.bloco.p];
  return S.produtos.filter(q => !q.removido && elBloco(q, S.bloco.tipo) && (a === 'todos' || grupoDe(q) === a));
}
// vários produtos: seleciona só os nomes ou só os preços de todos, pra mover junto
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-sobloco]'); if (!b) return;
  const ps = [...S.selProds].filter(q => elBloco(q, b.dataset.sobloco));
  if (!ps.length) return;
  S.bloco = { p: ps[0], ps, tipo: b.dataset.sobloco }; painel();
});
// mover os cards selecionados (célula + fotos + tudo dentro)
function moverCards(ps, dx, dy, base) {
  ps.forEach((q, i) => {
    const b0 = base ? base[i] : { x: q.cell.x, y: q.cell.y, fotos: q.fotos.map(retFoto) };
    const ddx = b0.x + dx - q.cell.x, ddy = b0.y + dy - q.cell.y;
    q.cell = { ...q.cell, x: b0.x + dx, y: b0.y + dy };
    q.fotos.forEach(im => { const r = retFoto(im); posFoto(im, { ...r, x: r.x + ddx, y: r.y + ddy }); });
    aplicarCelula(q); render(q);
  });
}
$('#ed-varios').onclick = () => { S.multi = !S.multi; painel(); aviso(S.multi ? 'Toque nos produtos ou fotos pra somar à seleção' : 'Seleção simples'); };

// campos do produto
for (const [id, campo, norm] of [['#f-nome', 'nome'], ['#f-preco', 'precoTxt', normPreco], ['#f-formato', 'formatoTxt'], ['#f-qtd', 'qtdTxt'], ['#f-tarja', 'tarjaTxt']]) {
  const inp = $(id);
  inp.addEventListener('focus', () => { if (S.sel) marcar(S.sel); });
  inp.addEventListener('input', () => { if (!S.sel) return; S.sel[campo] = campo === 'nome' ? caixaNome(inp.value) : inp.value; render(S.sel); mudou(); });
  if (norm) inp.addEventListener('change', () => { if (!S.sel) return; S.sel[campo] = norm(inp.value); inp.value = S.sel[campo]; render(S.sel); mudou(); });
}

// preço duplo (PEDAÇO…), DE e selo: campos que só existem quando o card tem
function camposExtras(p) {
  const box = $('#f-extras');
  if (box.dataset.de !== p.id) {
    box.dataset.de = p.id; box.textContent = '';
    const campo = (rotulo, attrs, liga) => {
      const l = document.createElement('label'); l.className = 'campo';
      const s = document.createElement('span');
      if (liga) { s.className = 'liga'; const c = document.createElement('input'); c.type = 'checkbox'; c.dataset.liga = liga; s.appendChild(c); }
      s.appendChild(document.createTextNode(rotulo));
      const i = document.createElement('input'); i.inputMode = 'decimal';
      for (const k in attrs) i.dataset[k] = attrs[k];
      l.append(s, i); box.appendChild(l);
    };
    (p.extras || []).forEach((v, k) => campo('Preço ' + v.suf.toUpperCase(), { extra: k }));
    if (p.de) campo('Preço DE', { val: 'de' }, 'de');
    if (podeSelo(p)) campo('Selo do clube (preço)', { val: 'selo' }, 'selo');
    if (podeLogo(p)) {
      const l = document.createElement('label'); l.className = 'campo';
      const s = document.createElement('span'); s.className = 'liga';
      const c = document.createElement('input'); c.type = 'checkbox'; c.dataset.liga = 'logo';
      s.append(c, document.createTextNode('Logo da marca no card'));
      l.appendChild(s); box.appendChild(l);
    }
  }
  const at = document.activeElement;
  for (const i of $$('input[data-extra]', box)) if (i !== at) i.value = p.extras[+i.dataset.extra].txt || '';
  for (const i of $$('input[data-val]', box)) if (i !== at) i.value = (i.dataset.val === 'de' ? p.deTxt : p.seloTxt) || '';
  for (const c of $$('input[data-liga]', box)) c.checked = c.dataset.liga === 'de' ? !!p.deOn : c.dataset.liga === 'logo' ? !!p.logoOn : !!p.seloOn;
}
(function () {
  const box = $('#f-extras');
  const escrever = (i, v) => {
    const p = S.sel; if (!p) return;
    if (i.dataset.extra != null) p.extras[+i.dataset.extra].txt = v;
    else if (i.dataset.val === 'de') { p.deTxt = v; if (v) p.deOn = true; }
    else if (i.dataset.val === 'selo') { if (v && !garantirSelo(p)) return; p.seloTxt = v; if (p.selo) p.seloOn = !!v; }
    render(p); mudou(); camposExtras(p);
  };
  box.addEventListener('focusin', e => { if (S.sel && e.target.matches('input:not([type=checkbox])')) marcar(S.sel); });
  box.addEventListener('input', e => { if (e.target.type !== 'checkbox') escrever(e.target, e.target.value); });
  box.addEventListener('change', e => {
    const i = e.target, p = S.sel; if (!p) return;
    if (i.type === 'checkbox') {
      marcar(p);
      if (i.dataset.liga === 'de') p.deOn = i.checked;
      else if (i.dataset.liga === 'logo') {
        if (i.checked && !garantirLogo(p)) { i.checked = false; return; }
        p.logoOn = i.checked;
        if (i.checked && !p.logoArq) aviso('Esse template não tem imagem de logo: configure logo_auto no padrão do mercado');
      } else { if (i.checked && !garantirSelo(p)) { i.checked = false; return; } p.seloOn = i.checked; }
      render(p); mudou(); return;
    }
    i.value = normPreco(i.value); escrever(i, i.value);
  });
})();

// ---------------------------------------------------------------- toque, arrasto, zoom
(function gestos() {
  const palco = $('#palco');
  const dedos = new Map();
  let modo = null, ini = null, moveu = false, pinça = null, dupNoArrasto = false;

  palco.addEventListener('pointerdown', e => {
    if (!S.svg) return;
    palco.setPointerCapture(e.pointerId);
    dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (dedos.size === 2) {
      const [a, b] = [...dedos.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      pinça = { d: Math.hypot(a.x - b.x, a.y - b.y), vb: { ...S.vb }, svgMid: pontoSvg(mid.x, mid.y) };
      modo = 'pinça'; return;
    }
    moveu = false; dupNoArrasto = e.altKey || e.ctrlKey;
    ini = { x: e.clientX, y: e.clientY, vb: { ...S.vb }, alvo: e.target, shift: e.shiftKey };
    const foto = e.target.closest && e.target.closest('image.ed-img');
    const noBloco = S.bloco && blocoPs().some(q => { const el = elBloco(q, S.bloco.tipo); return el && el.contains(e.target); });
    const pAlvo = prodDe(e.target);
    const ponta = S.selLinha ? pontaDaLinha(e.clientX, e.clientY) : 0;
    const lnAlvo = e.target.closest && e.target.closest('[data-linha]');
    if (ponta) { modo = 'linha-ponta'; ini.ponta = ponta; ini.l0 = { ...linhaSel() }; }
    else if (lnAlvo && linhaPorId(lnAlvo.dataset.linha)) {
      modo = 'linha'; ini.l0 = { ...linhaPorId(lnAlvo.dataset.linha) };
      // arrastar uma das selecionadas leva todas
      if (idsLinhasSel().length > 1 && idsLinhasSel().includes(ini.l0.id)) ini.grupo = linhasSel().map(l => ({ ...l }));
    }
    else if (S.editAreaImg && S.sel && !S.sel.removido && (ini.refArea = cardDaBordaArea(e.clientX, e.clientY))) {
      const ref = ini.refArea.p; S.sel = ref; ini.bordas = ini.refArea.b;
      modo = 'areaimg'; ini.p = ref; ini.M = { ...areaM(ref) }; ini.alvos = alvosAreaImg(ref, $('#ai-todos').checked);
    }
    else if (S.editCard && S.sel && !S.sel.removido && (ini.refCard = cardDaBordaCard(e.clientX, e.clientY))) {
      const ref = ini.refCard.p; S.sel = ref; ini.bordas = ini.refCard.b;
      modo = 'card'; ini.p = ref; ini.plano = planoCards(alvosCard(ref), ini.bordas); ini.alvos = todosDoPlano(ini.plano);
    }
    else if (foto && S.selImgs.includes(foto)) { modo = 'fotos'; ini.rs = S.selImgs.map(retFoto); }
    else if (S.selTexto && e.target.closest && S.selTexto.txts.includes(e.target.closest('text'))) {
      modo = 'texto'; ini.bx = S.selTexto.dx; ini.by = S.selTexto.dy;
    } else if (noBloco) {
      modo = 'bloco'; const t = S.bloco.tipo;
      ini.bs = blocoPs().map(q => [q[t + 'Dx'] || 0, q[t + 'Dy'] || 0]);
    } else if (!S.bloco && !S.selImgs.length && pAlvo && S.selProds.has(pAlvo)) {
      // arrastar um card selecionado move todos os selecionados
      modo = 'cards'; ini.ps = [...S.selProds]; ini.base = ini.ps.map(q => ({ x: q.cell.x, y: q.cell.y }));
      for (const q of ini.ps) if (!q.cellAuto) q.cellAuto = { ...q.cell };
    } else if (S.editArea && (ini.bordas = bordaDaArea(e.clientX, e.clientY))) {
      modo = 'area'; ini.zona = zonaAtual(); ini.A = { ...S.grades[ini.zona].area };
    } else modo = 'pan';
  });

  palco.addEventListener('pointermove', e => {
    if (!dedos.has(e.pointerId)) return;
    dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (modo === 'pinça' && dedos.size === 2) {
      const [a, b] = [...dedos.values()];
      const k = pinça.d / Math.hypot(a.x - b.x, a.y - b.y);
      const vb = pinça.vb, w = vb.w * k, h = vb.h * k;
      const fx = (pinça.svgMid.x - vb.x) / vb.w, fy = (pinça.svgMid.y - vb.y) / vb.h;
      camera({ x: pinça.svgMid.x - fx * w, y: pinça.svgMid.y - fy * h, w, h });
      return;
    }
    if (!ini) return;
    const dxp = e.clientX - ini.x, dyp = e.clientY - ini.y;
    if (!moveu && Math.hypot(dxp, dyp) < 6) return;
    const esc = S.svg.getScreenCTM().a;
    if (!moveu && modo === 'fotos') {
      marcar(...new Set(S.selImgs.map(prodDe)));
      if (dupNoArrasto && S.selImgs.length === 1) { // Alt/Ctrl+arrastar duplica, igual no Illustrator
        const im = S.selImgs[0], p = prodDe(im);
        const c = novaFoto(im.dataset.arq, retFoto(im));
        inserirFoto(p, c, im); relerFotos(p); S.selImgs = [c];
      }
    }
    if (!moveu && modo === 'bloco') marcar(...blocoPs());
    if (!moveu && modo === 'cards') marcar(...ini.ps);
    if (!moveu && modo === 'texto') marcar(S.selTexto);
    if (!moveu && modo === 'area') marcarGrade(ini.zona);
    if (!moveu && (modo === 'areaimg' || modo === 'card')) marcar(...ini.alvos);
    if (!moveu && (modo === 'linha' || modo === 'linha-ponta')) {
      marcar(S.linhas);
      if (!ini.grupo && S.selLinha !== ini.l0.id) { limparSelecao(); S.selLinha = ini.l0.id; painel(); } // arrastar já seleciona
    }
    moveu = true;
    // divisória da grade não sai do vão: o lugar dela é a grade (o visual muda pelo painel)
    if ((modo === 'linha' || modo === 'linha-ponta') && ((ini.l0 && ini.l0.zona) || (ini.grupo && ini.grupo.some(g => g.zona)))) {
      if (!ini.avisouDiv) { ini.avisouDiv = true; aviso('Divisória da grade: ela fica no vão entre os itens e muda sozinha com a grade', 2600); }
      return;
    }
    if (modo === 'linha' && ini.grupo) {
      const dx = dxp / esc, dy = dyp / esc;
      for (const g of ini.grupo) { const i = S.linhas.findIndex(l => l.id === g.id); if (i >= 0) S.linhas[i] = deslocarLinha(g, dx, dy); }
      desenharLinhas(); desenharSelecao();
      return;
    }
    if (modo === 'linha' || modo === 'linha-ponta') {
      const i = S.linhas.findIndex(l => l.id === ini.l0.id); if (i < 0) return;
      const l0 = ini.l0, dx = dxp / esc, dy = dyp / esc;
      S.linhas[i] = modo === 'linha' ? deslocarLinha(l0, dx, dy)
        : ini.ponta === 1 ? moverPonta(l0, 1, l0.x1 + dx, l0.y1 + dy, e.shiftKey || !!S.travarLinha)
        : moverPonta(l0, 2, l0.x2 + dx, l0.y2 + dy, e.shiftKey || !!S.travarLinha);
      desenharLinhas(); desenharSelecao();
      return;
    }
    if (modo === 'areaimg') {
      mudarAreaImg(ini.alvos, moverBordasArea(ini.p, ini.M, ini.bordas, dxp / esc, dyp / esc), false);
      desenharSelecao(); painelAreaImg(ini.p);
      return;
    }
    if (modo === 'card') {
      mudarCards(ini.plano, ini.bordas, dxp / esc, dyp / esc, false);
      desenharSelecao(); painelAreaCard(ini.p);
      return;
    }
    if (modo === 'area') {
      const A = { ...ini.A }, dx = dxp / esc, dy = dyp / esc, b = ini.bordas;
      if (b.includes('l')) { A.x += dx; A.w -= dx; }
      if (b.includes('r')) A.w += dx;
      if (b.includes('t')) { A.y += dy; A.h -= dy; }
      if (b.includes('b')) A.h += dy;
      if (b === 'm') { A.x += dx; A.y += dy; }
      if (A.w > 40 && A.h > 40) { S.grades[ini.zona].area = A; agendarGrade(ini.zona); }
      return;
    }
    if (modo === 'fotos') {
      S.selImgs.forEach((im, i) => posFoto(im, { ...ini.rs[i], x: ini.rs[i].x + dxp / esc, y: ini.rs[i].y + dyp / esc }));
      desenharSelecao();
    } else if (modo === 'bloco') {
      const t = S.bloco.tipo;
      blocoPs().forEach((p, i) => {
        p[t + 'Dx'] = ini.bs[i][0] + dxp / esc; p[t + 'Dy'] = ini.bs[i][1] + dyp / esc;
        posBloco(p, t);
      });
      desenharSelecao();
    } else if (modo === 'cards') {
      moverCards(ini.ps, dxp / esc, dyp / esc, ini.base);
      desenharSelecao();
    } else if (modo === 'texto') {
      const tx = S.selTexto; tx.dx = ini.bx + dxp / esc; tx.dy = ini.by + dyp / esc;
      tx.mexido = textoMexido(tx); posTexto(tx); desenharSelecao();
    } else if (modo === 'pan') {
      camera({ ...ini.vb, x: ini.vb.x - dxp / esc, y: ini.vb.y - dyp / esc });
    }
  });

  const fim = e => {
    if (!dedos.has(e.pointerId)) return;
    dedos.delete(e.pointerId);
    if (modo === 'pinça') { if (dedos.size === 0) modo = null; ini = null; return; }
    if (ini && !moveu) { if (modo !== 'linha-ponta') toque(ini.alvo, ini.shift); } // tocar na bolinha não desseleciona
    else if ((modo === 'fotos' || modo === 'bloco' || modo === 'area' || modo === 'texto' || modo === 'cards' || modo === 'linha' || modo === 'linha-ponta' || modo === 'areaimg' || modo === 'card') && moveu) { if (modo === 'area') montarGrade(ini.zona); if (modo === 'card') { arrumarFotosCard(ini.plano); desenharSelecao(); } if (modo === 'cards') ini.ps.forEach(registrarAj); if (modo === 'areaimg') { arrumarFotosArea(ini.alvos); desenharSelecao(); } mudou(); painel(); }
    ini = null; modo = null;
  };
  palco.addEventListener('pointerup', fim);
  palco.addEventListener('pointercancel', fim);
  // Firefox começa o arrasto nativo da <image> (arrastar a foto pra fora) e cancela o ponteiro: a foto não anda
  palco.addEventListener('dragstart', e => e.preventDefault());

  palco.addEventListener('wheel', e => {
    if (!S.svg) return;
    e.preventDefault();
    const k = Math.exp(e.deltaY * 0.0015);
    const pt = pontoSvg(e.clientX, e.clientY), vb = S.vb;
    camera({ x: pt.x - (pt.x - vb.x) * k, y: pt.y - (pt.y - vb.y) * k, w: vb.w * k, h: vb.h * k });
  }, { passive: false });
})();

function toque(alvo, shift) {
  const p = prodDe(alvo);
  const varios = S.multi || shift;
  if (S.trocandoLugar) {
    const a = S.trocandoLugar; S.trocandoLugar = null;
    if (p && p !== a) trocarLugar(a, p); else aviso('Troca cancelada');
    desenharSelecao(); return;
  }
  const ln = alvo.closest && alvo.closest('[data-linha]');
  if (ln && linhaPorId(ln.dataset.linha)) return varios && S.selLinha ? alternarLinha(ln.dataset.linha) : selecionarLinha(ln.dataset.linha);
  const foto = alvo.closest && alvo.closest('image.ed-img');

  if (varios) {
    // somar/tirar foto da seleção (quando já tem foto selecionada) ou produto
    if (foto && S.selImgs.length) {
      S.selImgs = S.selImgs.includes(foto) ? S.selImgs.filter(i => i !== foto) : [...S.selImgs, foto];
      return painel();
    }
    if (p) {
      S.selImgs = []; S.bloco = null; S.selTexto = null; S.selFundo = null;
      if (S.selProds.has(p)) { S.selProds.delete(p); S.sel = [...S.selProds].pop() || null; }
      else { S.selProds.add(p); S.sel = p; }
      return painel();
    }
  }

  if (p) {
    const jaNoProduto = S.sel === p || S.selImgs.some(im => prodDe(im) === p);
    if (foto && (jaNoProduto || S.selImgs.length)) { limparSelecao(); S.sel = p; S.selProds.add(p); S.selImgs = [foto]; return painel(); }
    if (jaNoProduto && p.logo && p.logoOn && p.logo.el === alvo) { limparSelecao(); S.sel = p; S.selProds.add(p); S.bloco = { p, tipo: 'logo' }; return painel(); }
    if (jaNoProduto && p.precoG && p.precoG.contains(alvo)) { limparSelecao(); S.sel = p; S.selProds.add(p); S.bloco = { p, tipo: 'preco' }; return painel(); }
    const iAp = [p.apoio, ...(p.apoiosExtra || [])].findIndex(a => a && a.el.contains(alvo));
    if (jaNoProduto && iAp >= 0) { limparSelecao(); S.sel = p; S.selProds.add(p); S.bloco = { p, tipo: iAp ? 'apoio' + iAp : 'apoio' }; return painel(); }
    if (jaNoProduto && p.qtdWrap && p.qtdTxt && p.qtdWrap.contains(alvo)) { limparSelecao(); S.sel = p; S.selProds.add(p); S.bloco = { p, tipo: 'qtd' }; return painel(); }
    if (jaNoProduto && p.nomeG && p.nomeG.contains(alvo)) { limparSelecao(); S.sel = p; S.selProds.add(p); S.bloco = { p, tipo: 'nome' }; return painel(); }
    return selecionarProduto(p);
  }

  // fora dos produtos: texto da arte ou fundo da página
  const t = alvo.closest && alvo.closest('text');
  const tx = t && S.textos.find(x => x.txts.includes(t));
  if (tx) { limparSelecao(); S.selTexto = tx; return painel(); }
  let i = S.paginas.findIndex(pg => pg.fundo && pg.fundo === alvo);
  // fundo de cor/vetor (página sem imagem): a forma que cobre boa parte da página abre o mesmo painel
  if (i < 0 && alvo.getBBox && /^(rect|path|polygon|image|use)$/i.test(alvo.tagName) && !alvo.closest('#ed-ui')) {
    const r = retSvgBBox(alvo);
    i = S.paginas.findIndex(pg => {
      const ix = Math.max(0, Math.min(r.x + r.w, pg.x + pg.w) - Math.max(r.x, pg.x));
      const iy = Math.max(0, Math.min(r.y + r.h, pg.y + pg.h) - Math.max(r.y, pg.y));
      return ix * iy >= pg.w * pg.h * 0.5;
    });
  }
  if (i >= 0) { limparSelecao(); S.selFundo = i; return painel(); }
  limparSelecao(); painel();
}

// ---------------------------------------------------------------- linhas divisórias
// S.linhas = [{id, pagina, x1, y1, x2, y2, cor, px, estilo}] em coordenadas do SVG do template (as
// mesmas de p.cell); formato e contas puras em linhas.js. px = espessura em unidades do SVG: a
// prancheta exportada sai com 2000 px de largura, então vira px × 2000 / largura da página.
// Cada página tem uma camada <g class="ed-linhas"> logo antes do primeiro card dela: fica por cima
// do fundo e da arte, por baixo dos produtos (o card cobre a linha se encostar). Cada linha =
// <line class="ed-linha"> visível + <line class="ed-linha-toque"> larga e transparente pro dedo
// (essa sai do export, junto com as alças e o destaque, que moram no #ed-ui).

// camada de cada página, no espaço do SVG raiz (o transform desfaz o do grupo onde ela mora)
function montarCamadasLinhas() {
  $$('g.ed-linhas', S.svg).forEach(g => g.remove());
  S.camadasLinha = S.paginas.map((pg, i) => {
    const g = el('g', { class: 'ed-linhas', 'data-pagina': i });
    const primeiro = S.produtos.filter(p => paginaDe(p) === i).map(p => p.g)
      .reduce((a, b) => !a || (b.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING) ? b : a, null);
    if (primeiro) primeiro.before(g);
    else if (pg.fundo) pg.fundo.after(g);
    else S.svg.insertBefore(g, S.ui);
    if (g.parentNode !== S.svg) {
      const m = matrizAteRaiz(g.parentNode).inverse();
      g.setAttribute('transform', `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`);
    }
    return g;
  });
}
function desenharLinhas() {
  if (!S.camadasLinha || !S.camadasLinha.length) return;
  for (const g of S.camadasLinha) g.textContent = '';
  for (const l of S.linhas) {
    const t = tracoDaLinha(l.estilo, l.px), pos = { x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2 };
    const g = el('g', { 'data-linha': l.id });
    const vis = el('line', { ...pos, class: 'ed-linha', fill: 'none', stroke: l.cor, 'stroke-width': l.px, 'stroke-linecap': t.linecap });
    if (t.dasharray) vis.setAttribute('stroke-dasharray', t.dasharray);
    g.appendChild(vis);
    g.appendChild(el('line', { ...pos, class: 'ed-linha-toque', stroke: 'transparent', 'stroke-width': 22, 'stroke-linecap': 'round',
      'vector-effect': 'non-scaling-stroke', 'pointer-events': 'stroke' }));
    S.camadasLinha[Math.max(0, Math.min(l.pagina, S.camadasLinha.length - 1))].appendChild(g);
  }
}
function linhaPorId(id) { return S.linhas.find(l => l.id === id) || null; }
function linhaSel() { return S.selLinha ? linhaPorId(S.selLinha) : null; }
// todas as selecionadas (a referência primeiro)
function idsLinhasSel() { return S.selLinha ? [S.selLinha, ...(S.selLinhas || [])].filter(id => linhaPorId(id)) : []; }
function linhasSel() { return idsLinhasSel().map(linhaPorId); }
// soma ou tira uma linha da seleção (Shift ou "Vários")
function alternarLinha(id) {
  const ids = idsLinhasSel();
  const novos = ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id];
  S.selProds = new Set(); S.sel = null; S.selImgs = []; S.bloco = null; S.selTexto = null; S.selFundo = null;
  S.selLinha = novos[0] || null; S.selLinhas = novos.slice(1);
  painel();
}
// muda várias linhas de uma vez (um passo só no desfazer): fn(linha) → campos novos
function mudarLinhas(ids, fn) {
  if (!ids.length) return;
  marcar(S.linhas);
  for (const id of ids) {
    const i = S.linhas.findIndex(l => l.id === id); if (i < 0) continue;
    const n = normalizarLinha({ ...S.linhas[i], ...fn(S.linhas[i]), id }, S.linhas[i]);
    if (n) { n.pagina = Math.min(n.pagina, S.paginas.length - 1); S.linhas[i] = n; }
  }
  espelharDivisorias(ids);
  desenharLinhas(); mudou(); painel();
}
// troca pelas linhas que a conta devolveu (alinhar, igualar, distribuir)
function gravarLinhas(novas) {
  const por = new Map(novas.map(l => [l.id, l]));
  mudarLinhas([...por.keys()], l => por.get(l.id));
}
function estadoLinhas() { return { tipo: 'l', linhas: listarLinhas() }; }
function aplicarLinhas(ls) {
  S.linhas = ls.map(l => ({ ...l }));
  if (S.selLinha && !linhaPorId(S.selLinha)) S.selLinha = null;
  S.selLinhas = (S.selLinhas || []).filter(id => linhaPorId(id));
  desenharLinhas();
}
// cor/espessura/estilo da última linha mexida valem pra próxima (guardado no navegador)
function lembrarLinha(l) { S.ultLinha = { cor: l.cor, px: l.px, estilo: l.estilo }; guardar.pôr('linha:ult', S.ultLinha); }
function padraoLinha() {
  const l = normalizarLinha({ x1: 0, y1: 0, x2: 0, y2: 0, ...LINHA_PADRAO, ...(S.ultLinha || guardar.ler('linha:ult', {})) });
  return { cor: l.cor, px: l.px, estilo: l.estilo }; // só o visual: as coordenadas vêm de quem chamou
}
function selecionarLinha(id) { limparSelecao(); S.selLinha = id; painel(); }
// bolinha da ponta sob o dedo: 1, 2 ou 0
function pontaDaLinha(cx, cy) {
  const l = linhaSel(); if (!l || (S.selLinhas || []).length) return 0; // várias: as bolinhas somem
  const p = pontoSvg(cx, cy), tol = 22 / S.svg.getScreenCTM().a;
  const d1 = Math.hypot(p.x - l.x1, p.y - l.y1), d2 = Math.hypot(p.x - l.x2, p.y - l.y2);
  if (Math.min(d1, d2) > tol) return 0;
  return d1 <= d2 ? 1 : 2;
}

// Funções pra automação (o agente da VPS chama por page.evaluate). Todas entram no desfazer e
// salvam sozinhas (mudou()). Coordenadas no espaço do SVG do template, como p.cell.
//   adicionarLinha({pagina, x1, y1, x2, y2, cor, px, estilo}) → id
//     sem as 4 coordenadas: horizontal no meio da página, 60% da largura; sem página: a atual;
//     cor/px/estilo que faltar = os da última linha (padrão #ffffff, 4, 'solida')
//   mudarLinha(id, campos) → a linha como ficou, ou null se o id não existe
//   apagarLinha(id) → true/false
//   listarLinhas() → [{id, pagina, x1, y1, x2, y2, cor, px, estilo}] (cópia)
function adicionarLinha(o = {}) {
  if (!S.edicao || !S.paginas.length) return null;
  o = o || {};
  const pad = padraoLinha();
  const pagina = Number.isInteger(o.pagina) && o.pagina >= 0 && o.pagina < S.paginas.length ? o.pagina : S.pagina;
  const temXY = ['x1', 'y1', 'x2', 'y2'].every(k => o[k] != null && o[k] !== '' && Number.isFinite(Number(o[k])));
  const l = normalizarLinha({ ...(temXY ? {} : linhaNoMeio(S.paginas[pagina], pad)), ...pad, ...o, pagina, id: novoId() }, pad);
  if (!l) return null;
  marcar(S.linhas);
  S.linhas.push(l); desenharLinhas(); mudou();
  return l.id;
}
function mudarLinha(id, campos = {}) {
  const i = S.linhas.findIndex(l => l.id === id); if (i < 0) return null;
  campos = campos || {};
  const nova = normalizarLinha({ ...S.linhas[i], ...campos, id }, S.linhas[i]);
  if (!nova) return null;
  nova.pagina = Math.min(nova.pagina, S.paginas.length - 1);
  marcar(S.linhas);
  S.linhas[i] = nova;
  espelharDivisorias([id]);
  if ('cor' in campos || 'px' in campos || 'estilo' in campos) lembrarLinha(nova);
  desenharLinhas(); mudou();
  if (S.selLinha === id) painel();
  return { ...nova };
}
function apagarLinha(id) {
  const i = S.linhas.findIndex(l => l.id === id); if (i < 0) return false;
  if (S.linhas[i].zona) { desligarDivisoria(S.linhas[i].zona, S.linhas[i].div); return true; }
  marcar(S.linhas);
  S.linhas.splice(i, 1);
  if (S.selLinha === id) S.selLinha = null;
  desenharLinhas(); mudou(); painel();
  return true;
}
function listarLinhas() { return S.linhas.map(l => ({ ...l })); }

// ---------------------------------------------------------------- divisórias da grade (Matheus, 17/10/2026, SMD-957)
// S.grades[k].divisorias = {v, h, cor, px, estilo, recuo}: linhas entre os itens da zona, que acompanham a
// grade (3 colunas = 2 verticais, 2 colunas = 1; horizontal entre as fileiras). Vem do template
// (data-divisorias da grid_area, ligado no construtor) e fica na ficha (grades). As linhas moram em S.linhas
// com zona/div e são refeitas a cada mudou(): o lugar sai da grade (divisorias.js); o visual é o das linhas
// atuais da zona (o painel da linha muda todas juntas, e o desfazer das linhas volta o visual junto).
function divisoriasValidas(d) {
  if (!d || typeof d !== 'object') return null;
  const l = normalizarLinha({ x1: 0, y1: 0, x2: 0, y2: 0, cor: d.cor || '#000000', px: d.px || 2, estilo: d.estilo || 'solida' });
  return { v: d.v !== false, h: d.h !== false, cor: l.cor, px: l.px, estilo: l.estilo, recuo: Math.max(0, +d.recuo || 0) };
}
function divisoriasDoTemplate(z) {
  const s = z.el && z.el.getAttribute('data-divisorias'); if (!s) return null;
  try { return divisoriasValidas(JSON.parse(s)); } catch { return null; }
}
function refazerDivisorias() {
  if (!S.zonas || !S.grades || !Array.isArray(S.linhas)) return;
  const auto = [];
  for (const z of S.zonas) {
    const g = S.grades[z.chave]; if (!g || !g.divisorias) continue;
    // catálogo: o fio entre as linhas é extra do próprio card; divisória da zona só se o template ainda
    // tiver (a da ficha antiga cruzava o texto quando as linhas mudam de altura)
    if (S.catalogo && !divisoriasDoTemplate(z)) { delete g.divisorias; continue; }
    let d = divisoriasValidas(g.divisorias);
    const atual = S.linhas.find(l => l.zona === z.chave);
    if (atual) d = { ...d, cor: atual.cor, px: atual.px, estilo: atual.estilo };
    g.divisorias = d;
    if (!d.v && !d.h) continue;
    const cells = ativosDaZona(z.chave).map(p => p.cell);
    divisoriasDaZona(cells, { v: d.v, h: d.h, recuo: d.recuo, vaoMax: Math.max(40, (g.espaco || 0) * 3) }).forEach((s, i) => auto.push({
      id: `div-${z.chave}-${s.div}${i}`, pagina: z.pagina, x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2,
      cor: d.cor, px: d.px, estilo: d.estilo, zona: z.chave, div: s.div,
    }));
  }
  S.linhas = [...S.linhas.filter(l => !l.zona), ...auto];
  if (S.selLinha && !linhaPorId(S.selLinha)) S.selLinha = null;
  S.selLinhas = (S.selLinhas || []).filter(id => linhaPorId(id));
  desenharLinhas();
}
// mexeu no visual de uma divisória: as outras da mesma zona ficam iguais
function espelharDivisorias(ids) {
  for (const id of ids) {
    const l = linhaPorId(id); if (!l || !l.zona) continue;
    for (const o of S.linhas) if (o.zona === l.zona) { o.cor = l.cor; o.px = l.px; o.estilo = l.estilo; }
  }
}
// liga/desliga e muda as divisórias da zona (painel Grade e automação). o = {v, h, cor, px, estilo, recuo}
function definirDivisorias(o = {}, k) {
  k = k || zonaAtual(); const g = S.grades[k]; if (!g) return null;
  if (!('divisorias' in g)) g.divisorias = null; // o desfazer volta pro "sem divisórias"
  marcarGrade(k);
  const base = g.divisorias || { v: false, h: false, ...padraoLinha() };
  const novo = divisoriasValidas({ ...base, ...o });
  // o visual pedido vale também pras linhas que já estão na tela (o refazer lê o visual delas)
  for (const l of S.linhas) if (l.zona === k) Object.assign(l, { cor: novo.cor, px: novo.px, estilo: novo.estilo });
  g.divisorias = novo;
  mudou(); painel();
  return { ...novo };
}
// apagar uma divisória desliga aquele lado da zona (senão ela voltaria no próximo refazer)
function desligarDivisoria(k, div) {
  const g = S.grades[k]; if (!g || !g.divisorias) return;
  marcarGrade(k);
  g.divisorias = { ...g.divisorias, [div]: false };
  mudou(); painel();
}
function apagarLinhasSel() {
  const autos = linhasSel().filter(l => l.zona);
  for (const par of new Set(autos.map(l => l.zona + '\n' + l.div))) { const [k, d] = par.split('\n'); desligarDivisoria(k, d); }
  const ids = idsLinhasSel().filter(id => { const l = linhaPorId(id); return l && !l.zona; });
  if (!ids.length) { S.selLinha = null; S.selLinhas = []; painel(); return; }
  marcar(S.linhas);
  S.linhas = S.linhas.filter(l => !ids.includes(l.id));
  S.selLinha = null; S.selLinhas = [];
  desenharLinhas(); mudou(); painel();
}

function duplicarLinha() {
  const l = linhaSel(); if (!l) return;
  const pg = S.paginas[l.pagina] || S.paginas[0];
  const id = adicionarLinha({ ...deslocarLinha(l, 0, pg.h * 0.03), cor: l.cor, px: l.px, estilo: l.estilo, pagina: l.pagina });
  if (id) selecionarLinha(id);
}

// cores pros atalhos: branco, preto e as 3 que o template mais usa
function coresDoTemplate() {
  if (S.coresTpl) return S.coresTpl;
  const conta = {};
  const somar = c => { c = corDaLinha(c, ''); if (c && c !== '#ffffff' && c !== '#000000') conta[c] = (conta[c] || 0) + 1; };
  for (const st of $$('style', S.svg)) for (const m of st.textContent.matchAll(/fill:\s*(#[0-9a-f]{3,6})\b/gi)) somar(m[1]);
  for (const e of $$('[fill]', S.svg)) somar(e.getAttribute('fill'));
  S.coresTpl = ['#ffffff', '#000000', ...Object.keys(conta).sort((a, b) => conta[b] - conta[a]).slice(0, 3)];
  return S.coresTpl;
}
function painelLinha() {
  const l = linhaSel(); if (!l) return;
  const n = idsLinhasSel().length;
  $('#fl-varios').classList.toggle('oculto', n < 2);
  $('#fl-titulo').textContent = n > 1 ? `${n} linhas divisórias` : l.zona ? 'Divisória da grade' : 'Linha divisória';
  $('#fl-auto').classList.toggle('oculto', !l.zona);
  if (l.zona) $('#fl-recuo').textContent = fmtPt(((S.grades[l.zona] || {}).divisorias || {}).recuo || 0);
  $('#fl-dist').classList.toggle('oculto', n < 3);
  if (document.activeElement !== $('#fl-px')) $('#fl-px').value = fmtPt(l.px);
  $('#fl-cor').value = l.cor;
  $$('input[name="estilo-linha"]').forEach(r => { r.checked = r.value === l.estilo; });
  $('#fl-travar').checked = !!S.travarLinha;
  const box = $('#fl-cores'), cores = coresDoTemplate();
  if (box.dataset.cores !== cores.join()) {
    box.dataset.cores = cores.join(); box.textContent = '';
    for (const c of cores) {
      const b = document.createElement('button');
      b.className = 'cor-bola'; b.dataset.ln = 'cor:' + c; b.title = c; b.style.background = c;
      box.appendChild(b);
    }
  }
  $$('.cor-bola', box).forEach(b => b.classList.toggle('ativa', b.dataset.ln === 'cor:' + l.cor));
}

$('#ed-linha').onclick = () => {
  if (!S.edicao || !S.carregado) return;
  const id = adicionarLinha({});
  if (id) { selecionarLinha(id); aviso('Arraste pra mover · as bolinhas esticam e giram (Shift trava reta)', 3200); }
};
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-ln]'); if (!b) return;
  const l = linhaSel(); if (!l) return;
  const [k, a, c] = b.dataset.ln.split(':'), ids = idsLinhasSel(), ls = linhasSel();
  if (k === 'px') mudarLinhas(ids, x => { const passo = x.px > 2 || (x.px === 2 && +a > 0) ? 1 : 0.5; return { px: Math.max(PX_MIN_LINHA, x.px + passo * +a) }; });
  if (k === 'eixo') mudarLinhas(ids, x => endireitarLinha(x, a));
  if (k === 'mv') mudarLinhas(ids, x => deslocarLinha(x, +a, +c));
  if (k === 'cor') { mudarLinhas(ids, () => ({ cor: a })); lembrarLinha(linhaSel()); }
  if (k === 'recuo' && l.zona && S.grades[l.zona]) {
    const d = S.grades[l.zona].divisorias || {};
    definirDivisorias({ recuo: Math.max(0, (d.recuo || 0) + +a) }, l.zona);
  }
  if (k === 'dup') duplicarLinha();
  if (k === 'apaga') apagarLinhasSel();
  // várias linhas: alinhar pela caixa de todas, igualar à 1ª selecionada, espaço igual
  if (k === 'al') gravarLinhas(alinharLinhas(ls, a));
  if (k === 'igual') gravarLinhas(igualarLinhas(ls, l, a));
  if (k === 'dist') gravarLinhas(distribuirLinhas(ls, a));
});
$('#fl-px').addEventListener('change', e => {
  const l = linhaSel(), v = parseFloat(String(e.target.value).replace(',', '.'));
  if (l && Number.isFinite(v) && v > 0) mudarLinhas(idsLinhasSel(), () => ({ px: v })); else painel();
});
// cor: o seletor dispara 'input' a cada arrasto; só a primeira mexida entra no desfazer
let corLinhaEmCurso = false;
$('#fl-cor').addEventListener('input', e => {
  const l = linhaSel(); if (!l) return;
  if (!corLinhaEmCurso) { corLinhaEmCurso = true; mudarLinhas(idsLinhasSel(), () => ({ cor: e.target.value })); return; }
  for (const x of linhasSel()) x.cor = corDaLinha(e.target.value, x.cor);
  espelharDivisorias(idsLinhasSel());
  desenharLinhas(); mudou();
});
$('#fl-cor').addEventListener('change', () => { corLinhaEmCurso = false; const l = linhaSel(); if (l) { lembrarLinha(l); painel(); } });
$$('input[name="estilo-linha"]').forEach(r => r.addEventListener('change', () => { const l = linhaSel(); if (l && r.checked) { mudarLinhas(idsLinhasSel(), () => ({ estilo: r.value })); lembrarLinha(linhaSel()); } }));
$('#fl-travar').addEventListener('change', e => { S.travarLinha = e.target.checked; });

// ---------------------------------------------------------------- ações de produto
function trocarLugar(a, b) {
  // troca as células: cada card se adapta ao tamanho da outra
  marcar(a, b);
  const ca = { ...a.cell }, cb = { ...b.cell };
  mudarCelula(a, cb); mudarCelula(b, ca);
  [a.cellAuto, b.cellAuto] = [b.cellAuto, a.cellAuto]; [a.cellAj, b.cellAj] = [b.cellAj, a.cellAj]; // o ajuste é da casa
  atribuirZonas([a, b]); // trocou de zona junto com a célula
  for (const z of new Set([a.zona, b.zona])) if (z) formatoAuto(z); // casa de outro tamanho: horizontal ⇄ normal
  mudou();
  aviso(`Produto ${a.rotulo} ⇄ ${b.rotulo}`);
}
$('#pp-frente').onclick = () => camadaSel('frente');
$('#pp-tras').onclick = () => camadaSel('tras');
$('#pp-trocar-lugar').onclick = () => { if (!S.sel) return; S.trocandoLugar = S.sel; desenharSelecao(); aviso('Agora toque no outro produto'); };

// ---------------------------------------------------------------- grade (montarGrade)
// Regra do painel: 1 parâmetro (colunas base C). R = ceil(N/C), base = floor(N/R), rem = N mod R;
// as 'rem' linhas cheias ficam EM CIMA (regra do Matheus, 05/10/2026: linha incompleta sempre
// embaixo, e nenhuma linha fica com 1 item só).
// produtos da página, zona por zona (cada zona na ordem de leitura dela)
function ativosDaPagina(i) { return zonasDaPagina(i).flatMap(z => ativosDaZona(z.chave)); }

// detecção por zona: colunas, espaço e linhas contando só os cards normais (especiais vão por casas)
function detectarGrade(k) {
  const z = S.porZona[k], pg = S.paginas[z.pagina];
  const todos = ativosDaZona(k);
  const ps = todos.filter(p => p.molde === 'normal').length ? todos.filter(p => p.molde === 'normal') : todos;
  // área útil: a grid_area da zona, ou a união dos cards (página sem grid_area)
  let area = z.ret ? { ...z.ret } : null;
  if (!area && todos.length) {
    const x0 = Math.min(...todos.map(p => p.cell.x)), y0 = Math.min(...todos.map(p => p.cell.y));
    const x1 = Math.max(...todos.map(p => p.cell.x + p.cell.w)), y1 = Math.max(...todos.map(p => p.cell.y + p.cell.h));
    area = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  const linhas = [], tol = tolLinha(ps);
  for (const p of ps) {
    const l = linhas.find(l => Math.abs(l.y - p.cell.y) <= tol);
    if (l) l.ps.push(p); else linhas.push({ y: p.cell.y, ps: [p] });
  }
  linhas.sort((a, b) => a.y - b.y);
  const cont = linhas.map(l => l.ps.length);
  let gut = 4;
  const gaps = [];
  for (const l of linhas) { const o = l.ps.slice().sort((a, b) => a.cell.x - b.cell.x); for (let k = 1; k < o.length; k++) gaps.push(o[k].cell.x - (o[k - 1].cell.x + o[k - 1].cell.w)); }
  // catálogo (1 por linha): o espaço é o vão entre as linhas, não entre colunas que não existem
  if (S.catalogo && !gaps.length) for (let k = 1; k < linhas.length; k++) gaps.push(linhas[k].y - (linhas[k - 1].y + linhas[k - 1].ps[0].cell.h));
  if (gaps.length) gut = Math.max(0, Math.round(gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] * 10) / 10);
  else if (S.catalogo) gut = 0;
  return {
    colunas: cont.length ? Math.max(...cont) : 4,
    espaco: gut,
    cheiasEmCima: regraTpl('linha_incompleta_embaixo', true), // regra global: linhas cheias em cima, incompleta embaixo
    linha1: aceitaLinhaDe1(z), // parte elástica com mais de uma linha: 1/2, 2/3 (linha incompleta em cima)
    area: area || { x: pg.x, y: pg.y, w: pg.w, h: pg.h },
  };
}
// bbox de um elemento no espaço do SVG raiz sem depender da câmera
// (soma os transform dos ancestrais na mão: o getCTM do <svg> raiz é diferente no Firefox)
function matrizAteRaiz(e) {
  let m = S.svg.createSVGMatrix();
  for (let n = e; n && n !== S.svg; n = n.parentNode) {
    const t = n.transform && n.transform.baseVal.consolidate();
    if (t) m = t.matrix.multiply(m);
  }
  return m;
}
function retSvgBBox(e) {
  const b = e.getBBox(), inv = matrizAteRaiz(e);
  const pt = (x, y) => { const p = S.svg.createSVGPoint(); p.x = x; p.y = y; return p.matrixTransform(inv); };
  const a = pt(b.x, b.y), c = pt(b.x + b.width, b.y + b.height);
  return { x: Math.min(a.x, c.x), y: Math.min(a.y, c.y), w: Math.abs(c.x - a.x), h: Math.abs(c.y - a.y) };
}

// padrão do cliente pode limitar a 1ª linha (Rigoni: 3 a 4 embaixo do título, nunca 5);
// o resto segue a regra normal e a última linha pode ficar menor
function primeiraLinhaMax() { const g = S.padrao && S.padrao.grade; return regraTpl('primeira_linha_max', g && g.primeira_linha_max) || 0; }
function distribuir(n, C, cheiasEmCima) {
  if (!n) return [];
  const m = primeiraLinhaMax();
  // Rigoni: a linha mais cheia é sempre a de baixo (13 com 5 colunas = 4/4/5); acrescenta linha até
  // a 1ª caber no limite, sem passar de C por linha e sem linha de 1
  if (m && m < C) {
    for (let R = Math.ceil(n / C); R <= n; R++) {
      const rows = distribuirLivre(n, Math.ceil(n / R), false);
      if (rows.length === R && rows[0] <= m && Math.max(...rows) <= C && !rows.includes(1)) return rows;
    }
  }
  return distribuirLivre(n, C, cheiasEmCima);
}
// aceita1: parte elástica da zona composta (Matheus, 26/10/2026) — lá linha de 1 pode (3 com 2 por
// linha = 1/2, não uma linha de 3 espremida)
function distribuirLivre(n, C, cheiasEmCima, aceita1) {
  if (!n) return [];
  const R = Math.ceil(n / C), base = Math.floor(n / R), rem = n % R;
  const rows = Array(R).fill(base);
  for (let k = 0; k < rem; k++) rows[cheiasEmCima ? k : R - 1 - k]++;
  if (S.catalogo || aceita1) return rows; // catálogo: 1 por linha é o certo (colunas=1 continua 1 coluna)
  // linha com 1 item só não pode: pega um da linha mais cheia; sem de onde tirar, junta na vizinha
  for (let i = 0; i < rows.length && rows.length > 1; i++) {
    if (rows[i] !== 1) continue;
    let j = -1;
    rows.forEach((v, k) => { if (k !== i && v > 2 && (j < 0 || v > rows[j])) j = k; });
    if (j >= 0) { rows[j]--; rows[i]++; }
    else { rows[i > 0 ? i - 1 : 1]++; rows.splice(i, 1); i--; }
  }
  return rows;
}

// quantos produtos em cada linha. g.linhas = as primeiras linhas escolhidas à mão (3 na 1ª, 5 na 2ª…);
// o que sobra segue a regra automática embaixo delas. Sobrou 1 só: vai pra última linha escolhida (na
// elástica, que aceita linha de 1, fica numa linha dele).
function linhasDaGrade(g, n) {
  const fix = (g.linhas || []).map(v => Math.max(1, Math.round(+v) || 0)).filter(v => v > 0);
  // elástica: incompleta em cima e linha de 1 pode (a regra "nunca linha de 1" e a do Rigoni não valem)
  if (!fix.length && g.linha1) return distribuirLivre(n, g.colunas, false, true);
  if (!fix.length) return distribuir(n, g.colunas, g.cheiasEmCima);
  const rows = []; let resto = n;
  for (const v of fix) { if (resto <= 0) break; const t = Math.min(v, resto); rows.push(t); resto -= t; }
  if (resto > 0) {
    const mais = distribuirLivre(resto, g.colunas, primeiraLinhaMax() ? false : g.cheiasEmCima, g.linha1);
    if (!g.linha1 && mais.length === 1 && mais[0] === 1 && rows.length) rows[rows.length - 1]++;
    else rows.push(...mais);
  }
  return rows;
}
// automação (somado-encarte ajustar --linhas): definirLinhas('3,5') ou ([3,5]); vazio/null = automático
function definirLinhas(linhas, k) {
  k = k || zonaAtual(); const g = S.grades[k]; if (!g) return null;
  const arr = Array.isArray(linhas) ? linhas : String(linhas || '').split(/[^0-9]+/).filter(Boolean);
  marcarGrade(k);
  g.linhas = arr.map(Number).filter(v => v > 0);
  if (!g.linhas.length) delete g.linhas;
  montarGrade(k); mudou(); painel();
  return linhasDaGrade(g, ativosDaZona(k).length);
}
function montarGrade(k) {
  montarGradeSo(k);
  formatoAuto(k); // card que ficou largo vira horizontal (e volta), se o template tiver o desenho
}
function montarGradeSo(k) {
  const g = S.grades[k]; if (!g) return;
  const ps = ativosDaZona(k);
  if (ps.some(p => p.span.c > 1 || p.span.r > 1)) return montarPorCasas(k, ps);
  const rows = linhasDaGrade(g, ps.length);
  if (S.catalogo && rows.every(c => c === 1)) return montarLinhasCatalogo(k, ps);
  const A = g.area, R = rows.length, e = g.espaco;
  const h = (A.h - (R - 1) * e) / R;
  let n = 0;
  rows.forEach((cols, r) => {
    const w = (A.w - (cols - 1) * e) / cols;
    for (let c = 0; c < cols; c++) celulaDaGrade(k, ps[n++], { x: A.x + c * (w + e), y: A.y + r * (h + e), w, h });
  });
}

// Catálogo: uma linha por produto, de cima pra baixo. A altura base é a de uma linha do template
// (grid_area data-linhas; lista menor não estica as linhas); nome que quebrou em 2 linhas ganha uma
// linha mais alta, e se não couber tudo na zona as linhas encolhem por igual (nunca saem da zona).
// Duas passadas: a 1ª escreve o nome pra saber quantas linhas ele usou.
function montarLinhasCatalogo(k, ps) {
  const g = S.grades[k], A = g.area, e = g.espaco || 0, z = S.porZona[k];
  const nTpl = +(z && z.el && z.el.getAttribute('data-linhas-tpl')) || 0;
  const R = ps.length, hl = (A.h - (Math.max(R, nTpl) - 1) * e) / Math.max(R, nTpl);
  const colocar = hs => { let y = A.y; ps.forEach((p, i) => { celulaDaGrade(k, p, { x: A.x, y, w: A.w, h: hs[i] }); y += hs[i] + e; }); };
  colocar(ps.map(() => hl));
  // nome de 2 linhas = linha de 1,4× (30 → 42 pt na Luxo, decisão do Matheus 19/10); as de 1 linha dividem
  // o que sobra da zona, sem passar da altura base. Não coube nem assim: todas encolhem por igual
  const dois = ps.map(p => (p.nomeNLinhas || 1) > 1), n2 = dois.filter(Boolean).length;
  if (!n2) return;
  const cabe = A.h - (R - 1) * e, h2 = hl * 1.4;
  const h1 = R > n2 ? Math.min(hl, (cabe - n2 * h2) / (R - n2)) : 0;
  let hs = dois.map(d => (d ? h2 : h1));
  if (R > n2 && h1 < hl * 0.75) { const tot = n2 * h2 + (R - n2) * hl; hs = dois.map(d => (d ? h2 : hl) * Math.min(1, cabe / tot)); }
  else if (R === n2) hs = dois.map(() => Math.min(h2, cabe / R));
  colocar(hs);
}

// Destaque 2×2 (regra do Marcelino): grade por CASAS, posição = a da lista (nunca reordena),
// 1 destaque 2×2 = 4 casas; sobra de casa estica o card vizinho.
// Meia casa (20/10/2026): a conta é feita em MEIAS casas (grade 2C × 2R); casa inteira = 2 meias, então
// com todos os spans inteiros sai igual à conta antiga. Meia casa = (casa + espaço)/2 − espaço de largura.
function montarPorCasas(k, ps) {
  const g = S.grades[k], C = Math.max(1, g.colunas), A = g.area, e = g.espaco;
  const meia = v => Math.max(1, Math.round(v * 2)), C2 = C * 2;
  const inteiro = ps.every(p => Number.isInteger(p.span.c) && Number.isInteger(p.span.r));
  const casas = ps.reduce((s, p) => s + Math.min(meia(p.span.c), C2) * meia(p.span.r), 0);
  let R = Math.max(2, Math.ceil(casas / C2 / 2) * 2), pos;
  for (let tent = 0; tent < 40; tent++, R += inteiro ? 2 : 1) {
    const occ = Array.from({ length: R }, () => Array(C2).fill(null));
    pos = []; let ok = true;
    for (const p of ps) {
      const sc = Math.min(meia(p.span.c), C2), sr = Math.min(meia(p.span.r), R);
      let achou = null;
      for (let r = 0; r <= R - sr && !achou; r++) for (let c = 0; c <= C2 - sc && !achou; c++) {
        let livre = true;
        for (let rr = r; rr < r + sr && livre; rr++) for (let cc = c; cc < c + sc; cc++) if (occ[rr][cc]) { livre = false; break; }
        if (livre) achou = { r, c };
      }
      if (!achou) { ok = false; break; }
      for (let rr = achou.r; rr < achou.r + sr; rr++) for (let cc = achou.c; cc < achou.c + sc; cc++) occ[rr][cc] = p;
      pos.push({ p, r: achou.r, c: achou.c, sr, sc });
    }
    if (!ok) continue;
    // casas vazias: estica o card colado à esquerda (ou à direita) na mesma linha, se ele tiver no máximo
    // uma casa de altura e a coluna vazia estiver livre em toda a altura dele
    let buracos = 0;
    const livre = (it, c) => { for (let rr = it.r; rr < it.r + it.sr; rr++) if (occ[rr][c]) return false; return true; };
    for (let r = 0; r < R; r++) for (let c = 0; c < C2; c++) {
      if (occ[r][c]) continue;
      const cand = [c > 0 && occ[r][c - 1], c < C2 - 1 && occ[r][c + 1]].filter(Boolean).map(v => pos.find(q => q.p === v));
      const it = cand.find(q => q && q.sr <= 2 && livre(q, c));
      if (it) { if (c < it.c) it.c = c; it.sc++; for (let rr = it.r; rr < it.r + it.sr; rr++) occ[rr][c] = it.p; } else buracos++;
    }
    // meia casa: passo = (casa + espaço) / 2; largura de n meias = n × passo − espaço
    const cw = (A.w - (C - 1) * e) / C, Rc = R / 2, ch = (A.h - (Rc - 1) * e) / Rc, px = (cw + e) / 2, py = (ch + e) / 2;
    for (const q of pos) celulaDaGrade(k, q.p, { x: A.x + q.c * px, y: A.y + q.r * py, w: q.sc * px - e, h: q.sr * py - e });
    if (buracos) aviso(`${fmtCasa(buracos / 4)} casa(s) ficaram vazias na página ${paginaDaZona(k) + 1}`);
    return;
  }
}

function reorganizar(k, msg) {
  marcar(...produtosDaZona(k));
  montarGrade(k); mudou(); painel();
  if (msg) aviso(msg);
}

// produto novo: clona o molde limpo do template, com numeração própria
function proximoNum() { return Math.max(0, ...S.produtos.map(p => parseInt(p.num, 10) || 0)) + 1; }
function criarProduto(id, num, moldeKey = 'normal', moldeDe = null) {
  const daZona = moldeKey === 'normal' && moldeDe && S.limpos && S.limpos[moldeDe];
  const molde = daZona || (S.moldes && S.moldes[moldeKey]) || S.molde;
  const g = molde.cloneNode(true);
  g.id = id; g.setAttribute('data-name', 'PRODUTO ' + num);
  for (const e of $$('[id]', g)) {
    if (/^produto_\d+_/.test(e.id)) e.id = e.id.replace(/^produto_\d+_/, `produto_${num}_`);
    else e.id = e.id + '_n' + num;
    e.removeAttribute('data-name');
  }
  ((daZona && molde.parentGroup) || S.molde.parentGroup).appendChild(g);
  aplicarVariaveis(g); // molde de especial vem de outro arquivo, sem os eixos aplicados
  const p = lerProduto(g);
  p.novo = true; p.num = String(num); p.rotulo = String(num);
  p.moldeDe = daZona ? moldeDe : null;
  p.molde = S.moldes && S.moldes[moldeKey] ? moldeKey : 'normal';
  if (p.molde !== 'normal') p.span = spanDoMolde(p.molde);
  herdarAreaImg(p);
  S.produtos.push(p); S.porId[p.id] = p;
  return p;
}

// cria um card vazio logo depois de 'depoisDe' na ordem de leitura (ou no fim da zona k)
// o card que o TEMPLATE desenhou nesta zona (mesmo removido): o formato certo pra esse tamanho de casa.
// Copiar o card de outra zona (o vizinho que já era cópia da capa) levava o desenho de outro tamanho, com
// R$ e nome fora do lugar do modelo (Redemais 22/10/2026, folhas 2 a 4)
function moldeDaZona(k) {
  const R = S.porZona[k] && S.porZona[k].ret; if (!R || !S.limpos) return null;
  const dentro = c => c && c.x + c.w / 2 >= R.x && c.x + c.w / 2 <= R.x + R.w && c.y + c.h / 2 >= R.y && c.y + c.h / 2 <= R.y + R.h;
  const tpl = S.produtos.filter(q => !q.novo && q.molde === 'normal' && S.limpos[q.id] && dentro(q.card));
  const tplN = tpl.filter(q => q.desenho !== 'horizontal');
  return ((tplN.length ? tplN : tpl)[0] || {}).id || null;
}
function novoNaZona(k, depoisDe) {
  const num = proximoNum();
  // desenho normal na frente do horizontal (o automático troca depois, se a casa ficar larga)
  const todosDaZona = S.produtos.filter(q => q.zona === k && q.molde === 'normal');
  const normais = todosDaZona.filter(q => q.desenho !== 'horizontal' && !q.autoH);
  const daZona = normais.length ? normais : todosDaZona;
  const orig = moldeDaZona(k) || daZona.filter(q => S.limpos && S.limpos[q.id]).pop() || daZona.map(q => q.moldeDe).filter(Boolean).pop();
  let origId = orig ? (orig.id || orig) : null;
  // zona esvaziada: template do construtor marca zona e card com data-modelo; usa um card desse modelo
  const dm = !origId && S.porZona[k] && S.porZona[k].el && S.porZona[k].el.getAttribute('data-modelo');
  if (dm) origId = Object.keys(S.limpos || {}).find(id => !/_ESPECIAL/.test(id) && S.limpos[id].getAttribute('data-modelo') === dm) || null;
  const p = criarProduto('PRODUTO_' + num + '_novo', num, 'normal', origId);
  const ref = depoisDe || ativosDaZona(k).filter(q => q !== p).pop();
  if (ref) mudarCelula(p, { ...ref.cell, x: ref.cell.x + 0.5, y: ref.cell.y + 0.5 });
  else { const A = S.grades[k].area; mudarCelula(p, { ...p.card, x: A.x, y: A.y }); }
  p.zona = k;
  p.nome = caixaNome('Novo produto'); p.precoTxt = '0,00';
  for (const v of p.extras || []) v.txt = '0,00';
  p.deOn = false; p.seloOn = false; p.logoOn = false; // DE, selo e logo só nos itens marcados
  p.fotos.forEach(im => im.remove()); p.fotos = [];
  render(p);
  return p;
}

function adicionarProduto(depoisDe) {
  const k = depoisDe ? depoisDe.zona : zonaAtual();
  if (!k || !S.grades[k]) return;
  const antes = produtosDaZona(k).map(estado);
  const p = novoNaZona(k, depoisDe);
  const num = p.num;
  S.desfazer.push([{ tipo: 'novo', id: p.id }, ...antes]);
  montarGrade(k); render(p);
  mudou(); selecionarProduto(p);
  aviso('Produto ' + num + ' adicionado e grade reorganizada');
  return p;
}

function removerProduto(p) {
  const k = p.zona;
  marcar(...(k ? produtosDaZona(k) : [p]));
  p.removido = true; render(p);
  if ($('#gr-auto').checked && k) montarGrade(k);
  limparSelecao(); mudou(); painel();
  aviso(`Produto ${p.rotulo} removido · ↶ desfaz`);
}

$('#pp-remover').onclick = () => { if (S.sel) removerProduto(S.sel); };
$('#pp-adicionar').onclick = () => { if (S.sel) adicionarProduto(S.sel); };
$('#gr-add').onclick = () => adicionarProduto(null);
$('#gr-montar').onclick = () => { const k = zonaAtual(); if (k) reorganizar(k, 'Grade reorganizada'); };
$('#gr-zona').onchange = e => { S.zonaAtiva = e.target.value; painel(); };
document.addEventListener('click', e => {
  const b = e.target.closest('[data-gr]'); if (!b) return;
  const z = zonaAtual(), g = S.grades[z]; if (!g) return;
  const [k, v] = b.dataset.gr.split(':');
  marcarGrade(z); // desfazer volta colunas/espaço junto com as células
  if (k === 'col') {
    g.colunas = Math.max(1, g.colunas + +v);
    // colunas novas valem: as linhas escolhidas à mão saem, e horizontal (2×1) que encheria a linha
    // inteira encolhe (4 horizontais em 2 colunas saíam 1 por linha, Marcelino 20/10/2026)
    delete g.linhas;
    // (zona toda em 2×1 = as colunas é que mandam: todos voltam a 1 casa)
    const ps = ativosDaZona(z), largos = ps.filter(p => p.span.r === 1 && p.span.c > 1);
    if (largos.length && largos.length === ps.length) for (const p of ps) p.span = { c: 1, r: 1 };
    else if (g.colunas > 1) for (const p of largos) if (p.span.c >= g.colunas) p.span = { c: g.colunas - 1, r: 1 };
  }
  if (k === 'esp') g.espaco = Math.max(0, g.espaco + +v);
  montarGrade(z); mudou(); painel();
});
document.addEventListener('click', e => {
  const b = e.target.closest('[data-grl]'); if (!b) return;
  const z = zonaAtual(), g = S.grades[z]; if (!g) return;
  if (b.dataset.grl === 'auto') return definirLinhas(null, z);
  const [i, d] = b.dataset.grl.split(':').map(Number);
  const rows = linhasDaGrade(g, ativosDaZona(z).length).slice(0, i + 1);
  rows[i] = Math.max(1, rows[i] + d);
  definirLinhas(rows, z);
});
$('#pp-areaimg').onclick = () => {
  S.editAreaImg = !S.editAreaImg; if (S.editAreaImg) S.editCard = false; painel(); desenharSelecao();
  if (S.editAreaImg) aviso('Arraste as bolinhas verdes pra mudar a área da imagem · a do meio move tudo');
};
document.addEventListener('click', e => {
  const b = e.target.closest('[data-ai]'); if (!b || !S.sel) return;
  const [borda, d] = b.dataset.ai.split(':'), v = +d;
  const p = S.sel, alvos = alvosAreaImg(p, $('#ai-todos').checked);
  marcar(...alvos);
  mudarAreaImg(alvos, moverBordasArea(p, areaM(p), borda, borda === 'l' || borda === 'r' ? v : 0, borda === 't' || borda === 'b' ? v : 0));
  mudou(); desenharSelecao(); painelAreaImg(p);
});
// área do produto: liga/desliga (desliga a da imagem, as bolinhas iam brigar), setas e medidas
function alternarAreaCard() {
  if (!S.sel) S.sel = [...S.selProds].pop() || null;
  S.editCard = !S.editCard; if (S.editCard) S.editAreaImg = false;
  painel(); desenharSelecao();
  if (S.editCard) aviso(S.selProds.size > 1 ? `Arraste as bolinhas laranja de qualquer card: muda nos ${S.selProds.size} selecionados`
    : 'Arraste as bolinhas laranja pra mudar o card · a do meio move · vale só neste encarte');
}
$('#pp-card').onclick = alternarAreaCard;
$('#gr-manter').onchange = e => {
  const z = zonaAtual(), g = S.grades[z]; if (!g) return;
  marcarGrade(z); g.manterAjuste = e.target.checked; mudou();
  aviso(g.manterAjuste ? 'Reorganizar a grade mantém o ajuste de cada card' : 'Reorganizar a grade volta os cards ao automático');
};
// divisórias da zona: liga/desliga cada lado; o visual muda tocando numa linha (painel da linha)
for (const [id, lado] of [['#gr-div-v', 'v'], ['#gr-div-h', 'h']]) $(id).onchange = e => {
  if (!S.grades[zonaAtual()]) return;
  definirDivisorias({ [lado]: e.target.checked });
  if (e.target.checked) aviso('Toque numa divisória pra mudar cor, espessura e estilo', 2400);
};
// card do lado: escolha lembrada no navegador (vale pros dois painéis)
for (const id of ['#ac-vizinho', '#pv-ac-vizinho']) {
  $(id).value = guardar.ler('encarte.vizinho', 'cobre');
  $(id).onchange = e => { guardar.pôr('encarte.vizinho', e.target.value); $('#ac-vizinho').value = $('#pv-ac-vizinho').value = e.target.value; };
}
$('#gr-blocos').onclick = () => {
  S.editCard = !S.editCard; if (S.editCard) S.editAreaImg = false;
  painel(); desenharSelecao();
  if (S.editCard) aviso(S.sel ? 'Arraste as bolinhas laranja pra mudar o card · vale só neste encarte' : 'Toque num bloco pra mexer nele · as bolinhas laranja mudam o tamanho');
};
$('#pv-card').onclick = alternarAreaCard;
$('#ac-alvo').onchange = () => { desenharSelecao(); painelAreaCard(S.sel); };
document.addEventListener('click', e => {
  const b = e.target.closest('[data-ac]'); if (!b || !S.sel) return;
  const [borda, d] = b.dataset.ac.split(':'), v = +d;
  const h = borda === 'l' || borda === 'r' || borda === 'mx', bd = borda.startsWith('m') ? 'm' : borda;
  const plano = planoCards(alvosCard(S.sel), bd);
  marcar(...todosDoPlano(plano));
  if (!mudarCards(plano, bd, h ? v : 0, h ? 0 : v, true)) return aviso('Card pequeno demais');
  mudou(); desenharSelecao(); painelAreaCard(S.sel);
});
// largura/altura digitadas (pt): estica pra direita/baixo, em todos os alvos
for (const id of ['#ac-w', '#ac-h', '#pv-ac-w', '#pv-ac-h']) $(id).addEventListener('change', e => {
  const p = S.sel; if (!p) return;
  const v = parseFloat(String(e.target.value).replace(',', '.'));
  if (!(v >= 30)) { painelAreaCard(p); return aviso('Mínimo 30 pt'); }
  const larg = id.endsWith('-w'), plano = planoCards(alvosCard(p), larg ? 'r' : 'b');
  marcar(...todosDoPlano(plano));
  const d = v - (larg ? p.cell.w : p.cell.h);
  if (!mudarCards(plano, larg ? 'r' : 'b', larg ? d : 0, larg ? 0 : d, true)) aviso('Card pequeno demais');
  mudou(); desenharSelecao(); painelAreaCard(p);
});
// volta pra grade: reorganiza as zonas dos alvos (o automático refaz as células)
for (const id of ['#ac-grade', '#pv-ac-grade']) $(id).onclick = () => {
  const p = S.sel; if (!p) return;
  const zonas = [...new Set(alvosCard(p).map(q => q.zona).filter(Boolean))];
  if (!zonas.length) return aviso('Esse card não está numa grade');
  const ps = S.produtos.filter(q => zonas.includes(q.zona));
  marcar(...ps); ps.forEach(q => { q.cellAj = null; });
  for (const z of zonas) montarGrade(z);
  mudou(); desenharSelecao(); painel(); aviso('Cards de volta à grade');
};
$('#ai-todos').onchange = () => { desenharSelecao(); painelAreaImg(S.sel); };
$('#pv-areaimg').onclick = () => {
  if (!S.sel) S.sel = [...S.selProds].pop() || null;
  S.editAreaImg = !S.editAreaImg; if (S.editAreaImg) S.editCard = false; painel(); desenharSelecao();
  if (S.editAreaImg) aviso(`Arraste as bolinhas de qualquer card selecionado: a área muda nos ${S.selProds.size}`);
};
$('#pv-ai-orig').onclick = () => {
  const alvos = [...S.selProds]; if (!alvos.length) return;
  marcar(...alvos); mudarAreaImg(alvos, null);
  mudou(); desenharSelecao(); painelAreaImg(S.sel);
};
// selecionar todos do mesmo formato (mesmo desenho e mesmo tamanho de casa) ou da mesma zona da grade
document.addEventListener('click', e => {
  const b = e.target.closest('[data-selpor]'); if (!b) return;
  const ref = S.sel || [...S.selProds].pop(); if (!ref) return aviso('Selecione um produto primeiro');
  const perto = (a, c) => Math.abs(a - c) <= Math.max(4, c * 0.03);
  const ps = S.produtos.filter(q => !q.removido && (b.dataset.selpor === 'zona'
    ? q.zona === ref.zona
    : q.molde === ref.molde && perto(q.cell.w, ref.cell.w) && perto(q.cell.h, ref.cell.h)));
  S.selProds = new Set(ps); S.sel = ref; S.selImgs = []; S.bloco = null; S.multi = true;
  painel(); desenharSelecao();
  aviso(`${ps.length} produto(s) ${b.dataset.selpor === 'zona' ? 'da mesma zona' : 'do mesmo formato'}`);
});
$('#ai-orig').onclick = () => {
  const p = S.sel; if (!p) return;
  const alvos = alvosAreaImg(p, $('#ai-todos').checked);
  marcar(...alvos); mudarAreaImg(alvos, null);
  mudou(); desenharSelecao(); painelAreaImg(p);
};
$('#gr-area').onclick = () => { S.editArea = !S.editArea; painel(); if (S.editArea) aviso('Arraste as bolinhas pra mudar a área · a do meio move tudo'); };
document.addEventListener('click', e => {
  const b = e.target.closest('[data-ga]'); if (!b) return;
  const z = zonaAtual(); if (!S.grades[z]) return;
  const [lado, d] = b.dataset.ga.split(':'); const v = +d;
  marcarGrade(z);
  const A = S.grades[z].area;
  if (lado === 'top') { A.y += v; A.h -= v; }
  if (lado === 'bottom') A.h += v;
  if (lado === 'left') { A.x += v; A.w -= v; }
  if (lado === 'right') A.w += v;
  montarGrade(z); mudou(); painel();
});
// só faz sentido com uma zona por página: copia pras outras páginas que também têm uma zona só
$('#gr-area-todas').onclick = () => {
  const z = zonaAtual(); if (!z) return;
  const i = S.pagina, A = S.grades[z].area, pg = S.paginas[i];
  let n = 1;
  S.paginas.forEach((pj, j) => {
    const zs = zonasDaPagina(j);
    if (j === i || zs.length !== 1) return;
    const k = zs[0].chave;
    marcarGrade(k);
    // mesma posição relativa à prancheta
    S.grades[k].area = { x: pj.x + (A.x - pg.x), y: pj.y + (A.y - pg.y), w: A.w, h: A.h };
    montarGrade(k); n++;
  });
  mudou(); aviso('Área aplicada em ' + n + ' página(s)');
};
$('#gr-area-orig').onclick = () => {
  const z = zonaAtual(); if (!S.grades[z]) return;
  marcarGrade(z);
  S.grades[z].area = { ...S.gradesOrig[z].area };
  montarGrade(z); mudou(); painel();
};

function painelGrade() {
  const z = zonaAtual(), g = S.grades[z]; if (!g) return;
  const zs = zonasDaPagina(S.pagina);
  const n = ativosDaZona(z).length;
  // página com várias zonas (destaques + normais): escolhe qual a grade mostra
  const sel = $('#gr-zona');
  sel.classList.toggle('oculto', zs.length < 2);
  sel.innerHTML = zs.map((x, j) => `<option value="${x.chave}">Zona ${j + 1} · ${ativosDaZona(x.chave).length} produtos</option>`).join('');
  sel.value = z;
  $('#gr-titulo').textContent = zs.length > 1 ? 'Grade da zona' : 'Grade da página';
  $('#gr-area-todas').classList.toggle('oculto', zs.length > 1);
  const rows = linhasDaGrade(g, n), fixas = (g.linhas || []).length;
  $('#gr-info').textContent = `${n} produtos · linhas ${rows.join('/')}${fixas ? ' (à mão)' : ''}`;
  // uma linha por vez: mexer na linha i fixa da 1ª até ela; as de baixo se recalculam
  $('#gr-linhas').innerHTML = rows.map((v, i) => `<span class="grupo${i < fixas ? ' fixa' : ''}"><small>Linha ${i + 1}</small>` +
    `<button class="step" data-grl="${i}:-1" aria-label="Menos na linha ${i + 1}">−</button><b class="val">${v}</b>` +
    `<button class="step" data-grl="${i}:1" aria-label="Mais na linha ${i + 1}">+</button></span>`).join('') +
    (fixas ? '<button class="btn sec" data-grl="auto">Automático</button>' : '');
  $('#gr-col').textContent = g.colunas;
  $('#gr-esp').textContent = g.espaco;
  painelAreaCard(S.sel);
  { const g = S.grades[zonaAtual()]; $('#gr-manter').checked = !!(g && g.manterAjuste); }
  { const d = g.divisorias; $('#gr-div-v').checked = !!(d && d.v); $('#gr-div-h').checked = !!(d && d.h); }
  $('#gr-area').classList.toggle('ativa', !!S.editArea);
  $('#gr-area').textContent = S.editArea ? '✓ Terminar área' : '▭ Editar área da grade';
  $('#gr-area-box').classList.toggle('oculto', !S.editArea);
}

function escopo() {
  const v = (document.querySelector('input[name="escopo"]:checked') || {}).value || 'produto';
  if (v === 'tudo') return S.produtos.filter(p => !p.removido);
  if (v === 'pagina') return S.produtos.filter(p => !p.removido && paginaDe(p) === S.pagina);
  return [...S.selProds].length ? [...S.selProds] : (S.sel ? [S.sel] : []);
}

function ajustar(chave, sinal, alvos) {
  if (!alvos.length) return aviso('Selecione um produto (ou mude o escopo)');
  marcar(...alvos);
  for (const p of alvos) {
    if (chave === 'nome') p.escNome = Math.max(0.4, arred(p.escNome + sinal * 0.05));
    if (chave === 'caixa') p.nomeCaixa = Math.min(1.6, Math.max(0.3, arred(p.nomeCaixa + sinal * 0.05)));
    // até quantas linhas o nome pode usar: parte de quantas tem agora; abaixo de 1 volta pro automático
    if (chave === 'linhas') { const v = (p.nomeLinhas || p.nomeNLinhas || 1) + sinal; p.nomeLinhas = v < 1 ? null : Math.min(4, v); }
    if (chave === 'entre') p.nomeEntre = Math.min(2, Math.max(0.6, arred(p.nomeEntre + sinal * 0.05)));
    if (chave === 'preco') p.escPreco = Math.max(0.4, arred(p.escPreco + sinal * 0.04));
    if (chave === 'real') p.escReal = Math.max(0.4, arred((p.escReal || 1) + sinal * 0.05));
    if (chave === 'cent') p.escCent = Math.max(0.4, arred((p.escCent || 1) + sinal * 0.05));
    if (chave === 'qtd') p.qtdEsc = Math.max(0.3, arred((p.qtdEsc || 1) + sinal * 0.05));
    if (chave === 'logo') p.logoEsc = Math.min(3, Math.max(0.3, arred((p.logoEsc || 1) + sinal * 0.05)));
    if (ehApoio(chave)) p[chave + 'Esc'] = Math.max(0.3, arred((p[chave + 'Esc'] || 1) + sinal * 0.05));
    if (chave === 'fundoW') p.fundoW = Math.max(0.4, arred(p.fundoW + sinal * 0.04));
    if (chave === 'fundoH') p.fundoH = Math.max(0.4, arred(p.fundoH + sinal * 0.04));
    if (chave === 'fundoX') p.fundoDx = arred((p.fundoDx || 0) + sinal * 2);
    if (chave === 'fundoY') p.fundoDy = arred((p.fundoDy || 0) + sinal * 2);
    if (chave === 'fotos') for (const im of p.fotos) escalarFoto(im, 1 + sinal * 0.05);
    render(p);
  }
  mudou(); mostrarPt();
  aviso(`${alvos.length} produto(s)`, 900);
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-aj]'); if (!b) return;
  const [chave, s] = b.dataset.aj.split(':');
  const noPainel = !!b.closest('#painel');
  const alvos = noPainel ? (S.bloco ? blocoPs() : [...S.selProds]) : escopo();
  ajustar(chave, +s, alvos);
});

// mover preço/nome pelas setas
document.addEventListener('click', e => {
  const b = e.target.closest('[data-mv]'); if (!b || !S.bloco) return;
  const [mx, my] = b.dataset.mv.split(':').map(Number);
  moverBloco(mx * 2, my * 2);
});
function moverBloco(dx, dy) {
  const ps = blocoPs(), t = S.bloco.tipo;
  marcar(...ps); for (const p of ps) { p[t + 'Dx'] = (p[t + 'Dx'] || 0) + dx; p[t + 'Dy'] = (p[t + 'Dy'] || 0) + dy; render(p); } mudou();
}
// vários nomes/preços/tapetes: põe todos na mesma linha (topo = o mais alto, base = o mais baixo,
// meio = a média dos centros). Mede de novo depois do render: o nome pode ter reflowed.
function alinharBloco(lado) {
  const ps = blocoPs(), t = S.bloco.tipo; if (ps.length < 2) return;
  const med = q => { const e = elBloco(q, t); return e ? retSvgBBox(e) : null; };
  const val = r => lado === 'topo' ? r.y : lado === 'base' ? r.y + r.h : r.y + r.h / 2;
  const rs = ps.map(med); if (rs.some(r => !r)) return;
  const vs = rs.map(val);
  const alvo = lado === 'topo' ? Math.min(...vs) : lado === 'base' ? Math.max(...vs) : vs.reduce((a, b) => a + b, 0) / vs.length;
  marcar(...ps);
  for (let passo = 0; passo < 3; passo++) {
    let mexeu = false;
    for (const q of ps) {
      const r = med(q), d = alvo - val(r);
      if (Math.abs(d) < 0.3) continue;
      // Dy é no espaço do card: converte a diferença medida no SVG raiz pela escala do grupo
      const k = matrizAteRaiz(q.g).d || 1;
      q[t + 'Dy'] = (q[t + 'Dy'] || 0) + d / k; render(q); mexeu = true;
    }
    if (!mexeu) break;
  }
  mudou();
}
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-alinhar]'); if (!b) return;
  if (S.selImgs.length > 1) alinharFotos(b.dataset.alinhar);
  else if (S.bloco) alinharBloco(b.dataset.alinhar);
});
// várias fotos (de um card ou de vários): topo = a mais alta, base = a mais baixa. Mede no SVG raiz
// (foto girada tem a caixa maior) e repete porque o y da foto é no espaço dela.
function alinharFotos(lado) {
  const ims = S.selImgs.filter(im => im.isConnected); if (ims.length < 2) return;
  const val = r => lado === 'topo' ? r.y : r.y + r.h;
  const vs = ims.map(im => val(retSvgBBox(im)));
  const alvo = lado === 'topo' ? Math.min(...vs) : Math.max(...vs);
  marcar(...new Set(ims.map(prodDe)));
  for (let passo = 0; passo < 3; passo++) {
    let mexeu = false;
    for (const im of ims) {
      const d = alvo - val(retSvgBBox(im)); if (Math.abs(d) < 0.3) continue;
      const k = matrizAteRaiz(im).d || 1, r = retFoto(im);
      posFoto(im, { ...r, y: r.y + d / k }); mexeu = true;
    }
    if (!mexeu) break;
  }
  mudou();
}
function apagarApoio() {
  if (!S.bloco || !ehApoio(S.bloco.tipo)) return;
  const ps = blocoPs(), t = S.bloco.tipo; marcar(...ps);
  for (const p of ps) { p[t + 'Off'] = true; render(p); }
  S.bloco = null; mudou(); painel();
  aviso('Tapete apagado (Ctrl+Z desfaz)');
}
document.addEventListener('click', e => { if (e.target.closest && e.target.closest('[data-apaga-apoio]')) apagarApoio(); });
function apagarLogo() {
  if (!S.bloco || S.bloco.tipo !== 'logo') return;
  const ps = blocoPs(); marcar(...ps);
  for (const p of ps) { p.logoOn = false; render(p); }
  S.bloco = null; mudou(); painel();
  aviso('Logo apagada (Ctrl+Z desfaz; volta pelo "Logo da marca no card" do produto)');
}
document.addEventListener('click', e => { if (e.target.closest && e.target.closest('[data-apaga-logo]')) apagarLogo(); });
$('#pb-zerar').onclick = () => { const ps = blocoPs(), t = S.bloco.tipo; marcar(...ps); for (const p of ps) { p[t + 'Dx'] = p[t + 'Dy'] = 0; if (ehApoio(t)) { p[t + 'Esc'] = 1; p[t + 'Off'] = false; } if (t === 'logo') p.logoEsc = 1; if (t === 'qtd') p.qtdEsc = 1; render(p); } mudou(); };
// Voltar ao modelo (SMD-1149, pedido do Matheus 21/10/2026): o encarte fica como veio do tema — cada card no
// tamanho e no lugar que o template dá, os textos soltos da arte (data, rodapé) no lugar original. O CONTEÚDO
// fica: nome, preço, formato, limite, tarja, preços extras, De/selo/logo ligados, as fotos escolhidas e a casa
// do card na grade. Com vários cards selecionados vale só pra eles (e os textos ficam como estão).
const AJUSTES_DO_CARD = ['escNome', 'escPreco', 'fundoW', 'fundoH', 'fundoDx', 'fundoDy', 'nomeCaixa', 'nomeEntre',
  'nomeAlinha', 'nomeLinhas', 'nomeBorda', 'nomeBordaCor', 'precoDx', 'precoDy', 'nomeDx', 'nomeDy', 'qtdDx', 'qtdDy',
  'qtdEsc', 'qtdZ', 'escReal', 'escCent', 'apoioDx', 'apoioDy', 'apoioEsc', 'apoiosAj', 'apoioOff', 'areaImg', 'cellAj',
  'fotoArea', 'fotoAlinha', 'fotoMao', 'fotoArranjo'];
function voltarAoModelo() {
  const so = S.selProds.size > 1;
  const ps = (so ? [...S.selProds] : S.produtos).filter(p => !p.removido);
  const txs = so ? [] : S.textos.filter(t => t.dx || t.dy || (t.esc && t.esc !== 1));
  if (!ps.length && !txs.length) return aviso('Nada pra voltar');
  if (!confirm(`Voltar ${so ? `os ${ps.length} cards selecionados` : 'o encarte inteiro'} ao modelo do tema?

`
    + 'Tamanhos e posições que você ajustou voltam ao do template. Nome, preço e fotos continuam. Dá pra desfazer (↶).')) return;
  marcar(...ps, ...txs);
  // card criado no editor como cópia de outra zona (outro tamanho): refeito com o card do template da zona
  // dele, com o mesmo conteúdo (nome, preço, fotos)
  const lote = [], vistos = new Set();
  for (const [i, p] of ps.entries()) {
    const certo = p.novo && p.molde === 'normal' && !p.autoH && p.desenho !== 'horizontal' && p.zona && moldeDaZona(p.zona);
    if (!certo || certo === p.moldeDe || certo === p.id) continue;
    trocarMolde(p, 'normal', { moldeDe: certo, manterSpan: true, auto: true, lote, vistos });
    const n = S.produtos[S.produtos.length - 1];
    if (n && n !== p && !n.removido) ps[i] = n;
  }
  if (lote.length) S.desfazer.push(lote);
  for (const p of ps) {
    const e = estado(p);
    for (const k of AJUSTES_DO_CARD) delete e[k];
    if (e.logo) { delete e.logo.dx; delete e.logo.dy; delete e.logo.esc; }
    // a casa da grade sem o ajuste à mão
    e.cell = p.cellAuto ? { ...p.cellAuto } : e.cell;
    aplicarEstado(p, e);
    if (p.fotos.length) { arranjar(p, 'auto'); marcarArranjo(p, 'auto'); p.fotoPend = null; }
    render(p);
  }
  for (const tx of txs) aplicarTexto(tx, { ...estadoTexto(tx), dx: undefined, dy: undefined, esc: undefined });
  atribuirZonas(ps);
  mudou(); painel();
  aviso(so ? `${ps.length} cards voltaram ao modelo` : 'Encarte voltou ao modelo do tema');
}
$('#gr-modelo').onclick = voltarAoModelo;


// ---------------------------------------------------------------- especial (destaque)
// moldes: o PRODUTO_ESPECIAL que já vem no template + os .svg de especial da pasta do template.
// Cada .svg externo tem classes/ids próprios (cls-1… colidem com o template): renomeia com prefixo.
async function carregarEspeciais(tplId) {
  S.moldes = { normal: S.molde };
  const dentro = $$('g[id^="PRODUTO_ESPECIAL"]', S.svg)[0];
  if (dentro) { const m = dentro.cloneNode(true); S.moldes['tpl'] = m; S.moldes['tpl'].nome = 'Especial do template'; }
  const lista = await apiJson(`/templates/${encodeURIComponent(tplId)}/especiais`, ajPedido()).catch(() => []);
  let defs = $('defs', S.svg); if (!defs) { defs = el('defs'); S.svg.insertBefore(defs, S.svg.firstChild); }
  let ne = 0, nh = 0;
  lista.forEach((esp, k) => {
    const pre = `esp${k + 1}_`;
    const doc = new DOMParser().parseFromString(esp.svg, 'image/svg+xml');
    const raiz = doc.documentElement;
    limparExport(raiz);
    const idsDefs = $$('defs [id]', raiz).map(x => x.id);
    let css = $$('style', raiz).map(s => s.textContent).join('\n').replace(/\.cls-(\d+)/g, `.${pre}cls-$1`);
    for (const id of idsDefs) css = css.split(`#${id})`).join(`#${pre}${id})`);
    for (const n of $$('[class]', raiz)) n.setAttribute('class', n.getAttribute('class').split(/\s+/).map(c => /^cls-\d+$/.test(c) ? pre + c : c).join(' '));
    for (const n of $$('defs [id]', raiz)) n.id = pre + n.id;
    for (const n of $$('*', raiz)) for (const at of [...n.attributes]) {
      if (/url\(#/.test(at.value)) n.setAttribute(at.name, at.value.replace(/url\(#([^)]+)\)/g, (m, id) => idsDefs.includes(id) ? `url(#${pre}${id})` : m));
      if ((at.localName === 'href') && at.value.startsWith('#') && idsDefs.includes(at.value.slice(1))) {
        n.setAttributeNS(XL, 'xlink:href', '#' + pre + at.value.slice(1)); n.setAttribute('href', '#' + pre + at.value.slice(1));
      }
    }
    const st = document.createElementNS(NS, 'style'); st.textContent = css; defs.appendChild(st);
    for (const d of $$('defs > *', raiz)) if (d.tagName !== 'style') defs.appendChild(document.importNode(d, true));
    const g = raiz.querySelector('g[id^="PRODUTO_ESPECIAL"]') || raiz.querySelector('g[id^="PRODUTO_"]');
    if (!g) return;
    const m = document.importNode(g, true); m.nome = esp.nome;
    // molde horizontal (construtor): chave própria (h1…), pra não mudar a numeração dos especiais
    // que as fichas antigas guardam (e1, e2…)
    m.formato = g.getAttribute('data-formato') || null;
    if (m.formato === 'horizontal') S.moldes['h' + (++nh)] = m;
    else S.moldes['e' + (++ne)] = m;
  });
  const opts = Object.keys(S.moldes).filter(k => k !== 'normal');
  $('#pp-esp-box').classList.toggle('oculto', !opts.length);
  $('#pp-esp-molde').innerHTML = opts.map(k => `<option value="${k}">${S.moldes[k].nome || k}</option>`).join('');
  $('#pp-esp-molde').value = opts.includes('e1') ? 'e1' : (opts[0] || ''); // o desenhado em arquivo na frente do antigo
}

const fmtCasa = v => String(Math.round(v * 2) / 2).replace('.', ',');
// casas que o molde ocupa: horizontal 2×1, especial 2×2
function spanDoMolde(key) { return S.moldes && S.moldes[key] && S.moldes[key].formato === 'horizontal' ? { c: 2, r: 1 } : { c: 2, r: 2 }; }

// ---------------------------------------------------------------- formato horizontal automático
// Template do construtor com versão horizontal do modelo: card que fica largo (2×1, ou linha com poucos
// produtos) troca sozinho pro desenho horizontal e volta pro normal quando estreita. A volta é mais
// estreita que a ida (1,15 × 1,35) pra não ficar trocando no limite. Escolha à mão (Virar especial)
// não volta sozinha. Mesmo 1,35 do construtor e do gerador (PROPORCAO_HORIZONTAL).
const HORIZ_IDA = 1.35, HORIZ_VOLTA = 1.15;
function moldeHorizontal(p) {
  const ks = Object.keys(S.moldes || {}).filter(x => S.moldes[x].formato === 'horizontal');
  const dm = p.g.getAttribute('data-modelo');
  // card do construtor (tem modelo): só vira horizontal se o MESMO modelo tiver esse desenho. Antes caía
  // no 1º horizontal do template e o card branco do Super Mais virava o Imbatível (17/10/2026)
  if (dm) return ks.find(x => S.moldes[x].getAttribute('data-modelo') === dm) || null;
  return ks[0] || null;
}
// card normal do template do mesmo modelo (pra um horizontal que veio do template voltar pro normal)
function normalDoModelo(p) {
  const dm = p.g.getAttribute('data-modelo');
  return Object.keys(S.limpos || {}).find(id => !/_ESPECIAL/.test(id) && S.limpos[id].getAttribute('data-modelo') === dm
    && S.limpos[id].getAttribute('data-formato') !== 'horizontal') || null;
}
function formatoAuto(k) {
  if (S.trocandoFormato) return;
  const trocas = [];
  for (const p of ativosDaZona(k)) {
    if (!p.cell.h) continue;
    const r = p.cell.w / p.cell.h;
    if (p.molde === 'normal' && p.desenho !== 'horizontal' && !p.fixoNormal && r >= HORIZ_IDA) { const key = moldeHorizontal(p); if (key) trocas.push([p, key, null]); }
    else if (r < HORIZ_VOLTA) {
      // volta: o que virou horizontal aqui, e também o horizontal que já veio assim do template
      // (precisa de um card normal do mesmo modelo no template pra servir de desenho)
      const origem = p.autoH ? p.origemNormal : p.molde === 'normal' && p.desenho === 'horizontal' ? normalDoModelo(p) : undefined;
      if (origem !== undefined && (origem || p.autoH)) trocas.push([p, 'normal', origem]);
    }
  }
  if (!trocas.length) return;
  // todas as trocas desta passada viram UM passo do desfazer (o estado de antes de cada card só
  // entra uma vez: o primeiro, que é o de antes da passada)
  const lote = [], vistos = new Set();
  S.trocandoFormato = true;
  try { for (const [p, key, origem] of trocas) trocarMolde(p, key, { auto: true, moldeDe: origem, lote, vistos }); }
  finally { S.trocandoFormato = false; }
  if (lote.length) S.desfazer.push(lote);
}

// troca o card por outro molde mantendo nome/preço/fotos/posição na lista
// op.auto: troca do formato automático (mantém as casas e a seleção, sem aviso)
function trocarMolde(p, moldeKey, op = {}) {
  const k = p.zona; if (!k) return;
  const antes = produtosDaZona(k).map(estado);
  const num = proximoNum();
  // voltar pro normal: desenho normal do mesmo modelo (não o 1º card do template, que pode ser horizontal)
  const deNormal = moldeKey !== 'normal' ? null : op.moldeDe || (p.autoH || p.desenho === 'horizontal' ? p.origemNormal || normalDoModelo(p) : null);
  const n = criarProduto('PRODUTO_' + num + '_novo', num, moldeKey, deNormal);
  mudarCelula(n, { ...p.cell }); n.cellAuto = p.cellAuto; n.cellAj = p.cellAj;
  n.zona = k;
  n.nome = p.nome; n.precoTxt = p.precoTxt; n.formatoTxt = p.formatoTxt || n.formatoTxt; n.qtdTxt = p.qtdTxt;
  if (n.tarja && p.tarja) n.tarjaTxt = p.tarjaTxt;
  // o que o molde novo também tem segue igual; o que ele não tem fica de fora
  for (const v of n.extras || []) { const o = (p.extras || []).find(x => x.suf === v.suf); if (o) v.txt = o.txt; }
  if (n.de) { n.deOn = !!(p.de && p.deOn); if (p.de) n.deTxt = p.deTxt; }
  if (n.selo) { n.seloOn = !!(p.selo && p.seloOn); if (p.selo) n.seloTxt = p.seloTxt; }
  levarLogo(p, n);
  n.fotos.forEach(im => im.remove());
  n.fotos = p.fotos.map(im => novaFoto(im.dataset.arq, retFoto(im)));
  for (const im of n.fotos) inserirFoto(n, im);
  n.span = op.auto || op.manterSpan ? { ...p.span } : moldeKey === 'normal' ? { c: 1, r: 1 } : spanDoMolde(moldeKey);
  // o horizontal automático lembra de onde veio, pra voltar pro mesmo desenho normal
  if (op.auto && moldeKey !== 'normal') { n.autoH = true; n.origemNormal = origemEstilo(p); }
  // "Voltar pro normal" à mão num card largo: fica normal (o automático não troca de novo)
  if (!op.auto && moldeKey === 'normal') n.fixoNormal = true;
  const estavaSel = S.sel === p;
  p.removido = true; render(p);
  // (o card novo também entra nos vistos: o estado dele numa troca seguinte não pode desfazer a remoção)
  if (op.lote) { op.lote.push({ tipo: 'novo', id: n.id }, ...antes.filter(e => !op.vistos.has(e.id))); antes.forEach(e => op.vistos.add(e.id)); op.vistos.add(n.id); }
  else S.desfazer.push([{ tipo: 'novo', id: n.id }, ...antes]);
  // trocar só o desenho (manterSpan): o card fica na mesma célula e a grade não é refeita. Refazer
  // a grade jogava fora os cards posicionados à mão (Redemais Quarta do Filé, 20/10/2026)
  if (!op.manterSpan) montarGrade(k);
  if (n.fotos.length) arranjar(n, 'auto');
  render(n);
  if (op.auto) { if (estavaSel) selecionarProduto(n); return; }
  mudou(); selecionarProduto(n);
  const hz = S.moldes[moldeKey] && S.moldes[moldeKey].formato === 'horizontal';
  aviso(moldeKey === 'normal' ? 'Voltou a card normal' : hz ? 'Virou horizontal (2×1) · grade por casas' : 'Virou especial (2×2) · grade por casas');
}
// Copiar estilo: o card troca de desenho pelo de outro card do template (cor, contorno, moldura,
// fundo do preço), mantendo nome, preço, selo/DE e fotos. A origem é o card como veio do template
// (ou o card de onde um card novo foi copiado). Destaque do template (PRODUTO_N_ESPECIAL) também
// serve de origem; o card copiado continua normal, com a casa (span) que já tinha.
// Molde de especial de outro arquivo (e1…) não tem card limpo e fica de fora.
function origemEstilo(q) { return q && (S.limpos && S.limpos[q.id] ? q.id : q.moldeDe) || null; }
function copiarEstilo(p, q) { return copiarEstiloDe(p, origemEstilo(q), 'do produto ' + (q && q.rotulo)); }
function copiarEstiloDe(p, orig, de) {
  const k = p.zona;
  if (!k || !orig) { aviso('Esse card não tem estilo pra copiar'); return null; }
  if (origemEstilo(p) === orig) { aviso('Já está com esse estilo'); return p; }
  const antes = produtosDaZona(k).map(estado);
  const num = proximoNum();
  const n = criarProduto('PRODUTO_' + num + '_novo', num, 'normal', orig);
  mudarCelula(n, { ...p.cell }); n.cellAuto = p.cellAuto; n.cellAj = p.cellAj;
  n.zona = k;
  n.nome = p.nome; n.precoTxt = p.precoTxt; n.formatoTxt = p.formatoTxt || n.formatoTxt; n.qtdTxt = p.qtdTxt;
  if (n.tarja && p.tarja) n.tarjaTxt = p.tarjaTxt;
  for (const v of n.extras || []) { const o = (p.extras || []).find(x => x.suf === v.suf); if (o) v.txt = o.txt; }
  if (n.de) { n.deOn = !!(p.de && p.deOn); if (p.de) n.deTxt = p.deTxt; }
  if (p.selo && p.seloOn) { garantirSelo(n); if (n.selo) { n.seloOn = true; n.seloTxt = p.seloTxt; } }
  else if (n.selo) n.seloOn = false;
  levarLogo(p, n);
  n.fotos.forEach(im => im.remove());
  n.fotos = p.fotos.map(im => novaFoto(im.dataset.arq, retFoto(im)));
  for (const im of n.fotos) inserirFoto(n, im);
  n.span = { ...p.span };
  p.removido = true; render(p);
  S.desfazer.push([{ tipo: 'novo', id: n.id }, ...antes]);
  montarGrade(k);
  if (n.fotos.length) arranjar(n, 'auto');
  render(n); mudou(); selecionarProduto(n);
  aviso('Estilo copiado ' + de);
  return n;
}

// Estilos do template (Matheus, 20/10/2026, SMD-1101): o card escolhe o desenho num MODELO do template e no
// formato dele (padrão, horizontal, especial), em vez de copiar de outro produto. Template do construtor:
// um estilo por modelo (data-modelo), com o nome tirado dos arquivos de especial ("<tpl> especial
// [horizontal ]<nome do modelo>.svg"). Template do Illustrator (sem data-modelo): cada card de desenho
// diferente da página é um estilo, só no formato padrão (como era o "Copiar").
function estilosDoTemplate(p) {
  const limpos = Object.keys(S.limpos || {}).filter(id => !/_ESPECIAL/.test(id));
  const comModelo = limpos.some(id => S.limpos[id].getAttribute('data-modelo'));
  if (!comModelo) {
    const pg = paginaDe(p), vistos = new Set();
    return S.produtos.filter(q => !q.removido && paginaDe(q) === pg && origemEstilo(q))
      .filter(q => { const o = origemEstilo(q); if (vistos.has(o)) return false; vistos.add(o); return true; })
      .map(q => ({ id: origemEstilo(q), nome: `Produto ${q.rotulo} · ${String(q.nome || '').replace(/\n/g, ' ').slice(0, 24)}`,
        formatos: [{ k: 'padrao', nome: 'Padrão', orig: origemEstilo(q) }] }));
  }
  const nomes = {}, mold = {};
  for (const [key, m] of Object.entries(S.moldes || {})) {
    const dm = key !== 'normal' && m.getAttribute && m.getAttribute('data-modelo'); if (!dm) continue;
    (mold[dm] = mold[dm] || {})[m.formato === 'horizontal' ? 'h' : 'e'] = key;
    const r = String(m.nome || '').match(/especial (?:horizontal )?(.+)$/i); if (r && !nomes[dm]) nomes[dm] = r[1];
  }
  const dms = [...new Set([...limpos.map(id => S.limpos[id].getAttribute('data-modelo')).filter(Boolean), ...Object.keys(mold)])].sort((a, b) => a - b);
  return dms.map(dm => {
    const normal = limpos.find(id => S.limpos[id].getAttribute('data-modelo') === dm && S.limpos[id].getAttribute('data-formato') !== 'horizontal');
    const fs = [];
    if (normal) fs.push({ k: 'padrao', nome: 'Padrão', orig: normal });
    if (mold[dm] && mold[dm].h) fs.push({ k: 'horizontal', nome: 'Horizontal (2×1)', molde: mold[dm].h });
    if (mold[dm] && mold[dm].e) fs.push({ k: 'especial', nome: 'Especial (2×2)', molde: mold[dm].e });
    return { id: 'm' + dm, nome: nomes[dm] || 'Modelo ' + dm, formatos: fs };
  }).filter(e => e.formatos.length);
}
// estilo e formato em que o card está agora (pra marcar no seletor)
function estiloAtual(p) {
  const dm = p.g.getAttribute('data-modelo');
  const fmt = p.molde !== 'normal' ? (S.moldes[p.molde] && S.moldes[p.molde].formato === 'horizontal' ? 'horizontal' : 'especial')
    : p.desenho === 'horizontal' ? 'horizontal' : 'padrao';
  return { id: dm ? 'm' + dm : origemEstilo(p), fmt };
}
function painelEstilo(p) {
  const es = p.zona ? estilosDoTemplate(p) : [], at = estiloAtual(p), sel = $('#pp-estilo-de');
  $('#pp-estilo-box').classList.toggle('oculto', !es.length);
  $('#pp-formato-box').classList.toggle('oculto', !es.length);
  // com estilo do template o Formato já vira especial/horizontal: a linha Especial antiga sai
  $('#pp-esp-box').classList.toggle('oculto', !!es.length || !Object.keys(S.moldes || {}).some(x => x !== 'normal'));
  if (!es.length) return;
  const antes = sel.dataset.p === p.id ? sel.value : null;
  sel.replaceChildren(...es.map(e => { const o = document.createElement('option'); o.value = e.id; o.textContent = e.nome; return o; }));
  sel.value = es.some(e => e.id === antes) ? antes : es.some(e => e.id === at.id) ? at.id : es[0].id;
  sel.dataset.p = p.id;
  const e = es.find(x => x.id === sel.value), fsel = $('#pp-estilo-formato'), fAntes = fsel.dataset.p === p.id + sel.value ? fsel.value : null;
  fsel.replaceChildren(...e.formatos.map(f => { const o = document.createElement('option'); o.value = f.k; o.textContent = f.nome; return o; }));
  fsel.value = e.formatos.some(f => f.k === fAntes) ? fAntes : e.formatos.some(f => f.k === at.fmt) ? at.fmt : e.formatos[0].k;
  fsel.dataset.p = p.id + sel.value;
}
// automação: aplicarEstilo(p, 'Card 3 colunas' | 'm2', 'padrao'|'horizontal'|'especial')
function aplicarEstilo(p, estilo, formato) {
  if (!p || !p.zona) return null;
  const es = estilosDoTemplate(p);
  const e = es.find(x => x.id === estilo || x.nome === estilo); if (!e) { aviso('Estilo não encontrado'); return null; }
  const f = e.formatos.find(x => x.k === (formato || 'padrao')) || e.formatos[0];
  const at = estiloAtual(p);
  if (at.id === e.id && at.fmt === f.k) { aviso('Já está com esse estilo'); return p; }
  // trocar o estilo/formato só troca o desenho: o card fica com as casas que já tinha e a grade não
  // se reorganiza (Matheus, 20/10/2026: "mudo pra padrão e quebra a estrutura toda"). Pra mudar o
  // tamanho, as casas largura/altura do painel.
  if (f.molde) { trocarMolde(p, f.molde, { manterSpan: true }); return S.sel; }
  // padrão: card que está horizontal/especial volta pelo trocarMolde; normal troca só o desenho
  if (p.molde !== 'normal' || p.desenho === 'horizontal') { trocarMolde(p, 'normal', { moldeDe: f.orig, manterSpan: true }); return S.sel; }
  return copiarEstiloDe(p, f.orig, 'de ' + e.nome);
}
$('#pp-estilo-de').onchange = () => { if (S.sel) painelEstilo(S.sel); };
$('#pp-estilo-copiar').onclick = () => { if (S.sel) aplicarEstilo(S.sel, $('#pp-estilo-de').value, $('#pp-estilo-formato').value); };

$('#pp-esp-virar').onclick = () => { if (S.sel) trocarMolde(S.sel, $('#pp-esp-molde').value); };
$('#pp-esp-normal').onclick = () => { if (S.sel) trocarMolde(S.sel, 'normal'); };
document.addEventListener('click', e => {
  const b = e.target.closest('[data-span]'); if (!b || !S.sel) return;
  const [c, r] = b.dataset.span.split('x').map(Number);
  const k = S.sel.zona; if (!k) return;
  marcar(...produtosDaZona(k));
  S.sel.span = { c, r }; montarGrade(k); mudou(); painel();
});
// +1 / −1 casa por produto (largura ou altura): quem fica largo é escolha, não a sobra da grade
document.addEventListener('click', e => {
  const b = e.target.closest('[data-casa]'); if (!b || !S.sel) return;
  const k = S.sel.zona, g = k && S.grades[k]; if (!g) return;
  // de meia em meia casa (1 · 1,5 · 2 · 2,5…), pedido do Matheus 20/10/2026
  const [eixo, d] = b.dataset.casa.split(':'), max = eixo === 'c' ? Math.max(1, g.colunas) : 4;
  const v = Math.min(max, Math.max(1, S.sel.span[eixo] + Number(d) / 2));
  if (v === S.sel.span[eixo]) return;
  marcar(...produtosDaZona(k));
  S.sel.span = { ...S.sel.span, [eixo]: v }; montarGrade(k); mudou(); painel();
});

// ---------------------------------------------------------------- tamanho em pt (1 unidade do SVG = 1 pt do Illustrator)
// nome na tarja: a fonte também leva o ajuste da tarja à célula
function kNome(p) { return nomeNaTarja(p) ? fatorTarja(p) : 1; }
function ptNome(p) { return p.base.nome ? p.base.nome.fonte * p.escNome * kNome(p) * (p.encolheu || 1) : 0; }
// preço dividido: vale o tamanho do real
function basePreco(p) { return p.base.preco || p.base.real || null; }
function ptPreco(p) { const b = basePreco(p); return b ? b.fonte * p.escPreco * fatorTarja(p) * fatorLarguraPreco(p) : 0; }
function ptQtd(p) { return p.base.qtd ? p.base.qtd.fonte * (p.qtdEsc || 1) : 0; }
function fmtPt(v) { return (Math.round(v * 10) / 10).toString().replace('.', ','); }
function mostrarPt() {
  const p = S.bloco ? S.bloco.p : S.sel; if (!p) return;
  for (const [id, v] of [['#pt-nome', ptNome(p)], ['#pt-preco', ptPreco(p)], ['#pb-pt', S.bloco ? (S.bloco.tipo === 'preco' ? ptPreco(p) : S.bloco.tipo === 'qtd' ? ptQtd(p) : ptNome(p)) : 0]]) {
    const inp = $(id); if (inp && document.activeElement !== inp) inp.value = fmtPt(v);
  }
  $$('.nl-val').forEach(e => { e.textContent = p.nomeLinhas ? String(p.nomeLinhas) : 'auto'; });
  const esc = { fundoW: p.fundoW, fundoH: p.fundoH, caixa: p.nomeCaixa, entre: p.nomeEntre, real: p.escReal, cent: p.escCent, logo: p.logoEsc };
  $$('#painel [data-v]').forEach(e => { const k = e.dataset.v; const v = k in esc ? esc[k] : p[k + 'Esc']; e.textContent = Math.round((v || 1) * 100) + '%'; });
  const av = $('#pt-aviso');
  if (av) av.textContent = p.encolheu && p.encolheu < 0.999 ? `o nome encolheu pra caber (pedido ${fmtPt(p.base.nome.fonte * p.escNome)} pt)`
    : p.encolheu > 1.001 ? `título nunca abaixo de ${PISO_PT} pt (pedido ${fmtPt(p.base.nome.fonte * p.escNome)} pt)` : '';
}
function definirPt(tipo, valor) {
  const ps = S.bloco ? blocoPs() : S.sel ? [S.sel] : []; if (!ps.length) return;
  const v = parseFloat(String(valor).replace(',', '.')); if (!(v > 0)) return;
  marcar(...ps);
  for (const p of ps) {
    if (tipo === 'nome' && p.base.nome) p.escNome = v / (p.base.nome.fonte * kNome(p));
    if (tipo === 'preco' && basePreco(p)) p.escPreco = v / (basePreco(p).fonte * fatorTarja(p) * fatorLarguraPreco(p));
    if (tipo === 'qtd' && p.base.qtd) p.qtdEsc = v / p.base.qtd.fonte;
    render(p);
  }
  mudou(); mostrarPt();
}
document.addEventListener('change', e => {
  if (e.target.name === 'nome-alinha' && S.bloco) {
    const ps = blocoPs(); marcar(...ps);
    for (const p of ps) { p.nomeAlinha = e.target.value || null; render(p); }
    mudou();
  }
  if (e.target.id === 'pt-nome') definirPt('nome', e.target.value);
  if (e.target.id === 'pt-preco') definirPt('preco', e.target.value);
  if (e.target.id === 'pb-pt' && S.bloco) definirPt(S.bloco.tipo === 'preco' || S.bloco.tipo === 'qtd' ? S.bloco.tipo : 'nome', e.target.value);
});

// ---------------------------------------------------------------- textos da arte
function textosIguais(tx) { return S.textos.filter(t => t.orig === tx.orig); }
function editarTexto(fn) {
  const tx = S.selTexto; if (!tx) return;
  const alvos = $('#ft-todas').checked ? textosIguais(tx) : [tx];
  for (const t of alvos) { fn(t); conferirTexto(t); t.mexido = textoMexido(t); renderTexto(t); posTexto(t); }
  mudou(); desenharSelecao(); painel();
}
// mover/tamanho valem só pro texto tocado (cada página tem o seu lugar)
function mexerTexto(dx, dy, k) {
  const tx = S.selTexto; if (!tx) return;
  marcar(tx);
  tx.dx += dx; tx.dy += dy; if (k) tx.esc = Math.max(0.2, Math.round(tx.esc * k * 1000) / 1000);
  tx.mexido = textoMexido(tx); posTexto(tx); desenharSelecao(); mudou();
}
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-tx]'); if (!b) return;
  const [o, v] = b.dataset.tx.split(':'), n = +v;
  if (o === 'x') mexerTexto(n, 0); else if (o === 'y') mexerTexto(0, n); else if (o === 'esc') mexerTexto(0, 0, n > 0 ? 1.04 : 1 / 1.04);
});
$('#ft-texto').addEventListener('focus', () => { if (S.selTexto) marcar(...($('#ft-todas').checked ? textosIguais(S.selTexto) : [S.selTexto])); });
$('#ft-texto').addEventListener('input', e => editarTexto(t => { t.linhas = e.target.value; }));
$$('input[name="alinha"]').forEach(r => r.addEventListener('change', () => {
  marcar(...textosIguais(S.selTexto));
  editarTexto(t => { t.ancora = r.value; });
}));
$('#ft-zerar').onclick = () => {
  marcar(...textosIguais(S.selTexto));
  editarTexto(t => { t.linhas = t.orig; t.ancora = t.ancoraOrig; t.dx = 0; t.dy = 0; t.esc = 1; });
  painel();
};

// ---------------------------------------------------------------- fundo da página
function paginasFundo() { return $('#pf-todas').checked ? S.paginas.map((_, i) => i).filter(i => S.paginas[i].fundo) : [S.selFundo]; }
// pasta pra procurar/enviar o fundo: a da imagem da página (fundo embutido no SVG não tem arquivo: usa a do template)
function pastaFundo(i) {
  const f = S.paginas[i] && S.paginas[i].fundo;
  return pastaDe((f && f.dataset.arqOrig) || (S.template && S.template.svg) || '');
}
function trocarFundo(arq) {
  const ps = paginasFundo();
  marcar(...ps.map(i => ({ fundo: i })));
  for (const i of ps) aplicarFundo(i, arq);
  mudou(); painel(); fecharSheets();
}
$('#bt-fundo').onclick = () => { limparSelecao(); S.selFundo = S.pagina; painel(); };
$('#pf-zerar').onclick = () => {
  const ps = paginasFundo(); marcar(...ps.map(i => ({ fundo: i })));
  for (const i of ps) if (S.paginas[i].fundo) aplicarFundo(i, S.paginas[i].fundo.dataset.arqOrig);
  mudou(); painel();
};
$('#pf-pasta').onclick = async () => {
  if (!S.paginas[S.selFundo].fundo) return;
  const dir = pastaFundo(S.selFundo);
  abrirSheet('sh-pasta');
  $('#pa-dir').textContent = dir;
  $('#pa-res').innerHTML = '<p class="dica">carregando…</p>';
  const r = await apiJson('/pasta?p=' + encodeURIComponent(dir)).catch(() => null);
  const box = $('#pa-res'); box.innerHTML = r && r.arquivos.length ? '' : '<p class="dica">Nenhuma imagem nessa pasta.</p>';
  for (const arq of (r ? r.arquivos : [])) {
    const d = document.createElement('div'); d.className = 'foto';
    d.innerHTML = '<img loading="lazy" alt=""><span></span>';
    d.querySelector('img').src = urlImg(arq, 300);
    d.querySelector('span').textContent = nomeArq(arq);
    d.onclick = () => trocarFundo(arq);
    box.appendChild(d);
  }
};
$('#pf-enviar').onclick = () => escolherArquivo(async file => {
  if (!S.paginas[S.selFundo].fundo) return;
  const arq = await enviar(file, pastaFundo(S.selFundo), file.name);
  if (arq) trocarFundo(arq);
});

// ---------------------------------------------------------------- fotos
function escalarFoto(im, k) {
  const r = retFoto(im), cx = r.x + r.w / 2, base = r.y + r.h;
  posFoto(im, { x: cx - r.w * k / 2, y: base - r.h * k, w: r.w * k, h: r.h * k });
}

function proporcao(arq, fallback) {
  return new Promise(res => {
    const i = new Image();
    i.onload = () => res(i.naturalWidth / i.naturalHeight);
    i.onerror = () => res(fallback || 1);
    i.src = urlImg(arq, 200);
  });
}

// ---- padrão do cliente pras fotos e pra tarja (padroes_mercado.json → imagem / preco.estreito)
// J Meroto Terça da Feira, medido das correções do Matheus em 06/10/2026: 2 cópias em diagonal,
// cada uma até 1,4× a largura do card; a de trás sobe ~19% da altura acima do topo (~8,5% na
// última linha), a da frente termina ~17% acima do pé, entrando atrás da tarja.
function arranjoPadrao() { const I = S.padrao && S.padrao.imagem; return I && (I.arranjo === 'diagonal' || I.arranjo === 'misto') ? I : null; }
// arranjo "misto" (Rigoni): foto larga (carne na bandeja, pacote deitado) empilha em diagonal;
// embalagem em pé (leite, refrigerante, caixa) fica lado a lado
function usaDiagonal(p, I) {
  if (!I || I.arranjo === 'diagonal') return !!I;
  const r = p.fotos.length ? (() => { const f = retFoto(p.fotos[0]); return f.w / f.h; })() : 1;
  return r >= (typeof I.larga_a_partir === 'number' ? I.larga_a_partir : 1.2);
}
function ultimaLinha(p) {
  return !S.produtos.some(q => q !== p && !q.removido && q.zona === p.zona && q.cell.y > p.cell.y + p.cell.h * 0.5);
}
// pé da foto no padrão: "ate_nome" = em cima do nome; "ate_preco" = até o pé do fundo do preço
// (Rigoni, 06/10/2026: a foto não pode passar da parte de baixo do selo de preço)
function peDaFaixa(p, I) {
  if (!I || p.nomeTopo == null || p.nomeTopo <= p.cell.y + 20) return null;
  if (I.faixa === 'ate_preco' && p.fundo) {
    const r = retSvgBBox(p.fundo), pe = r.y + r.h;
    if (r.h > 0 && pe > p.cell.y + 20) return Math.min(pe, p.nomeTopo);
  }
  return I.faixa === 'ate_nome' || I.faixa === 'ate_preco' ? p.nomeTopo : null;
}
function diagonalCheia(p, I) {
  const c = p.cell; if (!p.fotos.length) return;
  const num = (v, pad) => (typeof v === 'number' ? v : pad);
  const sobe = c.h * (ultimaLinha(p) ? num(I.sobe_ultima_linha, 0.085) : num(I.sobe, 0.19));
  let topo = c.y - sobe, base = c.y + c.h - c.h * num(I.acima_do_pe, 0.17);
  // faixa até o nome (Rigoni): a pilha vai do topo do card até em cima do nome
  const pe = peDaFaixa(p, I);
  if (pe != null) { topo = c.y - sobe; base = pe; }
  const span = base - topo;
  const rs = p.fotos.map(im => { const r = retFoto(im); return r.w / r.h; });
  if (p.fotos.length === 1) { // uma cópia (ovos, melão): ocupa a faixa toda, centrada
    const maxW = c.w * num(I.largura_uma, 1.25), r = rs[0];
    let h = span, w = h * r; if (w > maxW) { w = maxW; h = w / r; }
    posFoto(p.fotos[0], { x: c.x + (c.w - w) / 2, y: base - h, w, h });
    return;
  }
  p.fotos.slice(2).forEach(im => im.remove()); relerFotos(p);
  const [tras, frente] = p.fotos;
  // card largo (linha de 3): a segunda vai mais pro lado do que pra baixo
  const larga = c.w > c.h * 1.05;
  const dy = span * (larga ? num(I.passo_y_largo, 0.14) : num(I.passo_y, 0.3));
  const dx = c.w * (larga ? num(I.passo_x_largo, 0.22) : num(I.passo_x, 0.2)) * (I.frente === 'direita' ? 1 : -1);
  // no card largo cada cópia fica menor que o card (abóbora/banana terra ~0,85–0,9×); no estreito passa dele
  const maxW = c.w * (larga ? num(I.largura_max_largo, 0.95) : num(I.largura_max, 1.4));
  const tam = r => { let h = span - dy, w = h * r; if (w > maxW) { w = maxW; h = w / r; } return { w, h }; };
  const t = tam(rs[0]), f = tam(rs[1]);
  // centros: a da frente fica dx pro lado da de trás; o par fica centrado no card
  const L = Math.min(-t.w / 2, dx - f.w / 2), R = Math.max(t.w / 2, dx + f.w / 2), cx = c.x + c.w / 2 - (L + R) / 2;
  posFoto(tras, { x: cx - t.w / 2, y: topo, ...t });
  posFoto(frente, { x: cx + dx - f.w / 2, y: base - f.h, ...f });
  tras.after(frente); relerFotos(p); // a de baixo fica NA FRENTE
}
// tarja dos cards estreitos (linha de 4): um pouco mais larga/alta e o nome com mais espaço.
// Só troca o que ainda está no valor padrão, pra não desfazer ajuste feito na mão.
function padraoCard(p) {
  const E = S.padrao && S.padrao.preco && S.padrao.preco.estreito; if (!E) return;
  const estreito = p.cell.w <= (E.ate_largura || 240);
  const alvo = estreito ? { fundoW: E.fundoW || 1, fundoH: E.fundoH || 1, nomeCaixa: E.nomeCaixa || 1 } : { fundoW: 1, fundoH: 1, nomeCaixa: 1 };
  const outro = estreito ? { fundoW: 1, fundoH: 1, nomeCaixa: 1 } : { fundoW: E.fundoW || 1, fundoH: E.fundoH || 1, nomeCaixa: E.nomeCaixa || 1 };
  for (const k in alvo) if (p[k] === outro[k]) p[k] = alvo[k];
}

// Foto mexida à mão × foto do arranjo: o arranjo guarda onde deixou as fotos (p.fotosAuto); se elas ainda
// estão lá, a foto é "do arranjo" e, quando o template muda a área, volta pro encaixe automático na área
// nova. Mexida à mão (arrastar, setas, escala, distribuir…), ela segue a área na mesma posição relativa.
function assinaturaFotos(p) { return p.fotos.map(im => { const r = retFoto(im); return [r.x, r.y, r.w, r.h].map(arred); }); }
function fotosDoArranjo(p) {
  const A = p.fotosAuto; if (!A || !p.fotos.length) return false;
  const B = assinaturaFotos(p);
  return A.ims.length === B.length && A.ims.every((im, i) => im === p.fotos[i]) && A.r.every((r, i) => r.every((v, k) => Math.abs(v - B[i][k]) < 0.5));
}
function marcarArranjo(p, tipo) { p.fotosAuto = { tipo, ims: [...p.fotos], r: assinaturaFotos(p) }; }
function arranjar(p, tipo) {
  const r = arranjarSo(p, tipo);
  // expandir mantém o desenho que está no card: não vira arranjo automático
  if (tipo !== 'expandir') marcarArranjo(p, tipo); else if (p.fotosAuto) marcarArranjo(p, p.fotosAuto.tipo);
  return r;
}
function arranjarSo(p, tipo) {
  // 'auto' = o que o editor faz sozinho (grade mudou, foto nova, lista): segue o padrão do cliente
  if (tipo === 'auto') { padraoCard(p); const I = arranjoPadrao(); if (I && p.fotos.length && usaDiagonal(p, I)) return diagonalCheia(p, I); tipo = 'lado'; }
  if (tipo === 'diagonal' && arranjoPadrao() && p.fotos.length >= 2) return diagonalCheia(p, arranjoPadrao());
  // padrão imagem.faixa = "ate_nome" (Rigoni): a foto ocupa o card do topo até o nome, e o selo de
  // preço fica por cima da parte de baixo dela; sem isso vale a área desenhada no template
  const Ip = S.padrao && S.padrao.imagem;
  let A = p.area;
  const pe = peDaFaixa(p, Ip);
  if (pe != null) {
    const folga = p.cell.w * 0.03;
    A = { x: p.cell.x + folga, y: p.cell.y + folga, w: p.cell.w - 2 * folga, h: pe - p.cell.y - folga };
  }
  const fs = p.fotos;
  if (!fs.length) return;
  const rs = fs.map(im => { const r = retFoto(im); return r.w / r.h; });
  // alinhamento do template (construtor) vale na área desenhada; na faixa até o nome, não
  const al = A === p.area ? p.fotoAlinha : null;
  const xAl = (w, padrao) => !al ? padrao : al.x === 'esq' ? A.x : al.x === 'dir' ? A.x + A.w - w : A.x + (A.w - w) / 2;
  const yAl = (h, padrao) => !al ? padrao : al.y === 'cima' ? A.y : al.y === 'baixo' ? A.y + A.h - h : A.y + (A.h - h) / 2;
  if (tipo === 'expandir') {
    // Expandir (pedido do Matheus, 17/10/2026): o arranjo que está no card (posição e tamanho de cada
    // foto em relação às outras) fica igual; o conjunto inteiro cresce ou encolhe na mesma proporção até
    // a caixa que envolve as fotos encostar na largura OU na altura da área, o que vier primeiro, e
    // assenta pelo alinhamento do template (sem ele: embaixo no centro). Uma foto só = maior possível.
    const rr = fs.map(retFoto);
    const x0 = Math.min(...rr.map(r => r.x)), y0 = Math.min(...rr.map(r => r.y));
    const uw = Math.max(...rr.map(r => r.x + r.w)) - x0, uh = Math.max(...rr.map(r => r.y + r.h)) - y0;
    if (!(uw > 0 && uh > 0)) return;
    const k = Math.min(A.w / uw, A.h / uh), W = uw * k, H = uh * k;
    const X = xAl(W, A.x + (A.w - W) / 2), Y = yAl(H, A.y + A.h - H);
    fs.forEach((im, i) => posFoto(im, { x: X + (rr[i].x - x0) * k, y: Y + (rr[i].y - y0) * k, w: rr[i].w * k, h: rr[i].h * k }));
    return;
  }
  if (tipo === 'uma') {
    fs.slice(1).forEach(im => im.remove()); relerFotos(p);
    const r = rs[0]; let w = A.w, h = w / r; if (h > A.h) { h = A.h; w = h * r; }
    posFoto(p.fotos[0], { x: xAl(w, A.x + (A.w - w) / 2), y: yAl(h, A.y + A.h - h), w, h });
    return;
  }
  if (tipo === 'diagonal' && fs.length >= 2) {
    // regra aprovada (invertida pelo Matheus em 11/10/2026, SMD-795): a de trás em cima à direita,
    // a da frente embaixo à esquerda, longe do preço; a de baixo fica NA FRENTE (última no DOM)
    const [tras, frente] = [fs[0], fs[1]];
    fs.slice(2).forEach(im => im.remove());
    const larg = (r) => { let w = A.w * 0.72, h = w / r; if (h > A.h * 0.72) { h = A.h * 0.72; w = h * r; } return { w, h }; };
    const t = larg(rs[0]), f = larg(rs[1]);
    posFoto(tras, { x: A.x + A.w - t.w, y: A.y + A.h * 0.03, ...t });
    posFoto(frente, { x: A.x, y: A.y + A.h - f.h, ...f });
    tras.after(frente); relerFotos(p);
    return;
  }
  // lado a lado: mesma altura, base alinhada, sobrepõe se não couber
  const n = fs.length;
  let h = Math.min(A.h, A.w / Math.max(...rs));
  const somaW = hh => rs.reduce((s, r) => s + r * hh, 0);
  // quanto uma cópia pode cobrir a outra: passo mínimo entre elas, em fração da largura da foto
  // (padrão imagem.passo_min; Rigoni sobrepõe bastante = 0,35)
  const passoMin = Ip && typeof Ip.passo_min === 'number' ? Ip.passo_min : 0.55;
  if (n > 1) {
    while (h > A.h * 0.4) {
      const ws = rs.map(r => r * h), media = somaW(h) / n;
      const passo = (A.w - ws[n - 1]) / (n - 1);
      if (somaW(h) <= A.w || passo >= media * passoMin) break;
      h *= 0.96;
    }
  }
  const w = rs.map(r => r * h), total = somaW(h);
  let x = total <= A.w ? xAl(total, A.x + (A.w - total) / 2) : A.x;
  const passoSobre = n > 1 ? (A.w - w[n - 1]) / (n - 1) : 0;
  // centraliza na faixa (em célula alta não fica tudo grudado embaixo); na faixa até o nome a foto
  // assenta em cima do nome
  const y = A !== p.area ? A.y + A.h - h : yAl(h, A.y + (A.h - h) / 2);
  fs.forEach((im, i) => {
    posFoto(im, { x, y, w: w[i], h });
    x += total <= A.w ? w[i] : passoSobre;
  });
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-arranjo]'); if (!b) return;
  const alvos = [...S.selProds]; if (!alvos.length) return;
  marcar(...alvos); for (const p of alvos) arranjar(p, b.dataset.arranjo); mudou();
});

function duplicarFoto() {
  if (S.selImgs.length !== 1) return;
  const im = S.selImgs[0], p = prodDe(im);
  marcar(p);
  const c = novaFoto(im.dataset.arq, retFoto(im));
  inserirFoto(p, c, p.fotos[p.fotos.length - 1]); relerFotos(p);
  // a diagonal do padrão fica só com 2 cópias e apagaria a nova: da 3ª em diante a cópia nasce
  // um pouco deslocada da original, pra mexer à mão (igual Alt+arrastar)
  const I = arranjoPadrao();
  if (I && p.fotos.length > 2 && usaDiagonal(p, I)) {
    const r = retFoto(im), d = p.cell.w * 0.06;
    posFoto(c, { ...r, x: r.x + d, y: r.y + d });
  } else arranjar(p, 'auto');
  S.selImgs = [c]; mudou(); painel();
}
function apagarFotos() {
  if (!S.selImgs.length) return;
  const ps = [...new Set(S.selImgs.map(prodDe))];
  marcar(...ps); S.selImgs.forEach(im => im.remove()); ps.forEach(relerFotos);
  S.selImgs = []; mudou(); painel();
}
// tudo = vai direto pra frente de todas (ou pra trás de todas) as fotos do card
function moverZ(frente, tudo) {
  if (!S.selImgs.length) return;
  marcar(...new Set(S.selImgs.map(prodDe)));
  for (const im of S.selImgs) {
    const p = prodDe(im), i = p.fotos.indexOf(im), ult = p.fotos.length - 1;
    if (frente && i < ult) p.fotos[tudo ? ult : i + 1].after(im);
    if (!frente && i > 0) p.fotos[tudo ? 0 : i - 1].before(im);
    relerFotos(p);
  }
  mudou();
}
async function endireitar() {
  marcar(...new Set(S.selImgs.map(prodDe)));
  for (const im of S.selImgs) {
    const r = retFoto(im), k = await proporcao(im.dataset.arq, r.w / r.h);
    const w = r.h * k;
    posFoto(im, { x: r.x + (r.w - w) / 2, y: r.y, w, h: r.h });
  }
  mudou();
}
function escalarSel(k) { marcar(...new Set(S.selImgs.map(prodDe))); S.selImgs.forEach(im => escalarFoto(im, k)); mudou(); }

// Distribuir (o do Illustrator): mesma distância entre os centros, podendo uma ficar por cima da
// outra. Vale pras fotos selecionadas, card por card; com uma só selecionada, pra todas do card.
function gruposFotosDistribuir() {
  const sel = S.selImgs.length === 1 ? prodDe(S.selImgs[0]).fotos : S.selImgs;
  const g = new Map();
  for (const im of sel) { const p = prodDe(im); if (!g.has(p)) g.set(p, []); g.get(p).push(im); }
  return [...g.entries()].filter(([, ims]) => ims.length >= 2);
}
const centroFoto = (r, eixo) => eixo === 'x' ? r.x + r.w / 2 : r.y + r.h / 2;
function moverCentroFoto(im, eixo, c) {
  const r = retFoto(im);
  posFoto(im, eixo === 'x' ? { ...r, x: c - r.w / 2 } : { ...r, y: c - r.h / 2 });
}
// a 1ª e a última ficam onde estão; as do meio se espalham por igual
function distribuirFotos(eixo) {
  const gs = gruposFotosDistribuir(); if (!gs.length) return;
  marcar(...gs.map(([p]) => p));
  for (const [, ims] of gs) {
    const ord = ims.map(im => ({ im, c: centroFoto(retFoto(im), eixo) })).sort((a, b) => a.c - b.c);
    const c0 = ord[0].c, passo = (ord[ord.length - 1].c - c0) / (ord.length - 1);
    ord.forEach((o, i) => moverCentroFoto(o.im, eixo, c0 + passo * i));
  }
  mudou();
}
// juntar/afastar: muda o passo entre os centros (igual pra todas) sem tirar o grupo do lugar
function espacarFotos(k) {
  const gs = gruposFotosDistribuir(); if (!gs.length) return;
  marcar(...gs.map(([p]) => p));
  for (const [, ims] of gs) {
    const rs = ims.map(im => retFoto(im));
    // eixo de quem está mais espalhado (fotos lado a lado = x; empilhadas = y)
    const faixa = e => Math.max(...rs.map(r => centroFoto(r, e))) - Math.min(...rs.map(r => centroFoto(r, e)));
    const eixo = faixa('x') >= faixa('y') ? 'x' : 'y';
    const ord = ims.map((im, i) => ({ im, c: centroFoto(rs[i], eixo) })).sort((a, b) => a.c - b.c);
    const tam = rs.reduce((s, r) => s + (eixo === 'x' ? r.w : r.h), 0) / rs.length;
    const meio = (ord[0].c + ord[ord.length - 1].c) / 2;
    const passo = Math.max(0, (ord[ord.length - 1].c - ord[0].c) / (ord.length - 1) + k * tam);
    ord.forEach((o, i) => moverCentroFoto(o.im, eixo, meio + passo * (i - (ord.length - 1) / 2)));
  }
  mudou();
}
$('#pi-dist-x').onclick = () => distribuirFotos('x');
$('#pi-dist-y').onclick = () => distribuirFotos('y');
$('#pi-juntar').onclick = () => espacarFotos(-0.05);
$('#pi-afastar').onclick = () => espacarFotos(0.05);
$('#pi-duplicar').onclick = duplicarFoto;
$('#pi-apagar').onclick = apagarFotos;
$('#pi-frente').onclick = () => moverZ(true);
$('#pi-tras').onclick = () => moverZ(false);
$('#pi-maior').onclick = () => escalarSel(1.06);
$('#pi-menor').onclick = () => escalarSel(1 / 1.06);
$('#pi-endireitar').onclick = endireitar;
$('#pi-trocar').onclick = () => abrirBusca('trocar');
$('#pp-add-foto').onclick = () => abrirBusca('adicionar');

async function usarFoto(arq, modo) {
  const k = await proporcao(arq);
  if (modo === 'trocar' && S.selImgs.length) {
    marcar(...new Set(S.selImgs.map(prodDe)));
    for (const im of S.selImgs) {
      const r = retFoto(im), w = r.h * k; // mantém a altura e o centro
      im.dataset.arq = arq; setHref(im, urlImg(arq)); delete im.dataset.erro;
      posFoto(im, { x: r.x + (r.w - w) / 2, y: r.y, w, h: r.h });
    }
  } else {
    const p = S.sel; if (!p) return;
    marcar(p);
    const h = p.area.h * 0.8;
    const im = novaFoto(arq, { x: p.area.x, y: p.area.y + p.area.h - h, w: h * k, h });
    inserirFoto(p, im, p.fotos[p.fotos.length - 1]); relerFotos(p);
    const I = arranjoPadrao(); // diagonal do padrão = 2 cópias; da 3ª em diante não rearranja (apagaria a nova)
    if (!(I && p.fotos.length > 2 && usaDiagonal(p, I))) arranjar(p, 'auto');
    S.selImgs = [im];
  }
  lembrar('recentes', arq);
  mudou(); painel(); fecharSheets();
}

// ---------------------------------------------------------------- banco de fotos (busca do painel)
async function carregarIndice(forcar) {
  if (S.indice && !forcar) return S.indice;
  let d;
  try { d = await apiJson('/indice'); }
  catch (e) {
    if (e.message !== 'sessao') aviso('Não consegui carregar o banco de fotos', 4000);
    S.indice = S.indice || []; return S.indice;
  }
  S.raizBanco = String(d.raiz || '').replace(/\\/g, '/').replace(/\/$/, '');
  S.indice = (d.arquivos || []).map(([pasta, rel]) => itemBanco(pasta, rel));
  return S.indice;
}
function itemBanco(pasta, rel) {
  return window.SomadoBusca.prepararItem({ pasta, rel, nome: rel.split('/').pop(), arq: S.raizBanco + '/' + rel });
}
function lembrar(lista, arq) {
  let l = guardar.ler(lista, []).filter(a => a !== arq);
  l.unshift(arq); if (lista === 'recentes') l = l.slice(0, 40);
  guardar.pôr(lista, l);
}
let abaBusca = 'busca', modoBusca = 'trocar';
function abrirBusca(modo) {
  modoBusca = modo; abrirSheet('sh-busca');
  $('#bq-envio').classList.add('oculto'); fecharRecorte();
  carregarIndice().then(() => mostrarBusca());
  const q = $('#bq-q');
  if (modo === 'trocar' && S.selImgs.length) q.value = nomeArq(S.selImgs[0].dataset.arq).toLowerCase();
  if (modo === 'adicionar' && S.sel) q.value = (S.sel.nome || '').replace(/\n/g, ' ').toLowerCase();
  setTimeout(() => q.select(), 50);
}
function mostrarBusca() {
  const box = $('#bq-res');
  let arqs;
  if (abaBusca === 'internet') return mostrarInternet();
  if (abaBusca === 'busca') {
    const q = $('#bq-q').value.trim();
    arqs = q ? window.SomadoBusca.buscar(q, S.indice || [], { limite: 60 }).map(r => r.item.arq) : [];
  } else arqs = guardar.ler(abaBusca, []);
  const favs = new Set(guardar.ler('favoritos', []));
  box.innerHTML = arqs.length ? '' : '<p class="dica">Nada aqui.</p>';
  for (const arq of arqs) {
    const d = document.createElement('div'); d.className = 'foto';
    d.innerHTML = `<img loading="lazy" alt=""><span></span><button class="estrela ${favs.has(arq) ? 'on' : ''}">★</button>`;
    d.querySelector('img').src = urlImg(arq, 200);
    d.querySelector('span').textContent = nomeArq(arq);
    d.addEventListener('click', ev => {
      if (ev.target.closest('.estrela')) {
        const l = guardar.ler('favoritos', []);
        guardar.pôr('favoritos', l.includes(arq) ? l.filter(a => a !== arq) : [arq, ...l]);
        ev.target.classList.toggle('on'); return;
      }
      usarFoto(arq, modoBusca);
    });
    box.appendChild(d);
  }
}
$('#bq-q').addEventListener('input', () => { clearTimeout(mostrarBusca.t); mostrarBusca.t = setTimeout(mostrarBusca, abaBusca === 'internet' ? 600 : 150); });
$$('#sh-busca .aba').forEach(b => b.onclick = () => {
  abaBusca = b.dataset.aba; $$('#sh-busca .aba').forEach(x => x.classList.toggle('ativa', x === b));
  $('#bq-q').classList.toggle('oculto', abaBusca !== 'busca' && abaBusca !== 'internet');
  $('#bq-net-status').classList.toggle('oculto', abaBusca !== 'internet');
  $('#bq-q').placeholder = abaBusca === 'internet' ? 'ex.: arroz 5kg, ou cole o link da foto' : 'ex.: arroz 5kg';
  if (abaBusca !== 'internet') fecharRecorte();
  mostrarBusca();
});
// o espelho do Drive roda no servidor (cron): aqui só pede e recarrega o índice depois
let tReindexar = null;
$('#bq-reindexar').onclick = async () => {
  const r = await apiJson('/reindexar', { method: 'POST' }).catch(() => null);
  if (!r) return aviso('Não consegui pedir a atualização do banco', 4000);
  aviso(r.aviso || 'O banco atualiza em até 1 minuto', 5000);
  clearTimeout(tReindexar);
  tReindexar = setTimeout(async () => {
    await carregarIndice(true);
    if (!$('#sh-busca').classList.contains('oculto')) mostrarBusca();
    aviso(`Banco recarregado · ${S.indice.length} fotos`, 3000);
  }, 70000);
};

// enviar foto pro banco (pasta da categoria escolhida)
function escolherArquivo(fn) {
  const inp = $('#arquivo'); inp.value = '';
  inp.onchange = () => { if (inp.files[0]) fn(inp.files[0]); };
  inp.click();
}
async function enviar(file, dir, nome) {
  aviso('Enviando…', 20000);
  const r = await apiJson(`/enviar?dir=${encodeURIComponent(dir)}&nome=${encodeURIComponent(nome)}`,
    { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file }).catch(() => null);
  if (!r) { aviso('Não consegui salvar a foto'); return null; }
  aviso('Salvo em ' + nomeArq(r.arq)); return r.arq;
}
let arquivoEnvio = null;
async function abrirEnvio(file, nomeDado) {
  arquivoEnvio = file;
  await carregarIndice();
  const pastas = [...new Set(S.indice.map(i => i.pasta).filter(Boolean))].sort();
  const ult = guardar.ler('ultimaPasta', pastas[0]);
  $('#bq-envio-pasta').innerHTML = pastas.map(p => `<option ${p === ult ? 'selected' : ''}>${p}</option>`).join('');
  const sugestao = nomeDado || (S.sel && S.sel.nome ? S.sel.nome.replace(/\n/g, ' ') : file.name.replace(/\.[^.]+$/, ''));
  $('#bq-envio-nome').value = sugestao;
  $('#bq-envio-prev').src = URL.createObjectURL(file);
  $('#bq-envio').classList.remove('oculto');
}
$('#bq-enviar').onclick = () => escolherArquivo(file => abrirEnvio(file));

// ---------------------------------------------------------------- banco › Internet
// Foto dos catálogos de supermercado → fila de recorte (BiRefNet no PC do Matheus,
// scripts/recorte-worker) → conferir aqui → "Ficou bom" cai no painel de envio acima,
// que salva no banco (Drive) e põe no card.
// Também aceita LINK colado no campo (foto ou página de qualquer site): vai direto pro recorte.
let netBusca = 0, netPedido = null, netUltimoLink = '';
const ehLink = q => /^https?:\/\/\S+$/i.test(q);
function dicaEm(box, txt) {
  const p = document.createElement('p'); p.className = 'dica'; p.textContent = txt;
  box.replaceChildren(p);
}
async function mostrarInternet() {
  const box = $('#bq-res');
  const q = $('#bq-q').value.trim();
  if (ehLink(q)) {
    ++netBusca;
    dicaEm(box, 'Link colado: a foto desse endereço vai pro recorte aqui embaixo.');
    if (q !== netUltimoLink) { netUltimoLink = q; pedirRecorte({ img: q, nome: '', thumb: '', link: true }); }
    return;
  }
  netUltimoLink = '';
  if (q.length < 3) return dicaEm(box, 'Escreva o produto (marca e tamanho ajudam) ou cole o link da foto.');
  const n = ++netBusca;
  dicaEm(box, 'Procurando nos sites dos supermercados…');
  const d = await apiJson('/internet/busca?q=' + encodeURIComponent(q)).catch(() => null);
  if (n !== netBusca) return;
  if (!d) return dicaEm(box, 'Não consegui buscar agora.');
  statusPc(d.worker);
  if (!d.itens.length) return dicaEm(box, 'Nada nos sites. Tente outro nome (sem tamanho, ou só marca e produto).');
  box.replaceChildren();
  for (const it of d.itens) {
    const f = document.createElement('div'); f.className = 'foto';
    const im = document.createElement('img'); im.loading = 'lazy'; im.alt = ''; im.referrerPolicy = 'no-referrer'; im.src = it.thumb;
    const sp = document.createElement('span'); sp.textContent = it.nome;
    const lj = document.createElement('b'); lj.className = 'loja'; lj.textContent = it.loja;
    f.append(im, sp, lj);
    f.onclick = () => pedirRecorte(it);
    box.appendChild(f);
  }
}
function statusPc(w) {
  const st = $('#bq-net-status');
  st.classList.toggle('off', !(w && w.online));
  st.textContent = w && w.online
    ? 'Recorte: PC ligado ✓ · toque numa foto pra tirar o fundo'
    : 'Recorte: o PC que recorta está desligado. O pedido fica na fila e sai quando ele ligar.';
}
function fecharRecorte() { netPedido = null; netUltimoLink = ''; $('#bq-net').classList.add('oculto'); }
async function pedirRecorte(it) {
  const prev = $('#bq-net-prev'), img = prev.querySelector('img'), txt = prev.querySelector('p');
  $('#bq-net').classList.remove('oculto'); prev.classList.remove('zoom');
  prev.classList.add('esperando'); txt.textContent = it.link ? 'Baixando a foto do link…' : 'Mandando pro recorte…';
  if (it.thumb) img.src = it.thumb; else img.removeAttribute('src');
  $('#bq-net-ok').disabled = true;
  const meu = netPedido = { item: it };
  let r = null, erro = '';
  try {
    const resp = it.arquivo
      ? await api('/internet/recorte?nome=' + encodeURIComponent(it.nome), {
        method: 'POST', headers: { 'Content-Type': it.arquivo.type || 'image/jpeg' }, body: it.arquivo,
      })
      : await api('/internet/recorte', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ img: it.img, nome: it.nome }),
      });
    const d = await resp.json().catch(() => ({}));
    if (resp.ok) r = d; else erro = d.error || '';
  } catch { /* api() já avisou */ }
  if (netPedido !== meu) return;
  if (!r) {
    if (it.link) netUltimoLink = '';
    txt.textContent = it.link
      ? 'Não consegui pegar a foto desse link' + (erro ? ': ' + erro : '') + '.'
      : it.arquivo ? 'Não consegui mandar a foto pro recorte' + (erro ? ': ' + erro : '') + '.'
      : 'Não consegui pegar essa foto. Escolha outra.';
    return;
  }
  if (it.link) {
    it.nome = r.nome || '';
    api('/internet/recorte/' + r.id + '?original=1').then(x => x.ok ? x.blob() : null).then(b => {
      if (b && netPedido === meu && !meu.blob) img.src = URL.createObjectURL(b);
    }).catch(() => {});
  }
  const ini = Date.now();
  for (;;) {
    const s = await apiJson('/internet/recorte/' + r.id).catch(() => null);
    if (netPedido !== meu) return;
    if (s && s.status === 'pronto') break;
    if (s && s.status === 'erro') { txt.textContent = 'O recorte falhou: ' + (s.erro || '') + '. Escolha outra foto.'; return; }
    if (s) statusPc(s.worker);
    txt.textContent = s && !s.worker.online
      ? 'Na fila: o PC que recorta está desligado.'
      : `Tirando o fundo… ${Math.round((Date.now() - ini) / 1000)}s`;
    await new Promise(ok => setTimeout(ok, 1200));
  }
  const resp = await api('/internet/recorte/' + r.id + '?png=1').catch(() => null);
  if (netPedido !== meu) return;
  if (!resp || !resp.ok) { txt.textContent = 'Não consegui baixar o recorte.'; return; }
  meu.blob = await resp.blob();
  img.src = URL.createObjectURL(meu.blob);
  prev.classList.remove('esperando');
  txt.textContent = 'Toque na foto pra ver de perto';
  $('#bq-net-ok').disabled = false;
}
$$('#bq-net [data-fundo]').forEach(b => b.onclick = () => {
  $$('#bq-net [data-fundo]').forEach(x => x.classList.toggle('ativo', x === b));
  $('#bq-net-prev').classList.remove('xadrez', 'escuro', 'magenta');
  $('#bq-net-prev').classList.add(b.dataset.fundo);
});
$('#bq-net-prev img').onclick = () => { if (!$('#bq-net-prev').classList.contains('esperando')) $('#bq-net-prev').classList.toggle('zoom'); };
$('#bq-net-outra').onclick = () => {
  const it = netPedido && netPedido.item;
  fecharRecorte();
  if (it && it.arquivo) abrirEnvio(it.arquivo, it.nome); // volta pro envio com a foto original
};
$('#bq-net-ok').onclick = () => {
  if (!netPedido || !netPedido.blob) return;
  const it = netPedido.item;
  const nome = it.arquivo ? it.nome : (S.sel && S.sel.nome ? S.sel.nome.replace(/\n/g, ' ') : it.nome).toUpperCase();
  const file = new File([netPedido.blob], 'recorte.png', { type: 'image/png' });
  fecharRecorte();
  abrirEnvio(file, nome);
};
// Enviar foto › Remover fundo: a foto do aparelho vai pra mesma fila do recorte (tira o fundo e
// apara o vazio no worker); "Ficou bom" volta pro envio com o PNG, mantendo pasta e nome.
$('#bq-envio-fundo').onclick = () => {
  if (!arquivoEnvio) return;
  const it = { arquivo: arquivoEnvio, nome: $('#bq-envio-nome').value.trim(), thumb: $('#bq-envio-prev').src };
  $('#bq-envio').classList.add('oculto'); arquivoEnvio = null;
  pedirRecorte(it);
};
$('#bq-envio-cancela').onclick = () => { $('#bq-envio').classList.add('oculto'); arquivoEnvio = null; };
$('#bq-envio-ok').onclick = async () => {
  if (!arquivoEnvio) return;
  const pasta = $('#bq-envio-pasta').value;
  guardar.pôr('ultimaPasta', pasta);
  const ext = (arquivoEnvio.name.match(/\.[^.]+$/) || ['.png'])[0].toLowerCase();
  const arq = await enviar(arquivoEnvio, S.raizBanco + '/' + pasta, $('#bq-envio-nome').value.trim() + ext);
  if (!arq) return;
  $('#bq-envio').classList.add('oculto'); arquivoEnvio = null;
  await carregarIndice(true);
  // o indice.json do servidor só pega a foto nova no próximo espelho: põe ela na busca já
  const ini = S.raizBanco + '/';
  if (arq.startsWith(ini) && !S.indice.some(i => i.arq === arq)) S.indice.push(itemBanco(pasta, arq.slice(ini.length)));
  usarFoto(arq, modoBusca);
};

// ---------------------------------------------------------------- preencher pela lista
// tolerância pra dois cards contarem como a mesma linha: card sem MARGEM_GRID (Juarez, Rodrigues)
// tem a caixa um pouco mais baixa ou mais alta que o vizinho
function tolLinha(ps) {
  const hs = ps.map(p => p.cell.h).filter(h => h > 0);
  return hs.length ? Math.max(8, Math.min(...hs) * 0.3) : 20;
}
// linhas de cima pra baixo (pelo topo do card), cada linha da esquerda pra direita
function ordemLeitura(ps) {
  const tol = tolLinha(ps), linhas = [];
  for (const p of ps.slice().sort((a, b) => a.cell.y - b.cell.y)) {
    const l = linhas[linhas.length - 1];
    if (l && p.cell.y - l.y0 <= tol) l.ps.push(p); else linhas.push({ y0: p.cell.y, ps: [p] });
  }
  return linhas.flatMap(l => l.ps.sort((a, b) => a.cell.x - b.cell.x));
}
function lerLinha(l) {
  l = l.replace(/\t/g, ' ').replace(/\s+/g, ' ').trim();
  // "foto: <caminho> ; <caminho>" no fim da linha = fotos já escolhidas (o Hermes resolve pelo
  // matcher do gerador, com os overrides); pula a busca. Vem por último porque caminho tem espaço.
  const marcas = {};
  l = l.replace(/(?:^|\s)foto\s*:\s*(.+)$/i, (_, v) => { marcas.fotos = v.split(';').map(s => s.trim()).filter(Boolean); return ''; }).trim();
  // "tarja: NA COMPRA DE // 5 KG OU MAIS!" (atacado do Juarez) vai no fim da linha, antes do foto:
  l = l.replace(/(?:^|\s)(?:tarja|gatilho)\s*:\s*(.+)$/i, (_, v) => { marcas.tarja = v.trim(); return ''; }).trim();
  // "logo: sim|não" liga ou desliga a logo da marca no card (sem isso vale a regra do mercado)
  l = l.replace(/(?:^|\s)logo\s*:\s*(sim|s|on|1|n[aã]o|n|off|0)\b/i, (_, v) => { marcas.logo = /^(sim|s|on|1)$/i.test(v); return ' '; }).replace(/\s+/g, ' ').trim();
  l = l.replace(/(?:^|\s)(de|selo)\s*:\s*(?:R\$\s*)?(\d+(?:[.,]\d{1,2})?)/gi, (_, k, v) => { marcas[k.toLowerCase()] = normPreco(v); return ' '; }).replace(/\s+/g, ' ').trim();
  // formato da lista.txt do gerador: "busca >> Nome na arte | 13,99 | UND" (preço duplo: "15,99 16,99")
  if (l.includes('|')) {
    const [nm, pr, fo] = l.split('|').map(s => s.trim());
    const partes = nm.split('>>').map(s => s.trim());
    const precos = (pr || '').match(/\d+(?:[.,]\d{1,2})?/g) || [];
    // preço em texto ("Consultar"): vai como está (o card escreve o texto no lugar do valor)
    const prTxt = !precos.length && pr && !/\d/.test(pr) ? pr : null;
    return { nome: partes[partes.length - 1], busca: partes[0], preco: precos[0] ? normPreco(precos[0]) : prTxt,
      precos2: precos.slice(1).map(normPreco), formato: fo ? normFormato(fo) : null, ...marcas };
  }
  const m = l.match(/^(.*?)\s*(?:R\$\s*)?(\d+[.,]\d{2})(?:\s*(?:\/|e)?\s*(?:R\$\s*)?(\d+[.,]\d{2}))?\s*(UND|UN|KG|PCT|CX|L|LT|FD|DZ)?\s*$/i);
  if (!m) return { nome: l, precos2: [], ...marcas };
  return { nome: m[1].replace(/[-–:;]+$/, '').trim(), preco: normPreco(m[2]), precos2: m[3] ? [normPreco(m[3])] : [],
    formato: m[4] ? normFormato(m[4]) : null, ...marcas };
}
// "un" da lista vira "UND" (é como os templates escrevem)
function normFormato(f) { const u = String(f || '').toUpperCase(); return u === 'UN' ? 'UND' : u; }
// unidade em minúscula no template (Luxo: "kg") fica minúscula; senão, como a lista manda (maiúscula)
function caixaFormato(p, f) {
  const b = p.base && p.base.formato ? p.base.formato.linhas.join('') : '';
  return b && b === b.toLowerCase() && b !== b.toUpperCase() ? String(f).toLowerCase() : f;
}
// nome em maiúscula só quando o template usa maiúscula (o J Meroto escreve "Batata Inglesa KG")
// "linhas=3,5,5" no cabeçalho da lista: produtos em cada linha da grade (as que faltarem, automático)
function linhasDoCab(l) { const m = String(l).match(/linhas\s*=\s*(\d+(?:\s*[,/]\s*\d+)*)/i); return m ? m[1].split(/[,/]/).map(v => +v).filter(v => v > 0) : null; }
function caixaNome(t) { return S.nomesMaiusculos === false ? t : String(t || '').toUpperCase(); }
// "=== PAGINA ===" separa as pranchetas: bloco 1 enche a página atual, o 2 a seguinte… Faltou
// prancheta no template = a página 1 é duplicada (paginasExtras). Um bloco só = como sempre.
function blocosDePagina(texto) {
  const bl = [];
  for (const l of String(texto || '').split('\n')) {
    if (/^=+.*\bPAGINA\b.*=+$/i.test(l.trim()) || !bl.length) bl.push([]);
    bl[bl.length - 1].push(l);
  }
  return bl.map(b => b.join('\n')).filter(b => b.split('\n').some(l => l.trim() && !/^=+.*=+$/.test(l.trim())));
}
$('#li-ok').onclick = async () => {
  const texto = $('#li-texto').value, blocos = blocosDePagina(texto);
  if (blocos.length <= 1) return preencherPagina(texto);
  const ini = S.pagina, falta = ini + blocos.length - S.paginas.length;
  if (falta > 0 && !await duplicarPagina(0, falta)) return;
  for (let k = 0; k < blocos.length; k++) { irPagina(ini + k); await preencherPagina(blocos[k]); }
  irPagina(ini);
  if (falta > 0) aviso(`${blocos.length} páginas preenchidas · ${falta} página(s) nova(s), cópia da página 1`, 4000);
};
async function preencherPagina(texto) {
  let linhas = texto.split('\n').map(s => s.trim()).filter(Boolean);
  const i = S.pagina, zsPag = zonasDaPagina(i);
  // "=== ZONA colunas=2 ===": cada seção enche uma zona da página, na ordem de leitura, com as
  // colunas dela; a zona ganha ou perde cards só ela (sem ZONA, a sobra ia toda pra última zona)
  const secoes = [];
  for (const l of linhas) {
    if (/^=+.*\bZONA\b.*=+$/i.test(l)) {
      // "=== ZONA z16 ===": o id da zona (catálogo casa por ele); "ZONA colunas=2" não tem id
      const c = l.match(/colunas\s*=\s*(\d+)/i), id = (l.match(/\bZONA\s+([\w-]+)(?![\w-]|\s*=\s*\d)/i) || [])[1];
      secoes.push({ col: c ? +c[1] : null, rows: linhasDoCab(l), id: id || null, linhas: [] });
    }
    else if (secoes.length && !/^=+.*=+$/.test(l)) secoes[secoes.length - 1].linhas.push(l);
  }
  const porZona = secoes.length > 0;
  // cabeçalho da lista.txt do gerador ("=== PAGINA colunas=5 ===") não é produto: vira as colunas da
  // grade — só quando a página tem uma zona (com várias, punha a mesma coluna em todas)
  const cab = porZona || zsPag.length !== 1 ? null : linhas.map(l => l.match(/^=+.*?colunas\s*=\s*(\d+).*=+$/i)).find(Boolean);
  const cabLinhas = porZona || zsPag.length !== 1 ? null : linhas.filter(l => /^=+.*=+$/.test(l)).map(linhasDoCab).find(Boolean);
  linhas = porZona ? secoes.flatMap(sc => sc.linhas) : linhas.filter(l => !/^=+.*=+$/.test(l));
  if (!linhas.length) return;
  if (porZona && secoes.length > zsPag.length) aviso(`A lista tem ${secoes.length} zonas e a página ${zsPag.length}: as seções a mais ficaram de fora`);
  if (cab) for (const z of zsPag) if (S.grades[z.chave]) S.grades[z.chave].colunas = Math.max(1, +cab[1]);
  if (cabLinhas) for (const z of zsPag) if (S.grades[z.chave]) S.grades[z.chave].linhas = cabLinhas;
  // catálogo: "=== ZONA z16 ===" casa pelo id da zona no construtor (data-zona da grid_area), não pela
  // ordem de leitura (zonas quase na mesma altura trocavam de lugar). Seção sem id que casa fica com a
  // próxima zona livre, na ordem
  if (porZona && S.catalogo) {
    const livres = zsPag.slice(), idDe = z => z.el && z.el.getAttribute('data-zona');
    for (const sc of secoes) { const z = sc.id && livres.find(q => idDe(q) === sc.id || q.chave === sc.id); if (z) { sc.zona = z; livres.splice(livres.indexOf(z), 1); } }
    for (const sc of secoes) if (!sc.zona && livres.length) sc.zona = livres.shift();
    const fora = secoes.filter(sc => !sc.zona);
    if (fora.length) aviso(`${fora.length} seção(ões) da lista sem zona na página: ficaram de fora`);
    // a ordem dos produtos na página é a das zonas (ativosDaPagina), não a da lista
    secoes.splice(0, secoes.length, ...secoes.filter(sc => sc.zona).sort((a, b) => zsPag.indexOf(a.zona) - zsPag.indexOf(b.zona)));
  }
  if (porZona) {
    const lote = S.produtos.filter(q => zsPag.some(z => z.chave === q.zona)).map(estado), novos = [];
    secoes.slice(0, zsPag.length).forEach((sc, k) => {
      const z = (sc.zona || zsPag[k]).chave;
      if (sc.col && S.grades[z]) S.grades[z].colunas = Math.max(1, sc.col);
      if (sc.rows && S.grades[z]) S.grades[z].linhas = sc.rows;
      let qs = ativosDaZona(z);
      while (qs.length < sc.linhas.length) { const p = novoNaZona(z, qs[qs.length - 1]); novos.push({ tipo: 'novo', id: p.id }); qs = ativosDaZona(z); }
      while (qs.length > sc.linhas.length) { const p = qs.pop(); p.removido = true; render(p); }
      montarGrade(z);
    });
    S.desfazer.push([...novos, ...lote]);
    linhas = secoes.slice(0, zsPag.length).flatMap(sc => sc.linhas);
  }
  let ps = ativosDaPagina(i);
  // página com zona composta (partes fixas e elásticas): a lista se divide entre os lugares fixos e as
  // áreas elásticas (preencherComposta), em vez de criar/remover cards no fim
  const compostaPag = !porZona && $('#li-qtd').checked && zsPag.some(z => parteDe(z));
  const fotos = $('#li-fotos').checked;
  if (fotos) await carregarIndice();
  // quantas cópias cada foto teve nesta edição (que nasce da semana anterior), lido ANTES de a grade
  // tirar cards: ovos com 1 continua com 1; foto que nunca apareceu usa o padrão (imagem.copias)
  const copiasPorFoto = new Map();
  for (const q of S.produtos) if (!q.removido) for (const im of q.fotos) copiasPorFoto.set(im.dataset.arq, q.fotos.filter(x => x.dataset.arq === im.dataset.arq).length);
  if (compostaPag) ps = preencherComposta(i, linhas.length);
  else if (!porZona && $('#li-qtd').checked && ps.length !== linhas.length) {
    // monta a grade: cria ou remove cards no fim pra bater com a lista
    // (cards novos entram na zona do último; com várias zonas, a ordem é zona por zona)
    const zs = zonasDaPagina(i);
    const lote = S.produtos.filter(q => zs.some(z => z.chave === q.zona)).map(estado);
    const novos = [];
    while (ps.length < linhas.length) {
      const ult = ps[ps.length - 1], k = ult ? ult.zona : zs[zs.length - 1].chave;
      const p = novoNaZona(k, ult); novos.push({ tipo: 'novo', id: p.id }); ps = ativosDaPagina(i);
    }
    while (ps.length > linhas.length) { const p = ps.pop(); p.removido = true; render(p); }
    S.desfazer.push([...novos, ...lote]);
    for (const z of zs) montarGrade(z.chave);
    ps = ativosDaPagina(i);
  } else {
    if (!porZona && S.sel && ps.includes(S.sel)) ps = ps.slice(ps.indexOf(S.sel));
    marcar(...ps.slice(0, Math.min(ps.length, linhas.length)));
  }
  if (cab) { for (const z of zonasDaPagina(i)) montarGrade(z.chave); ps = ativosDaPagina(i); }
  const n = Math.min(ps.length, linhas.length), semFoto = [];
  for (let i = 0; i < n; i++) {
    const p = ps[i], d = lerLinha(linhas[i]);
    // sufixo do formato no nome, quando o cliente escreve assim (Lima: "BANANA NANICA KG")
    const suf = (S.padrao && S.padrao.titulo && S.padrao.titulo.sufixo_formato) || [];
    let nome = d.nome;
    if (d.formato && suf.includes(d.formato) && !new RegExp(`\\b${d.formato}$`, 'i').test(nome)) nome += ' ' + d.formato;
    p.nome = caixaNome(nome); if (d.preco) p.precoTxt = d.preco; if (d.formato) p.formatoTxt = caixaFormato(p, d.formato);
    else if (S.catalogo) p.formatoTxt = ''; // catálogo: linha sem unidade não herda o "kg" do template
    if (p.tarja && d.tarja != null) p.tarjaTxt = d.tarja; // sem tarja: na linha, fica a do card
    padraoCard(p);
    (p.extras || []).forEach((v, k) => { if (d.precos2 && d.precos2[k]) v.txt = d.precos2[k]; });
    // DE e selo seguem a lista: só aparecem nos itens marcados
    if (p.de) { p.deOn = !!d.de; if (d.de) p.deTxt = d.de; }
    if (d.selo) garantirSelo(p);
    if (p.selo) { p.seloOn = !!d.selo; if (d.selo) p.seloTxt = d.selo; }
    aplicarLogoAuto(p, d.logo);
    if (S.catalogo && p.semArea) { p.fotos.forEach(im => im.remove()); relerFotos(p); } // catálogo: linha sem foto
    else if (fotos) {
      const termo = d.busca || d.nome;
      // "ALFACE OU COUVE" são dois produtos: uma foto de cada (a frase inteira acha coisa errada)
      const partes = !d.busca && /\s+ou\s+/i.test(termo) ? termo.split(/\s+ou\s+/i).map(s => s.trim()).filter(Boolean) : [termo];
      const achadas = d.fotos && d.fotos.length ? d.fotos
        : partes.map(t => window.SomadoBusca.buscar(t, S.indice, { limite: 1 })[0]).filter(Boolean).map(r => r.item.arq);
      p.fotos.forEach(im => im.remove());
      if (achadas.length) {
        const I = arranjoPadrao();
        const qt = partes.length > 1 || achadas.length > 1 ? achadas.length : copiasPorFoto.get(achadas[0]) || (I && I.copias) || Math.max(1, p.fotos.length);
        for (let j = 0; j < qt; j++) {
          const arq = achadas[j % achadas.length], k = await proporcao(arq);
          inserirFoto(p, novaFoto(arq, { x: p.area.x, y: p.area.y, w: p.area.h * k, h: p.area.h }));
        }
        relerFotos(p); arranjar(p, 'auto');
      } else { relerFotos(p); semFoto.push(p.nome); } // sem foto achada: card fica sem foto, não herda a do anterior
    }
    render(p);
  }
  // catálogo: com os nomes escritos, a grade refaz as alturas (nome de 2 linhas ganha linha mais alta)
  if (S.catalogo) for (const z of zonasDaPagina(i)) montarGrade(z.chave);
  mudou(); painel(); fecharSheets();
  aviso(`${n} produto(s) preenchidos` + (linhas.length > n ? ` · sobraram ${linhas.length - n} linhas` : '') +
    (semFoto.length ? ` · sem foto: ${semFoto.join(', ')}` : ''), semFoto.length ? 6000 : 2200);
}

// ---------------------------------------------------------------- zona composta (Matheus, 22/10/2026)
// O construtor publica cada parte da zona composta como uma grid_area com data-parte (fixo|elastica),
// data-grupo (a zona do construtor), data-prioridade (fixo: ordem do destaque) e data-max-linhas/-col
// (elástica). Fixo = lugar que existe sempre; elástica = recebe a sobra e monta as linhas pela quantidade.
function parteDe(z) {
  const el = z && z.el, t = el && el.getAttribute('data-parte'); if (!t) return null;
  const n = a => { const v = +el.getAttribute(a); return v > 0 ? v : null; };
  return { tipo: t, grupo: el.getAttribute('data-grupo') || '', prio: n('data-prioridade'), maxL: n('data-max-linhas'), maxC: n('data-max-col') };
}
// parte elástica que pode ter mais de uma linha (máx. de linhas ≥ 2 ou sem máximo) aceita linha de 1 produto.
// Sempre ligado, sem opção no construtor (Matheus, 26/10/2026): com máx. 1 linha não existe linha de 1 a evitar
function aceitaLinhaDe1(z) { const pt = parteDe(z); return !!pt && pt.tipo === 'elastica' && pt.maxL !== 1; }
// colunas da área elástica pra n cards: o arranjo com o maior card e mais perto do quadrado (o molde é ~240×250).
// Conta as linhas como vão sair (incompleta em cima, linha de 1 pode) e vale o pior card do arranjo:
// uma linha de 3 espremida perde pra 1/2 mesmo com o card de cima largo
function colunasElastica(n, A, e, maxL, maxC) {
  let melhor = null;
  for (let R = 1; R <= n; R++) {
    if (maxL && R > maxL) break;
    const C = Math.ceil(n / R); if (maxC && C > maxC) continue;
    const rows = distribuirLivre(n, C, false, maxL !== 1), h = (A.h - (rows.length - 1) * e) / rows.length;
    let nota = Infinity;
    for (const c of new Set(rows)) {
      const w = (A.w - (c - 1) * e) / c; if (w <= 0 || h <= 0) { nota = -1; break; }
      // card largo vira horizontal (2 casas) e pode transbordar: pesa menos
      const q = w / h; nota = Math.min(nota, w * h * Math.min(q, 1 / q) * (q >= 1.35 ? 0.3 : 1));
    }
    if (nota > 0 && (!melhor || nota > melhor.nota)) melhor = { C, nota };
  }
  // nada cabe nos dois máximos: o de linhas manda (5 com 2×2 = 2/3, a linha passa do máx. por linha)
  return melhor ? melhor.C : Math.max(1, maxL ? Math.ceil(n / maxL) : maxC || n);
}
// reparte a lista (nLista produtos) entre as zonas da página: lugares fixos e zonas normais ficam com o
// número de cards que têm; a sobra vai pras elásticas pelo tamanho delas. Devolve os cards na ordem de
// preenchimento: fixos com prioridade primeiro (1, 2, 3…), depois o resto na ordem de leitura
function preencherComposta(i, nLista) {
  const zs = zonasDaPagina(i), lote = S.produtos.filter(q => zs.some(z => z.chave === q.zona)).map(estado), novos = [];
  const info = zs.map(z => ({ z, k: z.chave, pt: parteDe(z), g: S.grades[z.chave] })).filter(o => o.g);
  const fixos = info.filter(o => !o.pt || o.pt.tipo === 'fixo'), elas = info.filter(o => o.pt && o.pt.tipo === 'elastica');
  // quantos lugares cada fixo tem: o desenho do template (colunas), não o que sobrou da semana anterior
  for (const o of fixos) o.n = o.pt ? Math.max(1, (S.gradesOrig[o.k] || o.g).colunas || 1) : ativosDaZona(o.k).length;
  const F = fixos.reduce((t, o) => t + o.n, 0);
  let sobra = Math.max(0, nLista - F);
  // fixos quando a lista é menor que os lugares: os com prioridade ficam, os outros perdem do fim
  if (nLista < F) {
    let falta = F - nLista;
    for (const o of [...fixos].sort((a, b) => ((a.pt && a.pt.prio) || 999) - ((b.pt && b.pt.prio) || 999)).reverse()) {
      const tira = Math.min(falta, o.n); o.n -= tira; falta -= tira; if (!falta) break;
    }
  }
  // elásticas: pela área (maior resto fica com o que sobra do arredondamento)
  const areaDe = o => { const A = (S.gradesOrig[o.k] || o.g).area || o.z.ret; return A.w * A.h; };
  const tot = elas.reduce((t, o) => t + areaDe(o), 0) || 1;
  for (const o of elas) { o.q = sobra * areaDe(o) / tot; o.n = Math.floor(o.q); }
  let resto = sobra - elas.reduce((t, o) => t + o.n, 0);
  for (const o of [...elas].sort((a, b) => (b.q - b.n) - (a.q - a.n))) { if (resto <= 0) break; o.n++; resto--; }
  for (const o of info) {
    let qs = ativosDaZona(o.k);
    while (qs.length < o.n) { const p = novoNaZona(o.k, qs[qs.length - 1]); novos.push({ tipo: 'novo', id: p.id }); qs = ativosDaZona(o.k); }
    while (qs.length > o.n) { const p = qs.pop(); p.removido = true; render(p); }
  }
  // fixo cresce por cima das elásticas vazias do mesmo grupo (só com um fixo no grupo); senão volta pro desenho
  const grupos = new Map();
  for (const o of info) if (o.pt) { const l = grupos.get(o.pt.grupo) || []; l.push(o); grupos.set(o.pt.grupo, l); }
  for (const l of grupos.values()) {
    const fx = l.filter(o => o.pt.tipo === 'fixo'); if (fx.length !== 1) continue;
    const f = fx[0], A0 = (S.gradesOrig[f.k] || f.g).area, vazias = l.filter(o => o.pt.tipo === 'elastica' && !o.n);
    const rs = [A0, ...vazias.map(o => (S.gradesOrig[o.k] || o.g).area)];
    const x0 = Math.min(...rs.map(r => r.x)), y0 = Math.min(...rs.map(r => r.y));
    f.g.area = { x: x0, y: y0, w: Math.max(...rs.map(r => r.x + r.w)) - x0, h: Math.max(...rs.map(r => r.y + r.h)) - y0 };
  }
  for (const o of elas) if (o.n) {
    const A = (S.gradesOrig[o.k] || o.g).area;
    o.g.area = { ...A }; o.g.colunas = colunasElastica(o.n, A, o.g.espaco, o.pt.maxL, o.pt.maxC); o.g.linha1 = o.pt.maxL !== 1; delete o.g.linhas;
  }
  S.desfazer.push([...novos, ...lote]);
  for (const o of info) montarGrade(o.k);
  const todos = ativosDaPagina(i);
  const prios = fixos.filter(o => o.pt && o.pt.prio).sort((a, b) => a.pt.prio - b.pt.prio).map(o => ativosDaZona(o.k)[0]).filter(Boolean);
  return [...prios, ...todos.filter(p => !prios.includes(p))];
}

// ---------------------------------------------------------------- inspecionar
function inspecionar() {
  const ul = $('#in-lista'); ul.innerHTML = '';
  const ps = ordemLeitura(S.produtos.filter(p => !p.removido && paginaDe(p) === S.pagina));
  const probs = [];
  for (const p of ps) {
    const it = [];
    if (!p.precoTxt || /^0+,?0*$/.test(p.precoTxt)) it.push('sem preço');
    if (!p.fotos.length) it.push('sem foto');
    if (p.fotos.some(im => im.dataset.erro)) it.push('foto não carregou');
    if (p.encolheu && p.encolheu < 0.8) it.push('nome apertado');
    const menor = Math.min(...(p.nomeTxts || []).filter(t => t.textContent.trim()).map(ptDoTexto).filter(v => v > 0));
    if (menor < PISO_PT - 0.05) it.push(`título de ${fmtPt(menor)} pt (mín. ${PISO_PT})`);
    const A = p.area;
    if (p.fotos.some(im => { const r = retFoto(im); return r.x < A.x - A.w * 0.06 || r.x + r.w > A.x + A.w * 1.06 || r.y < A.y - A.h * 0.1 || r.y + r.h > A.y + A.h * 1.06; })) it.push('foto saindo da área');
    if (it.length) probs.push({ p, it });
  }
  if (!probs.length) ul.innerHTML = '<li><span class="dica">Nada de errado nesta página.</span></li>';
  for (const { p, it } of probs) {
    const li = document.createElement('li');
    li.innerHTML = `<div class="info"><b></b><small></small></div>` + it.map(t => `<span class="tag ruim">${t}</span>`).join(' ');
    li.querySelector('b').textContent = `${p.rotulo} · ${(p.nome || '').replace(/\n/g, ' ')}`;
    li.onclick = () => { fecharSheets(); selecionarProduto(p); };
    ul.appendChild(li);
  }
}

// ---------------------------------------------------------------- exportar
const cacheData = new Map();
async function dataUrl(url) {
  if (cacheData.has(url)) return cacheData.get(url);
  const r = await fetch(url, { credentials: 'same-origin' });
  if (r.status === 401 || (r.redirected && /\/login/i.test(r.url))) { sessaoExpirou(); throw new Error('sessao'); }
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  const b = await r.blob();
  const d = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); });
  cacheData.set(url, d); return d;
}
// só as famílias que o SVG usa: embutir todas as do servidor dava ~145 MB de CSS por render (SVG de
// ~180 MB que o Chrome sem tela da VPS levava ~13 s pra abrir, em cada prancheta e na miniatura)
function familiasUsadas() {
  const fams = new Set();
  for (const t of $$('text, tspan', S.svg)) {
    for (const f of (getComputedStyle(t).fontFamily || '').split(',')) fams.add(f.replace(/["']/g, '').trim());
  }
  return fams;
}
async function cssFontes(usadas) {
  const css = await textoFontesCss();
  const partes = [];
  // @font-face{font-family:'X';src:url('/api/encarte/fonte/X.otf')[;font-weight:…]} — embute cada
  // arquivo como data URL e mantém o resto (faixa de peso/largura da fonte variável)
  for (const m of css.matchAll(/font-family:\s*['"]([^'"]+)['"]\s*;\s*src:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)([^}]*)\}/g)) {
    if (usadas && !usadas.has(m[1])) continue;
    partes.push(`@font-face{font-family:'${m[1]}';src:url('${await dataUrl(m[2])}')${m[3]}}`);
  }
  return partes.join('\n');
}

// a prancheta desenhada num canvas (escala = px por unidade do SVG); renderPng é este + toBlob
async function renderCanvas(ret, escala, soProdutos) {
  const clone = S.svg.cloneNode(true);
  clone.querySelector('#ed-ui')?.remove();
  for (const x of clone.querySelectorAll(soProdutos ? '.ed-linhas' : '.ed-linha-toque')) x.remove();
  const dentro = p => {
    const cx = p.cell.x + p.cell.w / 2, cy = p.cell.y + p.cell.h / 2;
    return cx >= ret.x && cx <= ret.x + ret.w && cy >= ret.y && cy <= ret.y + ret.h;
  };
  for (const p of S.produtos) if (p.removido || !dentro(p) || (soProdutos && !soProdutos.includes(p))) clone.querySelector(`[id="${p.id}"]`)?.remove();
  S.paginas.forEach(pg => {
    if (!pg.g) return;
    const fora = pg.x + pg.w < ret.x || pg.x > ret.x + ret.w;
    if (fora || soProdutos) clone.querySelector(`[id="${pg.g.id}"]`)?.remove();
  });
  const W = Math.round(ret.w * escala), H = Math.round(ret.h * escala);
  // render pequeno (miniatura) usa as mesmas larguras da tela, que o servidor já tem prontas
  const pequeno = W < 1000;
  for (const im of $$('image', clone)) {
    const arq = im.dataset.arq || im.getAttribute('data-arq');
    if (!arq) continue;
    const larg = im.classList.contains('ed-fundo') ? (pequeno ? 2000 : 2400) : (pequeno ? 700 : 1600);
    try { setHref(im, await dataUrl(urlImg(arq, larg))); }
    catch (e) { if (e.message === 'sessao') throw e; console.warn('foto não embutida', arq, e); im.remove(); }
  }
  const st = document.createElementNS(NS, 'style');
  st.textContent = (await cssFontes(familiasUsadas())) + ' text{text-rendering:geometricPrecision}';
  clone.insertBefore(st, clone.firstChild);
  clone.setAttribute('viewBox', `${ret.x} ${ret.y} ${ret.w} ${ret.h}`);
  clone.setAttribute('width', W); clone.setAttribute('height', H);
  const txt = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([txt], { type: 'image/svg+xml' }));
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  await new Promise(r => setTimeout(r, 200)); // fonte embutida assenta
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  if (!soProdutos) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); }
  ctx.drawImage(img, 0, 0, W, H);
  URL.revokeObjectURL(url);
  return cv;
}
async function renderPng(ret, escala, soProdutos, tipo = 'image/png', qualidade = 0.92) {
  return blobDoCanvas(await renderCanvas(ret, escala, soProdutos), tipo, qualidade);
}
function blobDoCanvas(cv, tipo = 'image/png', qualidade = 0.92) {
  return new Promise(res => cv.toBlob(res, tipo, qualidade));
}

async function entregar(blob, nome) {
  const arq = new File([blob], nome, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [arq] }) && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ files: [arq], title: nome }); return; } catch (e) { /* cancelou */ }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
// ---------------------------------------------------------------- pasta de trabalho do cliente
// CLIENTE/POSTAGENS - FLYERS/<ano>/<MM - MÊS>/<DD-MM NOME>/ com as artes em 1x/ (igual ao Illustrator)
function pastaCliente() {
  const tpl = S.template || {};
  if (tpl.pastaCliente) return tpl.pastaCliente;
  const f = S.paginas.find(pg => pg.fundo && pg.fundo.dataset.arqOrig);
  const arq = f ? f.fundo.dataset.arqOrig.replace(/\\/g, '/') : '';
  const i = arq.toUpperCase().indexOf('/TEMPLATES/');
  return i > 0 ? arq.slice(0, i) : '';
}
async function prepararPastaTrabalho() {
  const inp = $('#ex-pasta');
  if (S.edicao.pastaTrabalho) { inp.value = S.edicao.pastaTrabalho; return; }
  const cli = pastaCliente();
  if (!cli) { inp.value = ''; inp.placeholder = 'cole o caminho da pasta do encarte'; return; }
  const hoje = new Date(), data = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
  const r = await apiJson(`/sugerir-pasta?cliente=${encodeURIComponent(cli)}&titulo=${encodeURIComponent(S.edicao.titulo || '')}&data=${data}`).catch(() => null);
  inp.value = r ? r.pasta : '';
}
async function gravarNaPasta(dir, nome, blob) {
  try {
    const r = await api(`/gravar?dir=${encodeURIComponent(dir)}&nome=${encodeURIComponent(nome)}`,
      { method: 'PUT', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob });
    return r.ok;
  } catch (e) { return false; }
}
function pastaDoCampo() { return $('#ex-pasta').value.trim().replace(/\\/g, '/').replace(/\/$/, ''); }
// pranchas em <pasta>/1x + cópia da ficha + miniatura da tarefa, renderizadas NESTE navegador.
// É o mesmo código nos dois caminhos: o botão "gerar aqui" e a VPS (somado-encarte exportar abre a
// edição com ?exportar=1 num Chrome sem tela e chama esta função com salvarFicha:false).
// progresso(k, n): k-ésima prancheta de n (só as que têm produto).
async function exportarNoNavegador(pasta, { salvarFicha = true, progresso = null, status = () => {} } = {}) {
  S.edicao.pastaTrabalho = pasta;
  let salvou = null;
  if (salvarFicha) { status('salvando a edição…'); salvou = await salvar({ versao: true }); }
  const paginas = S.paginas.map((pg, i) => i).filter(i => ativosDaPagina(i).length);
  let ok = 0, falhou = 0, canvasPg1 = null;
  const arquivos = [];
  for (const [k, i] of paginas.entries()) {
    status(`prancheta ${i + 1} de ${S.paginas.length}…`);
    if (progresso) await progresso(k + 1, paginas.length);
    const pg = S.paginas[i];
    const cv = await renderCanvas(pg, 2000 / pg.w, null);
    if (i === 0) canvasPg1 = cv;
    const b = await blobDoCanvas(cv, 'image/jpeg');
    const nome = `Prancheta ${i + 1}.jpg`;
    if (await gravarNaPasta(pasta + '/1x', nome, b)) { ok++; arquivos.push('1x/' + nome); } else falhou++;
  }
  // cópia da ficha junto do encarte: se o editor sumir, a edição está na pasta
  if (!await gravarNaPasta(pasta, 'edicao_encarte.json', new Blob([JSON.stringify(S.edicao, null, 1)], { type: 'application/json' }))) falhou++;
  status('gerando a miniatura da tarefa…');
  const mini = await gerarMiniatura(canvasPg1);
  return { ok, falhou, salvou, mini, arquivos, pasta };
}
// Depois de exportar: "Abrir pasta" chama o programa do Windows (smd-tarefas-desktop
// >= 0.2.1 atende somado-tarefas://abrir-pasta e abre no Explorer); "Copiar caminho"
// serve sem o programa (colar na barra do Explorer). Caminho no jeito do Windows,
// com os espaços exatamente como estão no disco.
let pastaExportada = '';
function mostrarAbrirPasta(pasta) {
  pastaExportada = pasta ? (pasta.replace(/[\\/]+$/, '') + '/1x').replace(/\//g, '\\') : '';
  $('#ex-abrir').classList.toggle('oculto', !pastaExportada);
}
$('#ex-abrir-pasta').onclick = () => {
  if (pastaExportada) location.href = 'somado-tarefas://abrir-pasta?caminho=' + encodeURIComponent(pastaExportada);
};
$('#ex-copiar').onclick = async () => {
  if (!pastaExportada) return;
  try { await navigator.clipboard.writeText(pastaExportada); aviso('Caminho copiado: cole na barra do Explorer'); }
  catch { aviso('Não consegui copiar'); }
};
// alternativa antiga: gera aqui, com a aba aberta até acabar
$('#ex-trabalho').onclick = async () => {
  const pasta = pastaDoCampo();
  if (!pasta) return aviso('Defina a pasta de trabalho');
  const bt = $('#ex-trabalho'); bt.disabled = true;
  try {
    const r = await exportarNoNavegador(pasta, { status: t => { $('#ex-status').textContent = t; } });
    $('#ex-status').textContent = `${r.ok} prancheta(s) salvas em ${pasta}/1x`
      + (r.falhou ? ` · ${r.falhou} arquivo(s) não gravaram` : '')
      + (r.salvou ? ' · versão guardada' : ' · edição NÃO salva')
      + (r.mini ? '' : ' · miniatura não gravou');
    mostrarAbrirPasta(r.ok ? pasta : '');
  } catch (e) {
    $('#ex-status').textContent = e.message === 'sessao' ? 'Sessão expirou: entre de novo no Somado Tarefas.' : 'Erro ao salvar: ' + e.message;
  } finally { bt.disabled = false; }
};

// ---------------------------------------------------------------- exportar na VPS
// O jeito normal desde 08/10/2026: salva a edição, pede a exportação e libera. A VPS gera um
// pedido por vez (POST/GET /api/encarte/edicoes/[id]/exportar); dá pra fechar a tela.
let tExportVps = null;
function textoExportVps(e) {
  if (!e) return '';
  const hora = iso => iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
  if (e.status === 'fila') return 'Na fila da VPS' + (e.naFrente ? ` (${e.naFrente} na frente)` : '') + '. Pode fechar esta tela.';
  if (e.status === 'gerando') return (e.prancheta && e.total ? `VPS gerando prancheta ${e.prancheta} de ${e.total}…` : `VPS: ${e.mensagem || 'começando'}…`) + ' Pode fechar esta tela.';
  if (e.status === 'pronto') return `Pronto às ${hora(e.terminadoEm)}: ${(e.arquivos || []).length} prancheta(s) em ${e.pasta}/1x`
    + (e.mensagem ? ` · ${e.mensagem}` : '') + '. O Drive recebe em ~1 min.';
  return `Erro na exportação (${hora(e.terminadoEm)}): ${e.mensagem || 'sem detalhe'}`;
}
async function acompanharExportVps(e) {
  clearTimeout(tExportVps); tExportVps = null;
  if (SO_EXPORTAR || !S.edicao || location.hostname === '127.0.0.1') return;
  if (e === undefined) {
    const d = await apiJson(`/edicoes/${encodeURIComponent(S.edicao.id)}/exportar`).catch(() => null);
    e = d ? d.exportacao : null;
  }
  const el = $('#ex-vps-status'); if (el) { el.textContent = textoExportVps(e) || 'A VPS gera as pranchetas sozinha: pode fechar a tela depois de pedir.'; el.dataset.status = e ? e.status : ''; }
  mostrarAbrirPasta(e && e.status === 'pronto' ? e.pasta : '');
  if (e && (e.status === 'fila' || e.status === 'gerando')) tExportVps = setTimeout(() => acompanharExportVps(), 3000);
}
// Editor aberto pelo programa do Windows (servidor do encarte no PC, SMD-1146): não tem VPS no
// caminho. O botão principal gera aqui mesmo, com o template que está na tela, e grava direto na
// pasta do G: — a VPS usaria a cópia dela do template, que pode estar atrasada.
const NO_PC = location.hostname === '127.0.0.1';
if (NO_PC) {
  $('#ex-vps').textContent = 'Salvar na pasta de trabalho (Prancheta N.jpg em 1x/)';
  $('#ex-vps-status').textContent = 'Gera aqui no PC e grava direto na pasta. Espere terminar antes de fechar.';
  // no programa sobra só o salvar (pedido do Matheus, 21/10): o resto é da web
  for (const id of ['#ex-trabalho', '#ex-pagina', '#ex-todas', '#ex-produtos']) $(id).classList.add('oculto');
  // disquete = salva a edição, gera as pranchetas na pasta e abre a pasta no Explorer
  const disquete = $('#ed-salvar');
  disquete.removeAttribute('data-abre');
  disquete.title = 'Salvar: gera as pranchetas na pasta de trabalho e abre a pasta';
  disquete.onclick = async () => {
    if (disquete.disabled) return;
    await prepararPastaTrabalho();
    const pasta = pastaDoCampo();
    // sem pasta (cliente sem TEMPLATES no caminho): abre o Exportar pra colar o caminho
    if (!pasta) return abrirSheet('sh-exportar');
    disquete.disabled = true;
    const st = $('#ed-salvo');
    try {
      const r = await exportarNoNavegador(pasta, { status: t => { st.textContent = t; } });
      st.textContent = `${r.ok} prancheta(s) na pasta` + (r.falhou ? ` · ${r.falhou} não gravaram` : '');
      if (r.ok) {
        mostrarAbrirPasta(pasta);
        $('#ex-abrir-pasta').click();
      } else aviso('Nada foi gravado na pasta');
    } catch (e) {
      st.textContent = e.message === 'sessao' ? 'Sessão expirou: abra o encarte de novo pelo programa.' : 'Erro ao salvar: ' + e.message;
    } finally { disquete.disabled = false; }
  };
}
$('#ex-vps').onclick = async () => {
  const pasta = pastaDoCampo();
  if (!pasta) return aviso('Defina a pasta de trabalho');
  const bt = $('#ex-vps'); bt.disabled = true;
  const el = $('#ex-vps-status');
  if (NO_PC) {
    try {
      const r = await exportarNoNavegador(pasta, { status: t => { el.textContent = t; } });
      el.textContent = `${r.ok} prancheta(s) salvas em ${pasta}/1x`
        + (r.falhou ? ` · ${r.falhou} arquivo(s) não gravaram` : '')
        + (r.salvou ? ' · versão guardada' : ' · edição NÃO salva');
      mostrarAbrirPasta(r.ok ? pasta : '');
    } catch (e) {
      el.textContent = e.message === 'sessao' ? 'Sessão expirou: abra o encarte de novo pelo programa.' : 'Erro ao salvar: ' + e.message;
    } finally { bt.disabled = false; }
    return;
  }
  try {
    S.edicao.pastaTrabalho = pasta;
    el.textContent = 'salvando a edição…';
    if (!await salvar({ versao: true })) { el.textContent = 'A edição não salvou, então não pedi a exportação. Tente de novo.'; return; }
    const r = await api(`/edicoes/${encodeURIComponent(S.edicao.id)}/exportar`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pasta }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || r.status);
    await acompanharExportVps(d.exportacao);
  } catch (e) {
    el.textContent = e.message === 'sessao' ? 'Sessão expirou: entre de novo no Somado Tarefas.' : 'Não consegui pedir a exportação: ' + e.message;
  } finally { bt.disabled = false; }
};

function nomeBase() { return (S.edicao.titulo || 'encarte').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_'); }

$('#ex-pagina').onclick = async () => {
  $('#ex-status').textContent = 'gerando…';
  const pg = S.paginas[S.pagina];
  await entregar(await renderPng(pg, 2000 / pg.w), `${nomeBase()}_p${S.pagina + 1}.png`);
  $('#ex-status').textContent = 'pronto.';
};
$('#ex-todas').onclick = async () => {
  for (let i = 0; i < S.paginas.length; i++) {
    $('#ex-status').textContent = `página ${i + 1} de ${S.paginas.length}…`;
    const pg = S.paginas[i];
    const b = await renderPng(pg, 2000 / pg.w);
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `${nomeBase()}_p${i + 1}.png`; a.click();
  }
  $('#ex-status').textContent = 'pronto.';
};
$('#ex-produtos').onclick = async () => {
  const ps = ordemLeitura(S.produtos.filter(p => !p.removido && paginaDe(p) === S.pagina));
  let ok = 0;
  for (const p of ps) {
    $('#ex-status').textContent = `produto ${ok + 1} de ${ps.length}…`;
    const r = { ...p.cell };
    const b = await renderPng(r, 4, [p]);
    const nome = `${nomeBase()}_p${S.pagina + 1}_produto_${String(p.num).padStart(2, '0')}${p.rotulo !== p.num ? '_b' : ''}.png`;
    // no Somado Tarefas não há pasta exports/ no servidor: baixa no navegador
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = nome; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    ok++;
  }
  $('#ex-status').textContent = `${ok} produto(s) baixados`;
};

// ---------------------------------------------------------------- folhas, menu, teclado
function abrirSheet(id) {
  fecharSheets();
  $('#veu').classList.remove('oculto'); $('#' + id).classList.remove('oculto');
  if (id === 'sh-inspecionar') inspecionar();
  if (id === 'sh-exportar') { prepararPastaTrabalho(); acompanharExportVps(); }
}
function fecharSheets() { $$('.sheet').forEach(s => s.classList.add('oculto')); $('#veu').classList.add('oculto'); }
$('#veu').onclick = fecharSheets;
document.addEventListener('click', e => {
  const a = e.target.closest('[data-abre]'); if (a) abrirSheet(a.dataset.abre);
  if (e.target.closest('[data-fecha]')) fecharSheets();
});
$('#ed-menu').onclick = () => { limparSelecao(); painel(); };
// seções do painel do produto: lembra quais o usuário deixou abertas (por navegador)
for (const d of $$('.pp-sec[data-sec]')) {
  try { const v = localStorage.getItem('encarte.sec.' + d.dataset.sec); if (v) d.open = v === '1'; } catch (e) {}
  d.addEventListener('toggle', () => { try { localStorage.setItem('encarte.sec.' + d.dataset.sec, d.open ? '1' : '0'); } catch (e) {} });
}
$('#ed-desfazer').onclick = desfazer;
// ‹ salva, atualiza a miniatura se mexeu desde a última e volta pra tarefa (ou pra lista)
$('#ed-voltar').onclick = async () => {
  const bt = $('#ed-voltar'); if (bt.disabled) return;
  bt.disabled = true;
  try {
    clearTimeout(tSalvar);
    if (S.edicao && S.carregado) {
      $('#ed-salvo').textContent = 'salvando…';
      await salvar();
      if (S.mexeuDesdeMini) { $('#ed-salvo').textContent = 'gerando miniatura…'; await gerarMiniatura(); }
    }
  } finally { bt.disabled = false; }
  if (VOLTA) { S.edicao = null; location.href = VOLTA; return; }
  try { const u = new URL(location.href); u.searchParams.delete('edicao'); history.replaceState(null, '', u); } catch (e) { /* ok */ }
  telaInicio();
};

// "Editar template": salva e abre o construtor no projeto do template, numa aba própria
// (reusa a mesma aba se já estiver aberta). Ao publicar lá, esta tela reabre com o template novo.
$('#ed-template').onclick = async () => {
  if (!S.projetoTpl) return;
  const aba = window.open('', 'construtor-' + S.projetoTpl); // abre já no clique (bloqueador de pop-up)
  if (S.edicao && S.carregado) await salvar();
  const url = `/construtor-template/index.html#${encodeURIComponent(S.projetoTpl)}`;
  if (aba) aba.location.href = url; else location.href = url;
};
try {
  new BroadcastChannel('smd-encarte-template').onmessage = async ev => {
    const m = ev.data || {};
    if (m.tipo !== 'publicado' || !S.edicao || !S.projetoTpl || m.projeto !== S.projetoTpl) return;
    if (S.carregado && !(await salvar())) return; // conflito/erro: não reabre por cima do que está na tela
    await abrirEdicao(S.edicao.id);
    $('#ed-salvo').textContent = 'template atualizado';
  };
} catch (e) { /* navegador sem BroadcastChannel: recarregar à mão (F5) */ }

document.addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('input, textarea, select')) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); return desfazer(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); return S.selLinha ? duplicarLinha() : duplicarFoto(); }
  // ordem da foto, pela tecla física (como Ctrl+[ / Ctrl+] do Illustrator): no ABNT2 são o ´ (trás)
  // e o [ (frente); com Shift vai pro fundo / pro topo
  if ((e.ctrlKey || e.metaKey) && (e.code === 'BracketLeft' || e.code === 'BracketRight')) {
    e.preventDefault(); return moverZ(e.code === 'BracketRight', e.shiftKey);
  }
  if (e.key === 'Escape') { limparSelecao(); return painel(); }
  const passo = e.shiftKey ? 10 : 1;
  const mv = { ArrowLeft: [-passo, 0], ArrowRight: [passo, 0], ArrowUp: [0, -passo], ArrowDown: [0, passo] }[e.key];
  const ln = linhaSel();
  if (mv && ln) { e.preventDefault(); mudarLinhas(idsLinhasSel(), l => deslocarLinha(l, mv[0], mv[1])); }
  else if (mv && S.selImgs.length) {
    e.preventDefault(); marcar(...new Set(S.selImgs.map(prodDe)));
    for (const im of S.selImgs) { const r = retFoto(im); posFoto(im, { ...r, x: r.x + mv[0], y: r.y + mv[1] }); }
    mudou();
  } else if (mv && S.bloco) { e.preventDefault(); moverBloco(mv[0], mv[1]); }
  else if (mv && S.selTexto) { e.preventDefault(); mexerTexto(mv[0], mv[1]); }
  else if (mv && S.selProds.size) { e.preventDefault(); const ps = [...S.selProds]; marcar(...ps); moverCards(ps, mv[0], mv[1]); desenharSelecao(); mudou(); }
  if ((e.key === 'Delete' || e.key === 'Backspace') && ln) { e.preventDefault(); apagarLinhasSel(); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && S.selImgs.length) { e.preventDefault(); apagarFotos(); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && S.bloco && ehApoio(S.bloco.tipo)) { e.preventDefault(); apagarApoio(); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && S.bloco && S.bloco.tipo === 'logo') { e.preventDefault(); apagarLogo(); }
});
window.addEventListener('beforeunload', () => { if (S.edicao && tSalvar) salvar({ saindo: true }); });
$('#alerta-x').onclick = () => alerta('');
$('#tpl-atualizar').onclick = () => atualizarTemplate();
$('#tpl-depois').onclick = () => { S.tplAvisoFechado = true; avisoTemplateMudou(); };
$('#bt-atualizar-tpl').onclick = () => atualizarTemplate();

if (URLP.get('edicao')) abrirEdicao(URLP.get('edicao'));
else telaInicio();
