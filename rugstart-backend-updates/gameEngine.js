const crypto = require("crypto");

const cfg = {
  tickMs: Number(process.env.GAME_TICK_MS || 250),
  intermissionMs: Number(process.env.GAME_INTERMISSION_MS || 4000),
  startPrice: Number(process.env.GAME_STARTING_PRICE || 1.0),
  rugProb: Number(process.env.GAME_RUG_PROB || 0.035),
  driftMin: Number(process.env.GAME_DRIFT_MIN || -0.004),
  driftMax: Number(process.env.GAME_DRIFT_MAX || 0.008),
  bigMoveChance: Number(process.env.GAME_BIG_MOVE_CHANCE || 0.03),
  bigMoveMin: Number(process.env.GAME_BIG_MOVE_MIN || 0.03),
  bigMoveMax: Number(process.env.GAME_BIG_MOVE_MAX || 0.15),
  godCandleChance: Number(process.env.GAME_GOD_CANDLE_CHANCE || 0.00001),
  godCandleMove: Number(process.env.GAME_GOD_CANDLE_MOVE || 10.0),
  version: process.env.GAME_VERSION || "v3",
  initialBalance: Number(process.env.GAME_INITIAL_BALANCE || 1000),
  maxHistory: Number(process.env.GAME_MAX_HISTORY || 100),
};

const state = {
  phase: "intermission",
  gameId: 0,
  gameStartAt: Date.now() + cfg.intermissionMs,
  serverSeed: null,
  tick: 0,
  price: cfg.startPrice,
  peakMultiplier: cfg.startPrice,
  crashMultiplier: null,
  crashedAt: null,
  bets: new Map(),
  balances: new Map(),
  history: [],
  timer: null,
};

function createDeterministicRng(seed) {
  let counter = 0;
  return () => {
    const h = crypto
      .createHash("sha256")
      .update(`${seed}:${counter++}`)
      .digest();
    const n = h.readUInt32BE(0);
    return n / 0xffffffff;
  };
}

function driftPrice(price, randFn, version = "v3") {
  if (version === "v3" && randFn() < cfg.godCandleChance && price <= 100 * cfg.startPrice) {
    return price * cfg.godCandleMove;
  }

  let change = 0;

  if (randFn() < cfg.bigMoveChance) {
    const moveSize = cfg.bigMoveMin + randFn() * (cfg.bigMoveMax - cfg.bigMoveMin);
    change = randFn() > 0.5 ? moveSize : -moveSize;
  } else {
    const drift = cfg.driftMin + randFn() * (cfg.driftMax - cfg.driftMin);
    const volatility =
      version === "v1" ? 0.005 * Math.sqrt(price) : 0.005 * Math.min(10, Math.sqrt(price));
    change = drift + volatility * (2 * randFn() - 1);
  }

  const newPrice = price * (1 + change);
  return newPrice < 0 ? 0 : newPrice;
}

function getBalance(playerId) {
  if (!state.balances.has(playerId)) {
    state.balances.set(playerId, cfg.initialBalance);
  }
  return state.balances.get(playerId);
}

function setBalance(playerId, value) {
  state.balances.set(playerId, Number(value.toFixed(6)));
}

function settleCrash() {
  for (const bet of state.bets.values()) {
    if (!bet.cashedOut) {
      bet.status = "lost";
    }
  }
}

function beginNextRound() {
  state.phase = "running";
  state.gameId += 1;
  state.serverSeed = crypto.randomBytes(32).toString("hex");
  state.tick = 0;
  state.price = cfg.startPrice;
  state.peakMultiplier = cfg.startPrice;
  state.crashMultiplier = null;
  state.crashedAt = null;
  state.bets.clear();
  state.gameStartAt = Date.now();
}

function endRoundAndScheduleIntermission() {
  const settledBets = [...state.bets.values()].map((b) => ({
    playerId: b.playerId,
    amount: b.amount,
    autoCashout: b.autoCashout,
    status: b.status,
    cashoutMultiplier: b.cashoutMultiplier,
    payout: b.payout || 0,
  }));

  state.history.unshift({
    gameId: state.gameId,
    serverSeed: state.serverSeed,
    version: cfg.version,
    peakMultiplier: Number(state.peakMultiplier.toFixed(6)),
    crashMultiplier: Number((state.crashMultiplier || state.price).toFixed(6)),
    endedAt: Date.now(),
    bets: settledBets,
  });
  if (state.history.length > cfg.maxHistory) {
    state.history = state.history.slice(0, cfg.maxHistory);
  }

  state.phase = "intermission";
  state.gameStartAt = Date.now() + cfg.intermissionMs;
  state.tick = 0;
  state.price = cfg.startPrice;
  state.peakMultiplier = cfg.startPrice;
  state.bets.clear();
}

function runTick() {
  if (state.phase === "intermission") {
    if (Date.now() >= state.gameStartAt) {
      beginNextRound();
    }
    return;
  }

  state.tick += 1;
  const rng = createDeterministicRng(`${state.serverSeed}-${state.gameId}-${state.tick}`);

  if (rng() < cfg.rugProb) {
    state.crashMultiplier = state.price;
    state.crashedAt = Date.now();
    settleCrash();
    endRoundAndScheduleIntermission();
    return;
  }

  state.price = driftPrice(state.price, rng, cfg.version);
  if (state.price > state.peakMultiplier) {
    state.peakMultiplier = state.price;
  }

  for (const bet of state.bets.values()) {
    if (bet.cashedOut || bet.status !== "active") continue;
    if (bet.autoCashout && state.price >= bet.autoCashout) {
      const payout = bet.amount * bet.autoCashout;
      setBalance(bet.playerId, getBalance(bet.playerId) + payout);
      bet.cashedOut = true;
      bet.status = "won";
      bet.cashoutMultiplier = bet.autoCashout;
      bet.payout = Number(payout.toFixed(6));
    }
  }
}

function startEngine() {
  if (state.timer) return;
  state.timer = setInterval(runTick, cfg.tickMs);
}

function placeBet(playerId, amount, autoCashout = null) {
  if (state.phase !== "running") {
    throw new Error("Round is not running.");
  }
  if (state.bets.has(playerId)) {
    throw new Error("Player already has an active bet this round.");
  }
  const bal = getBalance(playerId);
  if (amount <= 0) {
    throw new Error("Amount must be greater than 0.");
  }
  if (amount > bal) {
    throw new Error("Insufficient balance.");
  }
  setBalance(playerId, bal - amount);
  state.bets.set(playerId, {
    playerId,
    amount,
    autoCashout,
    status: "active",
    cashedOut: false,
    cashoutMultiplier: null,
    payout: 0,
  });
}

function cashout(playerId) {
  const bet = state.bets.get(playerId);
  if (!bet || bet.status !== "active" || bet.cashedOut) {
    throw new Error("No active bet to cash out.");
  }

  const sameTickGrace =
    state.phase === "intermission" && state.crashedAt && Date.now() - state.crashedAt <= cfg.tickMs;
  if (state.phase !== "running" && !sameTickGrace) {
    throw new Error("Round already ended.");
  }

  const multiplier = state.phase === "running" ? state.price : state.crashMultiplier || state.price;
  const payout = bet.amount * multiplier;
  setBalance(playerId, getBalance(playerId) + payout);
  bet.cashedOut = true;
  bet.status = "won";
  bet.cashoutMultiplier = Number(multiplier.toFixed(6));
  bet.payout = Number(payout.toFixed(6));
  return { multiplier: bet.cashoutMultiplier, payout: bet.payout };
}

function getPublicState() {
  return {
    phase: state.phase,
    gameId: state.gameId,
    tick: state.tick,
    price: Number(state.price.toFixed(6)),
    peakMultiplier: Number(state.peakMultiplier.toFixed(6)),
    nextRoundAt: state.phase === "intermission" ? state.gameStartAt : null,
    tickMs: cfg.tickMs,
    version: cfg.version,
    activePlayers: state.bets.size,
  };
}

function getHistory(limit = 20) {
  return state.history.slice(0, limit);
}

function verifyGame(serverSeed, gameId, version = cfg.version) {
  let price = cfg.startPrice;
  let peakMultiplier = cfg.startPrice;
  let rugged = false;
  let tick = 0;

  while (!rugged && tick < 50000) {
    tick += 1;
    const rng = createDeterministicRng(`${serverSeed}-${gameId}-${tick}`);
    if (rng() < cfg.rugProb) {
      rugged = true;
      break;
    }
    price = driftPrice(price, rng, version);
    if (price > peakMultiplier) peakMultiplier = price;
  }

  return { peakMultiplier: Number(peakMultiplier.toFixed(6)), rugged };
}

module.exports = {
  startEngine,
  placeBet,
  cashout,
  getBalance,
  getPublicState,
  getHistory,
  verifyGame,
  config: cfg,
};
