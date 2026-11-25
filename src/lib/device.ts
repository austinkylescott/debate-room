// What this browser remembers about each Room: a random per-device token that
// identifies the same person on every reconnect, and the Host secret if this
// browser belongs to the Room's Host.

const tokenKey = (roomId: string) => `debate-room:${roomId}:token`;
const hostSecretKey = (roomId: string) => `debate-room:${roomId}:host-secret`;

export function deviceToken(roomId: string): string {
  const existing = read(tokenKey(roomId));
  if (existing) return existing;
  const token = crypto.randomUUID();
  write(tokenKey(roomId), token);
  return token;
}

export function savedHostSecret(roomId: string): string | null {
  return read(hostSecretKey(roomId));
}

export function saveHostSecret(roomId: string, hostSecret: string) {
  write(hostSecretKey(roomId), hostSecret);
}

export function forgetHostSecret(roomId: string) {
  try {
    localStorage.removeItem(hostSecretKey(roomId));
  } catch {
    // Storage can be unavailable (private mode); nothing to forget then.
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Without storage the device is a new person on every visit; still usable.
  }
}
