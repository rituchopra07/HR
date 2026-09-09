# HR Management System

A simple HR management web app to track employees — built with React (Vite) on the
frontend and Node/Express on the backend, with a JSON file as the data store.

## Project structure

```
HR/
├── client/    # React (Vite) frontend
└── server/    # Express API server
```

## Getting started

### 1. Start the API server

```bash
cd server
npm install
npm run dev
```

The server runs at http://localhost:4000.

### 2. Start the frontend

In a separate terminal:

```bash
cd client
npm install
npm run dev
```

The app runs at http://localhost:5173 and talks to the API at http://localhost:4000.

## API endpoints

| Method | Endpoint              | Description            |
|--------|------------------------|-------------------------|
| GET    | /api/employees          | List all employees      |
| GET    | /api/employees/:id      | Get one employee        |
| POST   | /api/employees          | Create a new employee   |
| PUT    | /api/employees/:id      | Update an employee      |
| DELETE | /api/employees/:id      | Remove an employee      |

## Next steps

- Swap the JSON file store for a real database (e.g. PostgreSQL, MongoDB)
- Add authentication/login
- Add attendance, leave, and payroll modules
