(() => {
  "use strict";

  // ---------- Settings ----------
  const PHOTO_SECONDS = 6;       // how long each photo stays on screen
  const MAX_VIDEO_SECONDS = 45;  // long clips move on after this
  const IDLE_HIDE_MS = 2800;     // controls fade after this much stillness

  const $ = (s) => document.querySelector(s);
  const intro = $("#intro"), show = $("#show"), stage = $("#stage");
  const fill = $("#progress-fill");
  const caption = $("#caption"), capAlbum = $("#cap-album"), capDate = $("#cap-date");
  const counter = $("#counter"), controls = $("#controls");

  const ALL = (window.MEDIA || []).slice();
  const KB = ["kb-in", "kb-out", "kb-left", "kb-right"];
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  let order = [], index = -1, current = null;
  let paused = false, muted = false, started = false;
  let slideStart = 0, slideDuration = 0, elapsedBeforePause = 0, raf = 0;

  // ---------- Shuffle: random, but avoid the same album twice in a row ----------
  function shuffle() {
    const a = ALL.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    for (let i = 1; i < a.length; i++) {
      if (a[i].album === a[i - 1].album) {
        const k = a.findIndex((x, n) => n > i && x.album !== a[i - 1].album);
        if (k > -1) [a[i], a[k]] = [a[k], a[i]];
      }
    }
    return a;
  }

  function prettyDate(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-").map(Number);
    return `${d} ${MONTHS[m - 1]} ${y}`;
  }

  // ---------- Preloading ----------
  const preloaded = new Map();
  function preload(item) {
    if (!item || preloaded.has(item.src)) return;
    if (item.type === "image") {
      const img = new Image(); img.decoding = "async"; img.src = item.src;
      preloaded.set(item.src, img);
    } else {
      const v = document.createElement("video");
      v.preload = "auto"; v.muted = true; v.playsInline = true; v.src = item.src;
      preloaded.set(item.src, v);
    }
    if (preloaded.size > 8) preloaded.delete(preloaded.keys().next().value);
  }

  // ---------- Building a slide ----------
  function buildSlide(item) {
    const slide = document.createElement("div");
    slide.className = "slide";
    const frame = document.createElement("div");
    frame.className = "frame";

    if (item.type === "image") {
      const bg = document.createElement("div");
      bg.className = "backdrop";
      bg.style.backgroundImage = `url("${item.src}")`;
      const img = document.createElement("img");
      img.className = "media kb";
      img.src = item.src; img.alt = "";
      img.style.setProperty("--kb", KB[Math.floor(Math.random() * KB.length)]);
      img.style.setProperty("--dur", `${PHOTO_SECONDS + 2}s`);
      frame.append(img);
      slide.append(bg, frame);
      slide._ready = img.decode ? img.decode().catch(() => {}) : Promise.resolve();
    } else {
      const bg = document.createElement("video");
      bg.className = "backdrop";
      bg.muted = true; bg.playsInline = true; bg.loop = true; bg.src = item.src;
      bg.setAttribute("aria-hidden", "true");
      const v = document.createElement("video");
      v.className = "media";
      v.playsInline = true; v.preload = "auto"; v.src = item.src;
      v.muted = muted;
      frame.append(v);
      slide.append(bg, frame);
      slide._video = v; slide._bg = bg;
      slide._ready = new Promise((res) => {
        if (v.readyState >= 2) return res();
        v.addEventListener("loadeddata", res, { once: true });
        v.addEventListener("error", res, { once: true });
        setTimeout(res, 4000);
      });
    }
    return slide;
  }

  // ---------- Showing a slide ----------
  let token = 0;
  async function go(step) {
    if (!order.length) return;
    let next = index + step;

    if (next >= order.length) { finish(); return; }
    if (next < 0) next = 0;
    index = next;

    const my = ++token;
    const item = order[index];
    cancelAnimationFrame(raf);
    fill.style.width = "0%";
    caption.classList.remove("show");

    const slide = buildSlide(item);
    stage.append(slide);
    await slide._ready;
    if (my !== token) { slide.remove(); return; }

    // retire the old slide
    const old = current;
    if (old) {
      old.classList.remove("in"); old.classList.add("out");
      if (old._video) { fadeOutAudio(old._video); }
      setTimeout(() => old.remove(), 1700);
    }
    current = slide;
    requestAnimationFrame(() => slide.classList.add("in"));

    capAlbum.textContent = item.album;
    capDate.textContent = prettyDate(item.date);
    requestAnimationFrame(() => caption.classList.add("show"));
    counter.textContent = `${index + 1} / ${order.length}`;

    preload(order[index + 1]); preload(order[index + 2]);

    if (item.type === "video") {
      const v = slide._video;
      v.muted = muted;
      slide._bg.play().catch(() => {});
      v.addEventListener("ended", () => { if (my === token) go(1); });
      v.addEventListener("error", () => { if (my === token) go(1); });
      const p = v.play();
      if (p) p.catch(() => { v.muted = true; muted = true; syncButtons(); v.play().catch(() => go(1)); });
      const dur = isFinite(v.duration) && v.duration > 0 ? v.duration : MAX_VIDEO_SECONDS;
      startClock(Math.min(dur, MAX_VIDEO_SECONDS), v);
    } else {
      startClock(PHOTO_SECONDS);
    }
    if (paused) applyPause();
  }

  function fadeOutAudio(v) {
    if (v.muted) { setTimeout(() => v.pause(), 1600); return; }
    const start = v.volume, t0 = performance.now();
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / 1200);
      v.volume = start * (1 - k);
      if (k < 1) requestAnimationFrame(tick); else v.pause();
    };
    requestAnimationFrame(tick);
  }

  // ---------- Timing & progress ----------
  function startClock(seconds, video) {
    slideDuration = seconds * 1000;
    elapsedBeforePause = 0;
    slideStart = performance.now();
    runClock(video);
  }

  function runClock(video) {
    const my = token;
    const tick = () => {
      if (my !== token || paused) return;
      let elapsed;
      if (video && isFinite(video.duration) && video.duration > 0) {
        const cap = Math.min(video.duration, MAX_VIDEO_SECONDS);
        elapsed = video.currentTime * 1000; slideDuration = cap * 1000;
      } else {
        elapsed = elapsedBeforePause + (performance.now() - slideStart);
      }
      const pct = Math.min(1, elapsed / slideDuration);
      fill.style.width = `${pct * 100}%`;
      if (pct >= 1 && (!video || video.currentTime >= MAX_VIDEO_SECONDS)) { go(1); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  function applyPause() {
    cancelAnimationFrame(raf);
    elapsedBeforePause += performance.now() - slideStart;
    if (current?._video) current._video.pause();
    current?.querySelector(".kb")?.style.setProperty("animation-play-state", "paused");
  }

  function togglePause(force) {
    const want = typeof force === "boolean" ? force : !paused;
    if (want === paused) return;
    paused = want;
    if (paused) applyPause();
    else {
      slideStart = performance.now();
      if (current?._video) current._video.play().catch(() => {});
      current?.querySelector(".kb")?.style.setProperty("animation-play-state", "running");
      runClock(current?._video);
    }
    syncButtons();
  }

  function toggleMute() {
    muted = !muted;
    if (current?._video) current._video.muted = muted;
    syncButtons();
  }

  function syncButtons() {
    controls.classList.toggle("paused", paused);
    controls.classList.toggle("muted", muted);
    $("#btn-play").setAttribute("aria-label", paused ? "Play (space)" : "Pause (space)");
    $("#btn-mute").setAttribute("aria-label", muted ? "Unmute (M)" : "Mute (M)");
  }

  // ---------- Note messages: gently highlight one at a time ----------
  const NOTE_SECONDS = 9;
  const noteItems = [...document.querySelectorAll("#notes li")];
  const dots = $("#note-dots");
  noteItems.forEach(() => dots.append(document.createElement("span")));
  let noteIndex = -1, noteTimer = 0;
  function nextNote() {
    noteIndex = (noteIndex + 1) % noteItems.length;
    noteItems.forEach((li, i) => li.classList.toggle("active", i === noteIndex));
    [...dots.children].forEach((d, i) => d.classList.toggle("on", i === noteIndex));
  }
  function startNotes() { nextNote(); clearInterval(noteTimer); noteTimer = setInterval(nextNote, NOTE_SECONDS * 1000); }

  // when every item has been shown, reshuffle and keep going
  function finish() {
    order = shuffle(); index = -1;
    go(1);
  }

  // ---------- Start ----------
  function begin() {
    if (started) return;
    started = true;
    order = shuffle();
    intro.classList.remove("is-active");
    show.classList.add("is-active");
    glow.stop();
    syncButtons();
    wake();
    startNotes();
    go(1);
  }

  // ---------- Idle controls ----------
  let idleTimer;
  function wake() {
    show.classList.remove("idle");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (!paused) show.classList.add("idle"); }, IDLE_HIDE_MS);
  }

  // ---------- Events ----------
  $("#begin").addEventListener("click", begin);
  $("#btn-next").addEventListener("click", () => go(1));
  $("#btn-prev").addEventListener("click", () => go(-1));
  $(".tap-next").addEventListener("click", () => go(1));
  $(".tap-prev").addEventListener("click", () => go(-1));
  $("#btn-play").addEventListener("click", () => togglePause());
  $("#btn-mute").addEventListener("click", toggleMute);
  $("#btn-shuffle").addEventListener("click", () => { order = shuffle(); index = -1; go(1); });
  ["mousemove", "touchstart", "keydown"].forEach((ev) => document.addEventListener(ev, wake, { passive: true }));

  document.addEventListener("keydown", (e) => {
    if (!started) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); begin(); } return; }
    switch (e.key) {
      case "ArrowRight": go(1); break;
      case "ArrowLeft": go(-1); break;
      case " ": e.preventDefault(); togglePause(); break;
      case "m": case "M": toggleMute(); break;
      case "f": case "F":
        if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
        else document.exitFullscreen?.();
        break;
    }
  });

  // swipe
  let sx = 0, sy = 0;
  show.addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  show.addEventListener("touchend", (e) => {
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
  }, { passive: true });

  // pause when the tab is hidden, resume when back
  let autoPaused = false;
  document.addEventListener("visibilitychange", () => {
    if (!started) return;
    if (document.hidden && !paused) { autoPaused = true; togglePause(true); }
    else if (!document.hidden && autoPaused) { autoPaused = false; togglePause(false); }
  });

  // ---------- Soft floating light (intro background) ----------
  const glow = (() => {
    const c = $("#glow"), ctx = c.getContext("2d");
    let w, h, dpr, dots = [], running = false, id = 0;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    function resize() {
      dpr = Math.min(2, devicePixelRatio || 1);
      w = c.width = innerWidth * dpr; h = c.height = innerHeight * dpr;
    }
    function seed() {
      const n = Math.round(Math.min(46, (innerWidth * innerHeight) / 26000));
      dots = Array.from({ length: n }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        r: (Math.random() * 2.4 + 0.6) * dpr,
        vy: -(Math.random() * 0.25 + 0.05) * dpr, vx: (Math.random() - 0.5) * 0.12 * dpr,
        a: Math.random() * 0.5 + 0.15, p: Math.random() * Math.PI * 2,
      }));
    }
    function frame(t) {
      ctx.clearRect(0, 0, w, h);
      for (const d of dots) {
        d.x += d.vx; d.y += d.vy;
        if (d.y < -20) { d.y = h + 20; d.x = Math.random() * w; }
        const tw = 0.6 + 0.4 * Math.sin(t / 1400 + d.p);
        const g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r * 6);
        g.addColorStop(0, `rgba(243, 201, 168, ${d.a * tw})`);
        g.addColorStop(1, "rgba(232, 165, 152, 0)");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(d.x, d.y, d.r * 6, 0, Math.PI * 2); ctx.fill();
      }
      if (running) id = requestAnimationFrame(frame);
    }
    addEventListener("resize", () => { resize(); seed(); });
    resize(); seed();
    return {
      start(z = 0) { c.style.zIndex = z; if (running) return; running = true; reduce ? frame(0) : (id = requestAnimationFrame(frame)); },
      stop() { running = false; cancelAnimationFrame(id); ctx.clearRect(0, 0, w, h); c.style.zIndex = 0; },
    };
  })();
  glow.start(0); // on the intro the light sits behind the text
})();
