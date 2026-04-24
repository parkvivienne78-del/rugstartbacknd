const express = require("express");
const { z } = require("zod");
const { getPool } = require("./db");
const {
  createOrGetUser,
  getBalanceByPrivyUserId,
  recordConfirmedDeposit,
  requestWithdrawal,
} = require("./services/walletService");

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

module.exports = router;
