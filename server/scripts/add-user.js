#!/usr/bin/env node
// Manage HR users for the tracker API. Uses server/.env like the server does: with HR_TRACKER_STORE=postgres the
// users live in the database (hr_users); otherwise in data/hr-users.json (git-ignored).
//
//   node scripts/add-user.js <email> "<Full name>" [admin|hr]   add a user, or reset their password / name / role
//   node scripts/add-user.js --list                             list users (no password data)
//   node scripts/add-user.js --disable <email>                  block sign-in (takes effect within a minute)
//   node scripts/add-user.js --enable <email>
//   node scripts/add-user.js --import [file]                    copy users from data/hr-users.json into the database
//                                                               (keeps their password hashes; skips emails already there)
//
// Passwords are prompted (not echoed) and stored only as bcrypt hashes.
const path = require("path");
try { process.loadEnvFile(path.join(__dirname, "..", ".env")); } catch (e) { if (e.code !== "ENOENT") throw e; }

const readline = require("readline");
const bcrypt = require("bcryptjs");
const { getUsers, fileUsers, ROLES, USERS_FILE } = require("../lib/users");
const { closePool } = require("../lib/pg");

const USAGE = 'Usage: node scripts/add-user.js <email> "<Full name>" [admin|hr]  |  --list  |  --disable <email>  |  --enable <email>  |  --import [file]';

function askHidden(q) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl._writeToOutput = (s) => { if (!rl.stdoutMuted) rl.output.write(s); };
    rl.question(q, (a) => { rl.close(); process.stdout.write("\n"); resolve(a); });
    rl.stdoutMuted = true;
  });
}

async function main(args) {
  const users = getUsers();
  const [cmd, arg] = args;

  if (cmd === "--list") {
    const list = await users.list();
    if (!list.length) return console.log(`No users yet (${users.where}).`);
    list.forEach((u) => console.log(`${u.active ? "active  " : "DISABLED"}  ${u.role.padEnd(5)}  ${u.name} <${u.email}>`));
    return console.log(`${list.length} user(s) in ${users.where}.`);
  }

  if (cmd === "--disable" || cmd === "--enable") {
    if (!arg) throw new Error(USAGE);
    const on = cmd === "--enable";
    if (!(await users.setActive(arg, on))) throw new Error(`No user ${arg}`);
    return console.log(`${on ? "Enabled" : "Disabled"} ${arg.toLowerCase()} (${users.where}).`);
  }

  if (cmd === "--import") {
    if (users.kind !== "postgres") throw new Error("--import copies users into the database; set HR_TRACKER_STORE=postgres in server/.env first.");
    const source = fileUsers(arg ? path.resolve(arg) : USERS_FILE);
    const list = await source.list();
    if (!list.length) return console.log(`Nothing to import from ${source.where}.`);
    for (const u of list) {
      const added = await users.upsert(u, { keepExisting: true });
      console.log(`${added ? "Imported" : "Skipped (already in database)"}: ${u.name} <${u.email}> (${u.role}${u.active ? "" : ", disabled"})`);
    }
    return console.log(`Done. Once you've checked --list, ${source.where} is no longer needed and can be deleted.`);
  }

  const [email, name, role = "hr"] = args;
  if (!email || !name || email.startsWith("--")) throw new Error(USAGE);
  if (!ROLES.includes(role)) throw new Error(`Role must be one of: ${ROLES.join(", ")}`);
  const pw = await askHidden(`Password for ${email}: `);
  if (pw.length < 10) throw new Error("Use at least 10 characters.");
  const again = await askHidden("Repeat password: ");
  if (pw !== again) throw new Error("Passwords don't match.");
  await users.upsert({ email, name, role, active: true, passwordHash: await bcrypt.hash(pw, 12) });
  console.log(`Saved ${name} <${email.toLowerCase()}> (${role}) to ${users.where}`);
}

main(process.argv.slice(2))
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => closePool());
