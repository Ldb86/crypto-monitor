import 'dotenv/config';
import express from 'express';
import { MaradonaPeleEngine } from './maradonaEngine.js';
import { sendTelegram } from './telegramNotifier.js';

const app = express();
app.use(express.json({ limit: '1mb' }));

const engines = new Map();
function key(symbol, timeframe) { return `${symbol}:${timeframe}`; }
function getEngine(symbol, timeframe, config = {}) {
  const k = key(symbol, timeframe);
  if (!engines.has(k)) engines.set(k, new MaradonaPeleEngine(config));
  return engines.get(k);
}

app.get('/health', (_, res) => res.json({ ok: true, engines: engines.size }));

app.post('/webhook/candle', async (req, res) => {
  try {
    const secret = req.query.secret || req.body.secret;
    if (process.env.WEBHOOK_SECRET && secret !== process.env.WEBHOOK_SECRET) {
      return res.status(401).json({ ok: false, error: 'secret non valido' });
    }

    const symbol = req.body.symbol ?? req.body.ticker ?? 'UNKNOWN';
    const timeframe = req.body.timeframe ?? req.body.interval ?? '30m';
    const candle = req.body.candle ?? req.body;
    const config = req.body.config ?? {};
    const engine = getEngine(symbol, timeframe, config);
    const result = engine.addCandle(candle, { symbol, timeframe });

    let telegram = null;
    if (result.alert && ['RADAR', 'READY', 'MASTER', 'WARNING'].includes(result.signal)) {
      telegram = await sendTelegram(result.alert).catch(err => ({ ok: false, error: err.message }));
    }

    res.json({ ok: true, result, telegram });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`MARADONA Node listening on :${port}`));
