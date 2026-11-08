import { describe, expect, test } from "bun:test";
import { buildWhatsAppUrl } from "../../../src/utils/whatsapp.js";

describe("buildWhatsAppUrl", () => {
  test("keeps digits only and encodes the message", () => {
    const url = buildWhatsAppUrl("+62 812-3456-7890", "Halo Siti & Budi? 100%");
    expect(url).toBe("https://wa.me/6281234567890?text=Halo%20Siti%20%26%20Budi%3F%20100%25");
  });

  test("round-trips the text through the query string", () => {
    const text = "Jadwal (NP-20261110-A7K2) pukul 10.00 WIB\nTerima kasih";
    const url = new URL(buildWhatsAppUrl("+6281234567890", text));
    expect(url.host).toBe("wa.me");
    expect(url.pathname).toBe("/6281234567890");
    expect(url.searchParams.get("text")).toBe(text);
  });

  test("never breaks out of the query when the text contains url syntax", () => {
    const url = new URL(buildWhatsAppUrl("+6281234567890", "a=b&c=d#frag?x"));
    expect([...url.searchParams.keys()]).toEqual(["text"]);
    expect(url.hash).toBe("");
  });
});
