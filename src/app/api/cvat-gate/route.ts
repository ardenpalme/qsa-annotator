import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { signGate, CVAT_COOKIE } from '@/lib/cvat-gate';

export async function GET(req: Request) {
  const { userId, redirectToSignIn } = await auth();
  if (!userId) return redirectToSignIn({ returnBackUrl: req.url });

  const res = NextResponse.redirect('https://cvat.fpcadanot438.xyz/');
  res.cookies.set(CVAT_COOKIE, await signGate(userId), {
    domain: '.fpcadanot438.xyz',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 8 * 3600,
  });
  return res;
}
