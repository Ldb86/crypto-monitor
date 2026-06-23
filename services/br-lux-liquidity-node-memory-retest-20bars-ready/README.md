# BR + TL + Liquidity 2/3 — memoria rotture e retest

Servizio Node.js per Visual Studio Code e Railway. Non dipende da TradingView: usa candele Bybit, replica la TL LuxAlgo, legge order book/trade Bybit + Binance + OKX, costruisce Auto Cluster e calcola S/R EzAlgo separati per ogni timeframe.

## Regola di notifica

I tre pilastri sono:

1. **Range Box 20 — rottura fresca** LONG o SHORT;
2. **TL — rottura fresca** `UPPER_BREAK` o `LOWER_BREAK`;
3. **Liquidity** confermata da almeno 2 exchange su 3.

Telegram parte quando almeno **2 pilastri freschi su 3** concordano nella stessa direzione.

| Range | TL | Liquidity | Esito |
|---|---|---|---|
| ✅ LONG | ❌/🟡 storico | ✅ LONG | notifica LONG 2/3 |
| ❌/🟡 storico | ✅ SHORT | ✅ SHORT | notifica SHORT 2/3 |
| ✅ LONG | ✅ LONG | ❌ contraria/neutra | notifica LONG 2/3 con warning liquidity |
| ✅ SHORT | ✅ SHORT | ✅ SHORT | conferma completa SHORT 3/3 |
| solo un pilastro fresco | — | — | nessuna notifica |

## Memoria aggiunta

Per ogni `simbolo + timeframe + direzione` il motore ricostruisce e conserva:

- ultima rottura TL;
- ultima rottura Range Box;
- candela, ora, livello e close della rottura;
- numero di candele trascorse;
- stato: `fresh`, `recent`, `retest_confirmed`, `invalidated`, `expired`, `missing`.

La memoria predefinita è di **20 candele per ciascun timeframe**. Quindi 20 candele 3m, 20 candele 5m, 20 candele 15m ecc. restano completamente separate.

### Retest

Un retest viene confermato soltanto quando:

1. la rottura è già avvenuta;
2. il prezzo si è allontanato dal livello;
3. torna entro la tolleranza configurata;
4. richiude nuovamente nella direzione della rottura.

Con `COUNT_RETEST_AS_PILLAR=false` — impostazione consigliata — rotture recenti e retest compaiono in **giallo** nel messaggio, ma non vengono contati come una nuova spunta verde.

Esempio:

```text
TL ✅ SHORT — ROTTURA FRESCA
RANGE BOX 🟡 SHORT — ROTTO 7 CANDELE FA, RETEST CONFERMATO
LIQUIDITY ✅ 2/3 SHORT
```

## Invalidazione

Una vecchia rottura viene marcata `invalidated` quando il prezzo chiude stabilmente dal lato opposto. Default:

```env
BREAK_INVALIDATION_CLOSES=2
BREAK_INVALIDATION_TOLERANCE_PCT=0.05
```

Per la TL, un nuovo pivot dello stesso lato resetta la vecchia rottura come nel Pine LuxAlgo originale.

## Pivot/S&R EzAlgo

- `left=50`;
- `right=25`;
- `quick_right=5`;
- R1/R2/R3 sopra e S1/S2/S3 sotto;
- calcolo indipendente per ogni timeframe;
- warning fake break, mai blocco del messaggio.

## Endpoint

```text
GET /status
GET /clusters/BTCUSDT
GET /lux-audit/BTCUSDT/5m
GET /sr-audit/BTCUSDT/5m
GET /memory-audit/BTCUSDT/5m
POST /scan-now
```

L’endpoint `/memory-audit` mostra gli stati LONG e SHORT di TL e Range Box, con età, retest e invalidazioni.

## Avvio

```bash
npm install
npm run check
npm start
```

## Railway

- start command: `npm start`;
- healthcheck: `/status`;
- copia le variabili da `.env.example` nelle Variables;
- non caricare il file `.env` reale su GitHub.
