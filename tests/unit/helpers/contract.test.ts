// The contract checker must itself catch drift, otherwise the contract tests prove nothing.
import { describe, expect, test } from "bun:test";
import { checkResponse, documentedOperations, undocumentedFields } from "../../helpers/contract.js";

const service = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Gel Polish",
  description: null,
  category: "gel_polish",
  price: 150000,
  duration_minutes: 90,
  image_url: null,
  is_active: true,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("contract checker", () => {
  test("accepts a response that matches the contract, including nullable fields", async () => {
    const { problems } = await checkResponse(json({ data: service }), "GET", "/services/{id}");
    expect(problems).toEqual([]);
  });

  test("flags a field the contract does not declare, even deep inside the body", async () => {
    const top = await checkResponse(json({ data: { ...service, secret: 1 } }), "GET", "/services/{id}");
    expect(top.problems).toContain("$.data.secret is not documented");
    const list = await checkResponse(json({ data: [{ ...service, extra: true }] }), "GET", "/services");
    expect(list.problems).toContain("$.data[0].extra is not documented");
  });

  test("flags a value of the wrong type or format", async () => {
    const wrongType = await checkResponse(json({ data: { ...service, price: "free" } }), "GET", "/services/{id}");
    expect(wrongType.problems.join(" ")).toContain("/data/price");
    const badUuid = await checkResponse(json({ data: { ...service, id: "not-a-uuid" } }), "GET", "/services/{id}");
    expect(badUuid.problems.join(" ")).toContain("/data/id");
  });

  test("flags a status code the contract does not document, and an operation it does not know", async () => {
    const status = await checkResponse(json({ error: {} }, 418), "GET", "/services/{id}");
    expect(status.problems[0]).toContain("418");
    const unknown = await checkResponse(json({}), "GET", "/nope");
    expect(unknown.problems[0]).toContain("not in the contract");
  });

  test("validates error bodies against the Error schema and expects no body for 204", async () => {
    const good = await checkResponse(
      json({ error: { code: "NOT_FOUND", message: "Layanan tidak ditemukan" } }, 404),
      "GET",
      "/services/{id}",
    );
    expect(good.problems).toEqual([]);
    const noContent = await checkResponse(new Response(null, { status: 204 }), "DELETE", "/admin/services/{id}");
    expect(noContent.problems).toEqual([]);
    const withBody = await checkResponse(json({ data: 1 }, 204), "DELETE", "/admin/services/{id}");
    expect(withBody.problems.join(" ")).toContain("no body");
  });

  test("lists every operation of the contract", () => {
    const operations = documentedOperations().map((o) => `${o.method} ${o.path}`);
    expect(operations).toContain("POST /bookings");
    expect(operations).toContain("PATCH /admin/bookings/{id}/status");
    expect(operations.length).toBeGreaterThan(30);
  });

  test("undocumentedFields leaves free-form objects alone", () => {
    expect(undocumentedFields({ type: "object" }, { anything: 1 })).toEqual([]);
  });
});
