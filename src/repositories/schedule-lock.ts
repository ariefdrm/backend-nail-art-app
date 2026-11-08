/**
 * Key of the PostgreSQL advisory lock that serializes every code path which must not
 * run concurrently with the others: creating a blocked slot (it checks for bookings)
 * and creating a booking (it checks for blocked slots and for the booking buffer).
 * Without it a block and a booking created at the same instant could both succeed.
 * Lives in its own file so both repositories can import it without a cycle.
 */
export const SCHEDULE_LOCK_KEY = 726_001;
