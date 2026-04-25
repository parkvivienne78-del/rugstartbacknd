const express = require("express");
const { z } = require("zod");
const game = require("./gameEngine");
const { verifySolDeposit, getTreasuryWallet } = require("./services/solanaService");
const { getPool } = require("./db");

let walletService = {};
try {
  walletService = require("./services/walletService");
} catch (_) {}

const router = express.Router();
const ok = (res, data = {}) => res.json({ ok: true, ...data });

router.get("/health", async (_req, res) => {
  let db = "missing_database_url";
  try {
    await getPool().query("SELECT 1");
    db = "ok";
  } catch (_error) {
    db = process.env.DATABASE_URL ? "error" : "missing_database_url";
  }
  ok(res, { service: "rugs-backend", db, time: new Date().toISOString() });
});

router.get("/mfa/status", (_req, res) => ok(res, { enabled: false, required: false, status: "disabled", methods: [] }));
router.post("/mfa/status", (_req, res) => ok(res, { enabled: false, required: false, status: "disabled", methods: [] }));

router.post("/users/sync", async (req, res) => {
  const privyUserId = String(req.body?.privyUserId || req.body?.id || req.body?.walletAddress || req.body?.address || "guest");
  try {
    if (walletService.createOrGetUser) {
      const user = await walletService.createOrGetUser({ privyUserId, walletAddress: req.body?.walletAddress || req.body?.address });
      return res.status(201).json({ ok: true, user });
    }
  } catch (e) {
    return res.status(201).json({ ok: true, user: { privyUserId }, warning: e.message });
  }
  res.status(201).json({ ok: true, user: { privyUserId } });
});

router.get("/wallet/balance/:privyUserId", async (req, res) => {
  const id = req.params.privyUserId;
  try {
    if (walletService.getBalanceByPrivyUserId) {
      const balance = await walletService.getBalanceByPrivyUserId(id);
      if (balance) return ok(res, { balance });
    }
  } catch (_) {}
  ok(res, { balance: { privyUserId: id, available: String(game.getBalance(id)), locked: "0", updatedAt: new Date().toISOString() } });
});

router.post("/wallet/deposits/confirm", (_req, res) => res.status(201).json({ ok: true, duplicate: false }));
router.post("/wallet/withdrawals/request", (req, res) => res.status(201).json({ ok: true, withdrawal: { status: "pending", amount: String(req.body?.amount || 0), currency: req.body?.currency || "SOL" } }));

// Rugs/Candleflip game shape
router.get("/games/current", (req, res) => ok(res, { currentGame: game.getCurrentGame(req.query.playerId), game: game.getCurrentGame(req.query.playerId), data: game.getCurrentGame(req.query.playerId) }));
router.get("/game/current", (req, res) => ok(res, { currentGame: game.getCurrentGame(req.query.playerId), game: game.getCurrentGame(req.query.playerId), data: game.getCurrentGame(req.query.playerId) }));
router.get("/current-game", (req, res) => ok(res, { currentGame: game.getCurrentGame(req.query.playerId), game: game.getCurrentGame(req.query.playerId), data: game.getCurrentGame(req.query.playerId) }));
router.get("/game/state", (req, res) => ok(res, { currentGame: game.getCurrentGame(req.query.playerId), game: game.getCurrentGame(req.query.playerId), state: game.getCurrentGame(req.query.playerId), data: game.getCurrentGame(req.query.playerId) }));
router.get("/games", (_req, res) => ok(res, { games: [game.getCurrentGame()], data: [game.getCurrentGame()] }));
router.get("/games/history", (req, res) => ok(res, { games: game.getHistory(req.query.limit || 20), data: game.getHistory(req.query.limit || 20) }));
router.get("/game/history", (req, res) => ok(res, { games: game.getHistory(req.query.limit || 20), history: game.getHistory(req.query.limit || 20), data: game.getHistory(req.query.limit || 20) }));

function playerIdFrom(req) {
  return String(req.body?.playerId || req.body?.privyUserId || req.body?.userId || req.body?.walletAddress || "guest");
}

router.post("/trades/buy", (req, res, next) => {
  try {
    const trade = game.buy({ playerId: playerIdFrom(req), username: req.body?.username, amount: Number(req.body?.amount || req.body?.size || 1) });
    ok(res, { trade, currentGame: game.getCurrentGame(playerIdFrom(req)), balance: game.getBalance(playerIdFrom(req)) });
  } catch (e) { next(e); }
});
router.post("/trades/sell", (req, res, next) => {
  try {
    const result = game.sell({ playerId: playerIdFrom(req), tradeId: req.body?.tradeId || req.body?.id });
    ok(res, { ...result, currentGame: game.getCurrentGame(playerIdFrom(req)) });
  } catch (e) { next(e); }
});
router.post("/game/buy", (req, res, next) => {
  try {
    const trade = game.buy({ playerId: playerIdFrom(req), username: req.body?.username, amount: Number(req.body?.amount || req.body?.size || 1) });
    ok(res, { trade, currentGame: game.getCurrentGame(playerIdFrom(req)), balance: game.getBalance(playerIdFrom(req)) });
  } catch (e) { next(e); }
});
router.post("/game/sell", (req, res, next) => {
  try {
    const result = game.sell({ playerId: playerIdFrom(req), tradeId: req.body?.tradeId || req.body?.id });
    ok(res, { ...result, currentGame: game.getCurrentGame(playerIdFrom(req)) });
  } catch (e) { next(e); }
});

// old crash aliases
router.post("/game/bet", (req, res, next) => {
  try {
    const trade = game.buy({ playerId: playerIdFrom(req), username: req.body?.username, amount: Number(req.body?.amount || 1) });
    ok(res, { bet: trade, trade, currentGame: game.getCurrentGame(playerIdFrom(req)), balance: game.getBalance(playerIdFrom(req)) });
  } catch (e) { next(e); }
});
router.post("/game/cashout", (req, res, next) => {
  try {
    const result = game.sell({ playerId: playerIdFrom(req), tradeId: req.body?.tradeId || req.body?.id });
    ok(res, { outcome: result, ...result, currentGame: game.getCurrentGame(playerIdFrom(req)) });
  } catch (e) { next(e); }
});

router.post("/sidebets", (req, res, next) => {
  try {
    const sidebet = game.addSidebet({ playerId: playerIdFrom(req), username: req.body?.username, amount: Number(req.body?.amount || 1), prediction: req.body?.prediction || "rug" });
    ok(res, { sidebet, currentGame: game.getCurrentGame(playerIdFrom(req)), balance: game.getBalance(playerIdFrom(req)) });
  } catch (e) { next(e); }
});

router.get("/leaderboard", (_req, res) => ok(res, { leaderboard: game.leaderboard(), data: game.leaderboard(), users: game.leaderboard(), entries: game.leaderboard() }));
router.get("/leaderboard/:mode", (req, res) => ok(res, { mode: req.params.mode, leaderboard: game.leaderboard(), data: game.leaderboard() }));

router.get("/profiles", (_req, res) => ok(res, { profiles: [], data: [] }));
router.get("/profile/:id", (req, res) => ok(res, { profile: { id: req.params.id, username: "Player", balance: game.getBalance(req.params.id) } }));
router.get("/battle-previews", (_req, res) => ok(res, { battlePreviews: [], data: [] }));
router.get("/admin/config", (_req, res) => ok(res, { config: {} }));
router.get("/admin/games/history/:id", (req, res) => ok(res, { games: game.getHistory(50), data: game.getHistory(50) }));
router.get("/admin/games/lookup/:gameId/:privyId", (req, res) => ok(res, { game: game.getHistory(100).find((g) => g.gameId === req.params.gameId) || game.getCurrentGame(req.params.privyId) }));
router.post("/admin/users/search", (_req, res) => ok(res, { users: [], data: [] }));

router.get("*", (req, res) => ok(res, { path: req.path, data: null, items: [] }));
router.post("*", (req, res) => ok(res, { path: req.path, data: null }));

module.exports = router;
