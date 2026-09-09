const express = require("express");
const cors = require("cors");
const employeesRouter = require("./routes/employees");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.use("/api/employees", employeesRouter);

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`HR server running at http://localhost:${PORT}`);
});
