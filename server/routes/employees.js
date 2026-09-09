const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();
const DATA_FILE = path.join(__dirname, "..", "data", "employees.json");

function readEmployees() {
  const raw = fs.readFileSync(DATA_FILE, "utf-8");
  return JSON.parse(raw);
}

function writeEmployees(employees) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(employees, null, 2));
}

// GET /api/employees - list all employees
router.get("/", (req, res) => {
  const employees = readEmployees();
  res.json(employees);
});

// GET /api/employees/:id - get one employee
router.get("/:id", (req, res) => {
  const employees = readEmployees();
  const employee = employees.find((e) => e.id === Number(req.params.id));
  if (!employee) return res.status(404).json({ error: "Employee not found" });
  res.json(employee);
});

// POST /api/employees - create a new employee
router.post("/", (req, res) => {
  const { name, email, department, position, joinDate, status } = req.body;
  if (!name || !email || !department || !position) {
    return res.status(400).json({ error: "name, email, department, and position are required" });
  }

  const employees = readEmployees();
  const nextId = employees.length > 0 ? Math.max(...employees.map((e) => e.id)) + 1 : 1;

  const newEmployee = {
    id: nextId,
    name,
    email,
    department,
    position,
    joinDate: joinDate || new Date().toISOString().slice(0, 10),
    status: status || "Active",
  };

  employees.push(newEmployee);
  writeEmployees(employees);
  res.status(201).json(newEmployee);
});

// PUT /api/employees/:id - update an employee
router.put("/:id", (req, res) => {
  const employees = readEmployees();
  const index = employees.findIndex((e) => e.id === Number(req.params.id));
  if (index === -1) return res.status(404).json({ error: "Employee not found" });

  const updated = { ...employees[index], ...req.body, id: employees[index].id };
  employees[index] = updated;
  writeEmployees(employees);
  res.json(updated);
});

// DELETE /api/employees/:id - remove an employee
router.delete("/:id", (req, res) => {
  const employees = readEmployees();
  const index = employees.findIndex((e) => e.id === Number(req.params.id));
  if (index === -1) return res.status(404).json({ error: "Employee not found" });

  const [removed] = employees.splice(index, 1);
  writeEmployees(employees);
  res.json(removed);
});

module.exports = router;
