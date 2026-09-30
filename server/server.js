const express = require("express");
const cors = require("cors");
const employeesRouter = require("./routes/employees");
const authRouter = require("./routes/auth");
const trackersRouter = require("./routes/trackers");

const app = express();
const PORT = process.env.PORT || 4000;

// Only the HR portal (GitHub Pages) and local development may call the API from a browser.
const ALLOWED_ORIGINS = (process.env.HR_ALLOWED_ORIGINS ||
  "https://rituchopra07.github.io,http://127.0.0.1:8080,http://localhost:8080,http://localhost:5173")
  .split(",").map((s) => s.trim()).filter(Boolean);

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || ALLOWED_ORIGINS.includes(origin)),
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 600,
}));
app.use(express.json({ limit: "1mb" }));

app.use("/api/employees", employeesRouter);
app.use("/api/auth", authRouter);
app.use("/api/trackers", trackersRouter);

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// never leak stack traces or connection details to the browser
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server" });
});

app.listen(PORT, () => {
  console.log(`HR server running at http://localhost:${PORT}`);
});
