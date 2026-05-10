import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// 🚨 1. Define the routes that REQUIRE you to be logged in
const protectedRoutes = [
  '/inbox', 
  '/chat',               // <-- ADDED: Protects all /chat/[roomId] pages
  '/admin',              // <-- ADDED: Protects the admin dashboard
  '/create-product', 
  '/profile', 
  '/shops/dashboard',
  '/shops/register',     // <-- ADDED (just in case it's different from shop-application)
  '/support',
  '/verify-student',
  '/shop-application'
];
// 🚨 2. Define routes that you CANNOT visit if you are already logged in
const publicOnlyRoutes = [
  '/login'
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Check if the user has our magical Auth Context cookie
  const hasAuthSession = request.cookies.has('client_auth_sync');

  // 2. Are they trying to access a protected route?
  const isProtectedRoute = protectedRoutes.some(route => pathname.startsWith(route));
  
  if (isProtectedRoute && !hasAuthSession) {
    console.log(`Middleware blocked access to ${pathname}. Redirecting to /login.`);
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  // 3. Are they trying to go to /login when they are ALREADY logged in?
  const isPublicOnlyRoute = publicOnlyRoutes.some(route => pathname.startsWith(route));

  if (isPublicOnlyRoute && hasAuthSession) {
    console.log(`Middleware blocked access to ${pathname}. Already logged in, sending to home.`);
    const homeUrl = new URL('/', request.url);
    return NextResponse.redirect(homeUrl);
  }

  // 4. Otherwise, let them pass!
  return NextResponse.next();
}

// 🚨 OPTIMIZATION: Tell Next.js to ignore image files, APIs, and static assets so it runs instantly
export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.png$).*)'],
};