import { Router } from "express";
import appRoute from "./app.route.js";
import healthRoutes from "./health.routes.js";

const routes = Router();

routes.use("/health", healthRoutes);
// API contract: documents/openapi.yaml (servers: /api/v1)
routes.use("/api/v1", appRoute);

export default routes;
