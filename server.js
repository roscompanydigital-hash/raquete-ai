import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { fileURLToPath } from "node:url";
import path from "node:path";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import { createStore } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const HAS_KEY = Boolean(process.env.ANTHROPIC_API_KEY);
const client = HAS_KEY ? new Anthropic() : null;
const DAILY_LIMIT = Number(process.env.DAILY_ANALYSIS_LIMIT || 20);
const IS_PROD = process.env.NODE_ENV === "production";
const COOKIE = "raquete_session";
const store = createStore();

const STROKES = {
  serve: "saque",
  forehand: "forehand",
  backhand: "backhand",
  volley: "voleio",
  smash: "smash",
};

const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["stroke_detected", "score", "summary", "strengths", "fixes", "drills", "phases"],
  properties: {
    stroke_detected: {
      type: "boolean",
      description: "false se os quadros não mostram claramente uma pessoa executando o golpe",
    },
    score: { type: "number", description: "Nota geral de 0 a 10, com uma casa decimal" },
    summary: { type: "string", description: "Resumo de 1 a 2 frases" },
    strengths: { type: "array", items: { type: "string" } },
    fixes: {
      type: "array",
      description: "Exatamente as 3 correções mais importantes, da mais importante para a menos",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "why", "how"],
        properties: {
          title: { type: "string" },
          why: { type: "string" },
          how: { type: "string" },
        },
      },
    },
    drills: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "description", "reps"],
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          reps: { type: "string" },
        },
      },
    },
    phases: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "score", "feedback"],
        properties: {
          name: { type: "string" },
          score: { type: "number" },
          feedback: { type: "string" },
        },
      },
    },
  },
};

const SYSTEM = `Você é um treinador de tênis experiente e certificado. Você recebe quadros (frames) extraídos em ordem de um vídeo curto de um aluno executando um golpe e devolve uma análise técnica em português do Brasil.

Como avaliar:
- Divida o golpe em fases (por exemplo, para o saque: posição inicial, lançamento da bola, troféu/carregamento, aceleração e contato, terminação). Dê uma nota de 0 a 10 para cada fase.
- A nota geral (0 a 10) reflete a técnica para o nível declarado do aluno. 5 é um golpe funcional com falhas claras, 8 ou mais é técnica sólida de competição.
- As 3 correções devem ser específicas e visíveis nos quadros, não conselhos genéricos. Diga o que está errado, por que isso atrapalha e como corrigir com uma pista simples.
- Sugira de 2 a 4 exercícios que atacam diretamente essas correções, com séries/repetições.
- Os quadros são poucos e de baixa resolução: não invente detalhes que não dá para ver. Se algo não estiver visível, diga isso na fase correspondente.
- Se os quadros não mostrarem uma pessoa executando um golpe de tênis, marque stroke_detected como false, use score 0 e explique no summary como gravar melhor.`;

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "25mb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// Descobre o usuário logado pelo cookie de sessão
app.use(wrap(async (req, _res, next) => {
  const token = req.cookies[COOKIE];
  req.user = token ? await store.getSessionUser(token) : null;
  next();
}));

const requireUser = (req, res, next) =>
  req.user ? next() : res.status(401).json({ error: "Faça login para continuar." });

async function startSession(res, userId) {
  const token = await store.createSession(userId);
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: IS_PROD, maxAge: 30 * 864e5 });
}

app.get("/api/status", (req, res) => res.json({ ai: HAS_KEY, user: req.user }));

// ---------- Contas ----------
const normEmail = (e) => String(e || "").trim().toLowerCase();

app.post("/api/signup", wrap(async (req, res) => {
  const email = normEmail(req.body?.email);
  const name = String(req.body?.name || "").trim().slice(0, 60);
  const password = String(req.body?.password || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "E-mail inválido." });
  if (!name) return res.status(400).json({ error: "Informe seu nome." });
  if (password.length < 8) return res.status(400).json({ error: "A senha precisa ter pelo menos 8 caracteres." });

  const user = await store.createUser({ email, name, passwordHash: await bcrypt.hash(password, 10) });
  if (!user) return res.status(409).json({ error: "Já existe uma conta com este e-mail. Faça login." });
  await startSession(res, user.id);
  res.json({ user: { id: user.id, email: user.email, name: user.name } });
}));

app.post("/api/login", wrap(async (req, res) => {
  const user = await store.getUserByEmail(normEmail(req.body?.email));
  const ok = user && (await bcrypt.compare(String(req.body?.password || ""), user.password_hash));
  if (!ok) return res.status(401).json({ error: "E-mail ou senha incorretos." });
  await startSession(res, user.id);
  res.json({ user: { id: user.id, email: user.email, name: user.name } });
}));

app.post("/api/logout", wrap(async (req, res) => {
  if (req.cookies[COOKIE]) await store.deleteSession(req.cookies[COOKIE]);
  res.clearCookie(COOKIE);
  res.json({ ok: true });
}));

// ---------- Histórico ----------
app.get("/api/analyses", requireUser, wrap(async (req, res) => {
  res.json({ analyses: await store.listAnalyses(req.user.id) });
}));

app.delete("/api/analyses/:id", requireUser, wrap(async (req, res) => {
  const ok = await store.deleteAnalysis(req.user.id, Number(req.params.id));
  res.status(ok ? 200 : 404).json({ ok });
}));

// ---------- Análise ----------
app.post("/api/analyze", requireUser, wrap(async (req, res) => {
  const { stroke, level, hand, frames, thumb } = req.body ?? {};
  if (!STROKES[stroke] || !Array.isArray(frames) || frames.length === 0 || frames.length > 16) {
    return res.status(400).json({ error: "Envie o tipo de golpe e de 1 a 16 quadros do vídeo." });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if ((await store.countAnalysesSince(req.user.id, today)) >= DAILY_LIMIT) {
    return res.status(429).json({ error: `Você atingiu o limite de ${DAILY_LIMIT} análises por dia. Volte amanhã!` });
  }

  const save = async (result) => {
    if (result.stroke_detected === false) return res.json({ result });
    const safeThumb = typeof thumb === "string" && thumb.startsWith("data:image/") && thumb.length < 60000 ? thumb : null;
    res.json(await store.addAnalysis(req.user.id, { stroke, level, hand, thumb: safeThumb, result }));
  };

  if (!HAS_KEY) return save({ ...demoAnalysis(stroke), demo: true });

  const content = frames.map((dataUrl) => ({
    type: "image",
    source: { type: "base64", media_type: "image/jpeg", data: String(dataUrl).replace(/^data:image\/\w+;base64,/, "") },
  }));
  content.push({
    type: "text",
    text: `Golpe: ${STROKES[stroke]}. Nível do aluno: ${level || "não informado"}. Mão dominante: ${hand || "não informada"}.
Os ${frames.length} quadros acima estão em ordem cronológica. Analise o golpe.`,
  });

  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: ANALYSIS_SCHEMA },
      },
      system: SYSTEM,
      messages: [{ role: "user", content }],
    });

    if (response.stop_reason === "refusal") {
      return res.status(422).json({ error: "A IA não conseguiu analisar este vídeo. Tente outro vídeo." });
    }
    const text = response.content.find((b) => b.type === "text")?.text;
    if (!text) throw new Error(`Resposta sem texto (stop_reason: ${response.stop_reason})`);
    await save(JSON.parse(text));
  } catch (err) {
    console.error(err);
    const status = err instanceof Anthropic.RateLimitError ? 429 : 502;
    res.status(status).json({ error: "Falha ao analisar o vídeo. Tente novamente em instantes." });
  }
}));

function demoAnalysis(stroke) {
  const score = Math.round((5.5 + Math.random() * 2.5) * 10) / 10;
  return {
    stroke_detected: true,
    score,
    summary: `Análise de demonstração do ${STROKES[stroke]}. Configure a chave da API para receber uma análise real do seu vídeo.`,
    strengths: ["Boa base de apoio antes do golpe", "Olhar fixo na bola até o contato"],
    fixes: [
      { title: "Prepare a raquete mais cedo", why: "A preparação tardia faz você bater atrasado e perder controle.", how: "Gire os ombros assim que identificar o lado da bola." },
      { title: "Contato à frente do corpo", why: "Bater ao lado do corpo tira potência e direção.", how: "Imagine que o contato acontece um passo à frente do pé da frente." },
      { title: "Termine o movimento", why: "Parar a raquete no contato desacelera o golpe antes da hora.", how: "Leve a raquete até o ombro oposto em todo golpe." },
    ],
    drills: [
      { name: "Sombra com pausa", description: "Faça o movimento sem bola, pausando 2 segundos na preparação.", reps: "3 séries de 10" },
      { name: "Alimentação na mão", description: "Um parceiro joga a bola com a mão e você foca no contato à frente.", reps: "3 séries de 15 bolas" },
    ],
    phases: [
      { name: "Preparação", score: Math.min(10, score + 0.5), feedback: "Boa postura, mas a rotação de ombros começa tarde." },
      { name: "Contato", score: Math.max(0, score - 0.8), feedback: "O contato acontece um pouco atrás do ideal." },
      { name: "Terminação", score, feedback: "Terminação curta; complete o movimento." },
    ],
  };
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Erro interno. Tente novamente." });
});

await store.init();
app.listen(PORT, () => {
  console.log(`Raquete AI rodando em http://localhost:${PORT} (banco: ${store.kind})${HAS_KEY ? "" : " (modo demonstração: defina ANTHROPIC_API_KEY)"}`);
});
