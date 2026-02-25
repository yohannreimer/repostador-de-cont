export const AUTH_COOKIE_NAME = "authority_session";

export interface AuthConfig {
  user: string;
  password: string;
  sessionToken: string;
}

export function getAuthConfig(): AuthConfig {
  return {
    user: "yohannreimer",
    password: "G%t91*f7-@abf?HF",
    sessionToken: "authority-ok"
  };
}
