# Maradona Java Brain v0.4.7F - Event-Driven AutoCluster + Forex/TradFi Mode

Baseline di partenza: Java 0.4.7 Event-Driven AutoCluster A/B/C.

## Cosa aggiunge questa variante 0.4.7F

- Mantiene invariata la logica crypto BTC/ETH: Bybit + Binance + OKX con filtro 2-of-3.
- Aggiunge modalita Forex/TradFi separata: `FOREX_MODE=BYBIT_ONLY`.
- Per i simboli forex/TradFi configurati, Binance e OKX non vengono usati per il voto.
- Bybit resta la fonte principale; Java applica score piu severo per compensare il fatto che non c'e il 2/3 multi-exchange.
- READY/PRE/WARNING restano segnali nascosti: svegliano AutoCluster e aggiornano la mappa, ma non mandano Telegram operativo.
- MASTER forex/TradFi manda Telegram solo se Bybit conferma con score minimo e spread entro soglia.

## Variabili principali

```env
FOREX_ENABLED=false
FOREX_MODE=BYBIT_ONLY
FOREX_SYMBOLS=EURUSDT,GBPUSDT,XAUUSDT
FOREX_MIN_BYBIT_SCORE=4
FOREX_MAX_SPREAD_PCT=0.12
FOREX_NOTIFY_REJECTED=false
```

Per attivarlo in test:

```env
FOREX_ENABLED=true
FOREX_SYMBOLS=EURUSDT,GBPUSDT,XAUUSDT
```

Nota: verificare su Bybit che i simboli forex/TradFi scelti siano disponibili nello stesso stream/orderbook usato dal servizio. Se Bybit TradFi/MT5 richiede endpoint diverso, il codice e' gia separato logicamente ma servirà un client dati dedicato.

## Log da controllare

Crypto:

```text
Liquidity: CONFIRMED_2_OF_3
Liquidity: REJECTED_2_OF_3
```

Forex/TradFi:

```text
FOREX ENGINE: BYBIT_ONLY CONFERMA
FOREX_BYBIT_ONLY_CONFIRMED
FOREX NON NOTIFICATO
FOREX_WAIT_BYBIT
FOREX_SPREAD_BLOCKED
```

## Regola operativa

- Crypto: 2/3 exchange = conferma.
- Forex/TradFi: Bybit-only con soglia severa, piu AutoCluster, pivot stimato, SL retail stimato e no-chase.
- In futuro: aggiungere Dukascopy e poi FXCM/OANDA se accessibili per creare `FOREX_CONFIRMED_2_OF_3`.

## v0.4.7D-F - Retail Liquidity Pool vs Our SL Fix

Questa patch corregge la logica della mappa operativa AutoCluster:

- `Retail liquidity pool` = zona dove probabilmente stanno gli stop retail da cacciare/sweeppare.
- `SL TradingView` = stop ricevuto dal payload TradingView.
- `Our SL protettivo stimato` = livello informativo oltre la liquidity pool, con buffer.

Regola operativa:

- LONG: il nostro SL non deve coincidere con la massa degli stop retail; deve stare sotto il retail liquidity pool con buffer.
- SHORT: il nostro SL non deve coincidere con la massa degli stop retail; deve stare sopra il retail liquidity pool con buffer.
- Se lo SL TradingView coincide o è troppo vicino al retail liquidity pool, Telegram stampa un warning.

La patch mantiene:

- Crypto BTC/ETH multi-exchange Bybit + Binance + OKX.
- AutoCluster Event-Driven 0.4.7 A/B/C.
- Forex BYBIT_ONLY 0.4.7F, ancora da testare.
- READY/PRE/WARNING come segnali nascosti/solo Brain se configurati così.

## v0.4.7E/G/I - Patch pulita post-test 16 giugno

Questa patch aggiunge tre correzioni operative emerse dai test Telegram/log:

### 0.4.7E - Telegram Clean Notification Filter

- Telegram invia solo segnali operativi confermati.
- READY/PRE/MONITOR/MICRO_TABLE_RESET/SL_RESET restano log-only.
- MASTER WATCH e MASTER NON CONFERMATO restano log-only di default.
- MASTER_LONG/MASTER_SHORT arrivano solo se liquidity engine conferma 2/3 o 3/3.
- MASTER_PELE_MICRO_GZ_LONG/SHORT arrivano solo se liquidity engine conferma 2/3 o 3/3.

Variabili:

```env
NOTIFY_READY=false
NOTIFY_PRE=false
NOTIFY_WARNING=false
NOTIFY_MONITOR=false
NOTIFY_MICRO_TABLE_RESET=false
NOTIFY_SL_RESET=false
NOTIFY_MASTER_WATCH=false
NOTIFY_MASTER_REJECTED=false
```

### 0.4.7G - AutoCluster 3 above / 3 below

- AutoCluster prova a produrre sempre 3 livelli sopra e 3 sotto.
- Se il book non fornisce abbastanza muri forti, vengono aggiunti livelli fallback a score basso (`PRICE_LADDER_FILL`) solo per completare la mappa operativa.
- I livelli forti da exchange restano prioritari.

### 0.4.7D-2 - Directional Our SL Validation

- LONG: Our SL deve stare sotto entry.
- SHORT: Our SL deve stare sopra entry.
- Se il pool retail è dalla parte sbagliata, non viene usato come stop pool ma come target/protezione informativa.
- Se Our SL non è direzionale, Telegram lo segnala come non valido/non calcolabile.

### 0.4.7I - Manual Coinglass Cluster Hit Alert

Quando un livello manuale impostato con `/setcg` viene raggiunto/toccato, Java invia una notifica una sola volta:

```text
CLUSTER MANUALE RAGGIUNTO / CONSUMATO
PAIR: BTCUSDT
LIVELLO: 65418.0000
TIPO: ABOVE 1
AZIONE: Aggiornare heatmap e /setcg BTC
```

Il livello viene marcato consumato/dirty e non viene notificato di nuovo fino al prossimo `/setcg`.

## v0.4.7J - Duplicate / overlap filter Pelé vs Maradona

Aggiunto filtro anti-doppia esposizione per segnali confermati sullo stesso symbol/timeframe/direzione.
Se un MASTER_PELE_MICRO_GZ e un MASTER Maradona normale arrivano sulla stessa area prezzi, Java non invia una seconda entry completa: invia al massimo una nota breve di confluenza/duplicato.

Variabili:
- NOTIFY_DUPLICATE_OVERLAP=true
- SUPPRESS_DUPLICATE_ENTRIES=true
- DUPLICATE_OVERLAP_WINDOW_MINUTES=90
- DUPLICATE_ENTRY_DISTANCE_PCT=0.30
- DUPLICATE_RANGE_OVERLAP_PCT=50
