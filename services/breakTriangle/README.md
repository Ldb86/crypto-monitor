# Break Triangle Service - Triangle Breakout Bot

Advanced triangle pattern detector with real-time monitoring and compression confirmation.

## Features
- Detects triangle compression patterns
- Real-time breakout alerts (live price monitoring)
- Confirmed alerts on candle close
- EMA and Bollinger Bands integration
- Multi-timeframe support (30m to 1w)
- Telegram notifications with detailed analysis

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

### Alert Modes
Edit `index.js` to configure:
```javascript
const SEND_LIVE_PREALERT = false;      // Send alert on price breakout (live)
const SEND_CONFIRMED_ALERT = true;     // Send alert on candle close
```

### Pattern Parameters
- `TRIANGLE_LENGTH`: Pivot detection sensitivity (lower = more reacting)
- `BREAKOUT_BUFFER`: Anti-fake breakout threshold (0.08%)
- `LIVE_BREAKOUT_BUFFER`: Live price breakout threshold (0.05%)
- `FETCH_LIMIT`: Candele history to fetch (260 for EMA200)
- `PATTERN_WINDOW`: Candles for triangle calculation (25)

### Filters (Optional)
```javascript
const USE_TREND_FILTER = false;           // Filter by EMA50 > EMA200
const REQUIRE_EMA12_BB_CONFIRM = false;   // Require EMA12 > BB Middle
```

## Indicators Used
- **Triangle Patterns**: Pivot High/Low with ATR slopes
- **Compression Detection**: Range compression in last 25 candles
- **EMA**: 12, 50, 200 periods
- **Bollinger Bands**: 20-period, 2 std dev

## How It Works

1. **Fetch Data**: Gets last 260 candles from Bybit
2. **Pattern Analysis**: 
   - Calculates triangle using pivot points and slopes
   - Detects price compression
3. **Breakout Detection**:
   - Live: Monitors current price against triangle lines
   - Confirmed: Checks when previous candle closes
4. **Alerts**: Sends Telegram with entry, TP, SL

## Output Example
```
[HH:MM:SS] 🚀 Server avviato su porta 3000
[HH:MM:SS] ⚡ LIVE ETHUSDT[4h] LONG
[HH:MM:SS] 🔺 CONFIRMED ETHUSDT[4h] LONG
[HH:MM:SS] 📬 Telegram ...
```

## Timeframes
- 30m, 2h, 4h, 6h, 12h, 1d, 1w

---

**Note**: Triangle breakout requires confirmation from:
- Compression in last 25 candles
- Valid pivot detection
- Price crossing triangle boundary
