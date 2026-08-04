/* Gideon — a Granola-class AI notepad. Hears the room, writes the notes. */

const PROD = 'wss://thought-plot-backend-2867a2f6bfe7.herokuapp.com/ws/study-session';
const LOCAL = 'ws://localhost:8000/ws/study-session';
const WS_URL = location.search.includes('local') ? LOCAL : PROD;
const SR = 16000, SILENCE_MS = 900, MIN_SPEECH_MS = 700, MAX_CHUNK_MS = 14000, RMS_THRESH = 0.012;
const $ = (id) => document.getElementById(id);

// ── Custom icons (no emoji, hand-drawn — not an icon-lib) ──
const ICONS = {
  logo: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 5.6 6.6 17M12 5.6 17.4 17M6.6 17.2h10.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="5.6" r="2.3" fill="currentColor"/><circle cx="6.6" cy="17.4" r="2.3" fill="currentColor"/><circle cx="17.4" cy="17.4" r="2.3" fill="currentColor"/></svg>',
  enhance: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3.4 13.5 9.7 20 12l-6.5 2.3L12 20.6l-1.5-6.3L4 12l6.5-2.3z"/><circle cx="18.6" cy="5.6" r="1.3"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.6 12S6 6.2 12 6.2 21.4 12 21.4 12 18 17.8 12 17.8 2.6 12 2.6 12Z"/><circle cx="12" cy="12" r="2.5"/><path d="M4 4 20 20"/></svg>',
  collapse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10.5 12 15l5-4.5"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M6.6 6.6 17.4 17.4M17.4 6.6 6.6 17.4"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 5.5v13M5.5 12h13"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V6M6.6 11.4 12 6l5.4 5.4"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M5 7h14M5 12h14M5 17h9"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 6 9 12l5.5 6"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="11" cy="11" r="6.2"/><path d="M20 20l-3.6-3.6"/></svg>',
  minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M5.5 12h13"/></svg>',
  fit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3.5H4.5V7M16 3.5h3.5V7M8 20.5H4.5V17M16 20.5h3.5V17"/></svg>',
};
function injectIcons(root) { (root || document).querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = ICONS[el.dataset.icon] || ''; }); }

// ── State ──
const S = { id: '', date: 0, updated: 0, title: '', notes: '', enhanced: '', lines: [], terms: [], asks: [], mermaid: { thought_plot: '', architect: '', argument_ref: '' }, mode: 'thought_plot', tab: 'notes' };
let NOTES = [];
function uid() { return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function freshSession() { return { id: uid(), date: Date.now(), updated: Date.now(), title: '', notes: '', enhanced: '', lines: [], terms: [], asks: [], mermaid: { thought_plot: '', architect: '', argument_ref: '' }, mode: currentTool, tab: 'notes' }; }
function loadAll() {
  try { NOTES = JSON.parse(localStorage.getItem('gideon-notes') || '[]'); } catch { NOTES = []; }
  const cur = NOTES.find((n) => n.id === localStorage.getItem('gideon-current'));
  if (cur) Object.assign(S, cur); else Object.assign(S, freshSession());
}
let saveT = null;
function save() {
  S.updated = Date.now(); if (!S.date) S.date = Date.now();
  const i = NOTES.findIndex((n) => n.id === S.id); const snap = JSON.parse(JSON.stringify(S));
  if (i >= 0) NOTES[i] = snap; else NOTES.unshift(snap);
  clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem('gideon-notes', JSON.stringify(NOTES.slice(0, 200))); localStorage.setItem('gideon-current', S.id); } catch {} }, 250);
}
function relTime(ts) { if (!ts) return 'Today'; const d = new Date(ts), now = new Date(), day = 86400000, diff = now - ts; if (diff < day && now.getDate() === d.getDate()) return 'Today · ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); if (diff < 2 * day) return 'Yesterday'; if (diff < 7 * day) return d.toLocaleDateString([], { weekday: 'long' }); return d.toLocaleDateString([], { month: 'short', day: 'numeric' }); }

let ws = null, wsReady = false, wsQueue = [];
let listening = false, currentTool = 'thought_plot', localSTT = false;
let audioCtx = null, muteSink = null, pipelines = [];
let recStart = 0, recTimer = null, enhanceDirty = false, titleRequested = false;

// ── Mermaid ──
mermaid.initialize({ startOnLoad: false, suppressErrorRendering: true, theme: 'base', securityLevel: 'loose',
  themeVariables: { darkMode: true, background: '#0c0b09', primaryColor: '#1e1d1a', primaryTextColor: '#f5f3ed', primaryBorderColor: '#3d3a35', lineColor: '#716d65', secondaryColor: '#1e1d1a', tertiaryColor: '#161514', edgeLabelBackground: '#161514', clusterBkg: '#161514', clusterBorder: '#332f2a' },
  flowchart: { curve: 'basis', padding: 16, nodeSpacing: 50, rankSpacing: 50, htmlLabels: true } });
let mapScale = 1, mapTx = 0, mapTy = 0, mapDims = { w: 0, h: 0 };
function applyMap() { const s = $('map').querySelector('svg'); if (s) s.style.transform = `translate(${mapTx}px, ${mapTy}px) scale(${mapScale})`; }
function fitMap() {
  const s = $('map').querySelector('svg'); if (!s) return;
  const vb = s.viewBox && s.viewBox.baseVal;
  const w = vb && vb.width ? vb.width : 800, h = vb && vb.height ? vb.height : 600;
  mapDims = { w, h };
  s.style.width = w + 'px'; s.style.height = h + 'px';
  const cw = $('map').clientWidth, ch = $('map').clientHeight;
  let sc = Math.min((cw - 20) / w, (ch - 20) / h);
  if (!isFinite(sc) || sc <= 0) sc = 1;
  mapScale = Math.min(sc, 1.8);
  mapTx = (cw - w * mapScale) / 2; mapTy = (ch - h * mapScale) / 2;
  applyMap();
}
function zoomMap(factor, cx, cy) {
  const el = $('map'), rect = el.getBoundingClientRect();
  const mx = cx == null ? rect.width / 2 : cx - rect.left, my = cy == null ? rect.height / 2 : cy - rect.top;
  const ns = Math.min(8, Math.max(0.1, mapScale * factor));
  mapTx = mx - (mx - mapTx) * (ns / mapScale);
  mapTy = my - (my - mapTy) * (ns / mapScale);
  mapScale = ns; applyMap();
}
async function renderMap() {
  const code = S.mermaid[currentTool];
  if (!code) { $('map').innerHTML = ''; $('map-empty').style.display = ''; $('map-ctrl').classList.add('hidden'); renderMapState(); return; }
  try {
    const { svg } = await mermaid.render('mm-' + Date.now(), code);
    $('map').innerHTML = svg; $('map-empty').style.display = 'none'; $('map-ctrl').classList.remove('hidden');
    fitMap();
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
      case 'plot_update': if (d.graph && d.graph.mermaid_code) { const m = d.tool === 'architect' ? 'architect' : d.tool === 'argument_ref' ? 'argument_ref' : 'thought_plot'; S.mermaid[m] = d.graph.mermaid_code; if (m === currentTool) renderMap(); save(); } break;
      case 'transcript_text': if (d.text) { addLine(d.speaker || 'You', d.text); enhanceDirty = true; maybeTitle(); } break;
      case 'terms': if (d.terms) addTerms(d.terms); break;
      case 'ask_answer': resolveAsk(d.text); break;
      case 'enhanced_notes': setEnhanced(d.text); break;
      case 'title_suggestion': if (!S.title && d.text) { S.title = d.text; $('title').textContent = d.text; $('meta-date').textContent = relTime(S.date); save(); } break;
      case 'fact_check': { const ok = d.status === 'incorrect' || (d.status === 'assumption' && (d.confidence || 0) >= 0.65); if (ok && d.status !== 'verified') addInsight(d.status === 'incorrect' ? 'bad' : 'warn', d.status === 'incorrect' ? 'Likely wrong' : 'Worth checking', d.claim, d.correction || d.explanation); break; }
      case 'fallacy_call': if (d.fallacy) addInsight('bad', 'Fallacy · ' + (d.fallacy.name || ''), d.fallacy.what_was_said, d.fallacy.why_its_wrong); break;
      case 'technique_detected': if (d.technique && d.technique.name && d.technique.name !== 'None') addInsight(d.technique.quality === 'effective' ? 'good' : 'warn', 'Technique · ' + d.technique.name, '', d.technique.feedback); break;
    }
  };
}
function wsSend(o) { const m = JSON.stringify(o); if (wsReady && ws.readyState === 1) ws.send(m); else wsQueue.push(m); }

// ── UI ──
function setStatus(s) { $('status').textContent = s; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function mdInline(s) { return esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>'); }
function badge(id, n) { const b = $(id); if (!b) return; b.textContent = n; b.classList.toggle('show', n > 0); }

function addLine(who, text) { const w = /them|other|speaker/i.test(who) ? 'them' : 'you'; S.lines.push({ who: w, text }); if (S.lines.length > 20000) S.lines.shift(); renderTranscript(); save(); }
function renderTranscript() { const el = $('transcript'); $('transcript-empty').style.display = S.lines.length ? 'none' : ''; el.innerHTML = S.lines.map((l) => `<div class="tline"><span class="who ${l.who}">${l.who === 'them' ? 'Them' : 'You'}</span>${esc(l.text)}</div>`).join(''); el.scrollTop = el.scrollHeight; badge('b-transcript', S.lines.length); }
function addTerms(terms) { let a = false; for (const t of terms) { if (!S.terms.some((x) => x.term.toLowerCase() === (t.term || '').toLowerCase())) { S.terms.push({ term: t.term, definition: t.definition }); a = true; } } if (a) { renderTerms(); save(); } }
function renderTerms() { $('terms-empty').style.display = S.terms.length ? 'none' : ''; $('terms').innerHTML = S.terms.map((t) => `<div class="term"><b>${esc(t.term)}</b><span>${esc(t.definition)}</span></div>`).join(''); badge('b-terms', S.terms.length); }
function addInsight(tone, head, claim, fix) { const div = document.createElement('div'); div.className = 'ins ' + tone; div.innerHTML = `<div class="h">${esc(head)}</div>` + (claim ? `<div class="claim">“${esc(claim)}”</div>` : '') + (fix ? `<div class="fix">${esc(fix)}</div>` : ''); $('insights').prepend(div); while ($('insights').children.length > 24) $('insights').lastChild.remove(); }

let pendingAnswer = null;
function addAsk(q) { const wrap = document.createElement('div'); wrap.className = 'qa'; wrap.innerHTML = `<div class="q-wrap"><span class="q">${esc(q)}</span></div><div class="a">…</div>`; $('asks').appendChild(wrap); $('chat-empty').style.display = 'none'; $('asks').scrollTop = $('asks').scrollHeight; return wrap.querySelector('.a'); }
function resolveAsk(text) { if (pendingAnswer) { pendingAnswer.innerHTML = mdInline(text).replace(/\n/g, '<br>'); pendingAnswer = null; } $('asks').scrollTop = $('asks').scrollHeight; }

function mdToHtml(md) { const out = []; let inList = false; for (const raw of md.split('\n')) { const line = raw.trimEnd(); if (/^##\s/.test(line)) { if (inList) { out.push('</ul>'); inList = false; } out.push('<h2>' + esc(line.slice(3)) + '</h2>'); } else if (/^#\s/.test(line)) { if (inList) { out.push('</ul>'); inList = false; } out.push('<h1>' + esc(line.slice(2)) + '</h1>'); } else if (/^[-*]\s/.test(line)) { if (!inList) { out.push('<ul>'); inList = true; } const t = line.replace(/^[-*]\s+/, ''); const task = /^\[[ x]\]\s/.test(t); out.push(`<li${task ? ' class="task"' : ''}>${mdInline(t.replace(/^\[[ x]\]\s+/, ''))}</li>`); } else if (!line.trim()) { if (inList) { out.push('</ul>'); inList = false; } } else { if (inList) { out.push('</ul>'); inList = false; } out.push('<p>' + mdInline(line) + '</p>'); } } if (inList) out.push('</ul>'); return out.join(''); }
function setEnhanced(md) { S.enhanced = md || ''; $('enhanced').innerHTML = md ? mdToHtml(md) : ''; $('enhance').disabled = false; if (md) showEnhanced(true); save(); }
function showEnhanced(on) { $('tg-enh').classList.toggle('on', on); $('tg-mine').classList.toggle('on', !on); $('enhanced').classList.toggle('hidden', !on); $('editor').style.display = on ? 'none' : ''; }
function doEnhance() { const transcript = S.lines.map((l) => `${l.who === 'them' ? 'Them' : 'You'}: ${l.text}`).join('\n'); if (!transcript && !S.notes.trim()) return; $('enhance').disabled = true; $('enhanced').innerHTML = '<span class="loading">Writing your notes…</span>'; showEnhanced(true); if (!ws || ws.readyState > 1) connect(); wsSend({ type: 'enhance', transcript, notes: S.notes, title: S.title }); enhanceDirty = false; }
function maybeTitle() { if (S.title || titleRequested || S.lines.length < 3) return; titleRequested = true; wsSend({ type: 'title', transcript: S.lines.map((l) => `${l.who === 'them' ? 'Them' : 'You'}: ${l.text}`).join('\n'), notes: S.notes }); }

// ── Tabs ──
function transcriptText(n) { return S.lines.slice(-(n || 40)).map((l) => `${l.who === 'them' ? 'Them' : 'You'}: ${l.text}`).join('\n'); }
function mapNow() { if (S.lines.length) { if (!ws || ws.readyState > 1) connect(); wsSend({ type: 'map_now', text: transcriptText(30), tool: currentTool }); } }
function setTab(t) { S.tab = t; save(); document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === t)); document.querySelectorAll('.view').forEach((v) => v.classList.toggle('on', v.id === 'v-' + t)); if (t === 'map') { renderMap(); renderMapState(); } if (t === 'terms' && !S.terms.length && S.lines.length) requestTermsOnce(); }
function renderMapState() {
  const startBtn = $('map-start'), txt = document.querySelector('.map-empty-text');
  if (startBtn) startBtn.style.display = mapArmed ? 'none' : '';
  if (txt) txt.textContent = mapArmed ? 'Listening — your diagram builds as you talk.' : 'Turn this conversation into a live diagram — only when you ask.';
}
function armMapping() { mapArmed = true; renderMapState(); mapNow(); setStatus('Mapping'); }
let termsRequested = false;
function requestTermsOnce() { if (termsRequested) return; termsRequested = true; if (!ws || ws.readyState > 1) connect(); wsSend({ type: 'terms_now', text: transcriptText(60) }); }

// ── Library ──
function openLibrary() { renderLibrary(''); $('lib-search-input').value = ''; $('library').classList.remove('hidden'); }
function closeLibrary() { $('library').classList.add('hidden'); }
function renderLibrary(q) {
  const list = NOTES.slice().sort((a, b) => (b.updated || b.date || 0) - (a.updated || a.date || 0));
  const f = q ? list.filter((n) => ((n.title || '') + ' ' + (n.notes || '') + ' ' + (n.lines || []).map((l) => l.text).join(' ')).toLowerCase().includes(q.toLowerCase())) : list;
  $('lib-empty').style.display = f.length ? 'none' : '';
  $('lib-list').innerHTML = f.map((n) => { const snip = (n.enhanced || n.notes || (n.lines || []).map((l) => l.text).join(' ') || '').replace(/[#*\n]/g, ' ').trim().slice(0, 96); return `<button class="lib-item${n.id === S.id ? ' cur' : ''}" data-id="${n.id}"><div class="li-title">${esc(n.title || 'Untitled note')}</div><div class="li-sub">${relTime(n.updated || n.date)} · ${(n.lines || []).length} lines</div>${snip ? `<div class="li-snip">${esc(snip)}</div>` : ''}</button>`; }).join('');
}
function hydrate() {
  $('title').textContent = S.title || ''; $('editor').innerText = S.notes || '';
  $('enhanced').innerHTML = S.enhanced ? mdToHtml(S.enhanced) : '';
  currentTool = S.mode || 'thought_plot'; document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.tool === currentTool));
  renderTranscript(); renderTerms(); renderMap(); $('asks').innerHTML = ''; $('chat-empty').style.display = ''; showEnhanced(false);
  $('meta-date').textContent = relTime(S.date); titleRequested = !!S.title; termsRequested = false; mapArmed = false;
}
function openNote(id) { save(); const n = NOTES.find((x) => x.id === id); if (!n) return; Object.assign(S, JSON.parse(JSON.stringify(n))); hydrate(); setTab('notes'); closeLibrary(); }
function newNote() { if (listening) stopListening(); save(); Object.assign(S, freshSession()); hydrate(); setTab('notes'); closeLibrary(); if (wsReady) wsSend({ type: 'context_reset', tool: currentTool, mode: 'general' }); }

// ── Audio ──
function makePipeline(stream, speaker) {
  const st = { pending: [], plen: 0, hasSpeech: false, lastSpeech: 0, stream, speaker };
  st.src = audioCtx.createMediaStreamSource(stream); st.proc = audioCtx.createScriptProcessor(4096, 1, 1);
  st.proc.onaudioprocess = (ev) => { if (!listening) return; const input = ev.inputBuffer.getChannelData(0); let sum = 0; for (let i = 0; i < input.length; i++) sum += input[i] * input[i]; const rms = Math.sqrt(sum / input.length), now = performance.now(); st.pending.push(new Float32Array(input)); st.plen += input.length; if (rms > RMS_THRESH) { st.hasSpeech = true; st.lastSpeech = now; } const durMs = (st.plen / SR) * 1000, silent = now - st.lastSpeech; if (st.hasSpeech && ((silent > SILENCE_MS && durMs > MIN_SPEECH_MS) || durMs > MAX_CHUNK_MS)) flush(st); else if (!st.hasSpeech && durMs > 3000) { st.pending = []; st.plen = 0; } };
  st.src.connect(st.proc); st.proc.connect(muteSink); return st;
}
// AI runs on-demand only: transcription is always on, but the map / fact-check /
// terms passes fire only while you're actually viewing that panel. Default
// listening = transcribe + save, nothing else billed.
let mapArmed = false; // the map only builds after you press "Start mapping"
function chunkFlags() {
  return {
    map_enabled: S.tab === 'map' && mapArmed,
    terms_enabled: S.tab === 'terms',
    fact_check_enabled: S.tab === 'map' && mapArmed && currentTool === 'argument_ref',
  };
}
// Fallback only (non-macOS-26 / Windows): server-side transcription via Gemini.
function flush(st) {
  if (!st.plen) return;
  const merged = new Float32Array(st.plen); let off = 0;
  for (const b of st.pending) { merged.set(b, off); off += b.length; }
  st.pending = []; st.plen = 0; st.hasSpeech = false;
  wsSend(Object.assign({ type: 'audio_chunk', audio: abToB64(encodeWav(merged, SR)), mime_type: 'audio/wav', tool: currentTool, mode: 'general', speaker: st.speaker }, chunkFlags()));
}
function listenUI(on) {
  listening = on;
  document.body.classList.toggle('listening', on);
  $('listen').classList.toggle('live', on);
  $('listen-label').textContent = on ? 'Stop' : 'Listen';
  $('rec').classList.toggle('hidden', !on);
  if (on) { recStart = Date.now(); recTimer = setInterval(() => { const s = Math.floor((Date.now() - recStart) / 1000); $('rec-time').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }, 500); setStatus('Listening'); }
  else { clearInterval(recTimer); setStatus('Paused'); }
}
// Called on each finalized sentence from the on-device streaming transcriber.
function onSegment(seg) {
  if (!listening || !seg || !seg.text) return;
  addLine(seg.speaker, seg.text); enhanceDirty = true; maybeTitle();
  const f = chunkFlags();
  if (f.map_enabled || f.terms_enabled || f.fact_check_enabled) {
    wsSend(Object.assign({ type: 'text_chunk', text: seg.text, speaker: seg.speaker, tool: currentTool, mode: 'general' }, f));
  }
}
async function startListening() {
  const src = $('source').value;
  if (localSTT && window.gideon && window.gideon.sttStart) {
    // Real-time on-device streaming (Apple SpeechAnalyzer via yap).
    const ok = await window.gideon.sttStart({ mic: src === 'mic' || src === 'both', system: src === 'system' || src === 'both' });
    if (ok) { if (!ws || ws.readyState > 1) connect(); listenUI(true); return; }
    localSTT = false; // yap failed to start → fall back
  }
  // Fallback: browser capture → Gemini transcription.
  if (!ws || ws.readyState > 1) connect();
  audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SR }); muteSink = audioCtx.createGain(); muteSink.gain.value = 0; muteSink.connect(audioCtx.destination); pipelines = [];
  if (src === 'mic' || src === 'both') { try { pipelines.push(makePipeline(await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }), 'You')); } catch { setStatus('Mic permission needed'); } }
  if (src === 'system' || src === 'both') { try { const s = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true }); s.getVideoTracks().forEach((t) => t.stop()); if (s.getAudioTracks().length) pipelines.push(makePipeline(s, 'Them')); else setStatus('Enable Screen Recording for system audio'); } catch { if (!pipelines.length) setStatus('System audio unavailable'); } }
  if (!pipelines.length) { stopListening(); return; }
  listenUI(true);
}
function stopListening() {
  if (window.gideon && window.gideon.sttStop) window.gideon.sttStop();
  listenUI(false);
  for (const p of pipelines) { try { p.proc.disconnect(); } catch {} try { p.src.disconnect(); } catch {} try { p.stream.getTracks().forEach((t) => t.stop()); } catch {} }
  pipelines = []; try { if (audioCtx) audioCtx.close(); } catch {} audioCtx = null;
  if (enhanceDirty && S.lines.length) doEnhance();
}
function encodeWav(samples, rate) { const buf = new ArrayBuffer(44 + samples.length * 2), v = new DataView(buf); const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }; w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, samples.length * 2, true); let o = 44; for (let i = 0; i < samples.length; i++) { let s = Math.max(-1, Math.min(1, samples[i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; } return buf; }
function abToB64(ab) { const b = new Uint8Array(ab); let s = ''; const C = 0x8000; for (let i = 0; i < b.length; i += C) s += String.fromCharCode.apply(null, b.subarray(i, i + C)); return btoa(s); }

// ── Wire up ──
function init() {
  injectIcons();
  loadAll();
  hydrate(); setTab(S.tab || 'notes');
  if (window.gideon && window.gideon.sttAvailable) window.gideon.sttAvailable().then((v) => { localSTT = !!v; });
  if (window.gideon && window.gideon.onSttSegment) window.gideon.onSttSegment(onSegment);
  if (window.gideon && window.gideon.onSttError) window.gideon.onSttError((msg) => { setStatus(/screen/i.test(msg) ? 'Allow Screen Recording' : /mic/i.test(msg) ? 'Allow Microphone' : 'Mic/Screen permission needed'); });

  $('title').addEventListener('input', () => { S.title = $('title').textContent.trim(); titleRequested = true; save(); });
  $('editor').addEventListener('input', () => { S.notes = $('editor').innerText; save(); });
  $('tg-mine').addEventListener('click', () => showEnhanced(false));
  $('tg-enh').addEventListener('click', () => { if (S.enhanced) showEnhanced(true); else doEnhance(); });
  $('enhance').addEventListener('click', doEnhance);
  $('tabs').addEventListener('click', (e) => { const b = e.target.closest('.tab'); if (b) setTab(b.dataset.tab); });
  $('modes').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b) return; document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === b)); currentTool = b.dataset.tool; S.mode = currentTool; save(); if (wsReady) wsSend({ type: 'context_reset', tool: currentTool, mode: 'general' }); renderMap(); if (mapArmed && !S.mermaid[currentTool]) mapNow(); });
  $('map-start').addEventListener('click', armMapping);
  // Map pan + zoom
  (function () {
    const el = $('map');
    el.addEventListener('wheel', (e) => { e.preventDefault(); zoomMap(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY); }, { passive: false });
    let panning = false, sx = 0, sy = 0;
    el.addEventListener('mousedown', (e) => { panning = true; sx = e.clientX; sy = e.clientY; el.classList.add('grabbing'); });
    window.addEventListener('mousemove', (e) => { if (!panning) return; mapTx += e.clientX - sx; mapTy += e.clientY - sy; sx = e.clientX; sy = e.clientY; applyMap(); });
    window.addEventListener('mouseup', () => { panning = false; el.classList.remove('grabbing'); });
    el.addEventListener('dblclick', () => fitMap());
    $('map-zin').addEventListener('click', () => zoomMap(1.25));
    $('map-zout').addEventListener('click', () => zoomMap(0.8));
    $('map-fit').addEventListener('click', () => fitMap());
  })();
  $('ask-form').addEventListener('submit', (e) => { e.preventDefault(); const q = $('ask-input').value.trim(); if (!q) return; $('ask-input').value = ''; setTab('chat'); pendingAnswer = addAsk(q); if (!ws || ws.readyState > 1) connect(); wsSend({ type: 'ask', text: q, context: S.lines.map((l) => `${l.who === 'them' ? 'Them' : 'You'}: ${l.text}`).join('\n') }); });
  $('export').addEventListener('click', () => { const md = [`# ${S.title || 'Meeting notes'}`, '', S.enhanced || '', '', '## Transcript', ...S.lines.map((l) => `**${l.who === 'them' ? 'Them' : 'You'}:** ${l.text}`)].join('\n'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' })); a.download = `gideon-${(S.title || 'notes').replace(/\s+/g, '-').toLowerCase()}.md`; a.click(); URL.revokeObjectURL(a.href); });
  $('new').addEventListener('click', newNote);
  $('listen').addEventListener('click', () => (listening ? stopListening() : startListening()));

  // library
  $('library-btn').addEventListener('click', openLibrary);
  $('lib-back').addEventListener('click', closeLibrary);
  $('lib-new').addEventListener('click', newNote);
  $('lib-list').addEventListener('click', (e) => { const it = e.target.closest('.lib-item'); if (it) openNote(it.dataset.id); });
  $('lib-search-input').addEventListener('input', (e) => renderLibrary(e.target.value));

  // pill / window — drag to move, click (no drag) to expand
  (function () {
    const pill = $('pill'); let down = false, sx = 0, sy = 0, moved = 0;
    pill.addEventListener('mousedown', (e) => { if (e.button !== 0) return; down = true; moved = 0; sx = e.screenX; sy = e.screenY; pill.classList.add('grabbing'); if (window.gideon) window.gideon.dragStart(); });
    window.addEventListener('mousemove', (e) => { if (!down) return; const dx = e.screenX - sx, dy = e.screenY - sy; moved = Math.max(moved, Math.abs(dx) + Math.abs(dy)); if (window.gideon) window.gideon.dragMove(dx, dy); });
    window.addEventListener('mouseup', () => { if (!down) return; down = false; pill.classList.remove('grabbing'); if (window.gideon) window.gideon.dragEnd(); if (moved < 5) { document.body.classList.add('expanded'); if (window.gideon) window.gideon.expand(); } });
  })();
  $('collapse').addEventListener('click', () => { document.body.classList.remove('expanded'); if (window.gideon) window.gideon.collapse(); });
  $('close').addEventListener('click', () => window.gideon && window.gideon.close());
  $('stealth').addEventListener('click', async () => { const on = !$('stealth').classList.contains('on'); $('stealth').classList.toggle('on', on); if (window.gideon) await window.gideon.setStealth(on); });

  if (window.gideon) {
    window.gideon.onView((v) => { document.body.classList.toggle('expanded', v === 'panel'); document.body.classList.toggle('toast', v === 'toast'); });
    window.gideon.onHotkeyListen(() => (listening ? stopListening() : startListening()));
    window.gideon.onHotkeyAsk(() => { setTab('chat'); $('ask-input').focus(); });
    window.gideon.onMeetingDetected((name) => { if (listening) return; $('mb-app').textContent = name || 'a meeting'; $('mbanner').classList.remove('hidden'); });
    window.gideon.onMeetingCleared(() => $('mbanner').classList.add('hidden'));
  }
  $('mb-take').addEventListener('click', () => {
    $('mbanner').classList.add('hidden');
    // A detected meeting is a NEW note — don't append to the last one.
    if (S.lines.length || (S.notes && S.notes.trim()) || S.enhanced) newNote();
    $('source').value = 'both';
    if (window.gideon) window.gideon.expand();
    startListening();
  });
  $('mb-x').addEventListener('click', () => { $('mbanner').classList.add('hidden'); if (window.gideon) { window.gideon.dismissMeeting($('mb-app').textContent); window.gideon.collapse(); } });

  connect();
}
init();
