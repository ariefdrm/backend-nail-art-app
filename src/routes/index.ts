import { Router } from "express";
import adminBookingRoutes from "./admin-booking.routes.js";
import adminScheduleRoutes from "./admin-schedule.routes.js";
import adminCatalogRoutes from "./admin-catalog.routes.js";
import availabilityRoutes from "./availability.routes.js";
import authRoutes from "./auth.routes.js";
import bookingRoutes from "./booking.routes.js";
import catalogRoutes from "./catalog.routes.js";
import dashboardRoutes from "./dashboard.routes.js";
import healthRoutes from "./health.routes.js";

const routes = Router();
const v1 = Router();

// Feature routers (auth, catalog, bookings, admin, ...) mount on `v1`.
// API contract: documents/openapi.yaml (servers: /api/v1)
routes.use("/health", healthRoutes);
v1.use("/auth", authRoutes);
v1.use("/admin", adminScheduleRoutes);
v1.use("/admin", adminBookingRoutes);
v1.use("/admin", dashboardRoutes);
v1.use(catalogRoutes);
v1.use(availabilityRoutes);
v1.use(bookingRoutes);
v1.use("/admin", adminCatalogRoutes);
routes.use("/api/v1", v1);

export default routes;
