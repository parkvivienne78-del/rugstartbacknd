const {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
} = require("@solana/web3.js");

const processedDeposits = new Map();

function getConnection() {
  const rpcUrl =
    process.env.SOLANA_RPC_URL ||
    (process.env.SOLANA_NETWORK === "mainnet-beta"
      ? "https://api.mainnet-beta.solana.com"
      : "https://api.devnet.solana.com");

  return new Connection(rpcUrl, {
    commitment: process.env.SOLANA_COMMITMENT || "confirmed",
  });
}

function getTreasuryWallet() {
  const address = process.env.SOLANA_TREASURY_WALLET;
  if (!address) {
    throw new Error("Missing SOLANA_TREASURY_WALLET environment variable.");
  }
  return new PublicKey(address);
}

function solToLamports(sol) {
  return Math.round(Number(sol) * LAMPORTS_PER_SOL);
}

function lamportsToSol(lamports) {
  return Number(lamports) / LAMPORTS_PER_SOL;
}

function validatePublicKey(address, name = "wallet address") {
  try {
    return new PublicKey(address);
  } catch (_error) {
    throw new Error(`Invalid ${name}.`);
  }
}

async function verifySolDeposit({
  txSignature,
  expectedSender,
  expectedAmountSol = null,
  minAmountSol = 0,
}) {
  if (!txSignature || typeof txSignature !== "string") {
    throw new Error("Missing transaction signature.");
  }

  if (processedDeposits.has(txSignature)) {
    return {
      ok: true,
      duplicate: true,
      ...processedDeposits.get(txSignature),
    };
  }

  const connection = getConnection();
  const treasury = getTreasuryWallet();
  const sender = expectedSender ? validatePublicKey(expectedSender, "sender wallet address") : null;

  const tx = await connection.getParsedTransaction(txSignature, {
    maxSupportedTransactionVersion: 0,
    commitment: process.env.SOLANA_COMMITMENT || "confirmed",
  });

  if (!tx) {
    throw new Error("Transaction not found yet. Try again in a few seconds.");
  }

  if (tx.meta && tx.meta.err) {
    throw new Error("Transaction failed on-chain.");
  }

  let found = null;

  for (const ix of tx.transaction.message.instructions || []) {
    if (!ix || ix.program !== "system") continue;
    const parsed = ix.parsed;
    if (!parsed || parsed.type !== "transfer") continue;

    const info = parsed.info || {};
    const destination = String(info.destination || "");
    const source = String(info.source || "");
    const lamports = Number(info.lamports || 0);

    if (destination !== treasury.toBase58()) continue;
    if (sender && source !== sender.toBase58()) continue;

    found = { source, destination, lamports };
    break;
  }

  if (!found) {
    throw new Error("No valid SOL transfer to treasury wallet found in this transaction.");
  }

  const amountSol = lamportsToSol(found.lamports);
  const minLamports = solToLamports(minAmountSol || 0);

  if (found.lamports < minLamports) {
    throw new Error("Deposit is below the minimum amount.");
  }

  if (expectedAmountSol !== null && expectedAmountSol !== undefined) {
    const expectedLamports = solToLamports(expectedAmountSol);
    // allow tiny rounding tolerance
    if (Math.abs(found.lamports - expectedLamports) > 5) {
      throw new Error("Transaction amount does not match expected amount.");
    }
  }

  const result = {
    signature: txSignature,
    sender: found.source,
    destination: found.destination,
    lamports: found.lamports,
    amountSol,
    slot: tx.slot,
    blockTime: tx.blockTime,
    network: process.env.SOLANA_NETWORK || "devnet",
  };

  processedDeposits.set(txSignature, result);
  return {
    ok: true,
    duplicate: false,
    ...result,
  };
}

module.exports = {
  getConnection,
  getTreasuryWallet,
  verifySolDeposit,
};
