/* Gideon Listener — capture mic audio, stream to the backend for Gemini
   transcription + live thought-plot, render the map. */

// Point at prod by default; override with ?local for dev.
const PROD = 'wss://thought-plot-backend-2867a2f6bfe7.herokuapp.com/ws/study-session';
const LOCAL = 'ws://localhost:8000/ws/study-session';
const WS_URL = location.search.includes('local') ? LOCAL : PROD;

const SAMPLE_RATE = 16000;
const SILENCE_MS = 900;     // flush a chunk after this much trailing silence
const MIN_SPEECH_MS = 700;  // ignore blips shorter than this
const MAX_CHUNK_MS = 14000; // hard cap so we don't buffer forever
const RMS_THRESH = 0.012;   // speech vs silence

// ── DOM ──
const $ = (id) => document.getElementById(id);
const els = {
  mode: $('mode'), listen: $('listen'), listenLabel: $('listen-label'),
  status: $('status'), map: $('map'), empty: $('empty'), emptyText: $('empty-text'),
  interim: $('interim'), rail: $('rail'), flags: $('flags'), transcript: $('transcript'),
  pin: $('pin'), toggleRail: $('toggle-rail'),
};

let ws = null, wsReady = false, wsQueue = [];
let listening = false;
let audioCtx = null, source = null, processor = null, stream = null;
let pending = [];           // Float32 samples since last flush
let pendingLen = 0;
let hasSpeech = false, lastSpeechAt = 0, chunkStartAt = 0;
let currentMermaid = '';

// ── Mermaid ──
mermaid.initialize({
  startOnLoad: false, suppressErrorRendering: true, theme: 'base', securityLevel: 'loose',
  themeVariables: {
    darkMode: true, background: '#0c0b09', primaryColor: '#1e1d1a', primaryTextColor: '#f5f3ed',
    primaryBorderColor: '#3d3a35', lineColor: '#716d65', secondaryColor: '#1e1d1a',
    tertiaryColor: '#161514', edgeLabelBackground: '#161514', clusterBkg: '#161514', clusterBorder: '#332f2a',
  },
  flowchart: { curve: 'basis', padding: 18, nodeSpacing: 55, rankSpacing: 55, htmlLabels: true },
});

async function renderMap(code) {
  if (!code) return;
  try {
    const { svg } = await mermaid.render('mm-' + Date.now(), code);
    els.map.innerHTML = svg;
    els.empty.classList.add('hidden');
    // auto-fit
    const svgEl = els.map.querySelector('svg');
    const vb = svgEl && svgEl.viewBox && svgEl.viewBox.baseVal;
    if (svgEl && vb && vb.width) {
      const cw = els.map.clientWidth - 32, ch = els.map.clientHeight - 32;
      const fit = Math.max(0.5, Math.min(cw / vb.width, ch / vb.height, 2.2));
      svgEl.style.width = vb.width + 'px';
      svgEl.style.height = vb.height + 'px';
      svgEl.style.transform = `scale(${fit})`;
      svgEl.style.transformOrigin = 'center';
    }
  } catch (e) { /* keep last good */ }
}

// ── WebSocket ──
function connect() {
  ws = new WebSocket(WS_URL);
  ws.onopen = () => { wsReady = true; setStatus('Connected'); wsQueue.forEach((m) => ws.send(m)); wsQueue = []; };
  ws.onclose = () => { wsReady = false; if (listening) setStatus('Reconnecting…'); setTimeout(() => { if (listening) connect(); }, 1200); };
  ws.onerror = () => setStatus('Connection issue');
  ws.onmessage = (e) => {
    let d; try { d = JSON.parse(e.data); } catch { return; }
    if (d.type === 'plot_update' && d.graph && d.graph.mermaid_code) {
      currentMermaid = d.graph.mermaid_code;
      renderMap(currentMermaid);
    } else if (d.type === 'transcript_text' && d.text) {
      addTranscript(d.speaker, d.text);
      els.interim.textContent = '';
    } else if (d.type === 'fact_check') {
      const ok = d.status === 'incorrect' || (d.status === 'assumption' && (d.confidence || 0) >= 0.65);
      if (ok && d.status !== 'verified') addFlag(d);
    }
  };
}
function wsSend(obj) {
  const m = JSON.stringify(obj);
  if (wsReady && ws.readyState === WebSocket.OPEN) ws.send(m); else wsQueue.push(m);
}

// ── UI helpers ──
function setStatus(s) { els.status.textContent = s; }
function addTranscript(who, text) {
  const div = document.createElement('div');
  div.className = 'tline';
  div.innerHTML = `<span class="who">${who || 'You'}</span>${escapeHtml(text)}`;
  els.transcript.appendChild(div);
  els.rail.classList.remove('hidden');
  els.rail.scrollTop = els.rail.scrollHeight;
}
function addFlag(d) {
  const isBad = d.status === 'incorrect';
  const div = document.createElement('div');
  div.className = 'flag ' + (isBad ? 'incorrect' : 'assumption');
  div.innerHTML = `<div class="h">${isBad ? 'Likely wrong' : 'Worth checking'}</div>` +
    `<div class="claim">“${escapeHtml(d.claim || '')}”</div>` +
    (d.correction || d.explanation ? `<div class="fix">${escapeHtml(d.correction || d.explanation)}</div>` : '');
  els.flags.prepend(div);
  els.rail.classList.remove('hidden');
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ── Audio ──
async function startListening() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  } catch (e) { setStatus('Mic permission needed'); return; }

  audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
  source = audioCtx.createMediaStreamSource(stream);
  processor = audioCtx.createScriptProcessor(4096, 1, 1);
  pending = []; pendingLen = 0; hasSpeech = false; chunkStartAt = performance.now();

  processor.onaudioprocess = (ev) => {
    const input = ev.inputBuffer.getChannelData(0);
    // RMS for VAD
    let sum = 0; for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    const rms = Math.sqrt(sum / input.length);
    const now = performance.now();

    pending.push(new Float32Array(input));
    pendingLen += input.length;

    if (rms > RMS_THRESH) { hasSpeech = true; lastSpeechAt = now; }

    const durMs = (pendingLen / SAMPLE_RATE) * 1000;
    const silentFor = now - lastSpeechAt;
    if (hasSpeech && ((silentFor > SILENCE_MS && durMs > MIN_SPEECH_MS) || durMs > MAX_CHUNK_MS)) {
      flushChunk();
    } else if (!hasSpeech && durMs > 3000) {
      // no speech in the last 3s — drop the buffer to avoid unbounded memory
      pending = []; pendingLen = 0; chunkStartAt = now;
    }
  };

  source.connect(processor);
  processor.connect(audioCtx.destination);

  listening = true;
  els.listen.classList.add('live');
  els.listenLabel.textContent = 'Stop';
  els.emptyText.textContent = 'Listening… speak and your map will grow.';
  setStatus('Listening');
  if (!ws || ws.readyState > 1) connect();
}

function flushChunk() {
  if (!pending.length) return;
  const total = pendingLen;
  const merged = new Float32Array(total);
  let off = 0; for (const buf of pending) { merged.set(buf, off); off += buf.length; }
  pending = []; pendingLen = 0; hasSpeech = false; chunkStartAt = performance.now();

  const wav = encodeWav(merged, SAMPLE_RATE);
  const b64 = abToB64(wav);
  els.interim.textContent = '…transcribing';
  wsSend({
    type: 'audio_chunk', audio: b64, mime_type: 'audio/wav',
    tool: els.mode.value, mode: 'general', speaker: 'You', fact_check_enabled: true,
  });
}

function stopListening() {
  listening = false;
  els.listen.classList.remove('live');
  els.listenLabel.textContent = 'Listen';
  setStatus('Paused');
  els.interim.textContent = '';
  try { if (processor) processor.disconnect(); } catch {}
  try { if (source) source.disconnect(); } catch {}
  try { if (audioCtx) audioCtx.close(); } catch {}
  try { if (stream) stream.getTracks().forEach((t) => t.stop()); } catch {}
  processor = source = audioCtx = stream = null;
}

function encodeWav(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const ws2 = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws2(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); ws2(8, 'WAVE'); ws2(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ws2(36, 'data'); v.setUint32(40, samples.length * 2, true);
  let o = 44; for (let i = 0; i < samples.length; i++) { let s = Math.max(-1, Math.min(1, samples[i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
  return buf;
}
function abToB64(ab) { const b = new Uint8Array(ab); let s = ''; const C = 0x8000; for (let i = 0; i < b.length; i += C) s += String.fromCharCode.apply(null, b.subarray(i, i + C)); return btoa(s); }

// ── Wire up ──
els.listen.addEventListener('click', () => (listening ? stopListening() : startListening()));
els.toggleRail.addEventListener('click', () => els.rail.classList.toggle('hidden'));
els.pin.addEventListener('click', async () => {
  const on = !els.pin.classList.contains('on');
  els.pin.classList.toggle('on', on);
  if (window.gideon) await window.gideon.setAlwaysOnTop(on);
});
els.mode.addEventListener('change', () => {
  currentMermaid = ''; els.map.innerHTML = ''; els.empty.classList.remove('hidden');
  els.flags.innerHTML = ''; els.transcript.innerHTML = '';
  if (wsReady) wsSend({ type: 'context_reset', tool: els.mode.value, mode: 'general' });
});

connect();
