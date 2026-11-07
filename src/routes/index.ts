import { Router } from "express";
import authRoutes from "./auth.routes.js";
import healthRoutes from "./health.routes.js";

const routes = Router();
const v1 = Router();

// Feature routers (auth, catalog, bookings, admin, ...) mount on `v1`.
// API contract: documents/openapi.yaml (servers: /api/v1)
routes.use("/health", healthRoutes);
v1.use("/auth", authRoutes);
routes.use("/api/v1", v1);

export default routes;
