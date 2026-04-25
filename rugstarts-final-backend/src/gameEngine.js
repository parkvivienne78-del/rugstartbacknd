const crypto = require("crypto");

const config = {
  tickMs: Number(process.env.GAME_TICK_MS || 250),
  cooldownMs: Number(process.env.GAME_COOLDOWN_MS || 5000),
  maxTicks: Number(process.env.GAME_MAX_TICKS || 220),
  initialBalance: Number(process.env.GAME_INITIAL_BALANCE || 1000),
  minPrice: 0.001,
  startPrice: 1,
  maxHistory: 100,
};

const state = {
  gameNumber: 0,
  current: null,
  balances: new Map(),
  history: [],
  timer: null,
};

function now() {
  return Date.now();
}

function uid(prefix = "id") {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function ensureBalance(playerId) {
  const id = String(playerId || "guest");
  if (!state.balances.has(id)) state.balances.set(id, config.initialBalance);
  return state.balances.get(id);
}

function setBalance(playerId, value) {
  state.balances.set(String(playerId || "guest"), Number(Number(value).toFixed(6)));
}

function makeCooldownGame(message = "Next game starting soon...") {
  const id = uid("game");
  return {
    id,
    gameId: id,
    serverSeedHash: hash(id),
    version: "rugstarts-candleflip-v2",
    price: config.startPrice,
    active: false,
    prices: [],
    tickCount: 0,
    scoreboard: [],
    playerScoreboard: null,
    trades: [],
    sidebets: [],
    rugged: false,
    createdAt: now(),
    startedAt: null,
    endedAt: null,
    cooldown: {
      timeLeft: config.cooldownMs,
      paused: false,
      message,
      startedAt: now(),
      endsAt: now() + config.cooldownMs,
    },
    provablyFair: {
      serverSeedHash: hash(id),
      version: "rugstarts-candleflip-v2",
    },
  };
}

function startCooldown(message) {
  state.current = makeCooldownGame(message);
}

function randomCrashTick(seed) {
  const n = parseInt(hash(seed).slice(0, 8), 16) / 0xffffffff;
  // Some instant rugs, many medium rounds, rare long runners.
  if (n < 0.12) return Math.floor(4 + n * 20);
  if (n < 0.75) return Math.floor(25 + n * 120);
  return Math.floor(120 + n * 100);
}

function startGame() {
  state.gameNumber += 1;
  const id = `game_${state.gameNumber}_${crypto.randomBytes(4).toString("hex")}`;
  const serverSeedHash = hash(`${id}:${now()}`);
  state.current = {
    id,
    gameId: id,
    serverSeedHash,
    version: "rugstarts-candleflip-v2",
    price: config.startPrice,
    active: true,
    prices: [{ tick: 0, price: config.startPrice, time: now(), timestamp: now() }],
    tickCount: 0,
    scoreboard: [],
    playerScoreboard: null,
    trades: [],
    sidebets: [],
    rugged: false,
    crashTick: randomCrashTick(`${id}:${serverSeedHash}`),
    createdAt: now(),
    startedAt: now(),
    endedAt: null,
    cooldown: { timeLeft: 0, paused: true, message: "" },
    provablyFair: {
      serverSeedHash,
      version: "rugstarts-candleflip-v2",
    },
  };
}

function endGame(rugged = true) {
  const g = state.current;
  if (!g) return;
  g.active = false;
  g.rugged = rugged;
  g.endedAt = now();
  g.cooldown = {
    timeLeft: config.cooldownMs,
    paused: false,
    message: rugged ? "Rugged! Next game starting soon..." : "Game ended. Next game starting soon...",
    startedAt: now(),
    endsAt: now() + config.cooldownMs,
  };

  // open trades lose if not sold
  for (const trade of g.trades) {
    if (trade.status === "open") {
      trade.status = "rugged";
      trade.sellPrice = 0;
      trade.pnl = -trade.amount;
      trade.closedAt = now();
    }
  }

  g.scoreboard = buildScoreboard(g);
  state.history.unshift(stripInternal(g));
  state.history = state.history.slice(0, config.maxHistory);
}

function buildScoreboard(game = state.current) {
  const grouped = new Map();
  for (const t of game.trades || []) {
    const id = t.playerId || "guest";
    const cur = grouped.get(id) || { playerId: id, username: t.username || id.slice(0, 12), pnl: 0, volume: 0, trades: 0 };
    cur.pnl += Number(t.pnl || 0);
    cur.volume += Number(t.amount || 0);
    cur.trades += 1;
    grouped.set(id, cur);
  }
  return Array.from(grouped.values()).sort((a,b)=>b.pnl-a.pnl).map((x, i)=>({ rank: i+1, ...x, pnl: Number(x.pnl.toFixed(6)), volume: Number(x.volume.toFixed(6)) }));
}

function tick() {
  if (!state.current) {
    startCooldown("Game is loading...");
    return;
  }

  const g = state.current;

  if (!g.active) {
    const left = Math.max(0, (g.cooldown?.endsAt || now()) - now());
    g.cooldown.timeLeft = left;
    if (left <= 0) startGame();
    return;
  }

  g.tickCount += 1;

  // Price curve: starts slow, speeds up, has little jitter.
  const growth = Math.pow(1.0125, g.tickCount);
  const wave = 1 + Math.sin(g.tickCount / 7) * 0.01;
  const jitter = 1 + ((parseInt(hash(`${g.id}:${g.tickCount}`).slice(0, 4), 16) / 0xffff) - 0.5) * 0.01;
  g.price = Number(Math.max(config.minPrice, config.startPrice * growth * wave * jitter).toFixed(6));
  g.prices.push({ tick: g.tickCount, price: g.price, time: now(), timestamp: now() });
  if (g.prices.length > 800) g.prices = g.prices.slice(-800);

  g.scoreboard = buildScoreboard(g);

  if (g.tickCount >= g.crashTick || g.tickCount >= config.maxTicks) {
    endGame(true);
  }
}

function startEngine() {
  if (state.timer) return;
  startCooldown("Game is loading...");
  state.timer = setInterval(tick, config.tickMs);
}

function getCurrentGame(playerId = null) {
  const g = stripInternal(state.current || makeCooldownGame("Game is loading..."));
  if (playerId) {
    g.playerScoreboard = g.scoreboard?.find((x) => x.playerId === String(playerId)) || null;
  }
  return g;
}

function stripInternal(game) {
  if (!game) return null;
  const { crashTick, ...pub } = game;
  return JSON.parse(JSON.stringify(pub));
}

function getHistory(limit = 20) {
  return state.history.slice(0, Number(limit) || 20);
}

function buy({ playerId = "guest", username = null, amount = 1, side = "buy" } = {}) {
  const g = state.current;
  if (!g || !g.active) throw new Error("No active game.");
  const id = String(playerId);
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) throw new Error("Invalid amount.");
  const bal = ensureBalance(id);
  if (bal < value) throw new Error("Insufficient balance.");
  setBalance(id, bal - value);

  const trade = {
    id: uid("trade"),
    gameId: g.gameId,
    playerId: id,
    userId: id,
    username: username || id.slice(0, 12),
    type: side,
    side,
    amount: Number(value.toFixed(6)),
    buyPrice: g.price,
    entryPrice: g.price,
    price: g.price,
    tick: g.tickCount,
    status: "open",
    pnl: 0,
    createdAt: now(),
    openedAt: now(),
  };
  g.trades.push(trade);
  g.scoreboard = buildScoreboard(g);
  return trade;
}

function sell({ playerId = "guest", tradeId = null } = {}) {
  const g = state.current;
  if (!g || !g.active) throw new Error("No active game.");
  const id = String(playerId);
  let trade = null;
  if (tradeId) trade = g.trades.find((t) => t.id === tradeId && t.playerId === id && t.status === "open");
  if (!trade) trade = [...g.trades].reverse().find((t) => t.playerId === id && t.status === "open");
  if (!trade) throw new Error("No open trade.");

  const payout = Number((trade.amount * (g.price / trade.buyPrice)).toFixed(6));
  const pnl = Number((payout - trade.amount).toFixed(6));
  trade.status = "sold";
  trade.sellPrice = g.price;
  trade.exitPrice = g.price;
  trade.pnl = pnl;
  trade.payout = payout;
  trade.closedAt = now();

  setBalance(id, ensureBalance(id) + payout);
  g.scoreboard = buildScoreboard(g);
  return { trade, payout, pnl, balance: ensureBalance(id) };
}

function addSidebet({ playerId = "guest", username = null, amount = 1, prediction = "rug" } = {}) {
  const g = state.current;
  if (!g || !g.active) throw new Error("No active game.");
  const id = String(playerId);
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) throw new Error("Invalid amount.");
  const bal = ensureBalance(id);
  if (bal < value) throw new Error("Insufficient balance.");
  setBalance(id, bal - value);
  const sidebet = {
    id: uid("sidebet"),
    gameId: g.gameId,
    playerId: id,
    userId: id,
    username: username || id.slice(0, 12),
    amount: value,
    prediction,
    status: "active",
    createdAt: now(),
  };
  g.sidebets.push(sidebet);
  return sidebet;
}

function getBalance(playerId = "guest") {
  return ensureBalance(playerId);
}

function leaderboard() {
  const rows = Array.from(state.balances.entries()).map(([playerId, balance]) => ({
    playerId,
    username: playerId.slice(0, 12),
    balance,
  }));
  return rows.sort((a,b)=>b.balance-a.balance).slice(0, 100);
}

function creditBalance(playerId = "guest", amount = 0) {
  const id = String(playerId || "guest");
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) throw new Error("Invalid credit amount.");
  const next = ensureBalance(id) + value;
  setBalance(id, next);
  return ensureBalance(id);
}

function debitBalance(playerId = "guest", amount = 0) {
  const id = String(playerId || "guest");
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) throw new Error("Invalid debit amount.");
  const current = ensureBalance(id);
  if (current < value) throw new Error("Insufficient balance.");
  setBalance(id, current - value);
  return ensureBalance(id);
}

module.exports = {
  config,
  startEngine,
  getCurrentGame,
  getHistory,
  buy,
  sell,
  addSidebet,
  getBalance,
  leaderboard,
  creditBalance,
  debitBalance,
};
