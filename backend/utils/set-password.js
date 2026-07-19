import bcrypt from 'bcryptjs';

const password = process.argv[2];
if (!password) {
  console.error("Usage: node set-password.js <password>");
  process.exit(1);
}

const hash = await bcrypt.hash(password, 12);
console.log(`Hashed password: ${hash}`);
