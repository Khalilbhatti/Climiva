/**
 * The secret in a review link, made and hashed on the server. Never imported by a Client Component or the proxy.
 *
 * A link is `<origin>/review/<token>`. The token is 32 random bytes written as 43 URL-safe characters (256 bits, so it cannot be guessed). Only its SHA-256
 * (64 lowercase hex characters) is ever stored; the database hashes what a visitor sends the same way (migration 0027, `app_review_token_hash`) and finds
 * the request by that. The token is shown to the business once, when the link is made, and is never logged, so a database copy or a log line cannot be
 * used to write a review.
 *
 * The origin is the platform's own address from configuration (BETTER_AUTH_URL), never the Host of the request that asked for the link.
 */
import { createHash, randomBytes } from "node:crypto";
import { REVIEW_LINK_DAYS } from "@/data/reviews";
import { serverTimerMs } from "@/lib/business-time";
import { platformOrigin } from "@/lib/domain-config";

/** What a token looks like. Anything else cannot be a link, so it is not even looked up. */
export const REVIEW_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const newReviewToken = (): string => randomBytes(32).toString("base64url");

export const hashReviewToken = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");

/** When a link made now (or at `fromMs`, milliseconds) stops working. */
export const reviewLinkExpiry = (fromMs: number = serverTimerMs()): Date => new Date(fromMs + REVIEW_LINK_DAYS * 24 * 60 * 60 * 1000);

/** The address to give the customer: absolute when the platform's address is configured, otherwise the path alone. */
export const reviewLinkUrl = (token: string): string => `${platformOrigin() ?? ""}/review/${token}`;
