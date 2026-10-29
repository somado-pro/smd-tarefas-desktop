// ---------------------------------------------------------------- embutido no editor de encarte (SMD-1150)
// O editor de encarte abre esta página num <iframe> (?embutido) quando a pessoa edita o modelo do card:
// em vez do modal pequeno, o mesmo editor de modelo do construtor (camadas, propriedades, cor com degradê
// e transparência, regras, versões e formatos), Matheus 21/10/2026. Abre no projeto que foi publicado com
// o template, com o ajuste que a edição já tinha, ou seja, o card como está no encarte. Nada é gravado
// daqui (salvar/publicar ficam desligados no EMB.on): o encarte recebe o modelo pronto e aplica "só neste
// encarte" (ficha da edição) ou "salvar no template" (projeto do construtor + republicar).
// Usa o estado e as funções do app.js (S, M, EMB, abrirModelo, renderModelo, modeloFinal…).

const E = { d: null, base: {}, inicial: '', ocupado: false };
const NOME_KS = ['nome', 'nome_fundo'];

// ?painel: só o painel de ferramentas, ao lado do encarte (Matheus, 22/10/2026: "editar na tela, só o
// painel de ferramenta ser o do template"). O card é o do próprio encarte: cada mudança aqui manda o modelo
// pra prévia de lá (tipo 'previa'), e tocar/arrastar uma peça lá chega aqui como 'selecionar'/'mover'.
const PAINEL = new URLSearchParams(location.search).has('painel');
function iniciarEmbutido() {
  document.body.classList.add('embutido');
  if (PAINEL) document.body.classList.add('painel');
  window.addEventListener('message', ev => {
    const d = ev.data;
    if (ev.origin !== location.origin || ev.source !== window.parent || !d || !d.smdModelo) return;
    if (d.tipo === 'abrir') abrirEmbutido(d).catch(e => { alert('Não abri o modelo do card: ' + e.message); mandar({ tipo: 'fechar' }); });
    else if (d.tipo === 'erro') ocupado(false);
    else if (d.tipo === 'selecionar' && E.d) { M.sel = d.peca || null; renderModelo(); }
    else if (d.tipo === 'mover' && E.d) moverDoEncarte(d);
  });
  // Esc fecha (o seletor de cor aberto fecha primeiro: ele escuta no document, aqui é antes)
  window.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !E.d || popCor) return;
    e.preventDefault(); fecharEmbutido();
  }, true);
  mandar({ tipo: 'pronto' });
}
const mandar = m => window.parent.postMessage({ smdModelo: true, ...m }, location.origin);

async function abrirEmbutido(d) {
  carregando(true);
  try {
    const r = await fetch(`/api/encarte/templates/${encodeURIComponent(d.template)}/projeto`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ aj: d.aj || [] }),
    });
    if (!r.ok) throw new Error(r.status === 404 ? 'o template não tem o projeto do construtor publicado junto' : 'HTTP ' + r.status);
    S.proj = await r.json();
    S.proj.id = d.projetoId; // imagens enviadas no projeto (srcImg) e biblioteca
    // migrarMolde: modelo antigo num template publicado guarda cada tamanho em uso como formato (fica igual)
    S.proj.publicadoEm = S.proj.publicadoEm || new Date().toISOString();
    S.pi = 0; S.sel = null; S.sujo = false;
    await carregarBlocos();
    // os produtos da edição no card, começando pelo que foi tocado
    if (d.edicao) try {
      const re = await fetch('/api/encarte/edicoes/' + encodeURIComponent(d.edicao));
      if (re.ok) {
        const ed = await re.json(), ps = produtosDaEdicao(ed);
        S.exemplo = { edicao: d.edicao, titulo: ed.titulo, produtos: ps };
        const alvo = String(d.produto || '').replace(/\s+/g, ' ').trim().toLowerCase();
        M.exIdx = Math.max(0, ps.findIndex(p => p.nome.toLowerCase() === alvo));
      }
    } catch { /* sem os produtos: o card mostra o exemplo do template */ }
  } finally { carregando(false); }
  const m = S.proj.modelos_card.find(x => x.indice === d.modelo);
  if (!m) throw new Error(`o modelo ${d.modelo} não está no template publicado`);
  E.d = d; E.base = {};
  EMB.antesDeDesenhar = antesDeDesenhar;
  abrirModelo(m.id);
  // a versão do card tocado; no tamanho dele, se o modelo tiver desenho próprio pra esse tamanho
  if (M.m[d.versao]) M.aba = d.versao;
  const f = d.casa && M.m.molde && formatosDoModelo(M.m).find(x => x.v === M.aba && Math.abs(x.w - d.casa.w) < 1 && Math.abs(x.h - d.casa.h) < 1);
  if (f && formatoAjustado(f.k)) abrirFormato(f);
  montarCabecalho();
  renderModelo();
  E.inicial = E.enviado = JSON.stringify(modeloParaGravar());
}

// prévia no encarte (modo painel): depois de cada desenho, manda a peça selecionada e, se o modelo mudou
// desde o último envio, o modelo inteiro (o encarte espera parar de mexer antes de redesenhar)
const renderModeloBase = renderModelo;
renderModelo = function () { // eslint-disable-line no-global-assign
  renderModeloBase();
  if (!PAINEL || !E.d || E.enviado == null) return;
  const atual = JSON.stringify(modeloParaGravar());
  mandar({ tipo: 'sel', peca: M.sel || null, ...(atual !== E.enviado ? { modeloCard: JSON.parse(atual) } : {}) });
  E.enviado = atual;
};
// arrasto feito no card do encarte: fração do card de lá → pt do card daqui
function moverDoEncarte(d) {
  if (d.peca) M.sel = d.peca;
  const k = M.sel, card = caixaCardModal(), dx = (d.fx || 0) * card.w, dy = (d.fy || 0) * card.h;
  if (!k || (!dx && !dy)) return renderModelo();
  if (ehGrupo(k)) moverGrupo(k, dx, dy);
  else if (ehMulti(k)) moverPecas(pecasMulti(), dx, dy);
  else { const c = campoM(k); if (c && c.x != null) moverPecas([k], dx, dy); }
  renderModelo();
}

// o modelo como vai pro encarte (modeloFinal mexe no M.m: a conta sai numa cópia e o modal segue igual)
function modeloParaGravar() {
  const m0 = clone(M.m), r = clone(modeloFinal());
  M.m = m0;
  return r;
}
const mudou = () => JSON.stringify(modeloParaGravar()) !== E.inicial;

function montarCabecalho() {
  const hd = $('#modal-header');
  hd.querySelector('h2').textContent = `Modelo do card · ${M.m.nome || 'modelo ' + E.d.modelo}`;
  for (const id of ['emb-desfazer-peca', 'emb-tirar', 'emb-so-aqui']) { const x = document.getElementById(id); if (x) x.remove(); }
  const bt = (id, txt, title, fn, cls = 'btn') => h('button', { class: cls, id, title, on: { click: fn } }, txt);
  $('#modal-cancelar').before(
    bt('emb-desfazer-peca', 'Desfazer esta peça', 'Volta a peça selecionada como ela estava ao abrir', desfazerPeca),
    ...(E.d.temAjuste ? [bt('emb-tirar', 'Tirar o ajuste do encarte', 'O card volta a seguir o template nesta edição', () => enviar('tirar'))] : []),
    bt('emb-so-aqui', 'Só neste encarte', 'Vale pros cards deste modelo só nesta edição', () => enviar('so-aqui')));
  $('#modal-cancelar').textContent = 'Fechar';
  $('#modal-cancelar').onclick = fecharEmbutido;
  $('#modal-salvar').textContent = 'Salvar no template';
  $('#modal-salvar').title = 'Grava no modelo do construtor e republica o template';
  $('#modal-salvar').onclick = () => enviar('salvar');
  if (!$('#emb-aviso')) hd.after(h('div', { id: 'emb-aviso', class: 'oculto' }));
}

function ocupado(on) {
  E.ocupado = on;
  for (const b of $('#modal-header').querySelectorAll('button')) b.disabled = on;
}
function enviar(tipo) {
  if (E.ocupado) return;
  if (tipo !== 'tirar' && !mudou()) return alert('Nada mexido ainda.');
  ocupado(true);
  mandar({ tipo, modeloCard: tipo === 'tirar' ? null : modeloParaGravar() });
}
function fecharEmbutido() {
  if (E.ocupado) return;
  if (mudou() && !confirm('Sair sem aplicar? O que você mexeu no modelo do card se perde.')) return;
  mandar({ tipo: 'fechar' });
}

// antes de cada desenho do modal: guarda como cada versão estava ao abrir (base do "Desfazer esta peça") e,
// com a regra do cliente prendendo o nome, devolve o nome pro lugar (cor, fonte e tamanho continuam livres)
function antesDeDesenhar() {
  const c = M.m && M.m[M.aba];
  if (!c) return;
  if (!E.base[M.aba]) E.base[M.aba] = clone(c);
  const b = E.base[M.aba];
  let voltou = false;
  if (E.d.nomePreso) for (const k of NOME_KS) if (c[k] && b[k] && (c[k].x !== b[k].x || c[k].y !== b[k].y)) { c[k].x = b[k].x; c[k].y = b[k].y; voltou = true; }
  const av = $('#emb-aviso');
  if (!av) return;
  av.textContent = E.d.nomePreso || '';
  av.classList.toggle('oculto', !(E.d.nomePreso && (voltou || NOME_KS.includes(M.sel) || M.sel === 'g:produto')));
}

// a peça selecionada (ou as do grupo / da seleção múltipla) volta como estava ao abrir
function desfazerPeca() {
  const c = M.m[M.aba], b = E.base[M.aba];
  if (!c || !b) return;
  if (!M.sel) return alert('Toque numa peça do card (ou na lista) primeiro.');
  const G = ehGrupo(M.sel) && GRUPOS.find(g => 'g:' + g.id === M.sel);
  const ks = ehMulti(M.sel) ? M.mult || [] : G ? G.campos || [] : [M.sel];
  for (const k of ks) {
    if (/^x\d+$/.test(k)) { const i = +k.slice(1); if (c.extras && b.extras && b.extras[i]) c.extras[i] = clone(b.extras[i]); continue; }
    if (b[k]) c[k] = clone(b[k]); else delete c[k];
    const pc = c.com_selo && c.com_selo.pecas, pb = b.com_selo && b.com_selo.pecas;
    if (pc) { if (pb && pb[k]) pc[k] = clone(pb[k]); else delete pc[k]; }
  }
  if (M.sel === 'g:preco') { if (b.com_selo) c.com_selo = clone(b.com_selo); else delete c.com_selo; }
  renderModelo();
}
