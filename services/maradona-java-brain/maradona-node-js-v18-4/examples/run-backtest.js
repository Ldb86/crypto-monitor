import { MaradonaPeleEngine } from '../src/index.js';

const engine = new MaradonaPeleEngine({
  longLiq: [0, 0, 0],
  shortLiq: [0, 0, 0]
});

// Demo sintetica: sostituisci con le tue candele Bybit/CSV.
let price = 100;
for (let i = 0; i < 160; i++) {
  const drift = i < 80 ? 0.05 : 0.22;
  const open = price;
  const close = price + drift + Math.sin(i / 7) * 0.5;
  const high = Math.max(open, close) + 0.8;
  const low = Math.min(open, close) - 0.8;
  const volume = 1000 + (i % 13 === 0 ? 700 : 0);
  price = close;
  const r = engine.addCandle({ time: Date.now() + i * 60000, open, high, low, close, volume }, { symbol: 'BTCUSDT', timeframe: '30m' });
  if (r.alert) console.log('\n' + r.alert + '\n');
}
