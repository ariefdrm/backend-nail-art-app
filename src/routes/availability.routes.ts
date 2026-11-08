import { Router } from "express";
import { getAvailability } from "../controllers/availability.controller.js";
import { validate } from "../middleware/validate.js";
import { availabilitySchemas } from "../schemas/availability.schema.js";

const availability = Router();

availability.get("/availability", validate(availabilitySchemas), getAvailability);

export default availability;
