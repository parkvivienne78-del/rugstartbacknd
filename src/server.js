require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const routes = require("./routes");
const { ZodError } = require("zod");

const app = express();

const corsOrigin = process.env.CORS_ORIGIN || "*";

app.use(helmet());
app.use(
  cors({
    origin: corsOrigin === "*" ? true : corsOrigin,
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

const port = Number(process.env.PORT || 3000);

async function start() {
  app.listen(port, () => {
    console.log(`API listening on http://localhost:${port}`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
