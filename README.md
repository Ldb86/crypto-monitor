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
│   └── bandaBellinger/              # EMA5 x Bollinger Bands Bot
│       ├── index.js
│       └── package.json
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
```

### Environment Setup

Create `.env` file in project root:

```env
BOT_TOKENS=token1,token2,token3
CHAT_IDS=chatid1,chatid2,chatid3
PORT=3000
```

Each service can use different ports by setting PORT env var.

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

## 🚢 Railway Deployment

Each service is deployed as a **separate Railway service**:

1. Create 3 Railway services (one for each bot)
2. Connect each to the GitHub repository
3. Set **Custom Start Command** for each:

```bash
# BR Service
cd services/BR && npm install && npm start

# breakTriangle Service
cd services/breakTriangle && npm install && npm start

# bandaBellinger Service
cd services/bandaBellinger && npm install && npm start
```

✅ Add **environment variables** in Railway dashboard:
- `BOT_TOKENS`
- `CHAT_IDS`
- `PORT` (use different ports per service, or auto-assign)

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
