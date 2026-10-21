// Somado Encarte — conserta, ao abrir, três defeitos que o export SVG do Illustrator deixa no template.
// Carregado antes do app.js; a função fica global. O mesmo conserto existe no arquivo, pelo
// scripts/encarte/limpar_export.py (passo obrigatório depois de exportar). Aqui é a rede de proteção
// pra template que foi pro Drive sem passar pelo script.
//
// 1. Sombra exportada como imagem: o efeito de sombra vira <image … "<nome> embutida N.png"> (multiply)
//    dentro do nome ou do preço do produto, já com o texto de exemplo borrado. O editor troca só o texto
//    e fica um "texto fantasma" (ex.: "27" borrado atrás do preço novo). Tira a imagem e põe sombra por
//    filtro (feDropShadow) no grupo do texto.
// 2. Fundo do card num grupo FUNDO: o editor só estica o MARGEM_GRID, então o fundo ficava parado no
//    tamanho do template. Card sem MARGEM_GRID e com FUNDO (com <rect>) passa a tratar o FUNDO como
//    MARGEM_GRID.
// 3. Sombra do Illustrator com filterUnits="userSpaceOnUse" e sem área (x/y/width/height): a área
//    padrão é medida a partir da origem do texto no template, então o nome levado pra longe dali
//    (molde do especial no destaque, nome centrado) some pela esquerda ("ESODORANTE", Mais Perto
//    10/10/2026). A área passa a ser relativa ao próprio elemento (-20% / 140%).
// 4. Sombra de elemento de card com área fixa (x/y/width/height em userSpaceOnUse): a área é o lugar
//    do card no template, e o card esticado ou mudado de casa fica cortado nela. Mesma troca do 3.
//
// Conservador: só mexe em imagem com "embutida" no caminho, dentro do nome/preço de um card. Selo,
// enfeite, fundo de preço e foto embutida fora disso ficam como estão.
'use strict';

const SOMBRAS_EXPORT = {
  sombra_nome: { x: '-10%', y: '-30%', width: '120%', height: '170%', dx: 1, dy: 2.5, desvio: 2.5, opac: 0.35 },
  sombra_preco: { x: '-20%', y: '-20%', width: '150%', height: '150%', dx: 3, dy: 3, desvio: 2.5, opac: 0.6 },
};
// grupos que guardam o texto do nome ou do preço (o "-N" é o sufixo de id repetido do Illustrator)
const RE_TEXTO_CARD = /^(?:produto|especial)_\d+_(nome|preco|preco_(?:real|centavos)(?:_.+)?|preco_de(?:_real|_centavos)?)(?:-\d+)?$/;
const RE_CARD = /^PRODUTO_(?:\d+(?:_ESPECIAL)?|ESPECIAL(?:_\d+)?)(?:-\d+)?$/;
const RE_FUNDO = /^FUNDO(?:-\d+)?$/;

function ehImagemEmbutida(im) {
  const h = im.getAttribute('data-arq') || im.getAttribute('href') || im.getAttribute('xlink:href') ||
    im.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '';
  let t = h;
  try { t = decodeURIComponent(h); } catch (e) { /* fica o texto cru */ }
  return /embutida/i.test(t);
}

// sobe até o card; devolve {alvo, tipo} se a imagem está num grupo de nome/preço, senão null
function alvoDaSombra(im) {
  let e = im.parentNode, precoG = null;
  while (e && e.nodeType === 1) {
    const id = e.id || '';
    const m = id.match(RE_TEXTO_CARD);
    if (m) return { alvo: e, tipo: m[1] === 'nome' ? 'sombra_nome' : 'sombra_preco' };
    if (/^(?:PRECO|PREÇO)/.test(id) && !precoG) precoG = e;
    if (RE_CARD.test(id)) break;
    if (/^fundo_preco/.test(id)) return null; // fundo do preço é desenho, não sombra
    e = e.parentNode;
  }
  if (!e || !RE_CARD.test(e.id || '') || !precoG) return null;
  // no grupo PRECO sem nome de campo: só se for multiply (sombra) e o pai tiver texto, e o pai não
  // for o PRECO inteiro (sombra no preço todo pegaria o fundo também)
  const pai = im.parentNode;
  let blend = '';
  try { blend = getComputedStyle(im).mixBlendMode || ''; } catch (e2) { /* sem estilo calculado */ }
  if (blend !== 'multiply' || pai === precoG || !pai.querySelector('text')) return null;
  return { alvo: pai, tipo: 'sombra_preco' };
}

function garantirFiltroSombra(svg, id) {
  const NSs = 'http://www.w3.org/2000/svg';
  if (svg.querySelector(`filter[id="${id}"]`)) return;
  let defs = svg.querySelector('defs');
  if (!defs) { defs = document.createElementNS(NSs, 'defs'); svg.insertBefore(defs, svg.firstChild); }
  const c = SOMBRAS_EXPORT[id];
  const f = document.createElementNS(NSs, 'filter');
  for (const [k, v] of Object.entries({ id, x: c.x, y: c.y, width: c.width, height: c.height, 'color-interpolation-filters': 'sRGB' })) f.setAttribute(k, v);
  const d = document.createElementNS(NSs, 'feDropShadow');
  for (const [k, v] of Object.entries({ dx: c.dx, dy: c.dy, stdDeviation: c.desvio, 'flood-color': '#000000', 'flood-opacity': c.opac })) d.setAttribute(k, String(v));
  f.appendChild(d);
  defs.appendChild(f);
}

// devolve o que fez: {sombras, fundos, filtros}
function limparExport(svg) {
  const feito = { sombras: 0, fundos: 0, filtros: 0 };
  if (!svg) return feito;
  for (const im of [...svg.querySelectorAll('image')]) {
    if (im.closest('defs') || !ehImagemEmbutida(im)) continue;
    const a = alvoDaSombra(im);
    if (!a) continue;
    im.remove();
    feito.sombras++;
    if (a.alvo.hasAttribute('filter')) continue;
    garantirFiltroSombra(svg, a.tipo);
    a.alvo.setAttribute('filter', `url(#${a.tipo})`);
  }
  for (const g of [...svg.querySelectorAll('g[id^="PRODUTO_"]')]) {
    if (!RE_CARD.test(g.id) || g.querySelector('[id^="MARGEM_GRID"]')) continue;
    const f = [...g.querySelectorAll('g[id^="FUNDO"]')].find(x => RE_FUNDO.test(x.id) && !x.closest('[id^="PRECO"], [id^="PREÇO"]') && x.querySelector('rect'));
    if (!f) continue;
    f.id = 'MARGEM_GRID' + (f.id.match(/-\d+$/) || [''])[0];
    f.setAttribute('data-name', 'MARGEM_GRID');
    feito.fundos++;
  }
  for (const f of svg.querySelectorAll('filter[filterUnits="userSpaceOnUse"]')) {
    if (['x', 'y', 'width', 'height'].some(a => f.hasAttribute(a))) continue;
    f.removeAttribute('filterUnits');
    for (const [k, v] of Object.entries({ x: '-20%', y: '-20%', width: '140%', height: '140%' })) f.setAttribute(k, v);
    feito.filtros++;
  }
  // 4. sombra de elemento do card com área FIXA em userSpaceOnUse: a área é o lugar do card no
  //    template; card esticado ou levado pra outra casa fica cortado nela (fundo amarelo pela metade,
  //    Super Mais Quinta da Carne 13/10/2026, destaques 2×2 → 3×2). A área passa a ser relativa.
  const doCard = new Set();
  for (const g of svg.querySelectorAll('g[id^="PRODUTO_"]')) {
    if (!RE_CARD.test(g.id)) continue;
    for (const e of [g, ...g.querySelectorAll('*')]) {
      let v = e.getAttribute('filter') || '';
      try { v += ' ' + (getComputedStyle(e).filter || ''); } catch (e2) { /* sem estilo calculado */ }
      for (const m of v.matchAll(/url\(\s*["']?#([^"')\s]+)/g)) doCard.add(m[1]);
    }
  }
  for (const id of doCard) {
    const f = svg.querySelector(`filter[id="${id}"]`);
    if (!f || f.getAttribute('filterUnits') !== 'userSpaceOnUse') continue;
    f.removeAttribute('filterUnits');
    for (const [k, v] of Object.entries({ x: '-20%', y: '-20%', width: '140%', height: '140%' })) f.setAttribute(k, v);
    feito.filtros++;
  }
  if (feito.sombras || feito.fundos || feito.filtros) console.info('[encarte] export consertado ao abrir:', feito, '— rode scripts/encarte/limpar_export.py no SVG');
  return feito;
}
