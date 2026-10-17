import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const HAS_KEY = Boolean(process.env.ANTHROPIC_API_KEY);
const client = HAS_KEY ? new Anthropic() : null;

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
app.use(express.json({ limit: "25mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/status", (_req, res) => res.json({ ai: HAS_KEY }));

app.post("/api/analyze", async (req, res) => {
  const { stroke, level, hand, frames } = req.body ?? {};
  if (!STROKES[stroke] || !Array.isArray(frames) || frames.length === 0 || frames.length > 16) {
    return res.status(400).json({ error: "Envie o tipo de golpe e de 1 a 16 quadros do vídeo." });
  }

  if (!HAS_KEY) {
    return res.json({ ...demoAnalysis(stroke), demo: true });
  }

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
    res.json(JSON.parse(text));
  } catch (err) {
    console.error(err);
    const status = err instanceof Anthropic.RateLimitError ? 429 : 502;
    res.status(status).json({ error: "Falha ao analisar o vídeo. Tente novamente em instantes." });
  }
});

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

app.listen(PORT, () => {
  console.log(`Raquete AI rodando em http://localhost:${PORT}${HAS_KEY ? "" : " (modo demonstração: defina ANTHROPIC_API_KEY)"}`);
});
