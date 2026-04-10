# Railway Deployment Guide

This document explains how to deploy each microservice to Railway.

## Prerequisites
- GitHub account with this repository connected
- Railway account (https://railway.app)
- Environment variables configured

## Step 1: Create 3 Railway Services

### Service 1: BR (Range Box Breakout)
1. New Project → GitHub Repository
2. Select this repository
3. **Service Name**: `br-bot`
4. **Environment**: Add variables
5. **Start Command**:
```bash
cd services/BR && npm install && npm start
```

### Service 2: Break Triangle
1. New Service → GitHub Repository
2. Select this repository
3. **Service Name**: `triangle-bot`
4. **Environment**: Add variables
5. **Start Command**:
```bash
cd services/breakTriangle && npm install && npm start
```

### Service 3: Banda Bellinger
1. New Service → GitHub Repository
2. Select this repository
3. **Service Name**: `bellinger-bot`
4. **Environment**: Add variables
5. **Start Command**:
```bash
cd services/bandaBellinger && npm install && npm start
```

## Step 2: Environment Variables

For **each service**, add these in Railway dashboard:

```
BOT_TOKENS=token1,token2,token3
CHAT_IDS=chatid1,chatid2,chatid3
PORT=3000
NODE_ENV=production
```

## Step 3: Deploy

1. **Automatic**: Each git push to main triggers auto-deploy (if configured)
2. **Manual**: Click "Deploy" button in Railway dashboard

## Monitoring

- View logs for each service in Railway dashboard
- Logs show real-time signal detection and Telegram sends
- Check for errors in the logs tab

## Port Configuration

Each service gets a unique port automatically on Railway:
- Railway assigns PORT via environment variable
- Services expose health check on `GET /` endpoint
- Response: `✅ [Bot Name] bot ATTIVO`

## Expected Startup Logs

```
🚀 Server avviato su porta 3000
🕒 Timeframes attivi: 30m, 2h, 4h, ...
📡 LIVE pre-alert: OFF
✅ Confirmed alert: ON
```

## Troubleshooting

### Service won't start
- Check the Build Logs in Railway
- Verify `package.json` exists in service folder
- Ensure `node_modules/` is in `.gitignore`

### No alerts sent
- Verify BOT_TOKENS and CHAT_IDS are correct
- Check Telegram API token validity
- Review service logs for errors

### Memory/CPU issues
- Services are lightweight (< 100MB RAM)
- If bottlenecks occur, create separate Railway services

## Architecture Diagram

```
GitHub Repository (main branch)
    ↓
    ├─→ Railway Service 1 (BR)
    ├─→ Railway Service 2 (breakTriangle)
    └─→ Railway Service 3 (bandaBellinger)
            ↓
         Bybit API
         (fetch klines)
            ↓
         Signal Detection
            ↓
         Telegram Bot
         (send alerts)
```

## Auto-Deployment

When you push to `main`:
1. GitHub webhook triggers Railway
2. Each service rebuilds if changed
3. Services restart with new code
4. Alerts resume automatically

**Note**: Only modified services redeploy (Railway detects path changes)

---

**Useful Commands**:

Check git status:
```bash
git status
```

Deploy changes:
```bash
git add .
git commit -m "Update bots"
git push origin main
```

---

For more info: https://docs.railway.app
