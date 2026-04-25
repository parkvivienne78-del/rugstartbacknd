require("dotenv").config();

const http = require("http");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const { Server } = require("socket.io");
const { ZodError } = require("zod");

const routes = require("./routes");
const gameEngine = require("./gameEngine");

const app = express();

function getAllowedOrigins() {
  const raw = process.env.CORS_ORIGIN || "https://rugstarts.com,http://localhost:5173,http://localhost:3000";
  if (raw === "*") return true;
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

const allowedOrigins = getAllowedOrigins();

app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

app.use(express.json({ limit: "1mb" }));
app.use(morgan("combined"));

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    message: "Rugstart API is running. Use /api/health.",
  });
});

app.use("/api", routes);

app.use((err, _req, res, _next) => {
  console.error("API error:", err);

  if (err instanceof ZodError) {
    res.status(400).json({
      ok: false,
      error: "Validation failed.",
      issues: err.issues,
    });
    return;
  }

  const message = err instanceof Error ? err.message : "Internal server error";
  res.status(500).json({ ok: false, error: message });
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
});

function emitGameState() {
  io.emit("game:state", gameEngine.getPublicState());
  io.emit("gameState", gameEngine.getPublicState());
}

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.emit("connected", { id: socket.id });
  socket.emit("game:state", gameEngine.getPublicState());
  socket.emit("gameState", gameEngine.getPublicState());
  socket.emit("game:history", gameEngine.getHistory(20));

  socket.on("game:getState", () => {
    socket.emit("game:state", gameEngine.getPublicState());
    socket.emit("gameState", gameEngine.getPublicState());
  });

  socket.on("game:getHistory", (limit = 20) => {
    socket.emit("game:history", gameEngine.getHistory(Number(limit) || 20));
  });

  socket.on("game:bet", (payload = {}, ack) => {
    try {
      const playerId = String(payload.playerId || socket.id);
      const amount = Number(payload.amount);
      const autoCashout =
        payload.autoCashout === undefined || payload.autoCashout === null
          ? null
          : Number(payload.autoCashout);

      gameEngine.placeBet(playerId, amount, autoCashout);
      const response = {
        ok: true,
        state: gameEngine.getPublicState(),
        balance: gameEngine.getBalance(playerId),
      };

      socket.emit("game:balance", { playerId, balance: response.balance });
      emitGameState();
      if (typeof ack === "function") ack(response);
    } catch (error) {
      const response = { ok: false, error: error.message || "Bet failed." };
      socket.emit("game:error", response);
      if (typeof ack === "function") ack(response);
    }
  });

  socket.on("game:cashout", (payload = {}, ack) => {
    try {
      const playerId = String(payload.playerId || socket.id);
      const outcome = gameEngine.cashout(playerId);
      const response = {
        ok: true,
        outcome,
        balance: gameEngine.getBalance(playerId),
        state: gameEngine.getPublicState(),
      };

      socket.emit("game:balance", { playerId, balance: response.balance });
      emitGameState();
      if (typeof ack === "function") ack(response);
    } catch (error) {
      const response = { ok: false, error: error.message || "Cashout failed." };
      socket.emit("game:error", response);
      if (typeof ack === "function") ack(response);
    }
  });

  socket.on("disconnect", (reason) => {
    console.log("Socket disconnected:", socket.id, reason);
  });
});

const port = Number(process.env.PORT || 3000);

async function start() {
  gameEngine.startEngine();

  // Broadcast game state to connected clients at the same speed as the engine.
  const tickMs = Number(gameEngine.config.tickMs || 250);
  setInterval(emitGameState, tickMs);

  server.listen(port, () => {
    console.log(`API + Socket.IO listening on port ${port}`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
