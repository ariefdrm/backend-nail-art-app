import { describe, expect, test } from "bun:test";
import { isAllowedPushEndpoint } from "../../../src/utils/push-endpoint.js";

describe("isAllowedPushEndpoint", () => {
  test("accepts the push services the browsers use, including their subdomains", () => {
    for (const endpoint of [
      "https://fcm.googleapis.com/fcm/send/abc",
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://web.push.apple.com/abc",
      "https://wns2-par02p.notify.windows.com/w/?token=abc",
    ]) {
      expect(isAllowedPushEndpoint(endpoint)).toBe(true);
    }
  });

  test("refuses anything that would make the server call somewhere else (SSRF)", () => {
    for (const endpoint of [
      "http://fcm.googleapis.com/fcm/send/abc", // not https
      "https://localhost/push",
      "https://127.0.0.1/push",
      "https://169.254.169.254/latest/meta-data/", // cloud metadata
      "https://10.0.0.5/internal",
      "https://[::1]/push",
      "https://evil.test/fcm.googleapis.com",
      "https://fcm.googleapis.com.evil.test/abc", // look-alike suffix
      "https://evilfcm.googleapis.com.test/abc",
      "https://notfcm.googleapis.com.evil.test/abc",
      "https://user:pass@fcm.googleapis.com/abc", // credentials
      "https://fcm.googleapis.com:8443/abc", // custom port
      "file:///etc/passwd",
      "not a url",
      "",
    ]) {
      expect(isAllowedPushEndpoint(endpoint)).toBe(false);
    }
  });

  test("is case-insensitive about the host", () => {
    expect(isAllowedPushEndpoint("https://FCM.GoogleAPIs.com/fcm/send/abc")).toBe(true);
  });

  test("a host that merely ends with the domain text is not a subdomain", () => {
    expect(isAllowedPushEndpoint("https://xfcm.googleapis.com/abc")).toBe(false);
  });
});
