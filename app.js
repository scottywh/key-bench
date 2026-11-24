/* Key Bench 1.0.0 — the keyboard, on its own. Play it, record it, export it.
   Forked from Plus Twelve's keyboard side. No quiz, no guitar, no vocal trainer.
   Every key shows its name AND its number. C4 = 60, C5 = 72, octave = +12.

   Multi-touch: every pointer is tracked by pointerId. Each held key gets its own
   synth voice, each key stays lit while held, and the note ends on pointerup,
   pointercancel, or lostpointercapture. Chords are first-class here. */
(function () {
  'use strict';

  /* ---------- small DOM helpers (same shape as String Bench / Plus Twelve) ---------- */
  var app = document.getElementById('app');
  function el(tag, cls, html) { var n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; }
  function bar(title, sub) {
    var b = el('div', 'bar');
    var h = el('h1', 'brand'); h.innerHTML = '<i></i><span><span class="key">Key</span> Bench</span>';
    var chip = el('div', 'chip', '<span class="mono">' + sub + '</span>');
    var sp = el('div', 'spacer');
    b.appendChild(h); b.appendChild(sp); b.appendChild(chip);
    return b;
  }
  function toast(msg) {
    var t = document.querySelector('.toast'); if (t) t.remove();
    t = el('div', 'toast', msg); document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 4200);
  }

  /* ---------- notes ---------- */
  var NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  function nameOf(midi) { return NAMES[midi % 12] + (Math.floor(midi / 12) - 1); }
  function freqOf(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }
  var K0 = 60, K1 = 83; // C4..B5 — two octaves, same as Plus Twelve
  function isSharp(midi) { return NAMES[midi % 12].indexOf('#') >= 0; }

  /* ---------- audio: synth master bus + a recorder tap (same shape as Plus Twelve) ---------- */
  var AC = window.AudioContext || window.webkitAudioContext;
  var actx = null, master = null, recDest = null;
  function ac() {
    if (!actx) {
      actx = new AC();
      master = actx.createGain(); master.gain.value = 0.85; master.connect(actx.destination);
      recDest = actx.createMediaStreamDestination();
      master.connect(recDest);
    }
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }
  /* One voice per held key. stop() ramps the gain down and parks the oscillators. */
  function startVoice(midi) {
    var ctx = ac(), f = freqOf(midi), t = ctx.currentTime + 0.01;
    var g = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 3200; lp.Q.value = 0.4;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.008);
    var o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = f;
    var o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f * 2;
    var g2 = ctx.createGain(); g2.gain.value = 0.16;
    o1.connect(g); o2.connect(g2); g2.connect(g); g.connect(lp); lp.connect(master);
    o1.start(t); o2.start(t);
    return {
      stop: function () {
        try {
          var t2 = ctx.currentTime;
          g.gain.cancelScheduledValues(t2);
          g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), t2);
          g.gain.exponentialRampToValueAtTime(0.0001, t2 + 0.12);
          o1.stop(t2 + 0.25); o2.stop(t2 + 0.25);
          setTimeout(function () { try { g.disconnect(); lp.disconnect(); } catch (e) {} }, 400);
        } catch (e) {}
      }
    };
  }

  /* ---------- state ---------- */
  var S = { notesPlayed: 0, last: null };
  var active = {};       // pointerId -> { midi, voice, node, event, t0 }
  var keyCount = {};     // midi -> number of pointers currently holding it
  var pianoKeyEls = {};  // midi -> key element
  var MAX_DUR = 4;       // seconds — a release missed this long is capped, never left hanging

  /* ---------- MIDI export: real note durations (not Plus Twelve's fixed 1.6s) ---------- */
  function encVar(n) {
    var out = [n & 0x7f]; n >>= 7;
    while (n > 0) { out.unshift((n & 0x7f) | 0x80); n >>= 7; }
    return out;
  }
  function buildMidi(events, tpq, bpm) {
    tpq = tpq || 480; bpm = bpm || 120;
    var tps = tpq * bpm / 60; // ticks per second
    var evs = [];
    events.forEach(function (e) {
      var dur = (typeof e.dur === 'number' && e.dur > 0) ? e.dur : 1.2;
      evs.push({ t: e.t * tps, on: true, midi: e.midi, vel: e.vel || 100 });
      evs.push({ t: (e.t + dur) * tps, on: false, midi: e.midi, vel: 0 });
    });
    evs.sort(function (a, b) { return a.t - b.t || (a.on === b.on ? 0 : (a.on ? -1 : 1)); });
    var track = [];
    var us = Math.round(60000000 / bpm);
    track.push(0, 0xff, 0x51, 0x03, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff);
    var last = 0;
    evs.forEach(function (e) {
      var dt = Math.max(0, Math.round(e.t) - last); last = Math.round(e.t);
      encVar(dt).forEach(function (b) { track.push(b); });
      track.push(e.on ? 0x90 : 0x80, e.midi, e.on ? e.vel : 64);
    });
    track.push(0, 0xff, 0x2f, 0);
    var hdr = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (tpq >> 8) & 0xff, tpq & 0xff];
    var trk = [0x4d, 0x54, 0x72, 0x6b, (track.length >> 24) & 0xff, (track.length >> 16) & 0xff, (track.length >> 8) & 0xff, track.length & 0xff];
    return new Uint8Array(hdr.concat(trk).concat(track));
  }

  /* ---------- downloads: native bridge first (WebView cannot anchor-download) ---------- */
  function stampName(base, ext) {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return base + '-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + ext;
  }
  function downloadBlob(blob, fname, mime) {
    if (window.ChordBenchApp && window.ChordBenchApp.saveFile) {
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var b64 = ('' + rd.result).split(',')[1];
          var ok = window.ChordBenchApp.saveFile(fname, mime, b64);
          toast(ok === 'ok' ? 'Saved to Downloads/Key Bench: ' + fname : 'Save failed: ' + ok);
        } catch (e) { toast('Save failed: ' + e.message); }
      };
      rd.readAsDataURL(blob);
      return true;
    }
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = fname;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 200);
    return true;
  }

  /* ---------- landscape lock (same as Plus Twelve) ---------- */
  var orient = { tried: false, failed: false };
  var orientHintEl = null;
  function lockLandscape() {
    if (orient.tried) return;
    orient.tried = true;
    try {
      var p = screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape');
      if (p && p.catch) p.catch(function () { orient.failed = true; if (orientHintEl) orientHintEl.hidden = false; });
    } catch (e) { orient.failed = true; if (orientHintEl) orientHintEl.hidden = false; }
  }
  function unlockOrientation() {
    try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (e) {}
    orient.tried = false; orient.failed = false;
    if (orientHintEl) orientHintEl.hidden = true;
  }

  /* ---------- multi-touch piano ---------- */
  var lastEl = null, heldEl = null, hudEl = null, hudRefs = {}, takeEl = null, prevEl = null, recBtn = null;

  function refreshHeld() {
    if (!heldEl || !hudEl) return;
    var mids = Object.keys(active).map(function (k) { return active[k].midi; }).sort(function (a, b) { return a - b; });
    var uniq = []; mids.forEach(function (m) { if (uniq.indexOf(m) < 0) uniq.push(m); });
    if (uniq.length) {
      heldEl.innerHTML = 'HOLDING <b>' + uniq.map(function (m) { return nameOf(m); }).join(' · ') + '</b>';
    } else {
      heldEl.textContent = 'Hold keys with more than one finger — chords welcome.';
    }
    if (hudRefs.held) hudRefs.held.textContent = String(uniq.length);
  }
  function setLast(midi) {
    if (!lastEl) return;
    var nm = nameOf(midi);
    var m = nm.match(/^(.+?)(\d)$/);
    lastEl.innerHTML = m ? m[1] + '<small>' + m[2] + '</small>' : nm;
    lastEl.classList.remove('dim');
  }

  /* open a MIDI event for this pointer; closed on release (real duration) */
  var recEvents = [];   // { midi, t, dur, vel } — dur filled in on release
  var recT0 = 0;         // performance.now() at recording start
  function openEvent(midi) {
    if (!playRec) return null;
    var ev = { midi: midi, t: (performance.now() - recT0) / 1000, dur: null, vel: 100 };
    recEvents.push(ev);
    return ev;
  }
  function closeEvent(ev, tNow) {
    if (!ev || ev.dur != null) return;
    ev.dur = Math.min(Math.max((tNow - recT0) / 1000 - ev.t, 0.01), MAX_DUR);
  }

  function keyDown(midi, node, e) {
    if (e) { try { e.preventDefault(); } catch (err) {} }
    lockLandscape();
    var pid = e && e.pointerId != null ? e.pointerId : 'mouse';
    if (active[pid]) return; // this pointer is already holding a key
    if (e && node && node.setPointerCapture) { try { node.setPointerCapture(pid); } catch (err) {} }
    var voice = startVoice(midi);
    var ev = openEvent(midi);
    active[pid] = { midi: midi, voice: voice, node: node, event: ev, t0: performance.now() };
    keyCount[midi] = (keyCount[midi] || 0) + 1;
    if (keyCount[midi] === 1 && node) node.classList.add('lit');
    S.notesPlayed++;
    setLast(midi);
    refreshHeld();
    if (hudRefs.notes) hudRefs.notes.textContent = String(S.notesPlayed);
  }
  function keyUp(pid) {
    var a = active[pid];
    if (!a) return;
    delete active[pid];
    try { a.voice.stop(); } catch (e) {}
    closeEvent(a.event, performance.now());
    keyCount[a.midi] = Math.max(0, (keyCount[a.midi] || 1) - 1);
    if (keyCount[a.midi] === 0 && a.node) a.node.classList.remove('lit');
    refreshHeld();
  }
  function releaseAll() {
    Object.keys(active).forEach(function (pid) { keyUp(pid); });
  }

  function dotsFor(midi, white) {
    var idx = midi - K0; // 0..23 — dots at pattern positions 1·3·5·7·9, double dot on C
    var n = 0;
    if (idx % 12 === 0) n = 2; // C
    else if ([1, 3, 5, 7, 9].indexOf(idx % 12) >= 0) n = 1;
    if (!n) return '';
    var s = '';
    for (var i = 0; i < n; i++) s += '<i></i>';
    return '<span class="dots">' + s + '</span>';
  }
  function buildPiano() {
    var wrap = el('div', 'piano-wrap');
    var p = el('div', 'piano');
    p.setAttribute('role', 'group');
    p.setAttribute('aria-label', 'Piano, C4 to B5. Hold keys with more than one finger to play chords.');
    var whiteMidis = [];
    for (var m = K0; m <= K1; m++) if (!isSharp(m)) whiteMidis.push(m);
    var W = whiteMidis.length, wW = 100 / W;
    whiteMidis.forEach(function (midi, i) {
      var k = el('button', 'wkey', '<span class="kn">' + nameOf(midi) + '</span><span class="km">' + midi + '</span>' + dotsFor(midi, true));
      k.style.left = (i * wW) + '%'; k.style.width = wW + '%';
      k.setAttribute('aria-label', 'Play ' + nameOf(midi));
      k.addEventListener('pointerdown', function (e) { keyDown(midi, k, e); }, { passive: false });
      k.addEventListener('pointerup', function (e) { keyUp(e.pointerId); });
      k.addEventListener('pointercancel', function (e) { keyUp(e.pointerId); });
      k.addEventListener('lostpointercapture', function (e) { keyUp(e.pointerId); });
      k.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      p.appendChild(k);
      pianoKeyEls[midi] = k;
    });
    whiteMidis.forEach(function (midi, i) {
      if (i >= W - 1) return;
      var s = midi + 1;
      if (!isSharp(s)) return;
      var k = el('button', 'bkey', '<span class="kn">' + nameOf(s) + '</span><span class="km">' + s + '</span>' + dotsFor(s, false));
      k.style.left = ((i + 1) * wW - wW * 0.32) + '%';
      k.style.width = (wW * 0.64) + '%';
      k.setAttribute('aria-label', 'Play ' + nameOf(s));
      k.addEventListener('pointerdown', function (e) { keyDown(s, k, e); }, { passive: false });
      k.addEventListener('pointerup', function (e) { keyUp(e.pointerId); });
      k.addEventListener('pointercancel', function (e) { keyUp(e.pointerId); });
      k.addEventListener('lostpointercapture', function (e) { keyUp(e.pointerId); });
      k.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      p.appendChild(k);
      pianoKeyEls[s] = k;
    });
    [K0, K0 + 12].forEach(function (c, i) {
      var t = el('div', 'oct-tag', 'Octave ' + (i + 1) + ' · ' + nameOf(c));
      var idx = whiteMidis.indexOf(c);
      t.style.left = (idx * wW + 0.4) + '%';
      p.appendChild(t);
    });
    wrap.appendChild(p);
    return wrap;
  }

  /* ---------- recording: MediaRecorder over the synth bus, mp4 first (.m4a) ---------- */
  var MR = window.MediaRecorder;
  var playRec = null, playTimer = null, playChunks = [], playBlob = null;
  function chooseMime() {
    var cands = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'];
    for (var i = 0; i < cands.length; i++) {
      try { if (MR && MR.isTypeSupported && MR.isTypeSupported(cands[i])) return cands[i]; } catch (e) {}
    }
    return '';
  }
  function startPlayRecording() {
    if (playRec) return;
    ac();
    var mime = chooseMime();
    try {
      playRec = mime ? new MR(recDest.stream, { mimeType: mime }) : new MR(recDest.stream);
    } catch (e) { takeEl.textContent = 'Could not start the recorder: ' + e.message; return; }
    playChunks = []; recEvents = []; recT0 = performance.now(); playBlob = null;
    playRec.ondataavailable = function (ev) { if (ev.data && ev.data.size) playChunks.push(ev.data); };
    playRec.onstop = function () {
      var type = (playRec && playRec.mimeType) || mime || 'audio/mp4';
      var ext = type.indexOf('mp4') >= 0 ? '.m4a' : type.indexOf('webm') >= 0 ? '.webm' : '.ogg';
      playBlob = new Blob(playChunks, { type: type });
      // close any event whose release never landed — cap, don't hang
      var now = performance.now();
      recEvents.forEach(function (ev) { closeEvent(ev, now); });
      playRecUI();
    };
    playRec.start(250);
    var t0 = Date.now();
    playTimer = setInterval(function () {
      takeEl.textContent = '● REC ' + Math.floor((Date.now() - t0) / 1000) + 's · ' + recEvents.length + ' notes';
      // safety: cap any open event older than MAX_DUR even mid-take
      var now = performance.now();
      recEvents.forEach(function (ev) { if (ev.dur == null && (now - recT0) / 1000 - ev.t > MAX_DUR) ev.dur = MAX_DUR; });
    }, 500);
    recBtn.classList.add('on'); recBtn.textContent = '■ Stop';
    takeEl.textContent = '● REC 0s';
  }
  function stopPlayRecording() {
    if (!playRec) return;
    try { playRec.stop(); } catch (e) {}
    clearInterval(playTimer); playTimer = null;
    playRec = null;
    releaseAll(); // any held key ends with the take
    recBtn.classList.remove('on'); recBtn.textContent = '● Record';
  }
  function playRecUI() {
    takeEl.textContent = 'Take kept — ' + recEvents.length + ' notes. Download it below.';
    takeEl.className = 'statusline good';
    var dlA = document.getElementById('kb-dl-a');
    var dlM = document.getElementById('kb-dl-m');
    if (dlA) dlA.disabled = !playBlob;
    if (dlM) dlM.disabled = recEvents.length === 0;
    if (playBlob && prevEl) {
      prevEl.src = URL.createObjectURL(playBlob);
      prevEl.hidden = false;
    }
  }
  function downloadAudio() {
    if (!playBlob) return;
    var type = playBlob.type || 'audio/mp4';
    var ext = type.indexOf('mp4') >= 0 ? '.m4a' : type.indexOf('webm') >= 0 ? '.webm' : '.ogg';
    downloadBlob(playBlob, stampName('key-bench-play', ext), type);
  }
  function downloadMidi() {
    if (!recEvents.length) return;
    var bytes = buildMidi(recEvents, 480, 120);
    var blob = new Blob([bytes], { type: 'audio/midi' });
    downloadBlob(blob, stampName('key-bench-play', '.mid'), 'audio/midi');
  }

  /* ---------- render: one screen, the keyboard ---------- */
  function render() {
    app.innerHTML = '';
    var head = bar('Key Bench', 'C4 = 60 · C5 = 72 · +12');
    app.appendChild(head);

    var stage = el('div', 'stage');
    lastEl = el('div', 'bignote dim', '—');
    var kind = el('div', 'kind', 'Every key has a name and a number.');
    heldEl = el('div', 'heldline', 'Hold keys with more than one finger — chords welcome.');
    takeEl = el('div', 'statusline', '');
    stage.appendChild(lastEl); stage.appendChild(kind); stage.appendChild(heldEl); stage.appendChild(takeEl);
    app.appendChild(stage);

    hudEl = el('div', 'hud');
    [['notes', '0', 'Notes played'], ['held', '0', 'Held now'], ['take', '—', 'Take']].forEach(function (s) {
      var st = el('div', 'stat');
      var b = el('b'); b.setAttribute('data-h', s[0]); b.textContent = s[1];
      var sp = el('span'); sp.textContent = s[2];
      st.appendChild(b); st.appendChild(sp);
      hudEl.appendChild(st);
      hudRefs[s[0]] = b;
    });
    app.appendChild(hudEl);

    app.appendChild(buildPiano());
    app.appendChild(el('div', 'legend', 'Dots mark the pattern — 1 · 3 · 5 · 7 · 9, <i></i><i></i> on C. The octave is just +12.'));

    var row = el('div', 'row');
    recBtn = el('button', 'btn primary', '● Record');
    recBtn.addEventListener('click', function () { lockLandscape(); if (playRec) stopPlayRecording(); else startPlayRecording(); });
    var dlA = el('button', 'btn', 'Download .m4a'); dlA.id = 'kb-dl-a'; dlA.disabled = true;
    dlA.addEventListener('click', downloadAudio);
    var dlM = el('button', 'btn', 'Download .mid'); dlM.id = 'kb-dl-m'; dlM.disabled = true;
    dlM.addEventListener('click', downloadMidi);
    row.appendChild(recBtn); row.appendChild(dlA); row.appendChild(dlM);
    app.appendChild(row);

    prevEl = el('audio', 'rec-prev'); prevEl.controls = true; prevEl.hidden = true;
    app.appendChild(prevEl);

    orientHintEl = el('div', 'orient-hint', 'This bench plays best in landscape — rotate your phone if the keys feel cramped.');
    orientHintEl.hidden = true;
    app.appendChild(orientHintEl);

    // a held pointer that wanders off (or the app losing focus) must end the note
    window.addEventListener('pointerup', function (e) { if (e && e.pointerId != null) keyUp(e.pointerId); });
    window.addEventListener('pointercancel', function (e) { if (e && e.pointerId != null) keyUp(e.pointerId); });
    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', function () { if (document.hidden) releaseAll(); });
  }

  render();

  /* ---------- debug / test hook ---------- */
  window.KB = {
    S: S, nameOf: nameOf, freqOf: freqOf, isSharp: isSharp, K0: K0, K1: K1,
    active: active, keyCount: keyCount, pianoKeyEls: pianoKeyEls,
    keyDown: keyDown, keyUp: keyUp, releaseAll: releaseAll,
    buildMidi: buildMidi, encVar: encVar, MAX_DUR: MAX_DUR,
    get recEvents() { return recEvents; },
    get playRec() { return playRec; },
    get playBlob() { return playBlob; },
    startPlayRecording: startPlayRecording, stopPlayRecording: stopPlayRecording,
    downloadAudio: downloadAudio, downloadMidi: downloadMidi, downloadBlob: downloadBlob,
    lockLandscape: lockLandscape, unlockOrientation: unlockOrientation, orient: orient,
    chooseMime: chooseMime, stampName: stampName, toast: toast,
    startVoice: startVoice
  };
})();
