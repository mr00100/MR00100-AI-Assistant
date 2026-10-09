# MR00100 AI — YOUR SYSTEM. YOUR COMMAND.

A lightweight, futuristic, voice-controlled personal AI command center and coding
assistant. Next.js (App Router) + PostgreSQL (Drizzle ORM) + OpenRouter.

> PC control (launching apps, clipboard, terminal, files) acts on the machine that
> runs the server. To control **your** computer, run MR00100 on your own desktop.

## 1. Prerequisites

| Requirement | Notes |
|---|---|
| Node.js 20 LTS or newer | `node -v` — Node 18.15+ minimum for disk telemetry |
| PostgreSQL 14+ | Local install, or Docker: `docker run -d --name mr00100-db -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16` |
| Chrome or Edge | Required for voice (Web Speech API). Firefox/Safari: chat still works, mic does not |
| OpenRouter API key (optional) | https://openrouter.ai/keys — without it every LOCAL command still works; only the heavy AI engine stays OFFLINE |

## 2. Install

```bash
git clone <this repo> mr00100-ai
cd mr00100-ai
npm install
```

## 3. Configure `.env`

Create `.env` in the project root:

```env
# required
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db

# optional — enables the AI engine (also settable later in Settings → AI Provider)
OPENROUTER_API_KEY=sk-or-v1-...

# optional — models are never hard-coded; override defaults here or in Settings
OPENROUTER_MODEL=openai/gpt-4o-mini
OPENROUTER_DEVELOPER_MODEL=anthropic/claude-3.5-sonnet
OPENROUTER_REASONING_MODEL=openai/gpt-4o
OPENROUTER_FALLBACK_MODEL=meta-llama/llama-3.1-8b-instruct

# optional — sandbox root for files/terminal. Defaults to ./mr00100-workspace
# Point it at your real projects folder to work on them in Developer Mode.
# MR00100_WORKSPACE=C:\Users\you\Projects
```

Create the database once:

```bash
# psql
psql -U postgres -c "CREATE DATABASE app_db;"
```

If your connection string differs from the default, also update
`drizzle.config.json → dbCredentials.url` so `drizzle-kit` targets the same DB.

## 4. Create the tables

```bash
npx drizzle-kit push
```

## 5. Run

Development (hot reload):

```bash
npm run dev
```

Production (what you should use day-to-day — lower CPU/RAM):

```bash
npm run build
npm start
```

Open **http://localhost:3000** in Chrome or Edge.

## 6. First contact

1. Watch the boot sequence — every line is a real check (DB, telemetry, policy store, model catalog, workspace). Press **SKIP →** to jump in.
2. Press the **MIC** button in the dock (or `Ctrl+M`), allow microphone access, and say:
   - "MR00100, check my CPU usage"
   - "MR00100, create a python file called tmp/hello.py"
   - "MR00100, open my project"
   - "MR00100, run npm test"
3. Or open **CHAT** and type the same thing — voice and chat share one command router.
4. Press **DEV** for the developer workspace; press **MINI** (top right) for the compact floating mode.

Keyboard: `Ctrl+M` toggle mic · `Esc` close last panel · `Ctrl+S` save in editor · `Ctrl+F` find/replace.

## 7. Security model

- Everything file/terminal-related is sandboxed inside `MR00100_WORKSPACE`. Paths that escape it are rejected.
- **SAFE** actions run immediately; **CONFIRM** actions raise an authorization dialog stating exactly what will happen; **BLOCK** patterns (root deletion, disk formatting, credential access, persistence, reverse shells, fork bombs) are refused regardless of settings.
- Adjust levels in Settings → Security Center. Every decision is logged to `command_history`.
- Nothing is sent to OpenRouter unless a request is routed to the AI engine; the prompt, workspace tree, active file and your explicit memory entries are the only context transmitted.

## 8. Platform notes

| Capability | Windows | macOS | Linux |
|---|---|---|---|
| Launch / close apps | `start` / `taskkill` | `open -a` / `pkill` | `$PATH` binary / `pkill` |
| Clipboard | `clip` / PowerShell | `pbcopy` / `pbpaste` | `xclip` |
| System volume | not native — UI volume only | `osascript` | `amixer` |
| Network throughput | reports 0 (no `/proc/net/dev`) | reports 0 | live |
| Battery | not exposed | not exposed | `/sys/class/power_supply` |
| CPU / RAM / disk / processes / latency | ✔ | ✔ | ✔ |

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| Boot shows `INITIALIZING MR00100 CORE… FAILED` | PostgreSQL not reachable — check `DATABASE_URL`, then `npx drizzle-kit push` |
| `AI ENGINE :: OFFLINE` | No key — add `OPENROUTER_API_KEY` to `.env` or store one in Settings |
| Mic button says speech recognition unavailable | Use Chrome/Edge; other browsers lack the Web Speech API |
| `open chrome` fails | The executable is not on `PATH` of the machine running the server |
| UI feels heavy | Resource Guard will throttle automatically; or lower Particle Density / disable Digital Rain in Settings |
