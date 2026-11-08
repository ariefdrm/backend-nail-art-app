import { Router } from "express";
import { cancelBooking, createBooking, getBooking } from "../controllers/booking.controller.js";
import { validate } from "../middleware/validate.js";
import { cancelBookingSchemas, createBookingSchemas, lookupBookingSchemas } from "../schemas/booking.schema.js";

const bookings = Router();

bookings.post("/bookings", validate(createBookingSchemas), createBooking);
bookings.get("/bookings/:booking_code", validate(lookupBookingSchemas), getBooking);
bookings.patch("/bookings/:booking_code/cancel", validate(cancelBookingSchemas), cancelBooking);

export default bookings;
