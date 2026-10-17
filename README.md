# Raquete AI

Treinador de tênis com IA (inspirado no AceCue). Grave um golpe (saque, forehand, backhand, voleio ou smash) e receba:

- nota de 0 a 10
- as 3 correções mais importantes
- exercícios para corrigir
- análise fase por fase
- histórico e gráfico de evolução (salvos no aparelho)

## Como rodar

```bash
npm install
ANTHROPIC_API_KEY=sua-chave npm start
```

Abra http://localhost:3000. Sem a chave, o app funciona em **modo demonstração** (com uma análise de exemplo).

Pegue sua chave em https://console.anthropic.com/.

## Como funciona

1. O navegador extrai 10 quadros do vídeo (o vídeo não é enviado inteiro).
2. O servidor (`server.js`) envia os quadros ao Claude, que devolve a análise em JSON.
3. O app mostra o resultado e salva no histórico do aparelho.
