/**
 * The visitor's address, from X-Forwarded-For. Each proxy adds the address it saw to the end, and a
 * visitor can send the header with anything already in it. So only the entries our own proxies added
 * can be believed, which means counting from the end. With two proxies, the visitor is second from
 * the end. Returns undefined when it can't tell, so the caller can use the connection's address.
 */
export function forwardedAddress(
  header: string | undefined,
  trustedProxies: number,
): string | undefined {
  if (!header || trustedProxies < 1) {
    return undefined;
  }
  const entries = header.split(",").map((entry) => entry.trim());
  return entries[entries.length - trustedProxies] || undefined;
}
