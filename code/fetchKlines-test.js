const axios = require('axios');

async function fetchKlines(symbol, interval, limit = 200) {
  const intervalMap = { '1m': '1', '5m': '5', '15': '15' };
  const url = 'https://api.bybit.com/v5/market/kline';

  try {
    const response = await axios.get(url, {
      params: {
        category: 'spot',
        symbol,
        interval: intervalMap[interval],
        limit
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (EMA-Scanner)'
      }
    });

    const data = response.data?.result?.list;
    if (!data || data.length === 0) {
      console.log('⚠️ Nessun dato restituito da Bybit.');
      return;
    }

    console.log(`✅ ${symbol} [${interval}]: ricevuti ${data.length} dati`);
    console.log('📊 Ultimo close:', parseFloat(data[data.length - 1][4]));
  } catch (error) {
    console.error(`❌ Errore fetchKlines:`, error.message);
  }
}

// Testa un simbolo
fetchKlines('BTCUSDT', '5m', 100);
