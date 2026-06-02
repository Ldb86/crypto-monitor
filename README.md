# Crypto Monitor - Microservices Architecture

Progetto organizzato per deploy su Railway con microservizi indipendenti.

## 📁 Project Structure

```text
crypto-monitor/
├── services/
│   ├── BR/                         # Range Box Breakout Bot - Node.js
│   │   ├── index.js
│   │   └── package.json
│   ├── breakTriangle/              # Triangle Breakout Bot - Node.js
│   │   ├── index.js
│   │   └── package.json
│   ├── bandaBellinger/             # EMA5 x Bollinger Bands Bot - Node.js
│   │   ├── index.js
│   │   └── package.json
│   └── maradona-java-brain/        # Maradona Brain + Pelé Execution - Java Spring Boot
│       ├── Dockerfile              # obbligatorio per Railway
│       ├── build.gradle
│       ├── settings.gradle
│       ├── README.md
│       ├── .env.example
│       └── src/
├── shared/
├── utils/
├── .env.example                    # solo template, non mettere token veri
├── .gitignore
├── package.json                    # progetto Node principale
└── README.md
```

---

## 🚀 Quick Start locale

Ogni servizio gira in modo indipendente.

### Node services

```bash
cd services/BR
npm install
npm start
```

```bash
cd services/breakTriangle
npm install
npm start
```

```bash
cd services/bandaBellinger
npm install
npm start
```

### Maradona Java Brain

Per Maradona usare la cartella:

```bash
cd services/maradona-java-brain
```

Se hai Gradle installato localmente:

```bash
gradle clean build -x test
java -jar build/libs/*.jar
```

Su Railway invece **non usare `gradle bootRun` come Start Command**, perché il container può non avere Gradle installato. Per Railway usiamo il `Dockerfile`.

---

## 🧠 Service 4 — Maradona Java Brain

### Location

```text
services/maradona-java-brain
```

### Scopo

Servizio Java Spring Boot che riceve alert TradingView, valida il segnale con logica Maradona/Pelé e invia notifiche Telegram più pulite.

Flusso operativo:

```text
TradingView Alert JSON
→ Railway Webhook
→ Java Maradona Brain
→ TP Guard / Entry Range / No Chase / Protect
→ Telegram
```

### Funzioni attuali

```text
READY / MASTER / WARNING / PROTECT / FLIP
TP Guard direzionale
Entry Range
No Chase
Validazione TP incoerenti
Filtro segnali TradingView
Preparazione integrazione Bybit flow
```

### Variabili ambiente per Railway

Impostare nel service Railway, sezione **Variables**:

```env
TV_WEBHOOK_SECRET=una_password_segreta
SYMBOLS=BTCUSDT,ETHUSDT
TELEGRAM_BOT_TOKEN=token_bot_telegram
TELEGRAM_CHAT_ID=chat_id_o_gruppo
BYBIT_WS_URL=wss://stream.bybit.com/v5/public/linear
BYBIT_BASE_URL=https://api.bybit.com
PORT=8080
```

Non caricare mai `.env` con token veri su GitHub. Usare solo `.env.example`.

---

## 🚢 Railway Deployment

Ogni bot deve essere un **Railway service separato**.

### Node services

Per i servizi Node puoi usare Start Command tipo:

```bash
cd services/BR && npm install && npm start
```

```bash
cd services/breakTriangle && npm install && npm start
```

```bash
cd services/bandaBellinger && npm install && npm start
```

---

## 🚢 Railway Deployment — Maradona Java Brain

Per Maradona Java NON usare il progetto Node principale e NON usare `node $START_CMD`.

Nel service Railway dedicato a Maradona impostare:

### 1. Repository

Repo GitHub:

```text
crypto-monitor
```

### 2. Root Directory

Fondamentale:

```text
services/maradona-java-brain
```

Se la root directory è vuota, Railway prova a deployare il progetto Node principale e nei log si vedono messaggi tipo:

```text
crypto-monitor@1.0.0 start
node $START_CMD
```

Questo significa che NON sta partendo Maradona Java.

### 3. Dockerfile

Dentro `services/maradona-java-brain` deve esistere un file chiamato:

```text
Dockerfile
```

Contenuto consigliato:

```dockerfile
FROM gradle:8.7-jdk17 AS build

WORKDIR /app

COPY . .

RUN gradle clean build -x test

FROM eclipse-temurin:17-jre

WORKDIR /app

COPY --from=build /app/build/libs/*.jar app.jar

ENV PORT=8080
EXPOSE 8080

CMD ["java", "-jar", "app.jar"]
```

### 4. Build Command e Start Command

Nel service Railway Maradona lasciare vuoti:

```text
Build Command = vuoto
Start Command = vuoto
```

Il Dockerfile gestisce build e avvio.

Se invece Railway mostra questo errore:

```text
/bin/bash: line 1: gradle: command not found
```

vuol dire che sta usando un comando manuale `gradle ...` fuori dal Dockerfile. Svuotare Build/Start Command oppure verificare che il Dockerfile sia nella root directory corretta.

### 5. Deploy

Dopo ogni modifica:

```bash
git add services/maradona-java-brain
git commit -m "Update Maradona Java Brain service"
git push
```

Con autodeploy attivo, Railway riparte automaticamente. Altrimenti usare:

```text
Deploy Latest Commit
```

### 6. Log corretti attesi

Nei log del service Maradona NON devi vedere:

```text
npm install
npm start
node $START_CMD
crypto-monitor@1.0.0
```

Devi vedere qualcosa tipo:

```text
Using Dockerfile
FROM gradle:8.7-jdk17
gradle clean build -x test
java -jar app.jar
Spring Boot started
```

---

## 🔗 Webhook TradingView

Quando il dominio Railway è attivo, TradingView dovrà inviare gli alert al webhook Java.

Esempio URL:

```text
https://TUO-SERVICE.up.railway.app/webhook/tradingview
```

Il messaggio TradingView dovrà essere JSON, non solo `MARADONA ALERT`.

Esempio:

```json
{
  "secret": "TV_WEBHOOK_SECRET",
  "pair": "ETHUSDT.P",
  "tf": "30",
  "signal": "MASTER_SHORT",
  "entry": 2069.60,
  "sl": 2140.00,
  "tp1": 2044.02,
  "tp2": 2010.02,
  "entryType": "BREAKDOWN_CONFIRM",
  "compression": "NO"
}
```

---

## 🧪 Diagnosi errori Railway

### Errore: `gradle: command not found`

Causa:

```text
Railway sta provando a eseguire Gradle fuori da Dockerfile.
```

Soluzione:

```text
1. Aggiungere Dockerfile in services/maradona-java-brain
2. Root Directory = services/maradona-java-brain
3. Build Command vuoto
4. Start Command vuoto
5. Redeploy
```

### Errore: parte Node invece di Java

Log tipico:

```text
crypto-monitor@1.0.0 start
node $START_CMD
```

Soluzione:

```text
Root Directory sbagliata. Impostare services/maradona-java-brain.
```

### Errore generico Build image failed

Aprire:

```text
Build Logs
```

e controllare le righe rosse. Lo screenshot Details non basta.

---

## 📝 Notes

- I servizi Node e Maradona Java sono separati.
- Il Java Maradona non deve stare dentro un `index.js`.
- `services/maradona(v18.3.8)` può restare come vecchia cartella, ma non va usata per il service Java.
- Il service corretto è `services/maradona-java-brain`.
- I segreti vanno su Railway Variables, non su GitHub.
- Versione Maradona Java attuale: `v0.4 entry-range-protect`.
- Versione Pine/TradingView attuale: `V18.3.8 CLEAN ALERTS READY MASTER`.

---

**Version**: 1.1.0  
**Last Updated**: June 2026
