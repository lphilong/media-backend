import { auth } from "express-oauth2-jwt-bearer";

export function auth0JwtMiddleware(options: {
  issuerBaseURL: string;
  audience: string;
}) {
  return auth({
    issuerBaseURL: options.issuerBaseURL,
    audience: options.audience,
  });
}
