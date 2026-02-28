const holdRecordBtn = document.getElementById('holdRecord');
const liveFreqEl = document.getElementById('liveFreq');
const liveNoteEl = document.getElementById('liveNote');
const recordedSecEl = document.getElementById('recordedSec');
const trimStartLabelEl = document.getElementById('trimStartLabel');
const trimEndLabelEl = document.getElementById('trimEndLabel');
const convertBtn = document.getElementById('convertBtn');
const bpmEl = document.getElementById('bpm');
const waveformEl = document.getElementById('waveform');
const playBtn = document.getElementById('playBtn');
const stopBtn = document.getElementById('stopBtn');
const octaveUpBtn = document.getElementById('octaveUpBtn');
const octaveDownBtn = document.getElementById('octaveDownBtn');
const exportMidiBtn = document.getElementById('exportMidiBtn');
const freqMap = document.getElementById('freqMap');
const freqCtx = freqMap.getContext('2d');
const roll = document.getElementById('roll');
const ctx = roll.getContext('2d');

const state = {
  audioCtx: null,
  analyser: null,
  mediaStream: null,
  sourceNode: null,
  rafId: 0,
  sampleRate: 44100,
  recording: false,
  recordStartPerf: 0,
  recordingTotalSec: 0,
  pitchFrames: [],
  notes: [],
  timelineSec: 8,
  trimStart: 0,
  trimEnd: 0,
  minMidi: 36,
  maxMidi: 84,
  selectedNote: null,
  dragMode: null,
  dragCanvas: null,
  dragOffsetX: 0,
  playingNodes: [],
  playingTimeouts: [],
};

function noteNameFromMidi(midi) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(midi / 12) - 1;
  return `${names[midi % 12]}${octave}`;
}

function hzToMidi(freq) {
  return Math.round(69 + 12 * Math.log2(freq / 440));
}

function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function canvasPos(canvas, evt) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((evt.clientX - rect.left) / rect.width) * canvas.width,
    y: ((evt.clientY - rect.top) / rect.height) * canvas.height,
  };
}

function trimMax() {
  return Math.max(0.01, state.recordingTotalSec, state.timelineSec);
}

function updateTrimUI() {
  const max = trimMax();
  state.trimStart = clamp(state.trimStart, 0, max);
  state.trimEnd = clamp(state.trimEnd, 0, max);
  if (state.trimEnd < state.trimStart) state.trimEnd = state.trimStart;

  trimStartLabelEl.textContent = `Start ${state.trimStart.toFixed(2)}s`;
  trimEndLabelEl.textContent = `End ${state.trimEnd.toFixed(2)}s`;

  drawFreqMap();
  drawRoll();
}

function median(values) {
  if (!values.length) return null;
  const arr = [...values].sort((a, b) => a - b);
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 === 0 ? Math.round((arr[mid - 1] + arr[mid]) / 2) : arr[mid];
}

async function ensureAudioReady() {
  if (state.audioCtx && state.analyser && state.mediaStream) return;

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);

  state.audioCtx = audioCtx;
  state.mediaStream = stream;
  state.sourceNode = source;
  state.analyser = analyser;
  state.sampleRate = audioCtx.sampleRate;

  if (!state.rafId) pitchLoop();
}

function autoCorrelate(buffer, sampleRate) {
  const size = buffer.length;
  let rms = 0;
  for (let i = 0; i < size; i++) {
    const v = buffer[i];
    rms += v * v;
  }
  rms = Math.sqrt(rms / size);
  if (rms < 0.01) return -1;

  let r1 = 0;
  let r2 = size - 1;
  const threshold = 0.2;
  for (let i = 0; i < size / 2; i++) {
    if (Math.abs(buffer[i]) < threshold) {
      r1 = i;
      break;
    }
  }
  for (let i = 1; i < size / 2; i++) {
    if (Math.abs(buffer[size - i]) < threshold) {
      r2 = size - i;
      break;
    }
  }

  const trimmed = buffer.slice(r1, r2);
  const n = trimmed.length;
  const c = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n - i; j++) {
      c[i] += trimmed[j] * trimmed[j + i];
    }
  }

  let d = 0;
  while (d + 1 < c.length && c[d] > c[d + 1]) d++;

  let maxVal = -1;
  let maxPos = -1;
  for (let i = d; i < c.length; i++) {
    if (c[i] > maxVal) {
      maxVal = c[i];
      maxPos = i;
    }
  }

  if (maxPos <= 0) return -1;

  const x1 = c[maxPos - 1] || c[maxPos];
  const x2 = c[maxPos];
  const x3 = c[maxPos + 1] || c[maxPos];
  const a = (x1 + x3 - 2 * x2) / 2;
  const b = (x3 - x1) / 2;
  const shift = a ? -b / (2 * a) : 0;
  const period = maxPos + shift;
  if (!period || period < 2) return -1;

  return sampleRate / period;
}

function pitchLoop() {
  if (!state.analyser) {
    state.rafId = requestAnimationFrame(pitchLoop);
    return;
  }

  const buf = new Float32Array(state.analyser.fftSize);
  state.analyser.getFloatTimeDomainData(buf);
  const freq = autoCorrelate(buf, state.sampleRate);

  if (freq > 0 && isFinite(freq) && freq < 2500) {
    const midi = hzToMidi(freq);
    liveFreqEl.textContent = freq.toFixed(1);
    liveNoteEl.textContent = `${noteNameFromMidi(midi)} (${midi})`;

    if (state.recording) {
      const t = (performance.now() - state.recordStartPerf) / 1000;
      state.pitchFrames.push({ t, freq, midi });
      state.recordingTotalSec = t;
      recordedSecEl.textContent = t.toFixed(2);
    }
  }

  state.rafId = requestAnimationFrame(pitchLoop);
}

function startRecording() {
  if (state.recording) return;
  state.recording = true;
  state.recordStartPerf = performance.now();
  holdRecordBtn.classList.add('recording');
}

function stopRecording() {
  if (!state.recording) return;
  state.recording = false;
  holdRecordBtn.classList.remove('recording');

  state.trimStart = 0;
  state.trimEnd = state.recordingTotalSec;
  updateTrimUI();
}

async function beginRecordHold() {
  try {
    await ensureAudioReady();
    if (state.audioCtx.state === 'suspended') await state.audioCtx.resume();
    startRecording();
  } catch (err) {
    alert('Microphone permission is required to record.');
    console.error(err);
  }
}

holdRecordBtn.addEventListener('mousedown', beginRecordHold);
holdRecordBtn.addEventListener('touchstart', (e) => {
  e.preventDefault();
  beginRecordHold();
}, { passive: false });

window.addEventListener('mouseup', stopRecording);
window.addEventListener('touchend', stopRecording);

function convertFramesToNotes() {
  const start = state.trimStart;
  const end = state.trimEnd;
  if (end <= start) {
    alert('Set a valid trim range first.');
    return;
  }

  const frames = state.pitchFrames.filter((f) => f.t >= start && f.t <= end);
  if (!frames.length) {
    alert('No pitch data in selected range. Hold record and hum first.');
    return;
  }

  const bpm = clamp(Number(bpmEl.value) || 110, 40, 220);
  const stepSec = 60 / bpm / 4;
  const total = end - start;
  const buckets = Math.max(1, Math.ceil(total / stepSec));

  const quantized = [];
  for (let i = 0; i < buckets; i++) {
    const t0 = start + i * stepSec;
    const t1 = t0 + stepSec;
    const midiValues = frames.filter((f) => f.t >= t0 && f.t < t1).map((f) => f.midi).filter((m) => m >= state.minMidi && m <= state.maxMidi);
    quantized.push(median(midiValues));
  }

  const notes = [];
  let curMidi = null;
  let curStartStep = 0;

  for (let i = 0; i <= quantized.length; i++) {
    const m = i < quantized.length ? quantized[i] : null;

    if (curMidi === null && m !== null) {
      curMidi = m;
      curStartStep = i;
      continue;
    }

    if (curMidi !== null && m !== curMidi) {
      const durSteps = i - curStartStep;
      notes.push({
        start: curStartStep * stepSec,
        duration: Math.max(stepSec, durSteps * stepSec),
        midi: curMidi,
        velocity: 96,
      });
      curMidi = m;
      curStartStep = i;
    }
  }

  state.notes = notes;
  state.timelineSec = Math.max(8, end - start + 1);
  state.trimStart = 0;
  state.trimEnd = Math.max(0.2, end - start);
  drawRoll();
}

convertBtn.addEventListener('click', convertFramesToNotes);

function transposeAll(semitones) {
  state.notes = state.notes.map((n) => ({ ...n, midi: clamp(n.midi + semitones, state.minMidi, state.maxMidi) }));
  drawRoll();
}

octaveUpBtn.addEventListener('click', () => transposeAll(12));
octaveDownBtn.addEventListener('click', () => transposeAll(-12));

function stopPlayback() {
  for (const timeout of state.playingTimeouts) clearTimeout(timeout);
  state.playingTimeouts.length = 0;

  for (const node of state.playingNodes) {
    try { node.stop(); } catch {}
    try { node.disconnect(); } catch {}
  }
  state.playingNodes.length = 0;
}

function getTrimmedNotes() {
  const start = state.trimStart;
  const end = state.trimEnd;
  return state.notes
    .map((n) => {
      const nStart = n.start;
      const nEnd = n.start + n.duration;
      if (nEnd <= start || nStart >= end) return null;
      const clippedStart = Math.max(start, nStart);
      const clippedEnd = Math.min(end, nEnd);
      return {
        ...n,
        start: clippedStart - start,
        duration: Math.max(0.03, clippedEnd - clippedStart),
      };
    })
    .filter(Boolean);
}

async function playNotes() {
  if (!state.notes.length) return;
  await ensureAudioReady();
  if (state.audioCtx.state === 'suspended') await state.audioCtx.resume();

  stopPlayback();

  const now = state.audioCtx.currentTime + 0.05;
  const wave = waveformEl.value;

  for (const note of getTrimmedNotes()) {
    const osc = state.audioCtx.createOscillator();
    const gain = state.audioCtx.createGain();
    osc.type = wave;
    osc.frequency.value = midiToHz(note.midi);

    gain.gain.setValueAtTime(0, now + note.start);
    gain.gain.linearRampToValueAtTime(0.14, now + note.start + 0.01);
    gain.gain.linearRampToValueAtTime(0.12, now + note.start + Math.max(0.02, note.duration - 0.03));
    gain.gain.linearRampToValueAtTime(0, now + note.start + note.duration);

    osc.connect(gain).connect(state.audioCtx.destination);
    osc.start(now + note.start);
    osc.stop(now + note.start + note.duration + 0.03);
    state.playingNodes.push(osc, gain);
  }
}

playBtn.addEventListener('click', playNotes);
stopBtn.addEventListener('click', stopPlayback);

function writeVarLen(value) {
  let buffer = value & 0x7f;
  const bytes = [];
  while ((value >>= 7)) {
    buffer <<= 8;
    buffer |= ((value & 0x7f) | 0x80);
  }
  while (true) {
    bytes.push(buffer & 0xff);
    if (buffer & 0x80) buffer >>= 8;
    else break;
  }
  return bytes;
}

function exportMidi() {
  if (!state.notes.length) return;

  const ppq = 480;
  const bpm = clamp(Number(bpmEl.value) || 110, 40, 220);
  const usPerQuarter = Math.floor(60000000 / bpm);

  const events = [];
  events.push({ tick: 0, bytes: [0xff, 0x51, 0x03, (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff] });

  for (const n of getTrimmedNotes()) {
    const startTick = Math.floor(n.start * (ppq * bpm / 60));
    const endTick = Math.max(startTick + 1, Math.floor((n.start + n.duration) * (ppq * bpm / 60)));
    events.push({ tick: startTick, bytes: [0x90, n.midi, clamp(n.velocity, 1, 127)] });
    events.push({ tick: endTick, bytes: [0x80, n.midi, 0] });
  }

  events.sort((a, b) => a.tick - b.tick || a.bytes[0] - b.bytes[0]);

  const trackData = [];
  let prevTick = 0;
  for (const ev of events) {
    const delta = ev.tick - prevTick;
    prevTick = ev.tick;
    trackData.push(...writeVarLen(delta), ...ev.bytes);
  }
  trackData.push(0x00, 0xff, 0x2f, 0x00);

  const header = [
    0x4d, 0x54, 0x68, 0x64,
    0x00, 0x00, 0x00, 0x06,
    0x00, 0x00,
    0x00, 0x01,
    (ppq >> 8) & 0xff, ppq & 0xff,
  ];

  const trackLen = trackData.length;
  const trackHead = [
    0x4d, 0x54, 0x72, 0x6b,
    (trackLen >> 24) & 0xff,
    (trackLen >> 16) & 0xff,
    (trackLen >> 8) & 0xff,
    trackLen & 0xff,
  ];

  const bytes = new Uint8Array([...header, ...trackHead, ...trackData]);
  const blob = new Blob([bytes], { type: 'audio/midi' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'hum2midi-export.mid';
  a.click();
  URL.revokeObjectURL(url);
}

exportMidiBtn.addEventListener('click', exportMidi);

function freqGeometry() {
  const left = 56;
  const top = 14;
  const width = freqMap.width - left - 10;
  const height = freqMap.height - top - 22;
  return { left, top, width, height };
}

function timeToFreqX(sec) {
  const g = freqGeometry();
  return g.left + (sec / trimMax()) * g.width;
}

function freqXToTime(x) {
  const g = freqGeometry();
  return clamp(((x - g.left) / g.width) * trimMax(), 0, trimMax());
}

function drawTrimOverlay(drawCtx, xStart, xEnd, top, height) {
  drawCtx.fillStyle = 'rgba(6,10,16,0.56)';
  drawCtx.fillRect(0, top, xStart, height);
  drawCtx.fillRect(xEnd, top, drawCtx.canvas.width - xEnd, height);

  drawCtx.strokeStyle = '#ffcb6b';
  drawCtx.lineWidth = 2;
  drawCtx.beginPath();
  drawCtx.moveTo(xStart, top);
  drawCtx.lineTo(xStart, top + height);
  drawCtx.moveTo(xEnd, top);
  drawCtx.lineTo(xEnd, top + height);
  drawCtx.stroke();
}

function drawFreqMap() {
  const g = freqGeometry();
  const maxT = trimMax();

  freqCtx.clearRect(0, 0, freqMap.width, freqMap.height);
  freqCtx.fillStyle = '#0f141b';
  freqCtx.fillRect(g.left, g.top, g.width, g.height);

  const minHz = 60;
  const maxHz = 1200;

  for (let hz = 100; hz <= 1000; hz += 100) {
    const yNorm = (Math.log(hz) - Math.log(minHz)) / (Math.log(maxHz) - Math.log(minHz));
    const y = g.top + g.height - yNorm * g.height;
    freqCtx.strokeStyle = 'rgba(53,66,82,0.5)';
    freqCtx.beginPath();
    freqCtx.moveTo(g.left, y);
    freqCtx.lineTo(g.left + g.width, y);
    freqCtx.stroke();

    if (hz % 200 === 0) {
      freqCtx.fillStyle = '#8ea0b8';
      freqCtx.font = '10px sans-serif';
      freqCtx.fillText(`${hz}Hz`, 4, y + 3);
    }
  }

  for (let sec = 0; sec <= Math.floor(maxT); sec++) {
    const x = g.left + (sec / maxT) * g.width;
    freqCtx.strokeStyle = '#2d3a4b';
    freqCtx.beginPath();
    freqCtx.moveTo(x, g.top);
    freqCtx.lineTo(x, g.top + g.height);
    freqCtx.stroke();
    freqCtx.fillStyle = '#8ea0b8';
    freqCtx.font = '10px sans-serif';
    freqCtx.fillText(`${sec}s`, x + 2, g.top + g.height + 12);
  }

  const pts = state.pitchFrames.filter((f) => f.freq >= minHz && f.freq <= maxHz);
  if (pts.length > 1) {
    freqCtx.strokeStyle = '#58a6ff';
    freqCtx.lineWidth = 1.3;
    freqCtx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const x = g.left + (p.t / maxT) * g.width;
      const yNorm = (Math.log(p.freq) - Math.log(minHz)) / (Math.log(maxHz) - Math.log(minHz));
      const y = g.top + g.height - yNorm * g.height;
      if (i === 0) freqCtx.moveTo(x, y);
      else freqCtx.lineTo(x, y);
    }
    freqCtx.stroke();
  }

  const xStart = timeToFreqX(state.trimStart);
  const xEnd = timeToFreqX(state.trimEnd);
  drawTrimOverlay(freqCtx, xStart, xEnd, g.top, g.height);
}

function gridGeometry() {
  const left = 70;
  const top = 12;
  const width = roll.width - left - 10;
  const height = roll.height - top - 10;
  return { left, top, width, height };
}

function noteRect(note) {
  const g = gridGeometry();
  const ySpan = state.maxMidi - state.minMidi + 1;
  const x = g.left + (note.start / state.timelineSec) * g.width;
  const w = Math.max(8, (note.duration / state.timelineSec) * g.width);
  const row = state.maxMidi - note.midi;
  const h = g.height / ySpan;
  const y = g.top + row * h;
  return { x, y, w, h };
}

function drawRoll() {
  const g = gridGeometry();
  ctx.clearRect(0, 0, roll.width, roll.height);

  ctx.fillStyle = '#0f141b';
  ctx.fillRect(g.left, g.top, g.width, g.height);

  const ySpan = state.maxMidi - state.minMidi + 1;
  const rowH = g.height / ySpan;
  for (let i = 0; i < ySpan; i++) {
    const midi = state.maxMidi - i;
    const y = g.top + i * rowH;
    const blackKey = [1, 3, 6, 8, 10].includes(midi % 12);
    ctx.fillStyle = blackKey ? '#121a23' : '#111822';
    ctx.fillRect(g.left, y, g.width, rowH);

    if (midi % 12 === 0) {
      ctx.fillStyle = '#8ea0b8';
      ctx.font = '11px sans-serif';
      ctx.fillText(noteNameFromMidi(midi), 6, y + rowH - 2);
      ctx.strokeStyle = '#243244';
      ctx.beginPath();
      ctx.moveTo(g.left, y);
      ctx.lineTo(g.left + g.width, y);
      ctx.stroke();
    }
  }

  const secLines = Math.floor(state.timelineSec);
  for (let s = 0; s <= secLines; s++) {
    const x = g.left + (s / state.timelineSec) * g.width;
    ctx.strokeStyle = '#2d3a4b';
    ctx.beginPath();
    ctx.moveTo(x, g.top);
    ctx.lineTo(x, g.top + g.height);
    ctx.stroke();
    ctx.fillStyle = '#8ea0b8';
    ctx.font = '10px sans-serif';
    ctx.fillText(`${s}s`, x + 2, g.top + 10);
  }

  state.notes.forEach((n, idx) => {
    const r = noteRect(n);
    ctx.fillStyle = state.selectedNote === idx ? '#79c0ff' : '#58a6ff';
    ctx.fillRect(r.x, r.y + 1, r.w, Math.max(2, r.h - 2));
    ctx.fillStyle = '#e6edf3';
    ctx.font = '10px sans-serif';
    ctx.fillText(noteNameFromMidi(n.midi), r.x + 3, r.y + Math.max(10, r.h - 3));

    ctx.fillStyle = '#d4e7ff';
    ctx.fillRect(r.x + r.w - 3, r.y + 1, 3, Math.max(2, r.h - 2));
  });

  const xStart = g.left + (state.trimStart / trimMax()) * g.width;
  const xEnd = g.left + (state.trimEnd / trimMax()) * g.width;
  drawTrimOverlay(ctx, xStart, xEnd, g.top, g.height);
}

function trimHandleHit(canvas, x) {
  if (canvas === freqMap) {
    return {
      nearStart: Math.abs(x - timeToFreqX(state.trimStart)) <= 8,
      nearEnd: Math.abs(x - timeToFreqX(state.trimEnd)) <= 8,
    };
  }

  const g = gridGeometry();
  const xStart = g.left + (state.trimStart / trimMax()) * g.width;
  const xEnd = g.left + (state.trimEnd / trimMax()) * g.width;
  return {
    nearStart: Math.abs(x - xStart) <= 8,
    nearEnd: Math.abs(x - xEnd) <= 8,
  };
}

freqMap.addEventListener('mousedown', (evt) => {
  const p = canvasPos(freqMap, evt);
  const hit = trimHandleHit(freqMap, p.x);
  if (hit.nearStart) {
    state.dragMode = 'trimStart';
    state.dragCanvas = freqMap;
  } else if (hit.nearEnd) {
    state.dragMode = 'trimEnd';
    state.dragCanvas = freqMap;
  } else {
    const t = freqXToTime(p.x);
    if (Math.abs(t - state.trimStart) < Math.abs(t - state.trimEnd)) {
      state.trimStart = Math.min(t, state.trimEnd);
    } else {
      state.trimEnd = Math.max(t, state.trimStart);
    }
    updateTrimUI();
  }
});

roll.addEventListener('mousedown', (evt) => {
  const p = canvasPos(roll, evt);
  const trimHit = trimHandleHit(roll, p.x);

  if (trimHit.nearStart) {
    state.dragMode = 'trimStart';
    state.dragCanvas = roll;
    return;
  }
  if (trimHit.nearEnd) {
    state.dragMode = 'trimEnd';
    state.dragCanvas = roll;
    return;
  }

  state.selectedNote = null;
  state.dragMode = null;
  state.dragCanvas = roll;

  for (let i = state.notes.length - 1; i >= 0; i--) {
    const r = noteRect(state.notes[i]);
    if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) {
      state.selectedNote = i;
      const nearRightEdge = p.x > r.x + r.w - 8;
      state.dragMode = nearRightEdge ? 'resize' : 'move';
      state.dragOffsetX = p.x - r.x;
      break;
    }
  }

  drawRoll();
});

window.addEventListener('mousemove', (evt) => {
  if (!state.dragMode) return;

  if (state.dragMode === 'trimStart' || state.dragMode === 'trimEnd') {
    const canvas = state.dragCanvas || roll;
    const p = canvasPos(canvas, evt);
    const t = canvas === freqMap
      ? freqXToTime(p.x)
      : clamp(((p.x - gridGeometry().left) / gridGeometry().width) * trimMax(), 0, trimMax());

    if (state.dragMode === 'trimStart') {
      state.trimStart = Math.min(t, state.trimEnd);
    } else {
      state.trimEnd = Math.max(t, state.trimStart);
    }
    updateTrimUI();
    return;
  }

  if (state.selectedNote === null) return;

  const p = canvasPos(roll, evt);
  const note = state.notes[state.selectedNote];
  const g = gridGeometry();
  const rowH = g.height / (state.maxMidi - state.minMidi + 1);

  if (state.dragMode === 'move') {
    const xNorm = clamp((p.x - state.dragOffsetX - g.left) / g.width, 0, 1);
    note.start = xNorm * state.timelineSec;

    const row = Math.floor((p.y - g.top) / rowH);
    note.midi = clamp(state.maxMidi - row, state.minMidi, state.maxMidi);
  }

  if (state.dragMode === 'resize') {
    const noteStartX = g.left + (note.start / state.timelineSec) * g.width;
    const wNorm = clamp((p.x - noteStartX) / g.width, 0.003, 1);
    note.duration = Math.max(0.05, wNorm * state.timelineSec);
  }

  drawRoll();
});

window.addEventListener('mouseup', () => {
  state.dragMode = null;
  state.dragCanvas = null;
});

state.timelineSec = 8;
state.trimStart = 0;
state.trimEnd = state.timelineSec;
drawRoll();
updateTrimUI();
