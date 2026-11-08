import { Router } from "express";
import { cancelBooking, createBooking, getBooking } from "../controllers/booking.controller.js";
import { bookingCreateLimiter, bookingLookupLimiter } from "../middleware/rate-limit.js";
import { validate } from "../middleware/validate.js";
import { cancelBookingSchemas, createBookingSchemas, lookupBookingSchemas } from "../schemas/booking.schema.js";

const bookings = Router();

bookings.post("/bookings", bookingCreateLimiter, validate(createBookingSchemas), createBooking);
bookings.get("/bookings/:booking_code", bookingLookupLimiter, validate(lookupBookingSchemas), getBooking);
bookings.patch("/bookings/:booking_code/cancel", bookingLookupLimiter, validate(cancelBookingSchemas), cancelBooking);

export default bookings;
