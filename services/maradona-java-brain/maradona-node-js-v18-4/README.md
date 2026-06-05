# MARADONA Brain + PELE Execution - Node.js V18.4

Conversione operativa Node.js della logica TradingView/Pine **MARADONA/PELE**.

## Ruolo operativo

- **TradingView** = occhi, grafico, primo trigger e visual.
- **Node.js** = MASTER esterno: ricalcola Brain, valida, conferma, blocca o manda warning.
- **Telegram** = voce operativa pulita.

## Novita V18.4 Node

Aggiunti/aggiornati i moduli:

```text
src/wyckoffEngine.js
src/elliottEngine.js
```

### Wyckoff Core 2.0

Il Node ora legge in modo piu completo:

- Phase A / B / C / D / E
- SC / BC
- AR / AR_DOWN
- ST_LOW / ST_HIGH
- SPRING
- UTAD
- SOS / SOW
- LPS / LPSY
- MARKUP / MARKDOWN
- RE_ACCUMULATION / RE_DISTRIBUTION come bias operativo
- range high / low / mid
- premium / discount
- compressione range

Wyckoff entra nello score ma **non blocca da solo**.

### Elliott Lite

Elliott resta soft:

- impulso bullish/bearish semplificato
- ABC correttivo
- possibile exhaustion wave 5
- score long/short leggero
- warning non bloccante

## Alert

Gli alert Node includono ora righe tipo:

```text
WYCKOFF: PHASE C - SPRING (ACCUMULATION)
ELLIOTT: BULL_IMPULSE_1_2_3_4_5 (LONG)
TP GUARD: OK / CORRECTED
```

## Installazione

```bash
npm install
cp .env.example .env
npm start
```

## Demo locale

```bash
npm run demo
```

## Webhook TradingView / candles

```text
POST /webhook/candle?secret=TUO_WEBHOOK_SECRET
```

Payload esempio:

```json
{
  "symbol": "BTCUSDT",
  "timeframe": "30m",
  "candle": {
    "time": 1710000000000,
    "open": 69000,
    "high": 69500,
    "low": 68800,
    "close": 69300,
    "volume": 1234
  }
}
```

## Config principali

Nel file `src/config.js`:

```js
useWyckoffEngine: true,
wyckoffRangeLen: 100,
wyckoffPivotLen: 6,
wyckoffScoreWeight: 1,

useElliottEngine: true,
elliottSwingLen: 5,
elliottScoreWeight: 1,
```

## Note

Questa versione e pensata per test operativo: Node non disegna il grafico, ma decide e protegge gli alert. TradingView resta utile per vedere zone, label, dashboard e contesto visivo.
