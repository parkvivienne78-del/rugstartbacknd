require("dotenv").config();

const http = require("http");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const { Server } = require("socket.io");
const routes = require("./routes");
const game = require("./gameEngine");

const app = express();

function origins() {
  const raw = process.env.CORS_ORIGIN || "https://rugstarts.com,https://www.rugstarts.com,http://localhost:5173,http://localhost:3000";
  if (raw === "*") return true;
  return raw.split(",").map((x) => x.trim()).filter(Boolean);
}

const allowedOrigins = origins();

app.disable("x-powered-by");
app.use(helmet({ crossOriginResourcePolicy: false, contentSecurityPolicy: false }));
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.options("*", cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(morgan("combined"));
app.use((req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
app.get("/", (_req, res) => res.json({ ok: true, service: "rugstarts-candleflip-backend" }));
app.use("/api", routes);
app.use((err, _req, res, _next) => {
  console.error("API error:", err);
  res.status(400).json({ ok: false, error: err.message || "Request failed" });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ["GET", "POST"], credentials: true },
  transports: ["websocket", "polling"],
});

function emitGame() {
  const currentGame = game.getCurrentGame();

  // Emit the same object under many common names so the compiled frontend can catch it.
  io.emit("currentGame", currentGame);
  io.emit("game", currentGame);
  io.emit("game:update", currentGame);
  io.emit("game:tick", currentGame);
  io.emit("game:t", currentGame);
  io.emit("game:u", currentGame);
  io.emit("tickCurrent", currentGame);
  io.emit("update", currentGame);
  io.emit("price", { gameId: currentGame.gameId, price: currentGame.price, tickCount: currentGame.tickCount });
  io.emit("leaderboard", game.leaderboard());

  if (currentGame.active) {
    io.emit("game:start", currentGame);
    io.emit("currentGameActive", true);
  } else {
    io.emit("game:cooldown", currentGame);
    if (currentGame.rugged) io.emit("game:rugged", currentGame);
  }
}

function handleBuy(socket, payload = {}, ack) {
  try {
    const playerId = String(payload.playerId || payload.privyUserId || payload.userId || payload.walletAddress || socket.id);
    const trade = game.buy({ playerId, username: payload.username, amount: Number(payload.amount || payload.size || 1) });
    const response = { ok: true, trade, currentGame: game.getCurrentGame(playerId), balance: game.getBalance(playerId) };
    socket.emit("trade:new", trade);
    socket.emit("newTrade", trade);
    socket.emit("balance", response.balance);
    emitGame();
    if (typeof ack === "function") ack(response);
  } catch (e) {
    const response = { ok: false, error: e.message };
    socket.emit("error:trade", response);
    if (typeof ack === "function") ack(response);
  }
}

function handleSell(socket, payload = {}, ack) {
  try {
    const playerId = String(payload.playerId || payload.privyUserId || payload.userId || payload.walletAddress || socket.id);
    const result = game.sell({ playerId, tradeId: payload.tradeId || payload.id });
    const response = { ok: true, ...result, currentGame: game.getCurrentGame(playerId) };
    socket.emit("trade:sold", result.trade);
    socket.emit("balance", result.balance);
    emitGame();
    if (typeof ack === "function") ack(response);
  } catch (e) {
    const response = { ok: false, error: e.message };
    socket.emit("error:trade", response);
    if (typeof ack === "function") ack(response);
  }
}

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.emit("connected", { ok: true, id: socket.id });
  socket.emit("currentGame", game.getCurrentGame(socket.id));
  socket.emit("game:update", game.getCurrentGame(socket.id));
  socket.emit("leaderboard", game.leaderboard());

  socket.on("buy", (p, ack) => handleBuy(socket, p, ack));
  socket.on("trade:buy", (p, ack) => handleBuy(socket, p, ack));
  socket.on("placeTrade", (p, ack) => handleBuy(socket, p, ack));
  socket.on("game:buy", (p, ack) => handleBuy(socket, p, ack));
  socket.on("game:bet", (p, ack) => handleBuy(socket, p, ack));
  socket.on("bet", (p, ack) => handleBuy(socket, p, ack));

  socket.on("sell", (p, ack) => handleSell(socket, p, ack));
  socket.on("trade:sell", (p, ack) => handleSell(socket, p, ack));
  socket.on("closeTrade", (p, ack) => handleSell(socket, p, ack));
  socket.on("game:sell", (p, ack) => handleSell(socket, p, ack));
  socket.on("game:cashout", (p, ack) => handleSell(socket, p, ack));
  socket.on("cashout", (p, ack) => handleSell(socket, p, ack));

  socket.on("getCurrentGame", (_p, ack) => {
    const currentGame = game.getCurrentGame(socket.id);
    socket.emit("currentGame", currentGame);
    if (typeof ack === "function") ack({ ok: true, currentGame });
  });

  socket.on("disconnect", (reason) => console.log("Socket disconnected:", socket.id, reason));
});

const port = Number(process.env.PORT || 3000);

game.startEngine();
setInterval(emitGame, Number(process.env.SOCKET_BROADCAST_MS || 250));

server.listen(port, () => console.log(`Rugstarts Candleflip backend listening on ${port}`));
