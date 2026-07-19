import crypto from 'crypto';
const sessions = new Map();
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function createSession() {
console.log("Creating session",sessions);
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { expiresAt: Date.now() + SEVEN_DAYS_MS });
  return token;
}

export function getSession(token) {
  const entry = sessions.get(token);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    sessions.delete(token); // cleanup on expiry check
    return null;
  }
  return entry;
}

export function destroySession(token) {
  sessions.delete(token);
}

function destroyAllSessions() {
  sessions.clear();
}

