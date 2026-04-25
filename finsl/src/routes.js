const express = require("express");
const { z } = require("zod");
const { getPool } = require("./db");
const {
  createOrGetUser,
  getBalanceByPrivyUserId,
  recordConfirmedDeposit,
  requestWithdrawal,
} = require("./services/walletService");
const gameEngine = require("./gameEngine");

const router = express.Router();

router.get("/health", async (_req, res) => {
  let db = "missing_database_url";
  try {
    await getPool().query("SELECT 1");
    db = "ok";
  } catch (_error) {
    db = "error";
  }

  res.json({
    ok: true,
    service: "rugs-backend",
    db,
    time: new Date().toISOString(),
  });
});

router.post("/users/sync", async (req, res, next) => {
  try {
    const schema = z.object({
      privyUserId: z.string().min(3),
      walletAddress: z.string().optional(),
    });

    const user = await createOrGetUser(schema.parse(req.body));
    res.status(201).json({ ok: true, user });
  } catch (error) {
    next(error);
  }
});

router.get("/wallet/balance/:privyUserId", async (req, res, next) => {
  try {
    const { privyUserId } = req.params;
    const balance = await getBalanceByPrivyUserId(privyUserId);
    if (!balance) {
      res.status(404).json({ ok: false, error: "User not found." });
      return;
    }
    res.json({ ok: true, balance });
  } catch (error) {
    next(error);
  }
});

router.post("/wallet/deposits/confirm", async (req, res, next) => {
  try {
    const body = z.object({
      privyUserId: z.string().min(3),
      txSignature: z.string().min(10),
      amount: z.coerce.number().positive(),
      currency: z.string().default("SOL"),
      sourceAddress: z.string().optional(),
    });

    const result = await recordConfirmedDeposit(body.parse(req.body));
    res.status(201).json({
      ok: true,
      duplicate: result.duplicate,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/wallet/withdrawals/request", async (req, res, next) => {
  try {
    const body = z.object({
      privyUserId: z.string().min(3),
      destinationAddress: z.string().min(20),
      amount: z.coerce.number().positive(),
      currency: z.string().default("SOL"),
    });

    const withdrawal = await requestWithdrawal(body.parse(req.body));
    res.status(201).json({ ok: true, withdrawal });
  } catch (error) {
    next(error);
  }
});

router.get("/game/config", (_req, res) => {
  res.json({ ok: true, config: gameEngine.config });
});

router.get("/game/state", (_req, res) => {
  res.json({ ok: true, state: gameEngine.getPublicState() });
});

router.get("/game/history", (req, res) => {
  const limit = Math.max(1, Math.min(100, Number(req.query.limit || 20)));
  res.json({ ok: true, history: gameEngine.getHistory(limit) });
});

router.get("/game/balance/:playerId", (req, res) => {
  const { playerId } = req.params;
  res.json({ ok: true, playerId, balance: gameEngine.getBalance(playerId) });
});

router.post("/game/bet", (req, res, next) => {
  try {
    const body = z.object({
      playerId: z.string().min(1),
      amount: z.coerce.number().positive(),
      autoCashout: z.coerce.number().min(1.01).nullable().optional(),
    });
    const payload = body.parse(req.body);
    gameEngine.placeBet(payload.playerId, payload.amount, payload.autoCashout ?? null);
    res.status(201).json({
      ok: true,
      state: gameEngine.getPublicState(),
      balance: gameEngine.getBalance(payload.playerId),
    });
  } catch (error) {
    next(error);
  }
});

router.post("/game/cashout", (req, res, next) => {
  try {
    const body = z.object({
      playerId: z.string().min(1),
    });
    const payload = body.parse(req.body);
    const outcome = gameEngine.cashout(payload.playerId);
    res.json({
      ok: true,
      outcome,
      balance: gameEngine.getBalance(payload.playerId),
      state: gameEngine.getPublicState(),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/game/verify/:gameId", (req, res, next) => {
  try {
    const gameId = Number(req.params.gameId);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      throw new Error("Invalid gameId.");
    }
    const game = gameEngine.getHistory(100).find((g) => g.gameId === gameId);
    if (!game) {
      res.status(404).json({ ok: false, error: "Game not found in history." });
      return;
    }
    const verified = gameEngine.verifyGame(game.serverSeed, game.gameId, game.version);
    res.json({
      ok: true,
      gameId: game.gameId,
      serverSeed: game.serverSeed,
      recordedPeakMultiplier: game.peakMultiplier,
      verifiedPeakMultiplier: verified.peakMultiplier,
      rugged: verified.rugged,
      match: Math.abs(verified.peakMultiplier - game.peakMultiplier) < 0.000001,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
