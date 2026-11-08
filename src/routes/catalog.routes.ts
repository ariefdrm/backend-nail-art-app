import { Router } from "express";
import { getService, listArtists, listServices } from "../controllers/catalog.controller.js";
import { validate } from "../middleware/validate.js";
import { idSchemas, listServicesSchemas } from "../schemas/catalog.schema.js";

const catalog = Router();

catalog.get("/services", validate(listServicesSchemas), listServices);
catalog.get("/services/:id", validate(idSchemas), getService);
catalog.get("/artists", listArtists);

export default catalog;
