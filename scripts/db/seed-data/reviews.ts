/**
 * The canonical Apex Climate reviews.
 *
 * SEED AND TEST INFRASTRUCTURE ONLY (nothing in src/ imports this file, so none of it is compiled into a browser bundle).
 * scripts/db/seed-lib.ts writes it to PostgreSQL for the sample business, with deterministic ids; the specs read it as the
 * expected record. Sources: design-reference/stitch/ reviews_main_list, review_detail_*, reply_to_review, request_review.
 *
 *  - Sarah Mitchell's review (5 stars, source Climvia) is about the real Job JB-204 and is AWAITING a reply. The Reply dialog
 *    opens with the approved reply (`replyDraft`); posting it stores the response.
 *  - The reviews are `imported`: a representative sample of the workspace totals the screens report (12 reviews, 4.7 average,
 *    3 awaiting a reply, 5 requests), not twelve invented records. A reply posted since adds to what is answered.
 *  - The only source is Climvia. Nothing is published to, or read from, any outside review site.
 */
import type { ReviewsData } from "@/data/reviews";

export const SARAH_REPLY =
  "Thank you, Sarah. We appreciate your feedback and are glad the repair process was clear and completed as scheduled.";

export const REVIEWS: ReviewsData["reviews"] = [
  {
    id: "rev-sarah-mitchell",
    source: "Climvia",
    customerId: "sarah-mitchell",
    relatedJobId: "JB-204",
    rating: 5,
    text: "The technician explained the repair clearly and completed the work as scheduled.",
    date: "2024-10-25",
    replyDraft: SARAH_REPLY,
    imported: true,
  },
  {
    id: "rev-david-chen",
    source: "Climvia",
    customerId: "david-chen",
    rating: 4,
    text: "Scheduling was easy and the service visit went smoothly.",
    date: "2024-10-24",
    response: { body: "Thanks David, appreciate the feedback!", by: "Alex Morgan", at: "2024-10-24T16:20", imported: true },
    imported: true,
  },
  {
    id: "rev-elena-rodriguez",
    source: "Climvia",
    customerId: "elena-rodriguez",
    rating: 5,
    text: "Helpful communication and a straightforward maintenance visit.",
    date: "2024-10-23",
    imported: true,
  },
  {
    id: "rev-marcus-sterling",
    source: "Climvia",
    contactName: "Marcus Sterling",
    rating: 5,
    text: "Prompt arrival and thorough inspection of our heat pump before winter.",
    date: "2024-10-19",
    response: { body: "Thank you, Marcus. We’re glad the inspection was thorough.", by: "Alex Morgan", at: "2024-10-20T09:30", imported: true },
    imported: true,
  },
];

export const REVIEWS_DATA: ReviewsData = { reviews: REVIEWS, requests: [] };
