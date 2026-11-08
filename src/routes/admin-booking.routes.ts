import { Router } from "express";
import {
  changeStatus,
  createBooking,
  getBooking,
  listBookings,
  updateBooking,
} from "../controllers/admin-booking.controller.js";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  adminBookingIdSchemas,
  changeStatusSchemas,
  createAdminBookingSchemas,
  listAdminBookingsSchemas,
  updateAdminBookingSchemas,
} from "../schemas/admin-booking.schema.js";

// Mounted at /admin; every route requires a valid admin access token.
const adminBooking = Router();

adminBooking.get("/bookings", authenticate, validate(listAdminBookingsSchemas), listBookings);
adminBooking.post("/bookings", authenticate, validate(createAdminBookingSchemas), createBooking);
adminBooking.get("/bookings/:id", authenticate, validate(adminBookingIdSchemas), getBooking);
adminBooking.patch("/bookings/:id", authenticate, validate(updateAdminBookingSchemas), updateBooking);
adminBooking.patch("/bookings/:id/status", authenticate, validate(changeStatusSchemas), changeStatus);

export default adminBooking;
