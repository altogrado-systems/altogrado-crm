/**
 * API local para desarrollo (sin `vercel login`).
 * Carga .env y expone las mismas rutas que /api en Vercel.
 */
import { config } from "dotenv";
import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import loginHandler from "../api/auth/login.js";
import sheetsHandler from "../api/sheets.js";
import makeHandler from "../api/make.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "../.env") });

function vercelRes(expressRes) {
  let statusCode = 200;
  const headers = {};
  return {
    status(code) {
      statusCode = code;
      return this;
    },
    setHeader(name, value) {
      headers[name] = value;
      return this;
    },
    end(body) {
      expressRes.status(statusCode);
      for (const [k, v] of Object.entries(headers)) {
        expressRes.setHeader(k, v);
      }
      expressRes.send(body);
    },
  };
}

function wrap(handler) {
  return (req, res) => {
    Promise.resolve(handler(req, vercelRes(res))).catch((err) => {
      console.error("[local-api]", req.method, req.url, err.message);
      if (!res.headersSent) {
        const code = err.status && err.status >= 400 ? err.status : 500;
        res.status(code).json({ error: err.message || "Error interno" });
      }
    });
  };
}

const app = express();
app.use(express.json());

app.post("/api/auth/login", wrap(loginHandler));
app.get("/api/sheets", wrap(sheetsHandler));
app.post("/api/make", wrap(makeHandler));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

const port = Number(process.env.API_PORT) || 3000;
app.listen(port, "127.0.0.1", () => {
  console.log(`[local-api] http://127.0.0.1:${port} (/.env cargado)`);
});
