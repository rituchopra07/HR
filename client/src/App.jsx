import { useEffect, useState } from "react";
import "./App.css";

const API_BASE = "http://localhost:4000/api";

const EMPTY_FORM = {
  name: "",
  email: "",
  department: "",
  position: "",
  joinDate: "",
  status: "Active",
};

function App() {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);

  async function loadEmployees() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/employees`);
      if (!res.ok) throw new Error("Failed to load employees");
      setEmployees(await res.json());
    } catch (err) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadEmployees();
  }, []);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  }

  function startEdit(employee) {
    setEditingId(employee.id);
    setForm({
      name: employee.name,
      email: employee.email,
      department: employee.department,
      position: employee.position,
      joinDate: employee.joinDate,
      status: employee.status,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    try {
      const url = editingId
        ? `${API_BASE}/employees/${editingId}`
        : `${API_BASE}/employees`;
      const method = editingId ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to save employee");
      }
      cancelEdit();
      await loadEmployees();
    } catch (err) {
      setError(err.message || "Something went wrong");
    }
  }

  async function handleDelete(id) {
    if (!confirm("Remove this employee?")) return;
    setError("");
    try {
      const res = await fetch(`${API_BASE}/employees/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete employee");
      if (editingId === id) cancelEdit();
      await loadEmployees();
    } catch (err) {
      setError(err.message || "Something went wrong");
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>HR Management</h1>
        <p>Manage your organization's employees</p>
      </header>

      {error && <div className="banner error">{error}</div>}

      <section className="card">
        <h2>{editingId ? "Edit Employee" : "Add Employee"}</h2>
        <form className="employee-form" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="name">Name</label>
            <input id="name" name="name" value={form.name} onChange={handleChange} required />
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              value={form.email}
              onChange={handleChange}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="department">Department</label>
            <input
              id="department"
              name="department"
              value={form.department}
              onChange={handleChange}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="position">Position</label>
            <input
              id="position"
              name="position"
              value={form.position}
              onChange={handleChange}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="joinDate">Join Date</label>
            <input
              id="joinDate"
              name="joinDate"
              type="date"
              value={form.joinDate}
              onChange={handleChange}
            />
          </div>
          <div className="field">
            <label htmlFor="status">Status</label>
            <select id="status" name="status" value={form.status} onChange={handleChange}>
              <option value="Active">Active</option>
              <option value="On Leave">On Leave</option>
              <option value="Inactive">Inactive</option>
            </select>
          </div>

          <div className="form-actions">
            <button type="submit" className="primary">
              {editingId ? "Save Changes" : "Add Employee"}
            </button>
            {editingId && (
              <button type="button" className="secondary" onClick={cancelEdit}>
                Cancel
              </button>
            )}
          </div>
        </form>
      </section>

      <section className="card">
        <h2>Employees ({employees.length})</h2>
        {loading ? (
          <p>Loading...</p>
        ) : employees.length === 0 ? (
          <p>No employees yet. Add one above.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Department</th>
                  <th>Position</th>
                  <th>Join Date</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {employees.map((emp) => (
                  <tr key={emp.id}>
                    <td>{emp.name}</td>
                    <td>{emp.email}</td>
                    <td>{emp.department}</td>
                    <td>{emp.position}</td>
                    <td>{emp.joinDate}</td>
                    <td>
                      <span className={`status status-${emp.status.replace(/\s+/g, "-").toLowerCase()}`}>
                        {emp.status}
                      </span>
                    </td>
                    <td className="row-actions">
                      <button type="button" onClick={() => startEdit(emp)}>
                        Edit
                      </button>
                      <button type="button" className="danger" onClick={() => handleDelete(emp.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default App;
