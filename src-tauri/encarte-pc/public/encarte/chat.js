// ---------------------------------------------------------------- chat do Claude
// Painel do lado do palco: o Matheus pede, o Claude Code da VPS executa (do card até regra do
// cliente, template ou código) e devolve passos, resposta e pedidos de ok. Mensagens em
// /api/encarte/edicoes/<id>/chat (tabela gerencia.encarte_chat, 0018). Sem tempo real: o painel
// pergunta a cada 2 s enquanto o Claude trabalha (4 s com o painel aberto e ele parado).
// Usa do app.js: $, api, apiJson, S, abrirEdicao, salvar, tSalvar, alerta.
const CHAT = { aberto: false, ultimo: 0, base: null, rodando: false, timer: null, edicao: null };

function chatRota() { return '/edicoes/' + encodeURIComponent(S.edicao.id) + '/chat'; }

function chatAbrir(abrir = !CHAT.aberto) {
  CHAT.aberto = abrir;
  $('#chat').classList.toggle('oculto', !abrir);
  $('#ed-claude').classList.toggle('on', abrir);
  document.body.classList.toggle('com-chat', abrir);
  if (abrir) { chatPuxar(); setTimeout(() => $('#chat-txt').focus(), 50); }
  chatAgendar();
}

function chatAgendar() {
  clearTimeout(CHAT.timer);
  if (!S.edicao || (!CHAT.aberto && !CHAT.rodando)) return;
  CHAT.timer = setTimeout(chatPuxar, CHAT.rodando ? 2000 : 4000);
}

// outra edição aberta = outra conversa
function chatTrocouEdicao() {
  if (!S.edicao || CHAT.edicao === S.edicao.id) return;
  CHAT.edicao = S.edicao.id; CHAT.ultimo = 0; CHAT.base = null; CHAT.rodando = false;
  $('#chat-lista').replaceChildren();
}

async function chatPuxar() {
  if (!S.edicao) return;
  chatTrocouEdicao();
  try {
    const d = await apiJson(chatRota() + '?depois=' + CHAT.ultimo);
    // o que já existia quando a tela abriu não recarrega a ficha; só o que chega depois
    const primeira = CHAT.base === null;
    for (const m of d.mensagens || []) {
      CHAT.ultimo = Math.max(CHAT.ultimo, m.id);
      chatDesenhar(m);
      if (m.tipo === 'ficha' && !primeira) chatFichaMudou();
    }
    if (primeira) CHAT.base = CHAT.ultimo;
    // pedido que estava "na fila" e o Claude pegou: tira o aviso
    if (d.rodando) for (const s of document.querySelectorAll('#chat-lista .ch-eu small')) s.remove();
    CHAT.rodando = !!d.rodando;
    chatStatus(d);
  } catch (e) { /* sem rede: tenta de novo no próximo ciclo */ }
  chatAgendar();
}

function chatStatus(d) {
  $('#chat-status').textContent = d.parando ? 'parando…' : d.rodando ? 'trabalhando…' : '';
  $('#chat-parar').classList.toggle('oculto', !d.rodando);
  $('#ed-claude').classList.toggle('trabalhando', !!d.rodando);
}

function chatEl(tag, cls, txt) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt != null) e.textContent = txt;
  return e;
}

function chatDesenhar(m) {
  const lista = $('#chat-lista');
  const velho = lista.querySelector(`[data-id="${m.id}"]`);
  if (velho) velho.remove();
  let el;
  if (m.tipo === 'passo') {
    el = chatEl('div', 'ch-passo', '· ' + m.texto);
  } else if (m.tipo === 'ficha') {
    el = chatEl('div', 'ch-passo', '· ficha do encarte atualizada');
  } else if (m.tipo === 'fim') {
    el = chatEl('div', 'ch-fim', m.texto || 'pronto');
  } else if (m.tipo === 'erro') {
    el = chatEl('div', 'ch-erro', m.texto || 'deu erro');
  } else if (m.tipo === 'aprovacao') {
    el = chatEl('div', 'ch-ok');
    el.append(chatEl('b', '', 'Preciso do seu ok'), chatEl('p', '', m.texto));
    const det = m.dados && (m.dados.detalhe || m.dados.comando);
    if (det) el.append(chatEl('pre', '', String(det).slice(0, 1500)));
    if (m.estado === 'aguardando') {
      const linha = chatEl('div', 'linha-btn');
      const sim = chatEl('button', 'btn pri', 'Aprovar'), nao = chatEl('button', 'btn', 'Negar');
      sim.onclick = () => chatResponder(m, true); nao.onclick = () => chatResponder(m, false);
      linha.append(sim, nao); el.append(linha);
    } else {
      el.append(chatEl('small', '', m.estado === 'aprovado' ? '✓ aprovado' : '✕ negado'));
    }
  } else {
    el = chatEl('div', m.autor === 'usuario' ? 'ch-eu' : 'ch-claude', m.texto);
    if (m.autor === 'usuario' && m.estado === 'pendente') el.append(chatEl('small', '', 'na fila'));
  }
  el.dataset.id = m.id;
  // mantém a ordem pelo id (redesenho de aprovação cai no lugar certo)
  const depois = [...lista.children].find(x => Number(x.dataset.id) > m.id);
  lista.insertBefore(el, depois || null);
  if (!depois) lista.scrollTop = lista.scrollHeight;
}

async function chatResponder(m, aprovado) {
  try {
    const r = await api(chatRota(), { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acao: aprovado ? 'aprovar' : 'negar', msg: m.id }) });
    if (!r.ok && r.status !== 409) throw new Error(r.status);
    chatDesenhar({ ...m, estado: aprovado ? 'aprovado' : 'negado' });
  } catch (e) { if (e.message !== 'sessao') alerta('Não consegui mandar a resposta. Tente de novo.'); }
}

async function chatEnviar() {
  const t = $('#chat-txt'), texto = t.value.trim();
  if (!texto || !S.edicao) return;
  // o Claude lê a ficha do banco: o que está só na tela vai antes
  if (tSalvar) await salvar();
  t.value = ''; t.style.height = '';
  try {
    const r = await api(chatRota(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texto }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || r.status);
    CHAT.ultimo = Math.max(CHAT.ultimo, d.mensagem.id);
    chatDesenhar(d.mensagem);
    CHAT.rodando = true; chatAgendar();
  } catch (e) {
    t.value = texto;
    if (e.message !== 'sessao') alerta('Não consegui mandar a mensagem: ' + e.message);
  }
}

// o Claude gravou a ficha: recarrega a edição. Se tem mexida da tela ainda não salva, pergunta.
async function chatFichaMudou() {
  if (!S.edicao) return;
  if (tSalvar && !confirm('O Claude mudou este encarte.\n\nOK = recarregar e ver a mudança dele (o que você mexeu agora há pouco e ainda não salvou se perde).\nCancelar = continuar na sua versão.')) return;
  clearTimeout(tSalvar); tSalvar = null;
  await abrirEdicao(S.edicao.id);
}

$('#ed-claude').onclick = () => chatAbrir();
$('#chat-x').onclick = () => chatAbrir(false);
$('#chat-enviar').onclick = chatEnviar;
$('#chat-parar').onclick = async () => {
  try { await api(chatRota(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'parar' }) }); }
  catch (e) { /* o próximo ciclo mostra */ }
  chatPuxar();
};
$('#chat-txt').addEventListener('keydown', e => {
  // Enter manda, Shift+Enter quebra linha
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); chatEnviar(); }
});
$('#chat-txt').addEventListener('input', e => {
  const t = e.target; t.style.height = ''; t.style.height = Math.min(t.scrollHeight, 160) + 'px';
});
// ao abrir uma edição, confere se tem rodada em andamento (o botão avisa mesmo com o painel fechado)
setInterval(() => {
  const id = S.edicao && S.carregado ? S.edicao.id : null;
  if (id && id !== CHAT.edicao) chatPuxar();
}, 1000);
