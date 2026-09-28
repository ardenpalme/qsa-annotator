import { cookies } from 'next/headers';
import { verifyGate, CVAT_COOKIE } from '@/lib/cvat-gate';

export async function GET() {
  const ok = await verifyGate((await cookies()).get(CVAT_COOKIE)?.value);
  return new Response(null, { status: ok ? 204 : 401 });
}
