# Banda Bellinger Service - EMA5 x Bollinger Bands Bot

Live EMA cross detection with Bollinger Bands confirmation.

## Features
- EMA5 and Bollinger Bands 20-period crossing
- Real-time cross detection
- Range box calculations for TP/SL
- Multi-timeframe support (30m to 1w)
- Telegram notifications with complete analysis

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

## How It Works

1. **EMA5 Calculation**: Short-term moving average
2. **Bollinger Bands**: 20-period middle band
3. **Cross Detection**: When EMA5 crosses BB Middle
4. **TP/SL Calculation**: Based on last 20 candles range
5. **Alert**: Sends Telegram on cross confirmation

## Cross Conditions
- **LONG Signal**: EMA5 closes above BB Middle (after being below)
- **SHORT Signal**: EMA5 closes below BB Middle (after being above)

## Indicators Used
- **EMA5**: Short-term trend (main signal)
- **EMA50/EMA200**: Trend confirmation
- **Bollinger Bands (20, 2σ)**: Volatility and overbought/oversold
- **Range Box**: Last 20 candles for TP/SL

## Configuration
Modify `index.js` to change:
- `intervals`: Timeframes to monitor
- `coins`: Cryptocurrency pairs
- `formatPrice()`: Display precision
- `getRangeBox()`: TP/SL calculation base

## Timeframes
30m, 1h, 2h, 4h, 6h, 12h, 1d, 1w

## Output Example
```
[HH:MM:SS] 🚀 Server avviato su porta 3000
[HH:MM:SS] ⚡ LIVE CROSS BTCUSDT[4h] LONG
[HH:MM:SS] 📬 Telegram BTCUSDT[4h]
```

## Anti-Spam
Prevents duplicate alerts - only sends once per direction change per timeframe.

---

**Tuning Tips**:
- Increase/decrease EMA5 period for more/less sensitivity
- Adjust Bollinger Bands standard deviation
- Filter by EMA50/EMA200 trend for confirmation
