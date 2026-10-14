/**
 * Fetches the LAN IPv4 addresses exposed by the local HTTPS server.
 * GitHub Pages does not provide this endpoint, so the fallback explains
 * that the installed PWA does not need a host IP address.
 */
export const getLocalIP = async (): Promise<string> => {
  const pwaFallback = 'Not needed: both devices use the installed app';

  try {
    const response = await fetch('/api/ip', {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) return pwaFallback;

    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object' || !('addresses' in payload)) {
      return pwaFallback;
    }

    const addresses = (payload as { addresses?: unknown }).addresses;
    if (!Array.isArray(addresses)) return pwaFallback;

    const validAddresses = addresses.filter(
      (address): address is string => typeof address === 'string' && address.length > 0,
    );

    return validAddresses.length > 0
      ? validAddresses.join(', ')
      : 'No non-internal IPv4 address found';
  } catch {
    return pwaFallback;
  }
};
