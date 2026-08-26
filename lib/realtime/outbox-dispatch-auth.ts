import { isAuthorizedBearerSecret } from "../security/bearer-secret";

export function isAuthorizedOutboxDispatch(
  authorizationHeader: string | null,
  expectedSecret: string,
): boolean {
  return isAuthorizedBearerSecret(authorizationHeader, expectedSecret);
}
