// Somado Encarte — linhas divisórias: a parte que não mexe no DOM (formato, estilo, travar reta).
// Carregado antes do app.js; as funções ficam globais. O teste (lib/encarte/linhas.test.ts) roda
// este arquivo num contexto isolado.
//
// Linha = { id, pagina, x1, y1, x2, y2, cor, px, estilo } em coordenadas do SVG do template
// (as mesmas de p.cell). px = espessura em unidades do SVG: na prancheta exportada vira
// px × 2000 / largura da página (o export sai com 2000 px de largura).
'use strict';

const ESTILOS_LINHA = ['solida', 'pontilhada', 'tracejada'];
const LINHA_PADRAO = { cor: '#ffffff', px: 4, estilo: 'solida' };
const PX_MIN_LINHA = 0.5, PX_MAX_LINHA = 200;

function arredLinha(n) { return Math.round(n * 100) / 100; }

// traço do estilo: pontilhada = pontos redondos (traço 0 + ponta redonda), tracejada = traços
function tracoDaLinha(estilo, px) {
  if (estilo === 'pontilhada') return { dasharray: `0 ${arredLinha(px * 2)}`, linecap: 'round' };
  if (estilo === 'tracejada') return { dasharray: `${arredLinha(px * 3)} ${arredLinha(px * 2)}`, linecap: 'butt' };
  return { dasharray: '', linecap: 'butt' };
}

function corDaLinha(c, pad) {
  const s = String(c || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) return ('#' + s.slice(1).split('').map(x => x + x).join('')).toLowerCase();
  return pad;
}

// entrada solta (ficha, automação) → linha válida; null se faltar coordenada
function normalizarLinha(o, pad = LINHA_PADRAO) {
  if (!o || typeof o !== 'object') return null;
  const n = k => Number(o[k]);
  if (!['x1', 'y1', 'x2', 'y2'].every(k => Number.isFinite(n(k)))) return null;
  const px = Number.isFinite(n('px')) && n('px') > 0 ? n('px') : pad.px;
  return {
    id: o.id ? String(o.id) : '',
    pagina: Number.isInteger(n('pagina')) && n('pagina') >= 0 ? n('pagina') : 0,
    x1: arredLinha(n('x1')), y1: arredLinha(n('y1')), x2: arredLinha(n('x2')), y2: arredLinha(n('y2')),
    cor: corDaLinha(o.cor, pad.cor),
    px: arredLinha(Math.min(PX_MAX_LINHA, Math.max(PX_MIN_LINHA, px))),
    estilo: ESTILOS_LINHA.includes(o.estilo) ? o.estilo : pad.estilo,
    // divisória da grade (divisorias.js): zona = chave da grid_area, div = 'v' | 'h'
    ...(o.zona && (o.div === 'v' || o.div === 'h') ? { zona: String(o.zona), div: o.div } : {}),
  };
}

// linha nova: horizontal no meio da página, 60% da largura
function linhaNoMeio(pg, pad = LINHA_PADRAO) {
  const w = pg.w * 0.6, y = pg.y + pg.h / 2;
  return { x1: arredLinha(pg.x + (pg.w - w) / 2), y1: arredLinha(y), x2: arredLinha(pg.x + (pg.w + w) / 2), y2: arredLinha(y), cor: pad.cor, px: pad.px, estilo: pad.estilo };
}

// ponta 1 ou 2 em (x, y); com travar, ela fica na reta horizontal ou vertical da outra ponta
// (a que estiver mais perto do movimento)
function moverPonta(l, ponta, x, y, travar) {
  const o = ponta === 1 ? { x: l.x2, y: l.y2 } : { x: l.x1, y: l.y1 };
  if (travar) { if (Math.abs(x - o.x) >= Math.abs(y - o.y)) y = o.y; else x = o.x; }
  return ponta === 1 ? { ...l, x1: arredLinha(x), y1: arredLinha(y) } : { ...l, x2: arredLinha(x), y2: arredLinha(y) };
}

// deixa a linha reta ('h' ou 'v') girando pelo centro, mesmo comprimento
function endireitarLinha(l, eixo) {
  const cx = (l.x1 + l.x2) / 2, cy = (l.y1 + l.y2) / 2;
  const meio = Math.hypot(l.x2 - l.x1, l.y2 - l.y1) / 2;
  return eixo === 'v'
    ? { ...l, x1: arredLinha(cx), x2: arredLinha(cx), y1: arredLinha(cy - meio), y2: arredLinha(cy + meio) }
    : { ...l, y1: arredLinha(cy), y2: arredLinha(cy), x1: arredLinha(cx - meio), x2: arredLinha(cx + meio) };
}

function deslocarLinha(l, dx, dy) {
  return { ...l, x1: arredLinha(l.x1 + dx), y1: arredLinha(l.y1 + dy), x2: arredLinha(l.x2 + dx), y2: arredLinha(l.y2 + dy) };
}

// ---------------------------------------------------------------- várias linhas juntas (Matheus, 17/10/2026)
// caixa da linha (as pontas podem estar em qualquer ordem)
function caixaLinha(l) {
  const x0 = Math.min(l.x1, l.x2), y0 = Math.min(l.y1, l.y2);
  return { x0, y0, x1: Math.max(l.x1, l.x2), y1: Math.max(l.y1, l.y2) };
}
// alinha as linhas pela caixa de todas juntas: 'topo' | 'meio' | 'base' | 'esq' | 'centro' | 'dir'
function alinharLinhas(ls, como) {
  if (ls.length < 2) return ls;
  const cs = ls.map(caixaLinha);
  const U = { x0: Math.min(...cs.map(c => c.x0)), y0: Math.min(...cs.map(c => c.y0)), x1: Math.max(...cs.map(c => c.x1)), y1: Math.max(...cs.map(c => c.y1)) };
  return ls.map((l, i) => {
    const c = cs[i];
    const dx = como === 'esq' ? U.x0 - c.x0 : como === 'dir' ? U.x1 - c.x1 : como === 'centro' ? (U.x0 + U.x1) / 2 - (c.x0 + c.x1) / 2 : 0;
    const dy = como === 'topo' ? U.y0 - c.y0 : como === 'base' ? U.y1 - c.y1 : como === 'meio' ? (U.y0 + U.y1) / 2 - (c.y0 + c.y1) / 2 : 0;
    return deslocarLinha(l, dx, dy);
  });
}
// mesma altura (eixo 'v': todas com o começo e o fim em y da referência) ou mesma largura ('h', em x),
// cada uma no seu lugar no outro eixo
function igualarLinhas(ls, ref, eixo) {
  const r = caixaLinha(ref);
  return ls.map(l => {
    if (l.id === ref.id) return l;
    if (eixo === 'v') {
      const sobe = l.y1 <= l.y2;
      return { ...l, y1: arredLinha(sobe ? r.y0 : r.y1), y2: arredLinha(sobe ? r.y1 : r.y0) };
    }
    const vai = l.x1 <= l.x2;
    return { ...l, x1: arredLinha(vai ? r.x0 : r.x1), x2: arredLinha(vai ? r.x1 : r.x0) };
  });
}
// espaço igual: a primeira e a última (pela posição no eixo) ficam paradas, as do meio se espalham
// pelo centro ('h' = da esquerda pra direita, 'v' = de cima pra baixo)
function distribuirLinhas(ls, eixo) {
  if (ls.length < 3) return ls;
  const meio = l => { const c = caixaLinha(l); return eixo === 'h' ? (c.x0 + c.x1) / 2 : (c.y0 + c.y1) / 2; };
  const ord = ls.map((l, i) => ({ l, i, m: meio(l) })).sort((a, b) => a.m - b.m);
  const a = ord[0].m, passo = (ord[ord.length - 1].m - a) / (ord.length - 1), out = [...ls];
  ord.forEach((o, k) => {
    const d = a + passo * k - o.m;
    out[o.i] = eixo === 'h' ? deslocarLinha(o.l, d, 0) : deslocarLinha(o.l, 0, d);
  });
  return out;
}
