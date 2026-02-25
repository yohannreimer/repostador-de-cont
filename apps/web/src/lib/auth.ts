export const AUTH_COOKIE_NAME = "authority_session";

export interface AuthConfig {
  user: string;
  password: string;
  sessionToken: string;
}

export function getAuthConfig(): AuthConfig {
  return {
    user: "admin",
    password: "admin123",
    sessionToken: "authority-ok"
  };
}
