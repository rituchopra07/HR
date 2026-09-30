#!/usr/bin/env node
// Add or update an HR user for the tracker API.
//   node scripts/add-user.js ritu.chopra@fountainheadschools.org "Ritu Chopra" [admin|hr]
// The password is prompted (not echoed) and stored only as a bcrypt hash in data/hr-users.json (git-ignored).
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const bcrypt = require("bcryptjs");
const { USERS_FILE, readUsers } = require("../lib/auth");

const [email, name, role = "hr"] = process.argv.slice(2);
if (!email || !name) {
  console.error('Usage: node scripts/add-user.js <email> "<Full name>" [admin|hr]');
  process.exit(1);
}

function askHidden(q) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl._writeToOutput = (s) => { if (!rl.stdoutMuted) rl.output.write(s); };
    rl.question(q, (a) => { rl.close(); process.stdout.write("\n"); resolve(a); });
    rl.stdoutMuted = true;
  });
}

(async () => {
  const pw = await askHidden(`Password for ${email}: `);
  if (pw.length < 10) { console.error("Use at least 10 characters."); process.exit(1); }
  const again = await askHidden("Repeat password: ");
  if (pw !== again) { console.error("Passwords don't match."); process.exit(1); }
  const users = readUsers().filter((u) => u.email.toLowerCase() !== email.toLowerCase());
  users.push({ email, name, role, active: true, passwordHash: await bcrypt.hash(pw, 12), createdAt: new Date().toISOString() });
  fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  console.log(`Saved ${name} <${email}> (${role}) to ${USERS_FILE}`);
})();
