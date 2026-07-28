/* Gideon — desktop copilot: hears the room, maps the thinking, answers questions. */

const PROD = 'wss://thought-plot-backend-2867a2f6bfe7.herokuapp.com/ws/study-session';
const LOCAL = 'ws://localhost:8000/ws/study-session';
const WS_URL = location.search.includes('local') ? LOCAL : PROD;

const SR = 16000;
const SILENCE_MS = 900, MIN_SPEECH_MS = 700, MAX_CHUNK_MS = 14000, RMS_THRESH = 0.012;

const $ = (id) => document.getElementById(id);
const els = {
  map: $('map'), empty: $('empty'), emptyText: $('empty-text'), interim: $('interim'),
  answer: $('answer'), answerBody: $('answer-body'), answerClose: $('answer-close'),
  insights: $('insights'), transcript: $('transcript'), askForm: $('ask-form'), askInput: $('ask-input'),
  listen: $('listen'), listenLabel: $('listen-label'), source: $('source'), status: $('status'),
  modes: $('modes'), toggleNotes: $('toggle-notes'), stealth: $('stealth'), min: $('min'), close: $('close'),
};

let ws = null, wsReady = false, wsQueue = [];
let listening = false, currentTool = 'thought_plot', factOn = true;
let audioCtx = null, muteSink = null, pipelines = [];
const lines = [];           // {who, text} for transcript + copilot context

// ── Mermaid ──
mermaid.initialize({
  startOnLoad: false, suppressErrorRendering: true, theme: 'base', securityLevel: 'loose',
  themeVariables: { darkMode: true, background: '#0c0b09', primaryColor: '#1e1d1a', primaryTextColor: '#f5f3ed',
    primaryBorderColor: '#3d3a35', lineColor: '#716d65', secondaryColor: '#1e1d1a', tertiaryColor: '#161514',
    edgeLabelBackground: '#161514', clusterBkg: '#161514', clusterBorder: '#332f2a' },
  flowchart: { curve: 'basis', padding: 16, nodeSpacing: 50, rankSpacing: 50, htmlLabels: true },
});
async function renderMap(code) {
  if (!code) return;
  try {
    const { svg } = await mermaid.render('mm-' + Date.now(), code);
    els.map.innerHTML = svg; els.empty.classList.add('hidden');
    const s = els.map.querySelector('svg'), vb = s && s.viewBox && s.viewBox.baseVal;
    if (s && vb && vb.width) {
      const cw = els.map.clientWidth - 28, ch = els.map.clientHeight - 28;
      const fit = Math.max(0.5, Math.min(cw / vb.width, ch / vb.height, 2.2));
      s.style.width = vb.width + 'px'; s.style.height = vb.height + 'px';
      s.style.transform = `scale(${fit})`; s.style.transformOrigin = 'center';
    }
  } catch (e) { /* keep last good */ }
}

// ── WebSocket ──
function connect() {
  ws = new WebSocket(WS_URL);
  ws.onopen = () => { wsReady = true; setStatus(listening ? 'Listening' : 'Connected'); wsQueue.forEach((m) => ws.send(m)); wsQueue = []; };
  ws.onclose = () => { wsReady = false; setTimeout(() => { if (listening || document.hasFocus()) connect(); }, 1200); };
  ws.onerror = () => setStatus('Connection issue');
  ws.onmessage = (e) => {
    let d; try { d = JSON.parse(e.data); } catch { return; }
    switch (d.type) {
      case 'plot_update': if (d.graph && d.graph.mermaid_code) renderMap(d.graph.mermaid_code); break;
      case 'transcript_text': if (d.text) { addLine(d.speaker || 'You', d.text); els.interim.textContent = ''; } break;
      case 'ask_answer': showAnswer(d.text); break;
      case 'fact_check': {
        const ok = d.status === 'incorrect' || (d.status === 'assumption' && (d.confidence || 0) >= 0.65);
        if (ok && d.status !== 'verified') addInsight(d.status === 'incorrect' ? 'bad' : 'warn',
          d.status === 'incorrect' ? 'Likely wrong' : 'Worth checking', d.claim, d.correction || d.explanation);
        break;
      }
      case 'fallacy_call': if (d.fallacy) addInsight('bad', 'Fallacy · ' + (d.fallacy.name || ''), d.fallacy.what_was_said, d.fallacy.why_its_wrong); break;
      case 'technique_detected': if (d.technique && d.technique.name && d.technique.name !== 'None')
        addInsight(d.technique.quality === 'effective' ? 'good' : 'warn', 'Technique · ' + d.technique.name, '', d.technique.feedback); break;
    }
  };
}
function wsSend(o) { const m = JSON.stringify(o); if (wsReady && ws.readyState === 1) ws.send(m); else wsQueue.push(m); }

// ── UI ──
function setStatus(s) { els.status.textContent = s; }
function addLine(who, text) {
  const w = /them|other|speaker/i.test(who) ? 'them' : 'you';
  lines.push({ who: w === 'them' ? 'Them' : 'You', text });
  const div = document.createElement('div');
  div.className = 'tline';
  div.innerHTML = `<span class="who ${w}">${w === 'them' ? 'Them' : 'You'}</span>${esc(text)}`;
  els.transcript.appendChild(div);
  els.transcript.scrollTop = els.transcript.scrollHeight;
  if (lines.length > 200) lines.shift();
}
function addInsight(tone, head, claim, fix) {
  els.insights.classList.remove('hidden');
  const div = document.createElement('div');
  div.className = 'ins ' + tone;
  div.innerHTML = `<div class="h">${esc(head)}</div>` +
    (claim ? `<div class="claim">“${esc(claim)}”</div>` : '') +
    (fix ? `<div class="fix">${esc(fix)}</div>` : '');
  els.insights.prepend(div);
  while (els.insights.children.length > 20) els.insights.lastChild.remove();
}
function showAnswer(text) {
  els.answerBody.innerHTML = esc(text).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
  els.answer.classList.remove('hidden');
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

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
  els.interim.textContent = '…transcribing';
  wsSend({ type: 'audio_chunk', audio: abToB64(encodeWav(merged, SR)), mime_type: 'audio/wav', tool: currentTool, mode: 'general', speaker: st.speaker, fact_check_enabled: factOn });
}

async function startListening() {
  if (!ws || ws.readyState > 1) connect();
  audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SR });
  muteSink = audioCtx.createGain(); muteSink.gain.value = 0; muteSink.connect(audioCtx.destination);
  pipelines = [];
  const src = els.source.value;
  if (src === 'mic' || src === 'both') {
    try { const m = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }); pipelines.push(makePipeline(m, 'You')); }
    catch { setStatus('Mic permission needed'); }
  }
  if (src === 'system' || src === 'both') {
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
      s.getVideoTracks().forEach((t) => t.stop());
      if (s.getAudioTracks().length) pipelines.push(makePipeline(s, 'Them'));
      else setStatus('No system audio (grant Screen Recording)');
    } catch { setStatus('System audio unavailable — using mic'); }
  }
  if (!pipelines.length) { stopListening(); return; }
  listening = true;
  els.listen.classList.add('live'); els.listenLabel.textContent = 'Stop';
  els.emptyText.innerHTML = 'Listening… speak and your map will grow.';
  setStatus('Listening');
}
function stopListening() {
  listening = false;
  els.listen.classList.remove('live'); els.listenLabel.textContent = 'Listen';
  setStatus('Paused'); els.interim.textContent = '';
  for (const p of pipelines) { try { p.proc.disconnect(); } catch {} try { p.src.disconnect(); } catch {} try { p.stream.getTracks().forEach((t) => t.stop()); } catch {} }
  pipelines = [];
  try { if (audioCtx) audioCtx.close(); } catch {}
  audioCtx = null;
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

// ── Copilot ask ──
els.askForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = els.askInput.value.trim(); if (!q) return;
  els.askInput.value = '';
  if (!ws || ws.readyState > 1) connect();
  const ctx = lines.slice(-30).map((l) => `${l.who}: ${l.text}`).join('\n');
  showAnswer('…thinking');
  wsSend({ type: 'ask', text: q, context: ctx });
});
els.answerClose.addEventListener('click', () => els.answer.classList.add('hidden'));

// ── Modes / controls ──
els.modes.addEventListener('click', (e) => {
  const btn = e.target.closest('.chip'); if (!btn) return;
  [...els.modes.children].forEach((c) => c.classList.toggle('on', c === btn));
  currentTool = btn.dataset.tool;
  els.map.innerHTML = ''; els.empty.classList.remove('hidden'); els.insights.innerHTML = ''; els.insights.classList.add('hidden');
  if (wsReady) wsSend({ type: 'context_reset', tool: currentTool, mode: 'general' });
});
els.listen.addEventListener('click', () => (listening ? stopListening() : startListening()));
els.toggleNotes.addEventListener('click', () => els.transcript.classList.toggle('hidden'));
els.source.addEventListener('change', () => { if (listening) { stopListening(); startListening(); } });

// window controls
els.min.addEventListener('click', () => window.gideon && window.gideon.minimize());
els.close.addEventListener('click', () => window.gideon && window.gideon.close());
els.stealth.addEventListener('click', async () => {
  const on = !els.stealth.classList.contains('on');
  els.stealth.classList.toggle('on', on);
  if (window.gideon) await window.gideon.setStealth(on);
});

// hotkeys from main
if (window.gideon) {
  window.gideon.onHotkeyListen(() => (listening ? stopListening() : startListening()));
  window.gideon.onHotkeyAsk(() => els.askInput.focus());
}

// ── Meeting detection toast ──
const mb = { el: $('mbanner'), app: $('mb-app'), take: $('mb-take'), x: $('mb-x') };
let detectedApp = 'a meeting';
if (window.gideon) {
  window.gideon.onMeetingDetected((name) => {
    if (listening) return;               // already taking notes
    detectedApp = name || 'a meeting';
    mb.app.textContent = detectedApp;
    mb.el.classList.remove('hidden');
  });
  window.gideon.onMeetingCleared(() => mb.el.classList.add('hidden'));
}
mb.take.addEventListener('click', () => {
  mb.el.classList.add('hidden');
  els.source.value = 'both';             // capture the whole meeting
  startListening();
});
mb.x.addEventListener('click', () => {
  mb.el.classList.add('hidden');
  if (window.gideon) window.gideon.dismissMeeting(detectedApp);
});

connect();
