import { Router } from "express";
import { live, ready } from "../controllers/health.controller.js";

const health = Router();

health.get("/live", live);
health.get("/ready", ready);

export default health;
