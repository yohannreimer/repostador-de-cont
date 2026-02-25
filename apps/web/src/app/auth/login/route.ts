import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, getAuthConfig } from "../../../lib/auth";

interface LoginPayload {
  username?: string;
  password?: string;
  next?: string;
}

function normalizeNext(input: string | null | undefined): string {
  if (!input || !input.startsWith("/")) {
    return "/";
  }
  if (input.startsWith("//")) {
    return "/";
  }
  return input;
}

export async function POST(request: Request): Promise<NextResponse> {
  let payload: LoginPayload = {};

  try {
    payload = (await request.json()) as LoginPayload;
  } catch {
    payload = {};
  }

  const config = getAuthConfig();
  const username = payload.username?.trim() ?? "";
  const password = payload.password ?? "";

  if (username !== config.user || password !== config.password) {
    return NextResponse.json(
      { error: "Credenciais invalidas." },
      {
        status: 401
      }
    );
  }

  const destination = normalizeNext(payload.next);
  const response = NextResponse.json({
    ok: true,
    redirectTo: destination
  });

  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: config.sessionToken,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 14
  });

  return response;
}
