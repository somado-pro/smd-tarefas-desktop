// Biblioteca do construtor e blocos do cliente. Usa o estado e os ajudantes do app.js (S, M, h, el,
// api, clone, render, tudo, renderModelo…), que carrega antes.
//
// Biblioteca: pedaços prontos (card inteiro, grupo do card como o Preço, selos e elementos soltos,
// estrutura de projeto) pra usar em qualquer projeto. Galeria na lateral: toque em "Usar" (ou, no
// PC, arraste pra prancheta ou pro card). Com o card aberto, grupo e elementos entram no card.
//
// Blocos do cliente: imagens com papel (logo, selo do tema, elemento lateral, fundo) cadastradas na
// pasta do cliente. Qualquer imagem do projeto pode ser "bloco:<papel>": a imagem vem do cadastro,
// ou da trocada só neste projeto (S.proj.blocos[papel]).
'use strict';
/* eslint-disable @typescript-eslint/no-unused-vars -- funções chamadas pelo app.js (scripts clássicos dividem o escopo) */

const API_BIB = '/api/encarte/biblioteca';
const API_BLOCOS = '/api/encarte/blocos-cliente';
async function apiEm(url, opt = {}) {
  const r = await fetch(url, { headers: { 'content-type': 'application/json' }, ...opt });
  if (r.status === 401) { alert('Faça login no Somado Tarefas (mesmo endereço) e recarregue esta página.'); throw new Error('401'); }
  if (!r.ok) { let m = await r.text(); try { m = JSON.parse(m).error || m; } catch { /* texto */ } throw new Error(m); }
  return r.json();
}
const TIPOS_BIB = [['grupo', 'Grupos do card'], ['elementos', 'Selos e elementos'], ['card', 'Cards completos'], ['estrutura', 'Estruturas']];
const NOME_GRUPO = { produto: 'Produto', preco: 'Preço', de: 'Preço DE', selo: 'Selo do clube' };
const modalAberto = () => $('#modal-overlay').classList.contains('open');
const nomeCliente = id => (S.clientes.find(c => c.folderId === id) || {}).nome || '';

// projeto como está na tela (com o card aberto no modal, mesmo sem salvar)
function projetoNaTela() {
  const p = clone(S.proj);
  if (modalAberto() && M.m) { const i = p.modelos_card.findIndex(m => m.id === M.m.id); if (i >= 0) p.modelos_card[i] = clone(M.m); }
  return p;
}

// ---------------------------------------------------------------- blocos do cliente
async function carregarBlocos() {
  S.blocos = [];
  if (!S.proj) return;
  // projeto antigo sem a pasta: acha pelo nome do cliente (o servidor faz o mesmo ao gravar)
  if (!S.proj.folderId) { const c = S.clientes.find(x => x.nome === S.proj.cliente); if (c) S.proj.folderId = c.folderId; }
  if (!S.proj.folderId) return;
  try { S.blocos = await apiEm(`${API_BLOCOS}/${S.proj.folderId}`); } catch { /* sem blocos */ }
}
const srcArqCliente = ref => ref && S.proj && S.proj.folderId ? `${API_BLOCOS}/${S.proj.folderId}/imagem?arq=${encodeURIComponent(ref.slice(4))}` : '';
function srcBloco(papel) {
  const p = S.proj && S.proj.blocos && S.proj.blocos[papel];
  if (p) return srcImg(p);
  const b = (S.blocos || []).find(x => x.papel === papel);
  return b && b.url ? srcArqCliente(b.url) : '';
}
const nomeBloco = papel => ((S.blocos || []).find(b => b.papel === papel) || {}).nome || papel;
// etiqueta "◆ Logo" no canto do elemento que é bloco do cliente
function etiquetaBloco(svg, b, papel, esc) {
  const fs = 11 / esc, t = el('text', { x: b.x + 4 / esc, y: b.y + fs + 2 / esc, 'font-size': fs, fill: '#7b2ff7', 'font-family': 'system-ui', 'font-weight': 700, 'pointer-events': 'none',
    stroke: '#fff', 'stroke-width': 3 / esc, 'paint-order': 'stroke' }, svg);
  t.textContent = '◆ ' + nomeBloco(papel) + (srcBloco(papel) ? '' : ' (sem imagem)');
}
// <select> "Bloco do cliente…" do lado do "Enviar…" de toda imagem
function seletorBloco(v, aoMudar) {
  const sel = h('select', { title: 'Usar um bloco do cliente: a imagem vem do cadastro do cliente (Blocos do cliente…)', style: 'flex:1 1 100%;height:26px' },
    h('option', { value: '' }, S.proj && S.proj.folderId ? 'Bloco do cliente…' : 'Bloco do cliente (escolha o cliente)'),
    ...(S.blocos || []).map(b => h('option', { value: 'bloco:' + b.papel }, '◆ ' + b.nome + (srcBloco(b.papel) ? '' : ' (sem imagem)'))));
  sel.value = v && v.startsWith('bloco:') ? v : '';
  sel.addEventListener('input', () => aoMudar(sel.value || (v && v.startsWith('bloco:') ? null : v)));
  return sel;
}
function enviarArquivo(url) {
  return new Promise(res => {
    const i = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/svg+xml' });
    i.onchange = async () => {
      const f = i.files[0]; if (!f) return res(null);
      const fd = new FormData(); fd.append('arquivo', f);
      carregando(true);
      try { const r = await fetch(url, { method: 'POST', body: fd }); const j = await r.json(); if (!r.ok) throw new Error(j.erro || r.status); res(j.ref); }
      catch (e) { alert('Não enviou: ' + e.message); res(null); } finally { carregando(false); }
    };
    i.click();
  });
}
// põe o bloco na prancheta: fundo vira o fundo; o resto, uma imagem no lugar de costume
function porBlocoNaPrancheta(papel) {
  const pr = prancheta(), { w: W, h: H } = S.proj.tamanho;
  if (papel === 'fundo') { pr.fundo = { tipo: 'imagem', url: 'bloco:fundo', ajuste: 'cover' }; S.sel = null; }
  else {
    const caixa = { logo: { x: W * 0.03, y: H * 0.02, w: W * 0.28, h: H * 0.13 }, selo: { x: W * 0.3, y: H * 0.02, w: W * 0.4, h: H * 0.2 }, lateral: { x: W * 0.68, y: 0, w: W * 0.32, h: H * 0.3 } }[papel]
      || { x: W * 0.35, y: H * 0.35, w: W * 0.3, h: H * 0.2 };
    const it = { id: uid('img_'), tipo: 'imagem', ...arred(caixa), url: 'bloco:' + papel, ajuste: 'contain' };
    pr.elementos.push(it); S.sel = it.id;
  }
  S.sujo = true; tudo();
}

function abrirBlocos(op = {}) {
  if (!S.proj) return;
  if (!S.proj.folderId) return alert('Escolha o cliente do projeto (Propriedades › Projeto › Cliente) antes.');
  const lista = clone(S.blocos || []);
  const fundo = h('div', { class: 'bib-fundo', style: 'z-index:260' });
  const corpo = h('div', {});
  const fechar = () => fundo.remove();
  const thumb = src => h('div', { class: 'bl-thumb' }, ...(src ? [h('img', { src, alt: '' })] : [h('span', {}, 'sem imagem')]));
  const desenha = () => {
    corpo.replaceChildren();
    lista.forEach((b, i) => {
      const trocado = S.proj.blocos && S.proj.blocos[b.papel];
      const nome = h('input', { value: b.nome, style: 'flex:1;min-width:0' }); nome.addEventListener('change', () => { b.nome = nome.value.trim() || b.papel; });
      const tema = h('input', { type: 'checkbox' }); tema.checked = !!b.por_tema; tema.addEventListener('change', () => { b.por_tema = tema.checked; });
      const linha = h('div', { class: 'bl-linha' + (op.tema && b.por_tema ? ' destaque' : '') },
        thumb(b.url ? srcArqCliente(b.url) : ''),
        h('div', { class: 'bl-info' },
          h('div', { style: 'display:flex;gap:6px;align-items:center' }, nome, h('code', { style: 'font-size:11px;color:var(--c-text2)' }, b.papel)),
          h('label', { style: 'display:flex;gap:6px;align-items:center;font-size:12px;color:var(--c-text2)' }, tema, 'Muda a cada tema (o template novo pede essa imagem)'),
          h('div', { class: 'bl-bts' },
            h('button', { class: 'btn', on: { click: async () => { const r = await enviarArquivo(`${API_BLOCOS}/${S.proj.folderId}/imagem`); if (r) { b.url = r; desenha(); } } } }, b.url ? 'Trocar a do cliente…' : 'Imagem do cliente…'),
            h('button', { class: 'btn', title: 'Pôr este bloco na prancheta aberta', on: { click: () => { salvarLista().then(() => { fechar(); porBlocoNaPrancheta(b.papel); }); } } }, 'Pôr na prancheta'),
            ...(BLOCOS_FIXOS.includes(b.papel) ? [] : [h('button', { class: 'btn', title: 'Tirar o bloco do cadastro', on: { click: () => { lista.splice(i, 1); desenha(); } } }, '×')])),
          h('div', { class: 'bl-bts' },
            h('span', { style: 'font-size:11px;color:var(--c-text2)' }, trocado ? 'Neste template: imagem própria' : 'Neste template: a do cliente'),
            h('button', { class: 'btn', title: 'Usar outra imagem só neste template (ex.: o selo deste tema)', on: { click: async () => {
              const r = await enviarImagem(); if (!r) return;
              S.proj.blocos = { ...(S.proj.blocos || {}), [b.papel]: r }; S.sujo = true; desenha(); render();
            } } }, 'Trocar só neste template…'),
            ...(trocado ? [h('button', { class: 'btn', on: { click: () => { delete S.proj.blocos[b.papel]; S.sujo = true; desenha(); render(); } } }, 'Voltar pra do cliente')] : []))));
      corpo.append(linha);
    });
  };
  const salvarLista = async () => {
    carregando(true);
    try { S.blocos = await apiEm(`${API_BLOCOS}/${S.proj.folderId}`, { method: 'PUT', body: JSON.stringify({ blocos: lista }) }); }
    catch (e) { alert('Não salvou os blocos: ' + e.message); throw e; } finally { carregando(false); }
  };
  const novo = h('button', { class: 'btn', on: { click: () => {
    const n = prompt('Nome do bloco novo (ex.: Logo branca, Faixa do rodapé)'); if (!n) return;
    const papel = n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30);
    if (!papel || lista.some(b => b.papel === papel)) return alert('Já tem um bloco com esse nome.');
    lista.push({ papel, nome: n.trim(), por_tema: false }); desenha();
  } } }, '+ Bloco novo');
  const ok = h('button', { class: 'btn primary', on: { click: async () => { try { await salvarLista(); fechar(); tudo(); } catch { /* avisou */ } } } }, 'Salvar');
  desenha();
  fundo.append(h('div', { class: 'bib-dlg', style: 'width:min(560px,96vw)' },
    h('h2', {}, `Blocos do cliente · ${S.proj.cliente}`),
    h('div', { class: 'bib-dica' }, op.tema
      ? 'Projeto novo da estrutura: troque as imagens deste tema em "Trocar só neste template". A logo e o que não muda vêm do cadastro do cliente.'
      : 'Cada bloco é uma imagem do cliente com um papel. Na prancheta, escolha "Bloco do cliente" numa imagem (ou no fundo) e ela usa sempre a do cadastro; mude aqui e todo template do cliente acompanha ao publicar de novo.'),
    h('div', { class: 'bl-lista' }, corpo),
    h('div', { style: 'display:flex;gap:8px;justify-content:space-between;margin-top:12px' }, novo,
      h('div', { style: 'display:flex;gap:8px' }, h('button', { class: 'btn', on: { click: fechar } }, 'Cancelar'), ok))));
  document.body.append(fundo);
}
const BLOCOS_FIXOS = ['logo', 'selo', 'lateral', 'fundo', 'selo_desconto'];

// ---------------------------------------------------------------- salvar na biblioteca
const NOME_PADRAO = {
  card: p => (S.proj.modelos_card.find(m => m.id === p.modelo) || {}).nome || 'Card',
  grupo: p => `${NOME_GRUPO[p.grupo]} · ${(modalAberto() && M.m ? M.m.nome : '')}`.replace(/ · $/, ''),
  elementos: () => 'Selo',
  estrutura: () => `Estrutura ${S.proj.cliente.replace(/^\d+\.\s*/, '')}`,
};
function dialogoSalvar(pedido) {
  if (!S.proj) return;
  const fundo = h('div', { class: 'bib-fundo', style: 'z-index:260' });
  const fechar = () => fundo.remove();
  const nome = h('input', { value: NOME_PADRAO[pedido.tipo](pedido) });
  const alcance = h('select', {}, h('option', { value: '' }, 'Todos os clientes'), ...(S.proj.folderId ? [h('option', { value: S.proj.folderId }, `Só ${S.proj.cliente}`)] : []));
  alcance.value = pedido.tipo === 'estrutura' && S.proj.folderId ? S.proj.folderId : '';
  // elementos da prancheta: escolher quais entram (um selo costuma ser forma + texto)
  const marcados = new Set(pedido.ids || []);
  const escolha = pedido.tipo === 'elementos' && pedido.prancheta ? h('div', { class: 'bib-escolha' },
    ...prancheta().elementos.map(e => {
      const cb = h('input', { type: 'checkbox' }); cb.checked = marcados.has(e.id);
      cb.addEventListener('change', () => { if (cb.checked) marcados.add(e.id); else marcados.delete(e.id); });
      return h('label', {}, cb, { texto: 'T ', retangulo: '□ ', imagem: '⊡ ' }[e.tipo], e.tipo === 'texto' ? e.texto.slice(0, 30) : e.url && e.url.startsWith('bloco:') ? '◆ ' + nomeBloco(e.url.slice(6)) : e.tipo === 'imagem' ? 'Imagem' : 'Forma');
    })) : null;
  const ok = h('button', { class: 'btn primary', on: { click: async () => {
    if (!nome.value.trim()) return alert('Dê um nome.');
    const p = pedido.tipo === 'elementos' && pedido.prancheta ? { ...pedido, ids: [...marcados] } : pedido;
    if (p.ids && !p.ids.length) return alert('Marque pelo menos um elemento.');
    carregando(true);
    try {
      await apiEm(API_BIB, { method: 'POST', body: JSON.stringify({ nome: nome.value.trim(), folderId: alcance.value || null, projetoId: S.proj.id, projeto: projetoNaTela(), pedido: p }) });
      fechar(); aviso('Guardado na biblioteca.');
      if ($('#bib-gaveta')) carregarGaleria();
    } catch (e) { alert('Não guardou: ' + e.message); } finally { carregando(false); }
  } } }, 'Guardar');
  const titulo = { card: 'Guardar o card na biblioteca', grupo: `Guardar o grupo ${NOME_GRUPO[pedido.grupo] || ''} na biblioteca`, elementos: 'Guardar elementos na biblioteca', estrutura: 'Guardar como estrutura do cliente' }[pedido.tipo];
  fundo.append(h('div', { class: 'bib-dlg' },
    h('h2', {}, titulo),
    h('div', { class: 'prop-row' }, h('label', {}, 'Nome'), nome),
    h('div', { class: 'prop-row' }, h('label', {}, 'Vale pra'), alcance),
    ...(escolha ? [h('div', { class: 'bib-dica' }, 'Elementos que entram:'), escolha] : []),
    h('div', { class: 'bib-dica' }, pedido.tipo === 'estrutura'
      ? 'A estrutura guarda o projeto inteiro (pranchetas, zonas, cards e blocos). Em "Novo", escolha "Começar de" pra montar o template de um tema novo já pronto.'
      : 'As medidas ficam em pt. Num card de outro tamanho o grupo mantém o tamanho e a distância até a borda mais perto.'),
    h('div', { style: 'display:flex;gap:8px;justify-content:flex-end;margin-top:12px' }, h('button', { class: 'btn', on: { click: fechar } }, 'Cancelar'), ok)));
  document.body.append(fundo);
  nome.select();
}
function aviso(txt) {
  const a = h('div', { class: 'bib-aviso' }, txt); document.body.append(a);
  setTimeout(() => a.remove(), 2200);
}

// ---------------------------------------------------------------- galeria
const G = { aba: null, todos: false, itens: [], busca: '' };
function abrirGaleria() {
  if (!S.proj) return alert('Abra ou crie um projeto antes.');
  if ($('#bib-gaveta')) return fecharGaleria();
  G.aba = G.aba || (modalAberto() ? 'grupo' : 'elementos');
  const gav = h('div', { id: 'bib-gaveta' });
  document.body.append(gav);
  $('[data-bib]').classList.add('aberto');
  carregarGaleria();
}
function fecharGaleria() {
  const g = $('#bib-gaveta'); if (g) g.remove();
  $('[data-bib]').classList.remove('aberto');
}
async function carregarGaleria() {
  const gav = $('#bib-gaveta'); if (!gav) return;
  try { G.itens = await apiEm(`${API_BIB}?cliente=${G.todos || !S.proj.folderId ? 'todos' : S.proj.folderId}`); }
  catch (e) { G.itens = []; aviso('Biblioteca: ' + e.message); }
  desenharGaleria();
}
function desenharGaleria() {
  const gav = $('#bib-gaveta'); if (!gav) return;
  gav.classList.toggle('esquerda', modalAberto()); // com o card aberto, fica do lado oposto aos botões dele
  const ctx = modalAberto() ? `no card "${M.m.nome}" (${{ campos: 'normal', especial: 'especial', horizontal: 'horizontal' }[M.aba]})` : `na prancheta ${S.pi + 1}`;
  const busca = h('input', { placeholder: 'Buscar…', value: G.busca });
  busca.addEventListener('input', () => { G.busca = busca.value; desenharGrade(); });
  const todos = h('input', { type: 'checkbox' }); todos.checked = G.todos;
  todos.addEventListener('change', () => { G.todos = todos.checked; carregarGaleria(); });
  const grade = h('div', { class: 'bib-grade' });
  const desenharGrade = () => {
    grade.replaceChildren();
    const t = G.busca.trim().toLowerCase();
    const vis = G.itens.filter(i => i.tipo === G.aba && (!t || i.nome.toLowerCase().includes(t)));
    if (!vis.length) grade.append(h('div', { class: 'bib-vazio' }, G.itens.some(i => i.tipo === G.aba) ? 'Nada com essa busca.'
      : { grupo: 'Nenhum grupo ainda. No card, use ☆ no cabeçalho de um grupo (Preço, Selo…) pra guardar.', elementos: 'Nenhum elemento ainda. Selecione um elemento na prancheta (ou os extras do card) e use "Salvar na biblioteca".',
        card: 'Nenhum card ainda. Abra um modelo de card e use "Salvar o card na biblioteca".', estrutura: 'Nenhuma estrutura ainda. Com nada selecionado, use "Salvar como estrutura do cliente".' }[G.aba]));
    for (const it of vis) {
      const img = h('img', { src: `${API_BIB}/${it.id}/miniatura`, alt: '', loading: 'lazy', draggable: 'false' });
      const tile = h('div', { class: 'bib-item', draggable: it.tipo === 'grupo' || it.tipo === 'elementos' ? 'true' : 'false', title: it.nome },
        h('div', { class: 'bib-mini' }, img),
        h('div', { class: 'bib-nome' }, it.nome),
        h('div', { class: 'bib-tag' }, [it.subtipo && NOME_GRUPO[it.subtipo], it.folderId ? nomeCliente(it.folderId) || 'deste cliente' : 'todos os clientes'].filter(Boolean).join(' · ')),
        h('div', { class: 'bib-bts' },
          h('button', { class: 'btn primary', on: { click: () => usarItem(it) } }, it.tipo === 'estrutura' ? 'Novo projeto' : 'Usar'),
          h('button', { class: 'btn', title: 'Renomear ou mudar pra quem vale', on: { click: () => editarItem(it) } }, '✎'),
          h('button', { class: 'btn', title: 'Apagar da biblioteca', on: { click: async () => {
            if (!confirm(`Apagar "${it.nome}" da biblioteca? (os projetos que já usaram ficam como estão)`)) return;
            await apiEm(`${API_BIB}/${it.id}`, { method: 'DELETE' }); carregarGaleria();
          } } }, '×')));
      tile.addEventListener('dragstart', e => { e.dataTransfer.setData('text/x-bib', it.id); e.dataTransfer.effectAllowed = 'copy'; });
      grade.append(tile);
    }
  };
  gav.replaceChildren(
    h('div', { class: 'bib-cab' }, h('b', {}, 'Biblioteca'), h('button', { class: 'btn', on: { click: fecharGaleria } }, '×')),
    h('div', { class: 'bib-abas' }, ...TIPOS_BIB.map(([k, r]) => h('button', { class: 'btn' + (G.aba === k ? ' active' : ''), on: { click: () => { G.aba = k; desenharGaleria(); } } }, r))),
    h('div', { class: 'bib-filtro' }, busca, h('label', { title: 'Mostrar também os itens só de outros clientes' }, todos, 'Todos os clientes')),
    h('div', { class: 'bib-dica' }, G.aba === 'estrutura' ? 'Estrutura = projeto pronto pra começar um tema novo.' : `"Usar" põe ${ctx}.` + (matchMedia('(pointer: fine)').matches && (G.aba === 'grupo' || G.aba === 'elementos') ? ' Dá pra arrastar até o lugar.' : '')),
    grade);
  desenharGrade();
}
function editarItem(it) {
  const n = prompt('Nome do item', it.nome); if (n == null) return;
  let folderId = it.folderId;
  if (S.proj.folderId) folderId = confirm(`Deixar "${n}" só pra ${S.proj.cliente}?\n(OK = só deste cliente · Cancelar = todos os clientes)`) ? S.proj.folderId : null;
  apiEm(`${API_BIB}/${it.id}`, { method: 'PATCH', body: JSON.stringify({ nome: n, folderId }) }).then(carregarGaleria, e => alert(e.message));
}

// modelo que recebe um grupo quando o card não está aberto: o da zona selecionada, ou o único
function modeloAlvo() {
  const z = S.sel && prancheta().zonas.find(x => x.id === S.sel);
  if (z) return z.modelo_card_id;
  if (S.proj.modelos_card.length === 1) return S.proj.modelos_card[0].id;
  if (!S.proj.modelos_card.length) { alert('Crie um modelo de card antes.'); return null; }
  const nomes = S.proj.modelos_card.map((m, i) => `${i + 1}. ${m.nome}`).join('\n');
  const i = +prompt(`Em qual modelo de card?\n${nomes}`, '1') - 1;
  return S.proj.modelos_card[i] ? S.proj.modelos_card[i].id : null;
}

async function usarItem(it, pos) {
  if (it.tipo === 'estrutura') { fecharGaleria(); return novoDaEstrutura(it); }
  const noCard = modalAberto();
  let destino;
  if (it.tipo === 'card') destino = { zona: !noCard && S.sel && prancheta().zonas.some(z => z.id === S.sel) ? S.sel : undefined };
  else if (noCard) destino = { modelo: M.m.id, versao: M.aba, pos };
  else if (it.tipo === 'grupo') { const m = modeloAlvo(); if (!m) return; destino = { modelo: m }; }
  else destino = { prancheta: S.pi + 1, pos };
  carregando(true);
  try {
    const r = await apiEm(`${API_BIB}/${it.id}/usar`, { method: 'POST', body: JSON.stringify({ projetoId: S.proj.id, projeto: projetoNaTela(), destino }) });
    if (noCard && it.tipo !== 'card') {
      M.m[M.aba] = r.projeto.modelos_card.find(m => m.id === M.m.id)[M.aba]; M.sel = null; renderModelo();
    } else {
      // card aberto + card inteiro: o modelo novo entra no projeto sem levar junto o que ainda não
      // foi salvo no card aberto (ele continua no modal, e Cancelar segue valendo)
      const antes = noCard ? S.proj.modelos_card.find(m => m.id === M.m.id) : null;
      S.proj = { ...S.proj, modelos_card: r.projeto.modelos_card.map(m => (antes && m.id === antes.id ? antes : m)), pranchetas: r.projeto.pranchetas };
      if (r.ids && r.ids.length) S.sel = r.ids[0];
      S.sujo = true; tudo();
    }
    aviso(`"${it.nome}" entrou ${it.tipo === 'card' ? 'como modelo novo' : noCard ? 'no card' : 'no projeto'}.`);
  } catch (e) { alert('Não usou: ' + e.message); } finally { carregando(false); }
}

// "Novo" já com a estrutura escolhida
function novoDaEstrutura(it) {
  $('#proj-modal').classList.add('open');
  if (it.folderId && $('#pf-cliente').value !== it.folderId) { $('#pf-cliente').value = it.folderId; }
  atualizarEstruturas().then(() => { $('#pf-estrutura').value = it.id; $('#pf-estrutura').dispatchEvent(new Event('input')); });
}
async function atualizarEstruturas() {
  const sel = $('#pf-estrutura'); if (!sel) return;
  const cli = $('#pf-cliente').value;
  let lst = [];
  try { lst = (await apiEm(`${API_BIB}?tipo=estrutura&cliente=${cli || 'todos'}`)); } catch { /* sem biblioteca */ }
  const atual = sel.value;
  sel.replaceChildren(h('option', { value: '' }, 'Em branco'), ...lst.map(i => h('option', { value: i.id }, `Estrutura: ${i.nome}${i.folderId ? '' : ' (geral)'}`)));
  if (lst.some(i => i.id === atual)) sel.value = atual;
  sel.dispatchEvent(new Event('input'));
}

// soltar um item arrastado da galeria: na prancheta (elementos) ou no card aberto (grupo, elementos)
function ligarSoltar(alvo, svg) {
  alvo.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('text/x-bib')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  alvo.addEventListener('drop', e => {
    const id = e.dataTransfer.getData('text/x-bib'); if (!id) return;
    e.preventDefault();
    const it = G.itens.find(x => x.id === id); if (!it) return;
    const p = svg().createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
    const q = p.matrixTransform(svg().getScreenCTM().inverse());
    // o ponto solto é o canto de cima à esquerda do item
    usarItem(it, it.tipo === 'grupo' && !modalAberto() ? undefined : { x: Math.round(q.x), y: Math.round(q.y) });
  });
}

// ---------------------------------------------------------------- início (chamado pelo iniciar do app.js)
function iniciarBiblioteca() {
  // ícone da biblioteca na barra da esquerda
  const bt = h('button', { class: 'rail-btn', 'data-bib': '1', title: 'Biblioteca (cards, grupos, selos e estruturas prontos)', on: { click: abrirGaleria } });
  bt.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="3.2" height="14" rx=".6"/><rect x="7.6" y="3" width="3.2" height="14" rx=".6"/><path d="m12.4 4.2 3-1 2.9 13-3 1z"/></svg>';
  $('#rail').append(bt);
  // no card aberto também
  $('#modal-cancelar').before(h('button', { class: 'btn', title: 'Biblioteca: grupos e selos prontos pra este card', on: { click: abrirGaleria } }, 'Biblioteca'));
  // card abriu ou fechou com a galeria aberta: ela muda de lado e de destino do "Usar"
  new MutationObserver(() => { if ($('#bib-gaveta')) desenharGaleria(); }).observe($('#modal-overlay'), { attributes: true, attributeFilter: ['class'] });
  // "Blocos" na barra de cima
  $('#btn-duplicar-proj').after(h('button', { class: 'btn', title: 'Blocos do cliente: logo, selo do tema, elemento lateral, fundo', on: { click: () => abrirBlocos() } }, 'Blocos'));
  ligarSoltar($('#canvas-wrap'), () => $('#canvas-svg'));
  ligarSoltar($('#modal-canvas-wrap'), () => $('#modal-canvas'));
  // "Novo": começar de uma estrutura da biblioteca
  const est = h('select', { id: 'pf-estrutura' }, h('option', { value: '' }, 'Em branco'));
  const tamanhos = () => [...document.querySelectorAll('#proj-form .prop-row')].filter(r => r.querySelector('#pf-w,#pf-h,#pf-espaco') || (r.querySelector('select') && r.querySelector('select') !== est && !r.querySelector('#pf-cliente')));
  est.addEventListener('input', () => { for (const r of tamanhos()) r.style.display = est.value ? 'none' : ''; });
  $('#pf-tema').closest('.prop-row').after(h('div', { class: 'prop-row' }, h('label', {}, 'Começar de'), est));
  $('#pf-cliente').addEventListener('input', atualizarEstruturas);
  $('#btn-novo-proj').addEventListener('click', atualizarEstruturas);
  document.head.append(h('style', {}, `
.bib-fundo{position:fixed;inset:0;background:#0008;display:flex;align-items:center;justify-content:center;padding:12px}
.bib-dlg{background:var(--c-panel);border:1px solid #111;border-radius:8px;padding:18px;width:min(440px,96vw);max-height:92vh;overflow:auto}
.bib-dlg h2{font-size:14px;margin-bottom:12px}
.bib-dica{font-size:11px;color:var(--c-text2);margin:6px 0}
.bib-escolha{display:flex;flex-direction:column;gap:4px;max-height:180px;overflow:auto;border:1px solid var(--c-border);border-radius:4px;padding:6px}
.bib-escolha label{display:flex;gap:6px;align-items:center;font-size:12px}
.bib-aviso{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#111;color:#fff;padding:8px 14px;border-radius:6px;z-index:300;font-size:13px}
#bib-gaveta{position:fixed;top:44px;right:0;bottom:0;width:340px;background:var(--c-panel);border-left:1px solid var(--c-border);z-index:150;display:flex;flex-direction:column;padding:10px;gap:8px;box-shadow:-8px 0 24px #0008}
#bib-gaveta.esquerda{right:auto;left:0;border-left:0;border-right:1px solid var(--c-border);box-shadow:8px 0 24px #0008}
.bib-cab{display:flex;justify-content:space-between;align-items:center}
.bib-abas{display:flex;gap:4px;flex-wrap:wrap}
.bib-filtro{display:flex;gap:8px;align-items:center}
.bib-filtro input[type=text],.bib-filtro input:not([type]){flex:1;height:28px;background:var(--c-campo);border:1px solid var(--c-campo-borda);border-radius:4px;color:var(--c-text);padding:0 8px;min-width:0}
.bib-filtro label{display:flex;gap:4px;align-items:center;font-size:11px;color:var(--c-text2);white-space:nowrap}
.bib-grade{flex:1;overflow:auto;display:grid;grid-template-columns:repeat(2,1fr);gap:8px;align-content:start}
.bib-item{border:1px solid var(--c-border);border-radius:6px;padding:6px;display:flex;flex-direction:column;gap:4px;background:var(--c-panel2)}
.bib-item[draggable=true]{cursor:grab}
.bib-mini{height:110px;display:grid;place-items:center;background:#eef0f3;border-radius:4px;overflow:hidden}
.bib-mini img{max-width:100%;max-height:110px;display:block}
.bib-nome{font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bib-tag{font-size:10px;color:var(--c-text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bib-bts{display:flex;gap:4px}.bib-bts .primary{flex:1}
.bib-vazio{grid-column:1/-1;color:var(--c-text2);font-size:12px;padding:12px 4px}
.bl-lista{display:flex;flex-direction:column;gap:8px}
.bl-linha{display:flex;gap:10px;border:1px solid var(--c-border);border-radius:6px;padding:8px}
.bl-linha.destaque{border-color:var(--c-accent)}
.bl-thumb{width:72px;height:72px;flex-shrink:0;background:#eef0f3 repeating-conic-gradient(#ddd 0 25%,#fff 0 50%) 0 0/12px 12px;border-radius:4px;display:grid;place-items:center;overflow:hidden}
.bl-thumb img{max-width:100%;max-height:100%}.bl-thumb span{font-size:10px;color:#666}
.bl-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
.bl-info input:not([type=checkbox]){height:28px;background:var(--c-campo);border:1px solid var(--c-campo-borda);border-radius:4px;color:var(--c-text);padding:0 8px}
.bl-bts{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
@media (max-width:768px){#bib-gaveta,#bib-gaveta.esquerda{width:100vw;left:0;right:0;top:auto;height:70dvh;border-left:0;border-right:0;border-top:1px solid var(--c-border);border-radius:12px 12px 0 0}
.bib-grade{grid-template-columns:repeat(2,1fr)}.btn{min-height:32px}}
`));
}
