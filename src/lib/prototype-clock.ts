/**
 * The sample workspace's fixed clock. Application-owned, and not a business's data: it is the one moment the product pins the sample
 * business to (see lib/business-time `businessClock`), so the approved screens and every test read the same "today".
 *
 * The approved Stitch screens are set on Friday, October 25, 2024, so "today" in the sample workspace is this date, never the real one.
 * Every other business reads the real clock in its own time zone. A browser gets the clock it is to use from the workspace
 * (`useClock()`); nothing in a component should read these two.
 */

export const PROTOTYPE_TODAY = "2024-10-25";
/** Business-local timestamp stamped on records created in the sample workspace (confirmations, new bookings). */
export const PROTOTYPE_NOW = "2024-10-25T10:45";
