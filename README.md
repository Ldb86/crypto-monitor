# Crypto Monitor - Microservices Architecture

Complete restructure of the crypto-monitor project for Railway deployment with independent microservices.

## 📁 Project Structure

```
crypto-monitor/
├── services/
│   ├── BR/                          # Range Box Breakout Bot
│   │   ├── index.js
│   │   └── package.json
│   ├── breakTriangle/               # Triangle Breakout Bot
│   │   ├── index.js
│   │   └── package.json
│   ├── bandaBellinger/              # EMA5 x Bollinger Bands Bot
│   │   ├── index.js
│   │   └── package.json
│   └── maradona-java-brain/           # Elite Hybrid Bot (Java Spring Boot)
│       ├── build.gradle
│       └── README.md
├── shared/
│   ├── utils/                       # Shared utilities
│   └── otherFiles/                  # Backup files
├── .env.example                     # Environment template
├── .gitignore
└── README.md
```

## 🚀 Quick Start

### Prerequisites
- Node.js 18.x
- npm
- Java 21 (for `services/maradona-java-brain`)
- `.env` file with BOT_TOKENS and CHAT_IDS

### Installation & Run Locally

Each service runs independently:

```bash
# Service 1 - Range Box Breakout
cd services/BR
npm install
npm start

# Service 2 - Triangle Breakout (in another terminal)
cd services/breakTriangle
npm install
npm start

# Service 3 - Banda Bellinger (in another terminal)
cd services/bandaBellinger
npm install
npm start

# Service 4 - Maradona (in another terminal)
cd services/maradona-java-brain
gradle bootRun
```

### Environment Setup

Create a `.env` file in the project root for the Node.js services:

```env
BOT_TOKENS=token1,token2,token3
CHAT_IDS=chatid1,chatid2,chatid3
PORT=3000
```

The Java service `services/maradona-java-brain` uses Railway environment variables defined in its own `README.md`:

- `TV_WEBHOOK_SECRET`
- `SYMBOLS`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `BYBIT_WS_URL`

Each service can use different ports by setting `PORT`.

## 🔧 Services

### 1. **BR Service** (Range Box Breakout)
- **Location**: `services/BR`
- **Description**: Detects breakouts from range boxes (last 20 candles)
- **Uses**: MACD, EMA indicators
- **Start**: `npm install && npm start`
- **Port**: 3000 (or PORT env var)

### 2. **breakTriangle Service** (Triangle Breakout)
- **Location**: `services/breakTriangle`
- **Description**: Detects triangle pattern breakouts real-time
- **Uses**: Triangle patterns, EMA, Bollinger Bands
- **Start**: `npm install && npm start`
- **Port**: 3000 (or PORT env var)

### 3. **bandaBellinger Service** (EMA5 x Bollinger)
- **Location**: `services/bandaBellinger`
- **Description**: EMA5 and Bollinger Bands crosses
- **Uses**: EMA-5, Bollinger Bands
- **Start**: `npm install && npm start`
- **Port**: 3000 (or PORT env var)

### 4. **maradona-java-brain Service** (Elite Hybrid Bot)
- **Location**: `services/maradona-java-brain`
- **Description**: Java Spring Boot service that validates TradingView alerts with Bybit market flow before sending Telegram notifications
- **Uses**: TradingView webhook, Bybit WebSocket, Telegram notifications
- **Start**: `gradle bootRun`
- **Port**: 3000 (or `PORT` env var)

## 🚢 Railway Deployment

Each service is deployed as a **separate Railway service**:

1. Create 4 Railway services (one for each bot)
2. Connect each to the GitHub repository
3. Set **Custom Start Command** for each:

```bash
# BR Service
cd services/BR && npm install && npm start

# breakTriangle Service
cd services/breakTriangle && npm install && npm start

# bandaBellinger Service
cd services/bandaBellinger && npm install && npm start

# maradona-java-brain Service
cd services/maradona-java-brain && gradle bootRun
```

✅ Add **environment variables** in Railway dashboard:
- `BOT_TOKENS`
- `CHAT_IDS`
- `PORT` (use different ports per service, or auto-assign)
- `TV_WEBHOOK_SECRET` (for `maradona-java-brain`)
- `SYMBOLS` (for `maradona-java-brain`)
- `TELEGRAM_BOT_TOKEN` (for `maradona-java-brain`)
- `TELEGRAM_CHAT_ID` (for `maradona-java-brain`)
- `BYBIT_WS_URL` (for `maradona-java-brain`)

## 📊 Key Features

✓ **Independent Services**: Each bot runs in its own process
✓ **Real-time Alerts**: Telegram notifications on signal detection
✓ **Bybit API Integration**: Live market data
✓ **Multiple Indicators**: EMA, MACD, Bollinger Bands, Triangle Patterns
✓ **Anti-spam**: Prevents duplicate alerts
✓ **Production Ready**: Error handling and logging

## 🔍 Monitoring

Each service logs to console:

```
[HH:MM:SS] 🚀 Server avviato su porta 3000
[HH:MM:SS] 🔺 CONFIRMED BTC[4h] LONG | close=$...
[HH:MM:SS] 📬 Telegram BTC[4h]
```

Check Railway logs for real-time monitoring.

## 📝 Notes

- **Logica Inalterata**: All original bot logic is preserved
- **Dependencies**: axios, express, dotenv, technicalindicators
- **Node Version**: 18.x (set in package.json engines)
- **Database**: None required (stateless services)

## 🛠️ Customization

Modify parameters in each service's `index.js`:
- Timeframes: `intervals`, `intervalMap`
- Indicators: periods, standard deviations
- Risk management: TP/SL calculations
- Telegram: multi-account support via token arrays

## 📞 Support

For issues:
1. Check `.env` configuration
2. Verify Telegram tokens and chat IDs
3. Check Bybit API availability
4. Review service logs for errors

---

**Version**: 1.0.0  
**Last Updated**: April 2026
