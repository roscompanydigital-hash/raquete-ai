const STROKE_NAMES = { serve: "Saque", forehand: "Forehand", backhand: "Backhand", volley: "Voleio", smash: "Smash" };
const FRAME_COUNT = 10;
const FRAME_WIDTH = 640;
const STORAGE_KEY = "raquete-ai-history";

const $ = (sel) => document.querySelector(sel);
const state = { stroke: "serve", file: null, view: "home" };

// ---------- Histórico (salvo no próprio aparelho) ----------
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; }
}
function saveHistory(items) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, 50))); } catch { /* armazenamento cheio ou bloqueado */ }
}

// ---------- Navegação ----------
function show(view) {
  state.view = view;
  for (const v of ["home", "new", "loading", "result"]) $(`#view-${v}`).hidden = v !== view;
  $("#back").hidden = view === "home" || view === "loading";
  if (view === "home") renderHome();
  window.scrollTo(0, 0);
}
$("#back").onclick = () => show("home");
document.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => show(b.dataset.go)));

// ---------- Início ----------
function scoreColor(s) {
  return s >= 7.5 ? "var(--good)" : s >= 5 ? "var(--mid)" : "var(--bad)";
}
function fmtDate(ts) {
  return new Date(ts).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function renderHome() {
  const items = loadHistory();
  const scores = items.map((i) => i.result.score);
  const best = scores.length ? Math.max(...scores).toFixed(1) : "–";
  const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : "–";
  $("#stats").innerHTML = `
    <div><b>${items.length}</b><small>análises</small></div>
    <div><b>${avg}</b><small>nota média</small></div>
    <div><b>${best}</b><small>melhor nota</small></div>`;

  $("#empty").hidden = items.length > 0;
  $("#history").innerHTML = "";
  for (const item of items) {
    const li = document.createElement("li");
    li.innerHTML = `
      <img alt="" src="${item.thumb || ""}">
      <div class="meta"><b>${STROKE_NAMES[item.stroke]}</b><small>${fmtDate(item.date)} · ${item.level}</small></div>
      <span class="pill" style="color:${scoreColor(item.result.score)}">${item.result.score.toFixed(1)}</span>`;
    li.onclick = () => { renderResult(item); show("result"); };
    $("#history").appendChild(li);
  }
  renderChart(items.slice().reverse());
}

function renderChart(items) {
  $("#progress-card").hidden = items.length < 2;
  if (items.length < 2) return;
  const W = 320, H = 120, P = 10;
  const x = (i) => P + (i * (W - 2 * P)) / (items.length - 1);
  const y = (s) => H - P - (s / 10) * (H - 2 * P);
  const pts = items.map((it, i) => `${x(i)},${y(it.result.score)}`).join(" ");
  $("#chart").innerHTML = `
    ${[0, 5, 10].map((v) => `<line x1="${P}" x2="${W - P}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1" vector-effect="non-scaling-stroke"/>`).join("")}
    <polyline points="${pts}" fill="none" stroke="var(--ball)" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    ${items.map((it, i) => `<circle cx="${x(i)}" cy="${y(it.result.score)}" r="3.5" fill="var(--ball)"><title>${STROKE_NAMES[it.stroke]}: ${it.result.score.toFixed(1)}</title></circle>`).join("")}`;
}

// ---------- Nova análise ----------
document.querySelectorAll("#strokes .chip").forEach((chip) => {
  chip.onclick = () => {
    document.querySelectorAll("#strokes .chip").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    state.stroke = chip.dataset.stroke;
  };
});

$("#file").onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  state.file = file;
  const video = $("#preview");
  video.src = URL.createObjectURL(file);
  video.hidden = false;
  $("#analyze").disabled = false;
  $("#upload strong").textContent = "Trocar vídeo";
};

// Extrai quadros espaçados igualmente ao longo do vídeo
async function extractFrames(file, count) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = URL.createObjectURL(file);
  const unreadable = new Error("Não foi possível ler este vídeo neste navegador. Tente gravar de novo ou usar outro navegador.");
  await new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(unreadable), 15000);
    video.onloadeddata = () => { clearTimeout(timer); ok(); };
    video.onerror = () => { clearTimeout(timer); fail(unreadable); };
  });

  const duration = video.duration;
  if (!isFinite(duration) || duration <= 0) throw new Error("Vídeo sem duração válida.");
  const scale = Math.min(1, FRAME_WIDTH / video.videoWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const ctx = canvas.getContext("2d");

  const frames = [];
  for (let i = 0; i < count; i++) {
    const t = (duration * (i + 0.5)) / count;
    await new Promise((ok, fail) => {
      const timer = setTimeout(() => fail(unreadable), 8000);
      video.onseeked = () => { clearTimeout(timer); ok(); };
      video.currentTime = t;
    });
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    frames.push(canvas.toDataURL("image/jpeg", 0.75));
  }
  URL.revokeObjectURL(video.src);
  return frames;
}

$("#analyze").onclick = async () => {
  if (!state.file) return;
  const level = $("#level").value;
  const hand = $("#hand").value;
  show("loading");
  $("#frames").innerHTML = "";
  $("#loading-step").textContent = "Extraindo quadros do vídeo";

  try {
    const frames = await extractFrames(state.file, FRAME_COUNT);
    $("#frames").innerHTML = frames.map((f) => `<img alt="" src="${f}">`).join("");
    $("#loading-step").textContent = "O treinador de IA está avaliando cada fase do golpe…";

    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stroke: state.stroke, level, hand, frames }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erro na análise.");

    const item = { id: Date.now(), date: Date.now(), stroke: state.stroke, level, hand, thumb: frames[Math.floor(frames.length / 2)], result: data };
    if (data.stroke_detected !== false) saveHistory([item, ...loadHistory()]);
    renderResult(item);
    show("result");
  } catch (err) {
    show("new");
    const box = document.createElement("p");
    box.className = "error";
    box.textContent = err.message;
    $("#view-new").prepend(box);
    setTimeout(() => box.remove(), 6000);
  }
};

// ---------- Resultado ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function renderResult(item) {
  const r = item.result;
  const C = 2 * Math.PI * 46;
  const pct = Math.max(0, Math.min(10, r.score)) / 10;
  const color = scoreColor(r.score);

  $("#result").innerHTML = `
    <div class="card">
      <div class="score-head">
        <div class="ring">
          <svg viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="46" fill="none" stroke="var(--surface-2)" stroke-width="8"/>
            <circle cx="50" cy="50" r="46" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round"
              stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/>
          </svg>
          <div class="val"><div>${r.score.toFixed(1)}<small>de 10</small></div></div>
        </div>
        <div>
          <h2>${STROKE_NAMES[item.stroke]}</h2>
          <p>${esc(r.summary)}</p>
          ${r.demo ? '<p style="margin-top:8px"><span class="badge">Modo demonstração</span></p>' : ""}
        </div>
      </div>
    </div>

    ${r.stroke_detected === false ? "" : `
    <div class="card">
      <h3>As 3 correções mais importantes</h3>
      ${(r.fixes || []).slice(0, 3).map((f, i) => `
        <div class="fix">
          <div class="n">${i + 1}</div>
          <div>
            <h4>${esc(f.title)}</h4>
            <p><b>Por quê:</b> ${esc(f.why)}</p>
            <p><b>Como corrigir:</b> ${esc(f.how)}</p>
          </div>
        </div>`).join("")}
    </div>

    <div class="card">
      <h3>Exercícios recomendados</h3>
      ${(r.drills || []).map((d) => `
        <div class="drill"><b>${esc(d.name)}</b><p>${esc(d.description)}</p><small>${esc(d.reps)}</small></div>`).join("")}
    </div>

    <div class="card">
      <h3>Fase por fase</h3>
      ${(r.phases || []).map((p) => `
        <div class="phase">
          <div class="bar-row"><span>${esc(p.name)}</span><span style="color:${scoreColor(p.score)}">${Number(p.score).toFixed(1)}</span></div>
          <div class="bar"><i style="width:${Math.max(0, Math.min(10, p.score)) * 10}%;background:${scoreColor(p.score)}"></i></div>
          <p>${esc(p.feedback)}</p>
        </div>`).join("")}
    </div>

    ${(r.strengths || []).length ? `
    <div class="card">
      <h3>Pontos fortes</h3>
      <ul class="strengths">${r.strengths.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
    </div>` : ""}`}`;
}

show("home");
