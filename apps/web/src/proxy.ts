import { NextResponse, type NextRequest } from "next/server";

/**
 * A Content-Security-Policy on every page, so markup that slips past the
 * board's sanitisers (tutor HTML and SVG are model output, and a student's
 * material can steer the model) still cannot run script: only Next's own
 * scripts, carrying this request's nonce, may execute. Inline event handlers
 * and javascript: URLs are blocked outright.
 *
 * Styles stay 'unsafe-inline': React style props, KaTeX and the hand-drawn
 * SVGs all use inline styles, and none of them can run code.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV === "development";
  const tutor = tutorOrigins();
  const csp = [
    "default-src 'self'",
    // Dev needs eval for React's error overlays; production does not.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${tutor.http}`,
    `media-src 'self' blob: ${tutor.http}`,
    "font-src 'self' data:",
    `connect-src 'self' ${tutor.http} ${tutor.ws}`,
    // Interactive models are pages on the tutor server, shown in a sandboxed frame.
    `frame-src ${tutor.http}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "microphone=(self), camera=(), geolocation=()");
  return response;
}

/** Where the tutor server lives, as http and websocket origins (the board talks to both). */
function tutorOrigins(): { http: string; ws: string } {
  const http = new URL(process.env.NEXT_PUBLIC_TUTOR_HTTP ?? "http://localhost:8787").origin;
  const ws = new URL(process.env.NEXT_PUBLIC_TUTOR_WS ?? http.replace(/^http/, "ws")).origin;
  return { http, ws };
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
