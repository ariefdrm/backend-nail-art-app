// The server POSTs to a subscription's endpoint, so an endpoint the client invents (http://localhost, a cloud
// metadata address, an internal service) would turn this API into a request forger (SSRF). Only the push
// services that the browsers use are accepted.
const PUSH_SERVICE_DOMAINS = [
  "fcm.googleapis.com", // Chrome, Edge, Brave, Samsung Internet, Opera
  "push.services.mozilla.com", // Firefox
  "push.apple.com", // Safari
  "notify.windows.com", // legacy Edge/Windows
] as const;

/** An https URL, with no credentials or custom port, on one of the known push services (or a subdomain of one). */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") return false;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}
