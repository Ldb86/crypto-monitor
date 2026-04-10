# BR Service - Range Box Breakout Bot

Simple but effective range box breakout detector with MACD confirmation.

## Features
- Detects breakouts from range boxes (last 20 candles)
- MACD integration for signal confirmation
- Multi-timeframe support (15m to 1w)
- Telegram notifications with TP/SL calculations

## Quick Start

```bash
npm install
npm start
```

## Environment Variables
Create `.env` file in the root of the project:
```env
BOT_TOKENS=token1,token2
CHAT_IDS=chatid1,chatid2
PORT=3000
```

## Configuration
Modify `index.js` to change:
- `intervals`: Timeframes to monitor
- `coins`: Cryptocurrency pairs to track
- Risk management parameters: TP/SL multipliers

## Indicators Used
- **Range Box**: High/Low of last 20 candles
- **MACD**: For trend confirmation
- **EMA**: Trend direction (12, 26, 50, 200)

## How It Works
1. Fetches klines from Bybit API
2. Calculates range box from last 20 candlesiles
3. Detects when price breaks above/below the box
4. Sends confirmation via Telegram with TP/SL levels

## Output
```
[HH:MM:SS] 🚀 Server in ascolto sulla porta 3000
[HH:MM:SS] 🔺 BTCUSDT[4h] breakout up → LONG
[HH:MM:SS] 📬 Telegram inviato su BTCUSDT[4h] ➡️ Bot 1
```
