export const AUTH_COOKIE_NAME = "authority_session";

export interface AuthCredential {
  user: string;
  password: string;
}

export interface AuthConfig {
  credentials: AuthCredential[];
  sessionToken: string;
}

export function getAuthConfig(): AuthConfig {
  const envUser = process.env.AUTH_LOGIN_USER?.trim();
  const envPassword = process.env.AUTH_LOGIN_PASSWORD?.trim();

  const credentials: AuthCredential[] = [];

  if (envUser && envPassword) {
    credentials.push({
      user: envUser,
      password: envPassword
    });
  }

  // Default primary credential requested by user.
  credentials.push({
    user: "yohannreimer",
    password: "G%t91*f7-@abf?HF"
  });

  return {
    credentials,
    sessionToken: "authority-ok"
  };
}
