import { SignJWT, jwtVerify } from 'jose';

const secret = new TextEncoder().encode(process.env.CVAT_GATE_SECRET!);
export const CVAT_COOKIE = 'cvat_gate';

export async function signGate(userId: string) {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(secret);
}

export async function verifyGate(token?: string) {
  if (!token) return false;
  try {
    await jwtVerify(token, secret);
    return true;
  } catch {
    return false;
  }
}
