# Maradona Java Brain — V0.2 Alert Sync

Questo server fonde:

- TradingView V18.3.5+ = PRE / READY / MASTER / WARNING / FLIP
- Bybit WebSocket = orderbook reale + public trades + delta proxy
- Telegram = notifica finale ENTRY VALIDATA / BLOCCATA / WARNING

## Variabili Railway

```text
TV_WEBHOOK_SECRET=scegli-tu
SYMBOLS=ETHUSDT,BTCUSDT
TELEGRAM_BOT_TOKEN=token_bot
TELEGRAM_CHAT_ID=chat_id
BYBIT_WS_URL=wss://stream.bybit.com/v5/public/linear
```

## Webhook TradingView

URL:

```text
https://TUO-SERVER.up.railway.app/webhook/tradingview
```

Metodo: POST JSON.

## Messaggio JSON consigliato negli alert Pine/TradingView

Quando colleghiamo TradingView a Java, il messaggio deve essere JSON, non solo `MARADONA ALERT`.

```json
{
  "secret":"scegli-tu",
  "symbol":"{{ticker}}",
  "tf":"{{interval}}",
  "signal":"MASTER_SHORT",
  "side":"SHORT",
  "entry":2078.48,
  "entryRangeLow":2078.48,
  "entryRangeHigh":2088.50,
  "noChaseBelow":2062.00,
  "sl":2127.84,
  "tp1":2063,
  "tp2":2031,
  "tp3":2007,
  "score":12,
  "brain":"WAIT S 7/3",
  "entryType":"BREAKDOWN_CONFIRM",
  "compression":"SOFT",
  "mtf":"12H SHORT",
  "htf":"HTF BEAR",
  "macd":"MACD SHORT"
}
```

## Cosa fa la V0.2

- PRE / READY = monitor, nessuna entry.
- MASTER = Java confronta con Bybit flow.
- Se Bybit conferma: `ENTRY_VALIDATED_LONG/SHORT`.
- Se Bybit non conferma: `ENTRY_BLOCKED_LONG/SHORT`.
- Dopo MASTER, un PRE opposto diventa `WARNING_PROTECT`, non nuovo trade opposto.
- FLIP viene validato solo se anche Bybit conferma.

## Endpoint stato

```text
GET /webhook/status/ETHUSDT
GET /webhook/status/BTCUSDT
```

## Nota importante

Per ora è modalità decision/notifica. Non apre ordini reali.

## v0.3 Target Guard Update

Questa versione aggiunge il controllo direzionale dei TP ricevuti da TradingView:

- MASTER SHORT: TP1/TP2/TP3 devono stare sotto ENTRY.
- MASTER LONG: TP1/TP2/TP3 devono stare sopra ENTRY.
- Se un TP è dalla parte sbagliata, Telegram mostra `TP VALIDATION` e il Brain non lo considera entry automatica validata: diventa `MASTER WATCH - TP DA CORREGGERE`.
- I TP coerenti vengono riorganizzati da vicino a lontano e mostrati come target suggeriti.

Esempio rilevato nel test:

```text
BTCUSDT.P MASTER SHORT
ENTRY: 76030.4
TP1: 76297.1  <-- invalido perché sopra entry
TP2: 75347.6  <-- valido
TP3: 74398.1  <-- valido
```

Telegram avviserà che TP1 è incoerente e proporrà i TP validi riorganizzati.


## v0.4 Entry Range / No Chase
Java ora accetta anche:
- entryRangeLow / entryRangeHigh
- noChaseAbove / noChaseBelow

Questi campi servono quando perdi una notifica: non devi inseguire il prezzo, ma valutare retest/pullback e livello no-chase.
