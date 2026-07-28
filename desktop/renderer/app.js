/* Gideon — a Granola-class AI notepad. Hears the room, writes the notes. */

const PROD = 'wss://thought-plot-backend-2867a2f6bfe7.herokuapp.com/ws/study-session';
const LOCAL = 'ws://localhost:8000/ws/study-session';
const WS_URL = location.search.includes('local') ? LOCAL : PROD;

const SR = 16000, SILENCE_MS = 900, MIN_SPEECH_MS = 700, MAX_CHUNK_MS = 14000, RMS_THRESH = 0.012;
const $ = (id) => document.getElementById(id);

// ── Persistent state ──
const S = {
  title: '', notes: '', enhanced: '', lines: [], terms: [], asks: [],
  mermaid: { thought_plot: '', architect: '', argument_ref: '' },
  mode: 'thought_plot', tab: 'notes',
};
function save() { try { localStorage.setItem('gideon-session', JSON.stringify(S)); } catch {} }
function load() { try { const s = JSON.parse(localStorage.getItem('gideon-session') || 'null'); if (s) Object.assign(S, s); } catch {} }

let ws = null, wsReady = false, wsQueue = [];
let listening = false, currentTool = 'thought_plot';
let audioCtx = null, muteSink = null, pipelines = [];
let recStart = 0, recTimer = null, enhanceDirty = false;

// ── Mermaid ──
mermaid.initialize({
  startOnLoad: false, suppressErrorRendering: true, theme: 'base', securityLevel: 'loose',
  themeVariables: { darkMode: true, background: '#0c0b09', primaryColor: '#1e1d1a', primaryTextColor: '#f5f3ed', primaryBorderColor: '#3d3a35', lineColor: '#716d65', secondaryColor: '#1e1d1a', tertiaryColor: '#161514', edgeLabelBackground: '#161514', clusterBkg: '#161514', clusterBorder: '#332f2a' },
  flowchart: { curve: 'basis', padding: 16, nodeSpacing: 50, rankSpacing: 50, htmlLabels: true },
});
async function renderMap() {
  const code = S.mermaid[currentTool];
  if (!code) { $('map').innerHTML = ''; $('map-empty').style.display = ''; return; }
  try {
    const { svg } = await mermaid.render('mm-' + Date.now(), code);
    $('map').innerHTML = svg; $('map-empty').style.display = 'none';
    const s = $('map').querySelector('svg'), vb = s && s.viewBox && s.viewBox.baseVal;
    if (s && vb && vb.width) {
      const cw = $('map').clientWidth - 24, ch = $('map').clientHeight - 24;
      const fit = Math.max(0.5, Math.min(cw / vb.width, ch / vb.height, 2.2));
      s.style.width = vb.width + 'px'; s.style.height = vb.height + 'px';
      s.style.transform = `scale(${fit})`; s.style.transformOrigin = 'center';
    }
  } catch {}
}

// ── WebSocket ──
function connect() {
  ws = new WebSocket(WS_URL);
  ws.onopen = () => { wsReady = true; setStatus(listening ? 'Listening' : 'Ready'); wsQueue.forEach((m) => ws.send(m)); wsQueue = []; };
  ws.onclose = () => { wsReady = false; setTimeout(() => { if (listening) connect(); }, 1200); };
  ws.onerror = () => setStatus('Connection issue');
  ws.onmessage = (e) => {
    let d; try { d = JSON.parse(e.data); } catch { return; }
    switch (d.type) {
      case 'plot_update':
        if (d.graph && d.graph.mermaid_code) {
          const m = d.tool === 'architect' ? 'architect' : d.tool === 'argument_ref' ? 'argument_ref' : 'thought_plot';
          S.mermaid[m] = d.graph.mermaid_code; if (m === currentTool) renderMap(); save();
        }
        break;
      case 'transcript_text': if (d.text) { addLine(d.speaker || 'You', d.text); enhanceDirty = true; } break;
      case 'terms': if (d.terms) addTerms(d.terms); break;
      case 'ask_answer': resolveAsk(d.text); break;
      case 'enhanced_notes': setEnhanced(d.text); break;
      case 'fact_check': { const ok = d.status === 'incorrect' || (d.status === 'assumption' && (d.confidence || 0) >= 0.65); if (ok && d.status !== 'verified') addInsight(d.status === 'incorrect' ? 'bad' : 'warn', d.status === 'incorrect' ? 'Likely wrong' : 'Worth checking', d.claim, d.correction || d.explanation); break; }
      case 'fallacy_call': if (d.fallacy) addInsight('bad', 'Fallacy · ' + (d.fallacy.name || ''), d.fallacy.what_was_said, d.fallacy.why_its_wrong); break;
      case 'technique_detected': if (d.technique && d.technique.name && d.technique.name !== 'None') addInsight(d.technique.quality === 'effective' ? 'good' : 'warn', 'Technique · ' + d.technique.name, '', d.technique.feedback); break;
    }
  };
}
function wsSend(o) { const m = JSON.stringify(o); if (wsReady && ws.readyState === 1) ws.send(m); else wsQueue.push(m); }

// ── UI render ──
function setStatus(s) { $('status').textContent = s; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function mdInline(s) { return esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>'); }

function addLine(who, text) {
  const w = /them|other|speaker/i.test(who) ? 'them' : 'you';
  S.lines.push({ who: w, text }); if (S.lines.length > 400) S.lines.shift();
  renderTranscript(); save();
}
function renderTranscript() {
  const el = $('transcript');
  $('transcript-empty').style.display = S.lines.length ? 'none' : '';
  el.innerHTML = S.lines.map((l) => `<div class="tline"><span class="who ${l.who}">${l.who === 'them' ? 'Them' : 'You'}</span>${esc(l.text)}</div>`).join('');
  el.scrollTop = el.scrollHeight;
  badge('b-transcript', S.lines.length);
}
function addTerms(terms) {
  let added = false;
  for (const t of terms) { if (!S.terms.some((x) => x.term.toLowerCase() === (t.term || '').toLowerCase())) { S.terms.push({ term: t.term, definition: t.definition }); added = true; } }
  if (added) { renderTerms(); save(); }
}
function renderTerms() {
  $('terms-empty').style.display = S.terms.length ? 'none' : '';
  $('terms').innerHTML = S.terms.map((t) => `<div class="term"><b>${esc(t.term)}</b><span>${esc(t.definition)}</span></div>`).join('');
  badge('b-terms', S.terms.length);
}
function addInsight(tone, head, claim, fix) {
  const div = document.createElement('div'); div.className = 'ins ' + tone;
  div.innerHTML = `<div class="h">${esc(head)}</div>` + (claim ? `<div class="claim">“${esc(claim)}”</div>` : '') + (fix ? `<div class="fix">${esc(fix)}</div>` : '');
  $('insights').prepend(div); while ($('insights').children.length > 24) $('insights').lastChild.remove();
}
function badge(id, n) { const b = $(id); if (!b) return; b.textContent = n; b.classList.toggle('show', n > 0); }

// Chat
function addAsk(q) {
  const wrap = document.createElement('div'); wrap.className = 'qa';
  wrap.innerHTML = `<div class="q-wrap"><span class="q">${esc(q)}</span></div><div class="a">…</div>`;
  $('asks').appendChild(wrap); $('chat-empty').style.display = 'none';
  $('asks').scrollTop = $('asks').scrollHeight;
  return wrap.querySelector('.a');
}
let pendingAnswer = null;
function resolveAsk(text) {
  if (pendingAnswer) { pendingAnswer.innerHTML = mdInline(text).replace(/\n/g, '<br>'); pendingAnswer = null; }
  S.asks.push(text); $('asks').scrollTop = $('asks').scrollHeight; save();
}

// Enhanced notes (markdown → html)
function mdToHtml(md) {
  const out = []; let inList = false;
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    if (/^##\s/.test(line)) { if (inList) { out.push('</ul>'); inList = false; } out.push('<h2>' + esc(line.slice(3)) + '</h2>'); }
    else if (/^#\s/.test(line)) { if (inList) { out.push('</ul>'); inList = false; } out.push('<h1>' + esc(line.slice(2)) + '</h1>'); }
    else if (/^[-*]\s/.test(line)) { if (!inList) { out.push('<ul>'); inList = true; } const t = line.replace(/^[-*]\s+/, ''); const task = /^\[[ x]\]\s/.test(t); out.push(`<li${task ? ' class="task"' : ''}>${mdInline(t.replace(/^\[[ x]\]\s+/, ''))}</li>`); }
    else if (!line.trim()) { if (inList) { out.push('</ul>'); inList = false; } }
    else { if (inList) { out.push('</ul>'); inList = false; } out.push('<p>' + mdInline(line) + '</p>'); }
  }
  if (inList) out.push('</ul>');
  return out.join('');
}
function setEnhanced(md) {
  S.enhanced = md || ''; $('enhanced').innerHTML = md ? mdToHtml(md) : '';
  $('enhance').disabled = false; $('enhance').innerHTML = '✨ Enhance';
  if (md) showEnhanced(true); save();
}
function showEnhanced(on) {
  $('tg-enh').classList.toggle('on', on); $('tg-mine').classList.toggle('on', !on);
  $('enhanced').classList.toggle('hidden', !on); $('editor').style.display = on ? 'none' : '';
}
function doEnhance() {
  const transcript = S.lines.map((l) => `${l.who === 'them' ? 'Them' : 'You'}: ${l.text}`).join('\n');
  if (!transcript && !S.notes.trim()) return;
  $('enhance').disabled = true; $('enhance').innerHTML = '✨ Enhancing…';
  $('enhanced').innerHTML = '<span class="loading">Writing your notes…</span>'; showEnhanced(true);
  if (!ws || ws.readyState > 1) connect();
  wsSend({ type: 'enhance', transcript, notes: S.notes, title: S.title });
  enhanceDirty = false;
}

// ── Tabs ──
function setTab(t) {
  S.tab = t; save();
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('on', v.id === 'v-' + t));
  if (t === 'map') renderMap();
}
$('tabs').addEventListener('click', (e) => { const b = e.target.closest('.tab'); if (b) setTab(b.dataset.tab); });

// ── Audio ──
function makePipeline(stream, speaker) {
  const st = { pending: [], plen: 0, hasSpeech: false, lastSpeech: 0, stream, speaker };
  st.src = audioCtx.createMediaStreamSource(stream);
  st.proc = audioCtx.createScriptProcessor(4096, 1, 1);
  st.proc.onaudioprocess = (ev) => {
    if (!listening) return;
    const input = ev.inputBuffer.getChannelData(0);
    let sum = 0; for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    const rms = Math.sqrt(sum / input.length), now = performance.now();
    st.pending.push(new Float32Array(input)); st.plen += input.length;
    if (rms > RMS_THRESH) { st.hasSpeech = true; st.lastSpeech = now; }
    const durMs = (st.plen / SR) * 1000, silent = now - st.lastSpeech;
    if (st.hasSpeech && ((silent > SILENCE_MS && durMs > MIN_SPEECH_MS) || durMs > MAX_CHUNK_MS)) flush(st);
    else if (!st.hasSpeech && durMs > 3000) { st.pending = []; st.plen = 0; }
  };
  st.src.connect(st.proc); st.proc.connect(muteSink);
  return st;
}
function flush(st) {
  if (!st.plen) return;
  const merged = new Float32Array(st.plen); let off = 0;
  for (const b of st.pending) { merged.set(b, off); off += b.length; }
  st.pending = []; st.plen = 0; st.hasSpeech = false;
  wsSend({ type: 'audio_chunk', audio: abToB64(encodeWav(merged, SR)), mime_type: 'audio/wav', tool: currentTool, mode: 'general', speaker: st.speaker, fact_check_enabled: true });
}
async function startListening() {
  if (!ws || ws.readyState > 1) connect();
  audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SR });
  muteSink = audioCtx.createGain(); muteSink.gain.value = 0; muteSink.connect(audioCtx.destination);
  pipelines = [];
  const src = $('source').value;
  if (src === 'mic' || src === 'both') { try { pipelines.push(makePipeline(await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }), 'You')); } catch { setStatus('Mic permission needed'); } }
  if (src === 'system' || src === 'both') { try { const s = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true }); s.getVideoTracks().forEach((t) => t.stop()); if (s.getAudioTracks().length) pipelines.push(makePipeline(s, 'Them')); else setStatus('Enable Screen Recording for system audio'); } catch { if (!pipelines.length) setStatus('System audio unavailable'); } }
  if (!pipelines.length) { stopListening(); return; }
  listening = true; document.body.classList.add('listening');
  $('listen').classList.add('live'); $('listen-label').textContent = 'Stop';
  $('rec').classList.remove('hidden'); recStart = Date.now();
  recTimer = setInterval(() => { const s = Math.floor((Date.now() - recStart) / 1000); $('rec-time').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }, 500);
  setStatus('Listening');
}
function stopListening() {
  listening = false; document.body.classList.remove('listening');
  $('listen').classList.remove('live'); $('listen-label').textContent = 'Listen';
  $('rec').classList.add('hidden'); clearInterval(recTimer);
  for (const p of pipelines) { try { p.proc.disconnect(); } catch {} try { p.src.disconnect(); } catch {} try { p.stream.getTracks().forEach((t) => t.stop()); } catch {} }
  pipelines = []; try { if (audioCtx) audioCtx.close(); } catch {} audioCtx = null;
  setStatus('Paused');
  if (enhanceDirty && S.lines.length) doEnhance(); // auto-enhance after the meeting
}
function encodeWav(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, samples.length * 2, true);
  let o = 44; for (let i = 0; i < samples.length; i++) { let s = Math.max(-1, Math.min(1, samples[i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
  return buf;
}
function abToB64(ab) { const b = new Uint8Array(ab); let s = ''; const C = 0x8000; for (let i = 0; i < b.length; i += C) s += String.fromCharCode.apply(null, b.subarray(i, i + C)); return btoa(s); }

// ── Wire up ──
function init() {
  load();
  $('title').textContent = S.title;
  $('editor').textContent = S.notes;
  currentTool = S.mode;
  document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.tool === currentTool));
  renderTranscript(); renderTerms();
  $('enhanced').innerHTML = S.enhanced ? mdToHtml(S.enhanced) : '';
  if (S.asks.length) { /* keep chat empty on reload; asks are answers only */ }
  setTab(S.tab || 'notes');

  $('title').addEventListener('input', () => { S.title = $('title').textContent.trim(); save(); });
  $('editor').addEventListener('input', () => { S.notes = $('editor').innerText; save(); });
  $('tg-mine').addEventListener('click', () => showEnhanced(false));
  $('tg-enh').addEventListener('click', () => { if (S.enhanced) showEnhanced(true); else doEnhance(); });
  $('enhance').addEventListener('click', doEnhance);

  $('modes').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b) return; document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === b)); currentTool = b.dataset.tool; S.mode = currentTool; save(); if (wsReady) wsSend({ type: 'context_reset', tool: currentTool, mode: 'general' }); renderMap(); });

  $('ask-form').addEventListener('submit', (e) => { e.preventDefault(); const q = $('ask-input').value.trim(); if (!q) return; $('ask-input').value = ''; setTab('chat'); pendingAnswer = addAsk(q); if (!ws || ws.readyState > 1) connect(); wsSend({ type: 'ask', text: q, context: S.lines.slice(-40).map((l) => `${l.who === 'them' ? 'Them' : 'You'}: ${l.text}`).join('\n') }); });

  $('export').addEventListener('click', () => {
    const md = [`# ${S.title || 'Meeting notes'}`, '', S.enhanced || '', '', '## Transcript', ...S.lines.map((l) => `**${l.who === 'them' ? 'Them' : 'You'}:** ${l.text}`)].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    a.download = `gideon-${(S.title || 'notes').replace(/\s+/g, '-').toLowerCase()}.md`; a.click(); URL.revokeObjectURL(a.href);
  });

  $('new').addEventListener('click', () => {
    if (listening) stopListening();
    Object.assign(S, { title: '', notes: '', enhanced: '', lines: [], terms: [], asks: [], mermaid: { thought_plot: '', architect: '', argument_ref: '' }, tab: 'notes' });
    $('title').textContent = ''; $('editor').textContent = ''; $('enhanced').innerHTML = ''; $('map').innerHTML = ''; $('insights').innerHTML = '';
    renderTranscript(); renderTerms(); $('asks').innerHTML = ''; $('chat-empty').style.display = ''; showEnhanced(false); setTab('notes'); save();
    if (wsReady) wsSend({ type: 'context_reset', tool: currentTool, mode: 'general' });
  });

  $('listen').addEventListener('click', () => (listening ? stopListening() : startListening()));

  // pill / window
  $('pill').addEventListener('click', () => { document.body.classList.add('expanded'); if (window.gideon) window.gideon.expand(); });
  $('collapse').addEventListener('click', () => { document.body.classList.remove('expanded'); if (window.gideon) window.gideon.collapse(); });
  $('close').addEventListener('click', () => window.gideon && window.gideon.close());
  $('stealth').addEventListener('click', async () => { const on = !$('stealth').classList.contains('on'); $('stealth').classList.toggle('on', on); if (window.gideon) await window.gideon.setStealth(on); });

  if (window.gideon) {
    window.gideon.onView((v) => document.body.classList.toggle('expanded', v === 'panel'));
    window.gideon.onHotkeyListen(() => (listening ? stopListening() : startListening()));
    window.gideon.onHotkeyAsk(() => { setTab('chat'); $('ask-input').focus(); });
    window.gideon.onMeetingDetected((name) => { if (listening) return; $('mb-app').textContent = name || 'a meeting'; $('mbanner').classList.remove('hidden'); });
    window.gideon.onMeetingCleared(() => $('mbanner').classList.add('hidden'));
  }
  $('mb-take').addEventListener('click', () => { $('mbanner').classList.add('hidden'); $('source').value = 'both'; startListening(); });
  $('mb-x').addEventListener('click', () => { $('mbanner').classList.add('hidden'); if (window.gideon) window.gideon.dismissMeeting($('mb-app').textContent); });

  connect();
}
init();
