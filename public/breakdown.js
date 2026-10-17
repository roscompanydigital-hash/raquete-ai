// Breakdown em câmera lenta: toca o vídeo devagar, congela em cada fase
// e desenha título, dica e marcações por cima do jogador (tudo em um <canvas>).

const BALL = "#d9f24a";
const INK = "#1a2a05";
const SLOW_RATE = 0.35;
const INTRO_MS = 2200;
const DRAW_MS = 700;
const HOLD_MS = 4200;
const MAX_WIDTH = 720;

const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

export class Breakdown {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} opts
   *   video: HTMLVideoElement com o vídeo (modo vídeo) — ou —
   *   images: { [frame]: dataUrl } com os quadros congelados (modo histórico)
   *   checkpoints: [{ frame, time, title, cue, annotations }]
   *   strokeName, score, onChange(index)
   */
  constructor(canvas, opts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.video = opts.video || null;
    this.strokeName = opts.strokeName;
    this.score = opts.score;
    this.onChange = opts.onChange || (() => {});
    this.checkpoints = [...opts.checkpoints].sort((a, b) => (a.time ?? a.frame) - (b.time ?? b.frame));
    this.images = {};
    this.raf = null;
    this.stopped = false;

    const loads = Object.entries(opts.images || {}).map(([frame, src]) => new Promise((ok) => {
      const img = new Image();
      img.onload = () => { this.images[frame] = img; ok(); };
      img.onerror = ok;
      img.src = src;
    }));
    if (this.video && this.video.readyState < 2) {
      loads.push(new Promise((ok) => this.video.addEventListener("loadeddata", ok, { once: true })));
    }
    this.ready = Promise.all(loads).then(() => this.#size());
  }

  #size() {
    const src = this.video || Object.values(this.images)[0];
    const w = this.video ? src.videoWidth : src?.naturalWidth;
    const h = this.video ? src.videoHeight : src?.naturalHeight;
    const scale = Math.min(MAX_WIDTH, w || MAX_WIDTH) / (w || MAX_WIDTH);
    this.canvas.width = Math.round((w || 720) * scale);
    this.canvas.height = Math.round((h || 1280) * scale);
    // unidade base para textos e linhas (vídeo em pé ou deitado)
    this.u = Math.min(this.canvas.width / 300, this.canvas.height / 420);
  }

  async play() {
    await this.ready;
    this.stop();
    this.stopped = false;
    this.index = 0;
    this.mode = "intro";
    this.modeStart = performance.now();
    this.onChange(-1);
    if (this.video) {
      this.video.pause();
      this.video.playbackRate = SLOW_RATE;
      await this.#seek(0);
    }
    this.#loop();
  }

  async goTo(i) {
    await this.ready;
    this.stop();
    this.stopped = false;
    this.index = Math.max(0, Math.min(this.checkpoints.length - 1, i));
    await this.#enterHold();
    this.#loop();
  }

  stop() {
    this.stopped = true;
    cancelAnimationFrame(this.raf);
    this.video?.pause();
  }

  #seek(t) {
    return new Promise((ok) => {
      const v = this.video;
      if (Math.abs(v.currentTime - t) < 0.01) return ok();
      const done = () => { v.removeEventListener("seeked", done); ok(); };
      v.addEventListener("seeked", done);
      v.currentTime = t;
    });
  }

  async #enterHold() {
    const cp = this.checkpoints[this.index];
    this.video?.pause();
    if (this.video && cp.time != null) await this.#seek(cp.time);
    this.mode = "hold";
    this.modeStart = performance.now();
    this.onChange(this.index);
  }

  #next() {
    this.index++;
    if (this.index >= this.checkpoints.length) {
      if (this.video && !this.video.ended) {
        this.mode = "outro-play";
        this.video.play().catch(() => {});
      } else {
        this.mode = "end";
        this.modeStart = performance.now();
        this.onChange(this.checkpoints.length);
      }
      return;
    }
    if (this.video && this.checkpoints[this.index].time != null) {
      this.mode = "playing";
      this.video.play().catch(() => {});
    } else {
      this.#enterHold();
    }
  }

  #loop = () => {
    if (this.stopped) return;
    const now = performance.now();
    const elapsed = now - this.modeStart;
    const cp = this.checkpoints[this.index];

    if (this.mode === "intro" && elapsed > INTRO_MS) {
      if (this.video && cp?.time != null) {
        this.mode = "playing";
        this.video.play().catch(() => {});
      } else {
        this.#enterHold();
      }
    } else if (this.mode === "playing" && this.video.currentTime >= cp.time - 0.03) {
      this.#enterHold();
    } else if (this.mode === "playing" && this.video.ended) {
      this.#enterHold();
    } else if (this.mode === "hold" && elapsed > HOLD_MS) {
      this.#next();
    } else if (this.mode === "outro-play" && this.video.ended) {
      this.mode = "end";
      this.modeStart = now;
      this.onChange(this.checkpoints.length);
    }

    this.#draw(now);
    if (this.mode !== "end" || now - this.modeStart < 600) this.raf = requestAnimationFrame(this.#loop);
  };

  // ---------- Desenho ----------
  #draw(now) {
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height, u = this.u;
    const elapsed = now - this.modeStart;
    const cp = this.checkpoints[Math.min(this.index, this.checkpoints.length - 1)];

    // Fundo: quadro do vídeo ou imagem congelada
    ctx.fillStyle = "#0d1f17";
    ctx.fillRect(0, 0, W, H);
    const img = this.video || this.images[cp?.frame] || Object.values(this.images)[0];
    if (img) ctx.drawImage(img, 0, 0, W, H);

    if (this.mode === "intro") return this.#drawIntro(Math.min(1, elapsed / 500));
    if (this.mode === "end") return this.#drawEnd(Math.min(1, elapsed / 500));

    // Faixa escura no topo para o texto
    const grad = ctx.createLinearGradient(0, 0, 0, H * 0.32);
    grad.addColorStop(0, "rgba(5,15,10,0.85)");
    grad.addColorStop(1, "rgba(5,15,10,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H * 0.32);

    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(238,245,239,0.75)";
    ctx.font = `700 ${9 * u}px system-ui, sans-serif`;
    ctx.fillText(`${this.strokeName.toUpperCase()} · RAQUETE AI`, 14 * u, 14 * u);
    this.#drawProgress();

    if (this.mode !== "hold") return;
    const p = ease(elapsed / DRAW_MS);
    const n = this.index + 1;

    // Leve escurecida no quadro congelado
    ctx.fillStyle = `rgba(0,0,0,${0.18 * p})`;
    ctx.fillRect(0, H * 0.3, W, H * 0.7);

    // Número + título
    const y0 = 34 * u;
    const r = 13 * u;
    ctx.globalAlpha = p;
    ctx.fillStyle = BALL;
    ctx.beginPath();
    ctx.arc(14 * u + r, y0 + r, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `800 ${16 * u}px system-ui, sans-serif`;
    ctx.fillText(String(n), 14 * u + r, y0 + r + u);
    ctx.textAlign = "left";
    ctx.fillStyle = "#fff";
    ctx.font = `900 ${24 * u}px system-ui, sans-serif`;
    ctx.fillText(cp.title || "", 14 * u + 2 * r + 9 * u, y0 + r + u, W - 60 * u);

    // Dica
    ctx.textBaseline = "top";
    ctx.font = `600 ${11.5 * u}px system-ui, sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    this.#wrap(cp.cue || "", 14 * u, y0 + 2 * r + 10 * u, W - 28 * u, 15 * u);
    ctx.globalAlpha = 1;

    for (const a of cp.annotations || []) this.#annotation(a, p);
  }

  #drawProgress() {
    const { ctx, canvas, u } = this;
    const total = this.checkpoints.length;
    const w = 14 * u, gap = 4 * u;
    let x = canvas.width - 14 * u - total * w - (total - 1) * gap;
    for (let i = 0; i < total; i++) {
      ctx.fillStyle = i < this.index || (i === this.index && this.mode === "hold") ? BALL : "rgba(255,255,255,0.3)";
      ctx.fillRect(x, 16 * u, w, 3 * u);
      x += w + gap;
    }
  }

  #wrap(text, x, y, maxW, lineH) {
    const words = text.split(/\s+/);
    let line = "";
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (this.ctx.measureText(test).width > maxW && line) {
        this.ctx.fillText(line, x, y);
        line = word;
        y += lineH;
      } else line = test;
    }
    if (line) this.ctx.fillText(line, x, y);
  }

  #annotation(a, p) {
    const { ctx, canvas, u } = this;
    const W = canvas.width, H = canvas.height;
    const x = a.x * W, y = a.y * H, x2 = a.x2 * W, y2 = a.y2 * H;
    ctx.save();
    ctx.strokeStyle = BALL;
    ctx.lineWidth = 3 * u;
    ctx.lineCap = "round";
    ctx.shadowColor = BALL;
    ctx.shadowBlur = 10 * u;

    let labelAt = [x, y];
    if (a.type === "circle") {
      const rad = Math.max(8 * u, a.r * W);
      ctx.beginPath();
      ctx.arc(x, y, rad, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
      ctx.stroke();
      labelAt = [x, y - rad - 12 * u];
    } else if (a.type === "line" || a.type === "arrow") {
      const ex = x + (x2 - x) * p, ey = y + (y2 - y) * p;
      ctx.setLineDash(a.type === "line" ? [8 * u, 6 * u] : []);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.setLineDash([]);
      if (a.type === "arrow" && p > 0.95) {
        const ang = Math.atan2(y2 - y, x2 - x), h = 11 * u;
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - h * Math.cos(ang - 0.5), y2 - h * Math.sin(ang - 0.5));
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - h * Math.cos(ang + 0.5), y2 - h * Math.sin(ang + 0.5));
        ctx.stroke();
      }
      labelAt = [(x + x2) / 2, (y + y2) / 2 - 12 * u];
    }
    ctx.restore();

    if (a.text && p > 0.6) this.#label(a.text, ...labelAt, (p - 0.6) / 0.4);
  }

  #label(text, cx, cy, alpha) {
    const { ctx, canvas, u } = this;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `800 ${8.5 * u}px system-ui, sans-serif`;
    const tw = ctx.measureText(text.toUpperCase()).width;
    const w = tw + 10 * u, h = 15 * u;
    const x = Math.min(canvas.width - w - 4 * u, Math.max(4 * u, cx - w / 2));
    const y = Math.min(canvas.height - h - 4 * u, Math.max(4 * u, cy - h / 2));
    ctx.fillStyle = BALL;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 3 * u);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(text.toUpperCase(), x + 5 * u, y + h / 2 + 0.5 * u);
    ctx.restore();
  }

  #drawCard(alpha, lines) {
    const { ctx, canvas, u } = this;
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = `rgba(5,15,10,${0.72 * alpha})`;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = alpha;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let y = H * 0.3;
    for (const [text, size, weight, color, gap] of lines) {
      ctx.font = `${weight} ${size * u}px system-ui, sans-serif`;
      ctx.fillStyle = color;
      ctx.fillText(text, W / 2, y, W - 24 * u);
      y += gap * u;
    }
    ctx.globalAlpha = 1;
  }

  #drawIntro(alpha) {
    this.#drawCard(alpha, [
      ["BREAKDOWN EM CÂMERA LENTA", 9, 700, BALL, 30],
      ["SEU", 30, 900, "#fff", 32],
      [this.strokeName.toUpperCase(), 34, 900, BALL, 34],
      [`${this.checkpoints.length} momentos-chave`, 11, 500, "rgba(255,255,255,0.85)", 0],
    ]);
  }

  #drawEnd(alpha) {
    this.#drawCard(alpha, [
      ["NOTA", 10, 700, BALL, 40],
      [this.score.toFixed(1), 54, 900, "#fff", 40],
      ["de 10", 11, 500, "rgba(255,255,255,0.8)", 34],
      ["Toque em ↻ para ver de novo", 10, 500, "rgba(255,255,255,0.7)", 0],
    ]);
  }
}
