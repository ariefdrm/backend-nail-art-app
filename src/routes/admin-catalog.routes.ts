import { Router } from "express";
import {
  createArtist,
  createService,
  deleteArtist,
  deleteService,
  listArtists,
  listServices,
  updateArtist,
  updateService,
} from "../controllers/admin-catalog.controller.js";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  createArtistSchemas,
  createServiceSchemas,
  idSchemas,
  updateArtistSchemas,
  updateServiceSchemas,
} from "../schemas/catalog.schema.js";

// Mounted at /admin; every route requires a valid admin access token.
const adminCatalog = Router();

adminCatalog.get("/services", authenticate, listServices);
adminCatalog.post("/services", authenticate, validate(createServiceSchemas), createService);
adminCatalog.put("/services/:id", authenticate, validate(updateServiceSchemas), updateService);
adminCatalog.delete("/services/:id", authenticate, validate(idSchemas), deleteService);

adminCatalog.get("/artists", authenticate, listArtists);
adminCatalog.post("/artists", authenticate, validate(createArtistSchemas), createArtist);
adminCatalog.put("/artists/:id", authenticate, validate(updateArtistSchemas), updateArtist);
adminCatalog.delete("/artists/:id", authenticate, validate(idSchemas), deleteArtist);

export default adminCatalog;
