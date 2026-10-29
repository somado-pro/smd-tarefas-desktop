// ---------------------------------------------------------------- modelo do card (SMD-1150)
// Editar o modelo do card dentro do encarte, como abrir um grupo no Illustrator (Matheus, 21/10/2026):
// o resto fica cinza, só o card clicado em destaque. Ali ele mexe nas peças (lugar, tamanho, cor, fonte)
// e escolhe:
//   - Só neste encarte: vale pros cards do mesmo modelo nesta edição. Template do construtor: a ficha
//     guarda `modelosAj` (% do card) e o servidor gera o SVG do template com o ajuste (?aj=, mesmo gerador
//     da publicação). Template do Illustrator: a ficha guarda `modeloAjPt` (pt) e o editor aplica nos
//     cards da mesma zona antes de ler o template.
//   - Salvar no template (só construtor): o ajuste entra no projeto e o template é republicado; vale pros
//     próximos encartes e pros outros cards do mesmo modelo.
// Usa o estado e as funções do app.js (S, $, api, salvar, abrirEdicao…).

// id da peça (sem o número do card) → chave do campo no construtor
const PECAS_MODELO = {
  produto_N_nome: 'nome', produto_N_nome_texto: 'nome', fundo_nome_N: 'nome_fundo',
  PRECO_N: 'grupo_preco', PRECO: 'grupo_preco', fundo_preco_N: 'preco_fundo', fundo_preco: 'preco_fundo',
  fundo_moeda_N: 'moeda_fundo', moeda_N: 'moeda', moeda: 'moeda',
  produto_N_preco_real: 'preco', produto_N_preco: 'preco', produto_N_preco_centavos: 'centavos', produto_N_formato: 'unidade',
  produto_N_qtd_max: 'limite', produto_N_de: 'grupo_de', de_fundo_N: 'de_fundo', de_rotulo_N: 'de_rotulo', produto_N_preco_de: 'de_valor',
  produto_N_selo: 'grupo_selo', selo_fundo_N: 'selo_fundo', selo_rotulo_N: 'selo_rotulo', moeda_selo_N: 'selo_moeda', produto_N_valor_selo: 'selo_valor',
  produto_N_gatilho: 'gatilho', produto_N_tarja_fundo: 'gatilho_fundo', MARGEM_GRID_N: 'fundo_card', MARGEM_GRID: 'fundo_card', produto_N_area: 'area',
};
const ROTULO_PECA = {
  nome: 'Nome', grupo_nome: 'Nome com o fundo', nome_fundo: 'Fundo do nome', grupo_preco: 'Grupo do preço', preco_fundo: 'Fundo do preço',
  moeda_fundo: 'Fundo do R$', moeda: 'R$', preco: 'Preço', centavos: 'Centavos', unidade: 'Unidade (KG/UN)', limite: 'Limite',
  grupo_de: 'Preço DE', de_fundo: 'Fundo do DE', de_rotulo: 'Rótulo do DE', de_valor: 'Valor do DE', grupo_selo: 'Selo do clube',
  selo_fundo: 'Fundo do selo', selo_rotulo: 'Nome do clube', selo_moeda: 'R$ do selo', selo_valor: 'Preço do selo',
  gatilho: 'Frase do atacado', gatilho_fundo: 'Tarja do atacado', fundo_card: 'Fundo do card', area: 'Área da foto',
};
const SO_COR = new Set(['fundo_card']);

/** Chave da peça de um elemento do card (null = não é peça). */
function chavePeca(n) {
  if (!n || !n.id) return n && n.classList && n.classList.contains('ed-img') ? 'area' : null;
  const id = n.id.replace(/-\d+$/, '').replace(/_g$/, '');
  const ex = id.match(/^extra_\d+_(\d+)$/);
  if (ex) return 'extras.' + (+ex[1] - 1);
  if (/_var_\d+_imagem$/.test(id) || (n.classList && n.classList.contains('ed-img'))) return 'area';
  const k = PECAS_MODELO[id.replace(/_\d+(?=_|$)/g, '_N')];
  // nome com fundo (construtor): o <g> produto_NN_nome é o fundo + o texto juntos
  if (k === 'nome' && n.tagName === 'g' && n.querySelector('[id^="fundo_nome_"]')) return 'grupo_nome';
  return k || null;
}
// as peças do card, na ordem do documento (o elemento mais de fora de cada chave; a área leva as fotos)
function pecasDoCard(g) {
  const m = new Map();
  for (const n of $$('[id], .ed-img', g)) {
    const k = chavePeca(n); if (!k) continue;
    if (!m.has(k)) m.set(k, []);
    const l = m.get(k);
    if (!l.some(x => x.contains(n))) l.push(n);
  }
  return m;
}
const rotuloPeca = k => ROTULO_PECA[k] || (k.startsWith('extras.') ? 'Enfeite ' + (+k.slice(7) + 1) : k);
const ehGrupoPeca = k => /^grupo_/.test(k);
const temTexto = els => els.some(e => e.tagName === 'text' || e.querySelector('text'));

// matriz do espaço do pai do elemento → espaço do card
function matrizNoCard(e, card) { return matrizAteRaiz(card).inverse().multiply(matrizAteRaiz(e.parentNode)); }
function caixaNoCard(els, card) {
  const inv = matrizAteRaiz(card).inverse();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of els) {
    let b; try { b = e.getBBox(); } catch (er) { continue; }
    if (!b.width && !b.height) continue;
    const m = inv.multiply(matrizAteRaiz(e));
    for (const [x, y] of [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]) {
      const pt = S.svg.createSVGPoint(); pt.x = x; pt.y = y; const q = pt.matrixTransform(m);
      x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y);
    }
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Aplica o ajuste (em pt do card) nos elementos de uma peça: anda e escala pela transformação do próprio
 * elemento (vale pra texto, forma, imagem e grupo); cor e fonte pelo style. O grupo do preço cresce do
 * canto de baixo-direito, como no construtor; o resto, do meio.
 */
function aplicarPecaPt(card, chave, els, aj) {
  if (!els || !els.length) return;
  const s = aj.esc || 1, dx = aj.dx || 0, dy = aj.dy || 0;
  if (s !== 1 || dx || dy) {
    const U = caixaNoCard(els, card);
    if (U) {
      const ox = chave === 'grupo_preco' ? U.x + U.w : U.x + U.w / 2, oy = chave === 'grupo_preco' ? U.y + U.h : U.y + U.h / 2;
      // T(o + d) · S(s) · T(-o), no espaço do card; levado pro espaço do pai de cada elemento
      const T = S.svg.createSVGMatrix().translate(ox + dx, oy + dy).scale(s).translate(-ox, -oy);
      // grupo: vai nas peças de dentro (o editor reescreve o transform do grupo do preço e do nome
      // quando monta o card, e o ajuste sumia no template do Illustrator)
      const folhas = es => es.flatMap(e => e.tagName === 'g' ? folhas([...e.children]) : ['defs', 'title', 'desc', 'style'].includes(e.tagName) ? [] : [e]);
      for (const e of folhas(els)) {
        const M = matrizNoCard(e, card), L = M.inverse().multiply(T).multiply(M);
        const atual = e.transform && e.transform.baseVal.consolidate();
        // texto: a letra cresce pelo font-size e só o ponto de âncora anda (escala na transformação
        // somava com o encaixe do editor, que mede a largura e escolhe a letra: o preço saía 1,44×)
        if (e.tagName === 'text') { escalarTexto(e, M, T, s, atual); continue; }
        const f = atual ? L.multiply(atual.matrix) : L;
        e.setAttribute('transform', `matrix(${[f.a, f.b, f.c, f.d, f.e, f.f].map(v => +v.toFixed(4)).join(' ')})`);
      }
    }
  }
  if (aj.cor) for (const e of els) for (const n of [e, ...$$('text, tspan, rect, path, circle, ellipse, polygon', e)]) if (n.tagName !== 'g') n.style.fill = aj.cor;
  if (aj.fonte) for (const e of els) for (const n of [e, ...$$('text, tspan', e)]) if (n.tagName === 'text' || n.tagName === 'tspan') n.style.fontFamily = `'${aj.fonte}'`;
}
function escalarTexto(e, M, T, s, atual) {
  const m0 = atual ? atual.matrix : S.svg.createSVGMatrix();
  const pt = S.svg.createSVGPoint(); pt.x = m0.e; pt.y = m0.f;
  const q = pt.matrixTransform(M).matrixTransform(T).matrixTransform(M.inverse());
  e.setAttribute('transform', `matrix(${[m0.a, m0.b, m0.c, m0.d, q.x, q.y].map(v => +v.toFixed(4)).join(' ')})`);
  if (s === 1) return;
  // mede tudo antes de mudar (o tspan sem tamanho próprio herda o do texto já mudado)
  const nos = [e, ...$$('tspan', e)], pai = parseFloat(getComputedStyle(e).fontSize);
  const tams = nos.map(n => parseFloat(getComputedStyle(n).fontSize));
  nos.forEach((n, i) => {
    if (tams[i] && (n === e || Math.abs(tams[i] - pai) > 0.01)) n.style.fontSize = (tams[i] * s) + 'px';
  });
  for (const n of nos) {
    // linhas de baixo (tspan com x/y próprios): o vão entre elas cresce junto
    for (const at of ['x', 'y', 'dx', 'dy']) { const v = n !== e && n.getAttribute(at); if (v && /^-?[\d.]+$/.test(v)) n.setAttribute(at, +v * s); }
  }
  const sw = parseFloat(getComputedStyle(e).strokeWidth); if (sw) e.style.strokeWidth = sw * s;
}
function aplicarAjusteNoCard(card, pecas) {
  for (const [k, aj] of Object.entries(pecas || {})) aplicarPecaPt(card, k, pecasDoCard(card).get(k), aj);
}

/** Template do Illustrator: os ajustes "só neste encarte" entram nos cards antes de ler o template. */
function aplicarModeloAjPt(lista) {
  for (const a of Array.isArray(lista) ? lista : []) for (const id of a.cards || []) {
    const g = S.svg.getElementById(id); if (g) aplicarAjusteNoCard(g, a.pecas);
  }
}
/** Pedido do SVG do template do construtor com o ajuste da edição (POST: o modelo trocado inteiro não cabe na URL). */
function ajPedido() {
  const a = S.edicao && S.edicao.modelosAj;
  return Array.isArray(a) && a.length ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ aj: a }) } : {};
}

const ISO = { on: false, pecas: {} };
function versaoDoCard(p) {
  if (p.g.getAttribute('data-formato') === 'horizontal') return 'horizontal';
  return p.molde === 'normal' ? 'campos' : 'especial';
}
function somarAjPt(a, b) {
  const o = { ...a };
  if (b.dx) o.dx = (a.dx || 0) + b.dx;
  if (b.dy) o.dy = (a.dy || 0) + b.dy;
  if (b.esc) o.esc = (a.esc || 1) * b.esc;
  if (b.cor) o.cor = b.cor;
  if (b.fonte) o.fonte = b.fonte;
  return o;
}

function entrarModeloCard(p) {
  if (!p || ISO.on || MC.quadro || !S.carregado) return;
  const dm = p.g.getAttribute('data-modelo');
  // template do construtor: o editor de modelo do construtor inteiro (abaixo); o modo isolado fica pro
  // template do Illustrator, que não tem projeto
  if (S.projetoTpl && dm) return abrirModeloCompleto(p, +dm);
  limparSelecao(); painel();
  // o card (uma cópia; o p.g sai da tela e volta igual) fica em cima de um véu cinza, num grupo com a
  // mesma transformação de onde ele mora
  const m = matrizAteRaiz(p.g.parentNode), vb = S.svg.viewBox.baseVal;
  const veu = el('rect', { x: vb.x - 10, y: vb.y - 10, width: vb.width + 20, height: vb.height + 20, fill: '#1b1d21', 'fill-opacity': 0.62, class: 'iso-veu' });
  const wrap = el('g', { class: 'iso-card', transform: `matrix(${[m.a, m.b, m.c, m.d, m.e, m.f].join(' ')})` });
  const ui = el('g', { class: 'iso-ui', 'pointer-events': 'none' });
  Object.assign(ISO, {
    on: true, p, construtor: !!(S.projetoTpl && dm), modelo: dm ? +dm : 0, versao: versaoDoCard(p), pecas: {}, sel: null,
    pai: p.g.parentNode, prox: p.g.nextSibling, orig: p.g.cloneNode(true), veu, wrap, ui,
  });
  S.svg.append(veu, wrap, ui);
  p.g.remove();
  veu.addEventListener('click', () => sairModeloCard());
  abrirPainelIso();
  redesenharIso();
}

// refaz o card do zero (cópia guardada) e aplica tudo que foi mexido: desfazer é só tirar do mapa
function redesenharIso() {
  const novo = ISO.orig.cloneNode(true);
  ISO.wrap.replaceChildren(novo); ISO.card = novo;
  aplicarAjusteNoCard(novo, ISO.pecas);
  ISO.ui.replaceChildren();
  const ps = pecasDoCard(novo);
  if (ISO.sel && ps.get(ISO.sel)) {
    const b = retUniao(ps.get(ISO.sel));
    if (b) ISO.ui.appendChild(el('rect', { x: b.x - 2, y: b.y - 2, width: b.w + 4, height: b.h + 4, fill: 'none', stroke: '#ffcc00', 'stroke-width': 2, 'stroke-dasharray': '6 4', 'vector-effect': 'non-scaling-stroke' }));
  }
  atualizarPainelIso(ps);
}
function retUniao(els) {
  const bs = els.map(e => { try { return retSvgBBox(e); } catch (er) { return null; } }).filter(b => b && (b.w || b.h));
  if (!bs.length) return null;
  const x0 = Math.min(...bs.map(b => b.x)), y0 = Math.min(...bs.map(b => b.y));
  return { x: x0, y: y0, w: Math.max(...bs.map(b => b.x + b.w)) - x0, h: Math.max(...bs.map(b => b.y + b.h)) - y0 };
}

// Nome preso pela regra do cliente (padroes_mercado: titulo no topo/pé com margem): o editor põe o nome
// no lugar da regra em todo card, então mover no modelo não aparecia. Avisa e não deixa mover (Matheus,
// 21/10/2026: "deveria ser comunicado na tela").
const PECAS_DO_NOME = new Set(['nome', 'grupo_nome', 'nome_fundo']);
function nomePresoPelaRegra(p) {
  return !!(S.padrao && S.padrao.titulo && S.padrao.titulo.segue !== 'preco' && !nomeNaTarja(p) && !(p.base.nomeNoPreco && p.precoG && p.precoG !== p.g));
}
function motivoNomePreso() {
  const R = regra('titulo'), onde = R.y === 'bottom' ? 'no pé do card' : 'no topo do card';
  return `Não dá pra mover o nome: a regra deste cliente põe o nome ${onde}, a ${R.my} pt da borda, em todos os cards. Cor, fonte e tamanho funcionam.`;
}
const nomeTravado = k => PECAS_DO_NOME.has(k) && nomePresoPelaRegra(ISO.p);

function mexerPeca(aj) {
  const k = ISO.sel; if (!k) return aviso('Toque numa peça do card');
  if (SO_COR.has(k) && (aj.dx || aj.dy || aj.esc)) return aviso('O fundo do card só muda a cor (o tamanho é o da casa)');
  if ((aj.dx || aj.dy) && nomeTravado(k)) return aviso(motivoNomePreso(), 6000);
  ISO.pecas[k] = somarAjPt(ISO.pecas[k] || {}, aj);
  redesenharIso();
}

function sairModeloCard(semPerguntar) {
  if (!ISO.on) return;
  if (!semPerguntar && Object.keys(ISO.pecas).length && !confirm('Sair sem aplicar? O que você mexeu no modelo do card se perde.')) return;
  const { p, pai, prox } = ISO;
  if (prox && prox.parentNode === pai) pai.insertBefore(p.g, prox); else pai.appendChild(p.g);
  ISO.veu.remove(); ISO.wrap.remove(); ISO.ui.remove();
  ISO.on = false; ISO.pecas = {}; ISO.sel = null;
  $('#iso-painel').classList.add('oculto');
  desenharSelecao();
}

// pt do card → % do card (o construtor guarda as posições em % do card)
function pecasEmPct() {
  const w = ISO.p.cell.w, h = ISO.p.cell.h, out = {};
  for (const [k, a] of Object.entries(ISO.pecas)) {
    const o = {};
    if (a.dx) o.dx = Math.round(a.dx / w * 10000) / 100;
    if (a.dy) o.dy = Math.round(a.dy / h * 10000) / 100;
    if (a.esc && Math.abs(a.esc - 1) > 1e-3) o.esc = Math.round(a.esc * 1000) / 1000;
    if (a.cor) o.cor = a.cor;
    if (a.fonte) o.fonte = a.fonte;
    if (Object.keys(o).length) out[k] = o;
  }
  return out;
}
// junta o ajuste novo no que a ficha já tinha pro mesmo alvo (mesma conta do servidor: juntarAjustes)
function juntarLista(lista, item, chave) {
  const l = (Array.isArray(lista) ? lista : []).map(x => ({ ...x, pecas: { ...x.pecas } }));
  const ja = l.find(x => chave(x) === chave(item));
  if (!ja) { l.push(item); return l; }
  for (const [k, v] of Object.entries(item.pecas)) ja.pecas[k] = ja.pecas[k] ? somarAjPt(ja.pecas[k], v) : v;
  return l;
}
const chaveModelo = x => `${x.modelo}|${x.versao}`;

// cards da mesma zona e do mesmo molde (template do Illustrator), pelos ids do template
function cardsDoMesmoModelo(p) {
  return S.produtos.filter(q => !q.novo && q.zona === p.zona && q.molde === p.molde).map(q => q.g.id);
}

async function aplicarSoAqui() {
  if (!Object.keys(ISO.pecas).length) return aviso('Nada mexido ainda');
  const ed = S.edicao;
  if (ISO.construtor) ed.modelosAj = juntarLista(ed.modelosAj, { modelo: ISO.modelo, versao: ISO.versao, pecas: pecasEmPct() }, chaveModelo);
  else ed.modeloAjPt = juntarLista(ed.modeloAjPt, { cards: cardsDoMesmoModelo(ISO.p), pecas: { ...ISO.pecas } }, x => [...x.cards].sort().join(','));
  await recarregarComModelo('Modelo do card ajustado neste encarte');
}

async function salvarNoTemplateIso(forcar) {
  if (!ISO.construtor) return aviso('Template do Illustrator: só dá pra aplicar neste encarte');
  const ed = S.edicao, chave = chaveModelo(ISO);
  // o que já estava "só neste encarte" pra este modelo vai junto (é o que está na tela)
  const ja = (ed.modelosAj || []).filter(x => chaveModelo(x) === chave);
  const ajustes = juntarLista(ja, { modelo: ISO.modelo, versao: ISO.versao, pecas: pecasEmPct() }, chaveModelo);
  if (!Object.keys(ajustes[0].pecas).length) return aviso('Nada mexido ainda');
  if (!forcar && !confirm('Salvar no template? Vale pros próximos encartes e pros outros cards deste modelo. O template é republicado.')) return;
  const bt = $('#iso-salvar-tpl'); bt.disabled = true; aviso('Salvando no template…', 8000);
  try {
    const r = await api(`/projetos-template/${encodeURIComponent(S.projetoTpl)}/ajustar-modelo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ajustes, forcar: !!forcar }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.status === 409 && d.pendente) {
      bt.disabled = false;
      if (confirm('O construtor tem mudança neste template que ainda não foi publicada. Publicar junto com o ajuste do card?')) return salvarNoTemplateIso(true);
      return;
    }
    if (!r.ok) throw new Error(d.error || r.status);
    ed.modelosAj = (ed.modelosAj || []).filter(x => chaveModelo(x) !== chave);
    bt.disabled = false;
    await recarregarComModelo('Salvo no template e republicado');
  } catch (e) {
    bt.disabled = false;
    alerta(e.message === 'sessao' ? 'Sessão expirou: entre de novo no Somado Tarefas.' : 'Não salvou no template: ' + e.message);
  }
}

// grava a edição com o ajuste e reabre (o template é lido de novo, já com o ajuste)
async function recarregarComModelo(msg) {
  sairModeloCard(true);
  if (!(await salvar())) return;
  await abrirEdicao(S.edicao.id);
  aviso(msg, 3000);
}
async function tirarAjustesDoModelo() {
  const ed = S.edicao, p = ISO.p;
  if (!confirm('Tirar o ajuste do modelo deste card nesta edição? Ele volta como está no template.')) return;
  if (ISO.construtor) ed.modelosAj = (ed.modelosAj || []).filter(x => chaveModelo(x) !== chaveModelo(ISO));
  else ed.modeloAjPt = (ed.modeloAjPt || []).filter(x => !(x.cards || []).includes(p.g.id));
  await recarregarComModelo('O card voltou a seguir o template');
}
function temAjusteNaEdicao() {
  const ed = S.edicao;
  if (ISO.construtor) return (ed.modelosAj || []).some(x => chaveModelo(x) === chaveModelo(ISO));
  return (ed.modeloAjPt || []).some(x => (x.cards || []).includes(ISO.p.g.id));
}

// fontes que o servidor tem (as famílias do fontes.css)
let fontesIso = null;
async function listaFontes() {
  if (fontesIso) return fontesIso;
  const css = await textoFontesCss().catch(() => '');
  fontesIso = [...new Set([...css.matchAll(/font-family\s*:\s*["']?([^;"'}]+)/g)].map(m => m[1].trim()))].sort((a, b) => a.localeCompare(b));
  return fontesIso;
}

function abrirPainelIso() {
  $('#iso-painel').classList.remove('oculto');
  $('#iso-sub').textContent = ISO.construtor ? `${ISO.versao === 'campos' ? 'padrão' : ISO.versao} · modelo ${ISO.modelo}` : 'template do Illustrator · cards desta zona';
  $('#iso-salvar-tpl').classList.toggle('oculto', !ISO.construtor);
  $('#iso-dica').textContent = ISO.construtor
    ? 'Toque numa peça (ou escolha na lista) e arraste, use as setas, o tamanho, a cor ou a fonte.'
    : 'Template do Illustrator: o ajuste vale só neste encarte, nos cards desta zona.';
  $('#iso-tirar').classList.toggle('oculto', !temAjusteNaEdicao());
  listaFontes().then(fs => {
    const s = $('#iso-fonte'); if (s.options.length > 1) return;
    for (const f of fs) s.appendChild(new Option(f, f));
  });
}
function atualizarPainelIso(ps) {
  // camadas: uma linha por peça, na ordem do card (as de cima primeiro, como no construtor)
  const ks = [...ps.keys()], k = ISO.sel && ks.includes(ISO.sel) ? ISO.sel : '', els = k ? ps.get(k) : [];
  $('#iso-peca').replaceChildren(...ks.slice().reverse().map(c => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'iso-camada' + (c === k ? ' ativa' : '') + (ehGrupoPeca(c) ? ' grupo' : '');
    b.dataset.peca = c; b.setAttribute('role', 'option'); b.setAttribute('aria-selected', c === k);
    b.textContent = rotuloPeca(c) + (ISO.pecas[c] ? ' •' : '');
    return b;
  }));
  $('#iso-mover').classList.toggle('desligado', !k || SO_COR.has(k) || nomeTravado(k));
  $('#iso-motivo').textContent = k && nomeTravado(k) ? motivoNomePreso() : '';
  $('#iso-motivo').classList.toggle('oculto', !(k && nomeTravado(k)));
  $('#iso-tam').classList.toggle('desligado', !k || SO_COR.has(k));
  $('#iso-esc').textContent = Math.round(((ISO.pecas[k] || {}).esc || 1) * 100) + '%';
  $('#iso-cor-l').classList.toggle('oculto', !k || ehGrupoPeca(k) || k === 'area');
  $('#iso-fonte-l').classList.toggle('oculto', !k || ehGrupoPeca(k) || !temTexto(els));
  if (k && els[0]) {
    const alvo = els[0].tagName === 'g' ? (els[0].querySelector('text, rect, path') || els[0]) : els[0];
    const c = (ISO.pecas[k] && ISO.pecas[k].cor) || corHex(getComputedStyle(alvo).fill);
    if (c) $('#iso-cor').value = c;
  }
  $('#iso-fonte').value = (k && ISO.pecas[k] && ISO.pecas[k].fonte) || '';
}
function corHex(v) {
  const m = String(v || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? '#' + [m[1], m[2], m[3]].map(x => (+x).toString(16).padStart(2, '0')).join('') : null;
}

// ---------------------------------------------------------------- modelo do card completo (construtor)
// Template do construtor: o card é editado NA TELA do encarte e só o painel de ferramentas é o do
// construtor (Matheus, 22/10/2026: "editar na tela, só que o painel de ferramenta ser o do template, não
// ir para a página de template"). O painel é o editor de modelo do construtor num <iframe> ao lado
// (/construtor-template/?embutido&painel, ver embutido.js), sem o card dele: camadas, propriedades de cada
// peça, cor com degradê e transparência, regras, versões e formatos. O resto do encarte fica cinza e o
// card tocado em destaque; cada mudança no painel redesenha o encarte com o modelo novo (prévia, sem
// gravar), tocar numa peça do card seleciona ela no painel e arrastar move. No fim: "só neste encarte"
// grava o modelo na ficha (modelosAj, o servidor gera o template com ele) e "salvar no template" troca no
// projeto do construtor e republica. Fechar sem aplicar volta o encarte como estava.
const MC = { quadro: null, fr: null, p: null, gid: '', modelo: 0, versao: '', ajOrig: [], previa: null, tPrevia: 0, sel: null, veu: null, wrap: null, ui: null, pai: null, prox: null, carregando: false };
const clonarAj = a => JSON.parse(JSON.stringify(Array.isArray(a) ? a : []));
const responderMC = m => MC.fr && MC.fr.contentWindow.postMessage({ smdModelo: true, ...m }, location.origin);
async function abrirModeloCompleto(p, modelo) {
  limparSelecao(); painel();
  if (!(await salvar())) return; // o embutido lê os produtos da edição gravada
  Object.assign(MC, { p, gid: p.g.id, modelo, versao: versaoDoCard(p), ajOrig: clonarAj(S.edicao.modelosAj), previa: null, sel: null });
  const fr = document.createElement('iframe');
  fr.src = '/construtor-template/index.html?embutido=1&painel=1';
  fr.title = 'Modelo do card';
  MC.fr = fr; MC.quadro = document.createElement('div');
  MC.quadro.id = 'modelo-completo';
  MC.quadro.append(fr); document.body.append(MC.quadro);
  document.body.classList.add('mc-on');
  // aproxima no card (o painel come a lateral): a vista volta como estava ao fechar
  MC.vbAntes = S.vb && { ...S.vb };
  const b = retSvgBBox(p.g), f = 1.8;
  camera({ x: b.x + b.w / 2 - b.w * f / 2, y: b.y + b.h / 2 - b.h * f / 2, w: b.w * f, h: b.h * f });
  destacarCard();
}
// fecha o painel; com prévia na tela e sem aplicar, o encarte volta como estava
async function fecharModeloCompleto(aplicou) {
  if (!MC.quadro) return;
  clearTimeout(MC.tPrevia);
  // prévia no meio do redesenho: S.carregado fica falso e salvar não grava; espera ela acabar
  while (MC.carregando) await new Promise(r => setTimeout(r, 100));
  if (!MC.quadro) return; // fechou por outro caminho enquanto esperava
  MC.quadro.remove(); MC.quadro = MC.fr = null;
  document.body.classList.remove('mc-on');
  tirarDestaque();
  if (MC.vbAntes) { camera(MC.vbAntes); MC.vbAntes = null; }
  const tinhaPrevia = !!MC.previa || JSON.stringify(S.edicao.modelosAj || []) !== JSON.stringify(MC.ajOrig);
  MC.previa = null;
  if (!aplicou && tinhaPrevia) {
    S.edicao.modelosAj = MC.ajOrig;
    await recarregarPrevia();
    salvar();
  }
}

// o card tocado vai pra cima de um véu cinza (como o modo isolado), com a mesma matriz de onde mora
function destacarCard() {
  tirarDestaque();
  const p = S.produtos.find(q => q.g && q.g.id === MC.gid);
  if (!p || !p.g.parentNode) return;
  MC.p = p;
  const m = matrizAteRaiz(p.g.parentNode), vb = S.svg.viewBox.baseVal, mt = `matrix(${[m.a, m.b, m.c, m.d, m.e, m.f].join(' ')})`;
  // véu bem maior que a vista: zoom e a largura do palco mudam com o painel aberto
  MC.veu = el('rect', { x: vb.x - vb.width * 20, y: vb.y - vb.height * 20, width: vb.width * 41, height: vb.height * 41, fill: '#1b1d21', 'fill-opacity': 0.62, class: 'iso-veu' });
  MC.wrap = el('g', { class: 'iso-card', transform: mt });
  MC.ui = el('g', { class: 'iso-ui', 'pointer-events': 'none' }); // retUniao mede no espaço da raiz
  MC.pai = p.g.parentNode; MC.prox = p.g.nextSibling;
  S.svg.append(MC.veu, MC.wrap, MC.ui);
  MC.wrap.appendChild(p.g);
  marcarSelMC();
}
function tirarDestaque() {
  if (MC.wrap && MC.p && MC.p.g.parentNode === MC.wrap) {
    if (MC.prox && MC.prox.parentNode === MC.pai) MC.pai.insertBefore(MC.p.g, MC.prox); else if (MC.pai) MC.pai.appendChild(MC.p.g);
  }
  for (const k of ['veu', 'wrap', 'ui']) { if (MC[k]) MC[k].remove(); MC[k] = null; }
}
// chave da peça no SVG do encarte (chavePeca) ↔ seleção do construtor (M.sel)
const SEL_DE_PECA = { grupo_preco: 'g:preco', grupo_de: 'g:de', grupo_selo: 'g:selo', grupo_nome: 'g:produto', fundo_card: null };
const selDaPeca = k => k in SEL_DE_PECA ? SEL_DE_PECA[k] : k.startsWith('extras.') ? 'x' + k.slice(7) : k;
const PECA_DE_SEL = { 'g:preco': 'grupo_preco', 'g:de': 'grupo_de', 'g:selo': 'grupo_selo', 'g:produto': 'grupo_nome' };
const pecaDaSel = k => !k ? null : k.startsWith('g:') ? PECA_DE_SEL[k] || null : /^x\d+$/.test(k) ? 'extras.' + k.slice(1) : k;
function marcarSelMC() {
  if (!MC.ui || !MC.p) return;
  MC.ui.replaceChildren();
  const k = pecaDaSel(MC.sel), ps = pecasDoCard(MC.p.g);
  const els = (k && ps.get(k)) || (k === 'grupo_nome' && ps.get('nome'));
  const b = els && retUniao(els);
  if (b) MC.ui.appendChild(el('rect', { x: b.x - 2, y: b.y - 2, width: b.w + 4, height: b.h + 4, fill: 'none', stroke: '#ffcc00', 'stroke-width': 2, 'stroke-dasharray': '6 4', 'vector-effect': 'non-scaling-stroke' }));
}

// prévia: o encarte é refeito com o modelo do painel (sem buscar a edição de novo e sem gravar)
function agendarPrevia(modeloCard) {
  MC.previa = modeloCard;
  clearTimeout(MC.tPrevia);
  MC.tPrevia = setTimeout(async () => {
    if (!MC.quadro || !MC.previa) return;
    if (MC.carregando) return agendarPrevia(MC.previa);
    S.edicao.modelosAj = [...MC.ajOrig.filter(x => x.modelo !== MC.modelo), { modelo: MC.modelo, modeloCard: MC.previa }];
    await recarregarPrevia();
  }, 450);
}
async function recarregarPrevia() {
  MC.carregando = true;
  const vb = S.vb && { ...S.vb };
  try {
    tirarDestaque();
    await abrirEdicao(S.edicao.id, { ed: S.edicao });
    if (vb && S.svg) camera(vb);
    if (MC.quadro) destacarCard();
  } finally { MC.carregando = false; }
}

const ajusteDoModelo = (lista, modelo) => (Array.isArray(lista) ? lista : []).filter(x => x.modelo === modelo);
window.addEventListener('message', async ev => {
  const d = ev.data;
  if (!MC.quadro || ev.origin !== location.origin || ev.source !== MC.fr.contentWindow || !d || !d.smdModelo) return;
  const ed = S.edicao;
  if (d.tipo === 'pronto') responderMC({
    tipo: 'abrir', template: ed.template, projetoId: S.projetoTpl, aj: MC.ajOrig, modelo: MC.modelo, versao: MC.versao,
    casa: { w: MC.p.cell.w, h: MC.p.cell.h }, edicao: ed.id, produto: String(MC.p.nome || '').replace(/\s+/g, ' ').trim(),
    nomePreso: nomePresoPelaRegra(MC.p) ? motivoNomePreso().replace(' Cor, fonte e tamanho funcionam.', ' Cor, fonte e tamanho do nome funcionam; o lugar volta sozinho.') : '',
    temAjuste: ajusteDoModelo(MC.ajOrig, MC.modelo).length > 0,
  });
  else if (d.tipo === 'sel') {
    MC.sel = d.peca || null; marcarSelMC();
    if (d.modeloCard) agendarPrevia(d.modeloCard);
  }
  else if (d.tipo === 'fechar') fecharModeloCompleto(false);
  else if (d.tipo === 'so-aqui' || d.tipo === 'tirar') {
    // a troca já saiu do modelo com o ajuste que a edição tinha: substitui tudo deste modelo
    const resto = MC.ajOrig.filter(x => x.modelo !== MC.modelo);
    await fecharModeloCompleto(true);
    ed.modelosAj = d.tipo === 'tirar' ? resto : [...resto, { modelo: MC.modelo, modeloCard: d.modeloCard }];
    await recarregarComModelo(d.tipo === 'tirar' ? 'O card voltou a seguir o template' : 'Modelo do card ajustado neste encarte');
  } else if (d.tipo === 'salvar') {
    if (!(await salvarModeloNoTemplate(d.modeloCard, false))) responderMC({ tipo: 'erro' });
  }
});

// toque e arrasto no card em destaque: a peça é selecionada no painel e o arrasto vira 'mover'
// (fração do card; o painel converte pro card dele e a prévia redesenha o encarte)
function pecaDoAlvoMC(t) {
  for (let n = t; n && n !== MC.wrap && n !== S.svg; n = n.parentNode) { const k = chavePeca(n); if (k) return k; }
  return null;
}
document.addEventListener('pointerdown', e => {
  if (!MC.quadro || !MC.wrap || !e.target.closest) return;
  if (e.target === MC.veu) { e.stopPropagation(); e.preventDefault(); return; }
  if (!MC.wrap.contains(e.target)) return;
  e.stopPropagation(); e.preventDefault();
  const k = pecaDoAlvoMC(e.target), sel = k ? selDaPeca(k) : null;
  if (!sel) return;
  if (sel !== MC.sel) { MC.sel = sel; marcarSelMC(); responderMC({ tipo: 'selecionar', peca: sel }); }
  if (PECAS_DO_NOME.has(k) && nomePresoPelaRegra(MC.p)) return aviso(motivoNomePreso(), 6000);
  const inv = matrizAteRaiz(MC.wrap).inverse(), p0 = pontoSvg(e.clientX, e.clientY).matrixTransform(inv);
  const card = MC.p.cell, els = (pecasDoCard(MC.p.g).get(k) || []).map(n => [n, n.getAttribute('transform')]);
  let dx = 0, dy = 0;
  const mover = ev => {
    const p1 = pontoSvg(ev.clientX, ev.clientY).matrixTransform(inv);
    dx = p1.x - p0.x; dy = p1.y - p0.y;
    // só a peça anda na tela até soltar (aí o encarte se refaz com o modelo novo)
    for (const [n, t] of els) n.setAttribute('transform', `translate(${dx} ${dy})${t ? ' ' + t : ''}`);
    MC.ui.setAttribute('visibility', 'hidden');
  };
  const soltar = () => {
    document.removeEventListener('pointermove', mover, true); document.removeEventListener('pointerup', soltar, true);
    if (MC.ui) MC.ui.removeAttribute('visibility');
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    responderMC({ tipo: 'mover', peca: sel, fx: dx / card.w, fy: dy / card.h });
  };
  document.addEventListener('pointermove', mover, true);
  document.addEventListener('pointerup', soltar, true);
}, true);
for (const tipo of ['click', 'dblclick', 'pointerup', 'pointermove']) document.addEventListener(tipo, e => {
  if (!MC.quadro || !MC.wrap || !e.target.closest) return;
  if (MC.wrap.contains(e.target) || e.target === MC.veu) e.stopPropagation();
}, true);
async function salvarModeloNoTemplate(modeloCard, forcar) {
  if (!forcar && !confirm('Salvar no template? Vale pros próximos encartes e pros outros cards deste modelo. O template é republicado.')) return false;
  aviso('Salvando no template…', 8000);
  try {
    const r = await api(`/projetos-template/${encodeURIComponent(S.projetoTpl)}/ajustar-modelo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ajustes: [{ modelo: MC.modelo, modeloCard }], forcar: !!forcar }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.status === 409 && d.pendente) {
      if (confirm('O construtor tem mudança neste template que ainda não foi publicada. Publicar junto com o modelo do card? (O que mudou neste modelo lá fica como está aqui.)')) return salvarModeloNoTemplate(modeloCard, true);
      return false;
    }
    if (!r.ok) throw new Error(d.error || r.status);
  } catch (e) {
    alerta(e.message === 'sessao' ? 'Sessão expirou: entre de novo no Somado Tarefas.' : 'Não salvou no template: ' + e.message);
    return false;
  }
  await fecharModeloCompleto(true);
  S.edicao.modelosAj = MC.ajOrig.filter(x => x.modelo !== MC.modelo);
  await recarregarComModelo('Salvo no template e republicado');
  return true;
}

$('#iso-sair').onclick = () => sairModeloCard();
$('#iso-peca').onclick = e => { const b = e.target.closest('[data-peca]'); if (b) { ISO.sel = b.dataset.peca; redesenharIso(); } };
$('#iso-painel').addEventListener('click', e => {
  const mv = e.target.closest('[data-iso-mv]');
  if (mv) { const [x, y] = mv.dataset.isoMv.split(':').map(Number), k = e.shiftKey ? 10 : 1; mexerPeca({ dx: x * k, dy: y * k }); }
  const es = e.target.closest('[data-iso-esc]'); if (es) mexerPeca({ esc: +es.dataset.isoEsc });
});
$('#iso-cor').onchange = e => mexerPeca({ cor: e.target.value });
$('#iso-fonte').onchange = e => { if (e.target.value) mexerPeca({ fonte: e.target.value }); };
$('#iso-desfazer-peca').onclick = () => { if (ISO.sel) { delete ISO.pecas[ISO.sel]; redesenharIso(); } };
$('#iso-tirar').onclick = () => tirarAjustesDoModelo();
$('#iso-so-aqui').onclick = () => aplicarSoAqui();
$('#iso-salvar-tpl').onclick = () => salvarNoTemplateIso(false);
$('#pp-modelo').onclick = () => entrarModeloCard(S.sel);

// toque e arrasto dentro do card isolado (antes dos ouvintes do editor)
function pecaDoAlvo(t) {
  for (let n = t; n && n !== ISO.card && n !== S.svg; n = n.parentNode) { const k = chavePeca(n); if (k) return k; }
  return null;
}
document.addEventListener('pointerdown', e => {
  if (!ISO.on || !e.target.closest || e.target.closest('#iso-painel')) return;
  if (!ISO.wrap.contains(e.target)) return; // véu: o click dele sai
  e.stopPropagation(); e.preventDefault();
  const k = pecaDoAlvo(e.target);
  if (k && k !== ISO.sel) { ISO.sel = k; redesenharIso(); }
  if (!ISO.sel || SO_COR.has(ISO.sel)) return;
  if (nomeTravado(ISO.sel)) return aviso(motivoNomePreso(), 6000);
  const inv = matrizAteRaiz(ISO.wrap).inverse(), p0 = pontoSvg(e.clientX, e.clientY).matrixTransform(inv);
  const base = { ...(ISO.pecas[ISO.sel] || {}) }, k0 = ISO.sel;
  const mover = ev => {
    const p1 = pontoSvg(ev.clientX, ev.clientY).matrixTransform(inv);
    ISO.pecas[k0] = { ...base, dx: (base.dx || 0) + (p1.x - p0.x), dy: (base.dy || 0) + (p1.y - p0.y) };
    redesenharIso();
  };
  const soltar = () => { document.removeEventListener('pointermove', mover, true); document.removeEventListener('pointerup', soltar, true); };
  document.addEventListener('pointermove', mover, true);
  document.addEventListener('pointerup', soltar, true);
}, true);
for (const tipo of ['click', 'dblclick', 'pointerup', 'pointermove']) document.addEventListener(tipo, e => {
  if (!ISO.on || !e.target.closest || e.target.closest('#iso-painel')) return;
  if (ISO.wrap.contains(e.target) || (tipo !== 'click' && e.target === ISO.veu)) e.stopPropagation();
}, true);
document.addEventListener('keydown', e => {
  if (MC.quadro && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return fecharModeloCompleto(false); } // antes do embutido carregar
  if (!ISO.on || (e.target.closest && e.target.closest('input, textarea, select'))) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return sairModeloCard(); }
  const k = e.shiftKey ? 10 : 1;
  const mv = { ArrowLeft: [-k, 0], ArrowRight: [k, 0], ArrowUp: [0, -k], ArrowDown: [0, k] }[e.key];
  if (mv) { e.preventDefault(); e.stopPropagation(); mexerPeca({ dx: mv[0], dy: mv[1] }); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopPropagation(); if (ISO.sel) { delete ISO.pecas[ISO.sel]; redesenharIso(); } }
}, true);
