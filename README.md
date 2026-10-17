# Raquete AI

Treinador de tênis com IA (inspirado no AceCue). Grave um golpe (saque, forehand, backhand, voleio ou smash) e receba:

- nota de 0 a 10
- as 3 correções mais importantes
- exercícios para corrigir
- análise fase por fase
- histórico e gráfico de evolução, salvos na sua conta

## Colocar no ar (Render)

1. Crie uma conta em https://render.com (pode entrar com o GitHub).
2. No painel, clique em **New > Blueprint** e escolha o repositório `raquete-ai`.
3. Quando pedir `ANTHROPIC_API_KEY`, cole sua chave (crie em https://console.anthropic.com/).
4. Clique em **Apply**. Em alguns minutos o Render mostra o link do app (algo como `https://raquete-ai.onrender.com`).

O `render.yaml` cria o site e um banco Postgres gratuitos. Observações do plano grátis:
- o site "dorme" após 15 minutos sem uso e leva uns 30 a 60 segundos para acordar;
- o banco grátis do Render expira após 30 dias. Para algo permanente, use o plano pago do banco
  ou um Postgres grátis do Neon (https://neon.tech): copie a URL de conexão e coloque em `DATABASE_URL`.

## Rodar no computador

```bash
npm install
ANTHROPIC_API_KEY=sua-chave npm start
```

Abra http://localhost:3000. Sem `DATABASE_URL`, os dados ficam em `data/db.json`. Sem `ANTHROPIC_API_KEY`, o app funciona em **modo demonstração** (análise de exemplo).

## Configurações

| Variável | Para que serve |
| --- | --- |
| `ANTHROPIC_API_KEY` | Chave da IA (Claude). Sem ela, modo demonstração. |
| `DATABASE_URL` | Banco Postgres. Sem ela, usa o arquivo `data/db.json`. |
| `DAILY_ANALYSIS_LIMIT` | Máximo de análises por usuário por dia (padrão 20), para controlar custos. |

## Como funciona

1. O usuário cria uma conta (e-mail e senha) e entra.
2. O navegador extrai 10 quadros do vídeo (o vídeo não é enviado inteiro).
3. O servidor (`server.js`) envia os quadros ao Claude, que devolve a análise em JSON.
4. A análise é salva no banco, na conta do usuário (`db.js`).
