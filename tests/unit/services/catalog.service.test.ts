import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { AppError } from "../../../src/utils/errors.js";

interface ServiceRow {
  id: string;
  name: string;
  description: string | null;
  category: string;
  price: number;
  durationMinutes: number;
  imageUrl: string | null;
  isActive: boolean;
  createdAt: Date;
}
interface ArtistRow {
  id: string;
  name: string;
  photoUrl: string | null;
  isActive: boolean;
  createdAt: Date;
}

const svc = (overrides: Partial<ServiceRow> = {}): ServiceRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  name: "Gel Polish",
  description: null,
  category: "gel_polish",
  price: 150000,
  durationMinutes: 90,
  imageUrl: null,
  isActive: true,
  createdAt: new Date(),
  ...overrides,
});
const art = (overrides: Partial<ArtistRow> = {}): ArtistRow => ({
  id: "22222222-2222-4222-8222-222222222222",
  name: "Owner",
  photoUrl: null,
  isActive: true,
  createdAt: new Date(),
  ...overrides,
});

let services: ServiceRow[] = [];
let artists: ArtistRow[] = [];
let deleteResult = true;
const calls = {
  listServices: [] as unknown[],
  listArtists: [] as unknown[],
  createService: [] as unknown[],
  updateService: [] as { id: string; data: unknown }[],
  deleteService: [] as string[],
  updateArtist: [] as { id: string; data: unknown }[],
};

await mock.module("../../../src/repositories/service.repository.js", () => ({
  listServices: (filter: { activeOnly: boolean; category?: string }) => {
    calls.listServices.push(filter);
    return Promise.resolve(services);
  },
  findServiceById: (id: string) => Promise.resolve(services.find((s) => s.id === id) ?? null),
  createService: (data: Partial<ServiceRow>) => {
    calls.createService.push(data);
    return Promise.resolve(svc(data));
  },
  updateService: (id: string, data: Partial<ServiceRow>) => {
    calls.updateService.push({ id, data });
    const found = services.find((s) => s.id === id);
    return Promise.resolve(found ? { ...found, ...data } : null);
  },
  deleteServiceIfUnused: (id: string) => {
    calls.deleteService.push(id);
    return Promise.resolve(deleteResult);
  },
}));
await mock.module("../../../src/repositories/artist.repository.js", () => ({
  listArtists: (filter: unknown) => {
    calls.listArtists.push(filter);
    return Promise.resolve(artists);
  },
  findArtistById: (id: string) => Promise.resolve(artists.find((a) => a.id === id) ?? null),
  createArtist: (data: Partial<ArtistRow>) => Promise.resolve(art(data)),
  updateArtist: (id: string, data: Partial<ArtistRow>) => {
    calls.updateArtist.push({ id, data });
    const found = artists.find((a) => a.id === id);
    return Promise.resolve(found ? { ...found, ...data } : null);
  },
}));

const catalog = await import("../../../src/services/catalog.service.js");

async function code(promise: Promise<unknown>): Promise<string | undefined> {
  return promise.then(
    () => undefined,
    (e: AppError) => e.code,
  );
}

beforeEach(() => {
  services = [svc()];
  artists = [art()];
  deleteResult = true;
  for (const key of Object.keys(calls) as (keyof typeof calls)[]) calls[key] = [] as never;
});

describe("public catalog", () => {
  test("lists active services only, with an optional category filter", async () => {
    await catalog.listPublicServices("gel_polish");
    await catalog.listPublicServices();
    expect(calls.listServices).toEqual([
      { activeOnly: true, category: "gel_polish" },
      { activeOnly: true, category: undefined },
    ]);
  });

  test("maps rows to the snake_case contract and leaks no internal fields", async () => {
    const [dto] = await catalog.listPublicServices();
    expect(dto).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      name: "Gel Polish",
      description: null,
      category: "gel_polish",
      price: 150000,
      duration_minutes: 90,
      image_url: null,
      is_active: true,
    });
  });

  test("an inactive or missing service is a 404 for customers", async () => {
    services = [svc({ isActive: false })];
    expect(await code(catalog.getPublicService("11111111-1111-4111-8111-111111111111"))).toBe("NOT_FOUND");
    expect(await code(catalog.getPublicService("99999999-9999-4999-8999-999999999999"))).toBe("NOT_FOUND");
  });

  test("lists active artists only", async () => {
    const result = await catalog.listPublicArtists();
    expect(calls.listArtists).toEqual([{ activeOnly: true }]);
    expect(result).toEqual([
      { id: "22222222-2222-4222-8222-222222222222", name: "Owner", photo_url: null, is_active: true },
    ]);
  });
});

describe("admin services", () => {
  const input = {
    name: "Gel Polish",
    description: "",
    category: "gel_polish",
    price: 150000,
    duration_minutes: 90,
    image_url: undefined,
    is_active: true,
  };

  test("lists inactive services too", async () => {
    await catalog.listAdminServices();
    expect(calls.listServices).toEqual([{ activeOnly: false }]);
  });

  test("maps the input to repository data (empty description and missing image become null)", async () => {
    await catalog.createService(input);
    expect(calls.createService).toEqual([
      {
        name: "Gel Polish",
        description: null,
        category: "gel_polish",
        price: 150000,
        durationMinutes: 90,
        imageUrl: null,
        isActive: true,
      },
    ]);
  });

  test("update returns the new row or a 404", async () => {
    const updated = await catalog.updateService("11111111-1111-4111-8111-111111111111", { ...input, price: 175000 });
    expect(updated.price).toBe(175000);
    expect(await code(catalog.updateService("99999999-9999-4999-8999-999999999999", input))).toBe("NOT_FOUND");
  });

  test("removing an unused service deletes it and does not deactivate", async () => {
    await catalog.removeService("11111111-1111-4111-8111-111111111111");
    expect(calls.deleteService).toHaveLength(1);
    expect(calls.updateService).toHaveLength(0);
  });

  test("removing a service that has bookings deactivates it instead", async () => {
    deleteResult = false;
    await catalog.removeService("11111111-1111-4111-8111-111111111111");
    expect(calls.updateService).toEqual([{ id: "11111111-1111-4111-8111-111111111111", data: { isActive: false } }]);
  });

  test("removing an unknown service is a 404 and deletes nothing", async () => {
    expect(await code(catalog.removeService("99999999-9999-4999-8999-999999999999"))).toBe("NOT_FOUND");
    expect(calls.deleteService).toHaveLength(0);
  });
});

describe("admin artists", () => {
  test("lists inactive artists too and creates with null photo by default", async () => {
    await catalog.listAdminArtists();
    expect(calls.listArtists).toEqual([{ activeOnly: false }]);
    const created = await catalog.createArtist({ name: "Second", is_active: true });
    expect(created.photo_url).toBeNull();
  });

  test("update and deactivate answer 404 for an unknown artist", async () => {
    expect(
      await code(catalog.updateArtist("99999999-9999-4999-8999-999999999999", { name: "x", is_active: true })),
    ).toBe("NOT_FOUND");
    expect(await code(catalog.deactivateArtist("99999999-9999-4999-8999-999999999999"))).toBe("NOT_FOUND");
  });

  test("deactivate flips is_active and never deletes", async () => {
    await catalog.deactivateArtist("22222222-2222-4222-8222-222222222222");
    expect(calls.updateArtist).toEqual([{ id: "22222222-2222-4222-8222-222222222222", data: { isActive: false } }]);
  });
});
