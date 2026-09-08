-- The idempotency anchor for Phase 3.
--
-- Today the webhook dedupes by looking for an existing Order with the same
-- `stripeSessionId`, which only covers `checkout.session.completed` and only
-- after the Order row is committed. Recording the Stripe *event* id lets the
-- handler reject a replay of any event type before it does any work, inside
-- the same transaction that writes the Order.

-- Up Migration

CREATE TABLE "StripeEvent" (
    "id" text NOT NULL,
    "type" text NOT NULL,
    "receivedAt" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "StripeEvent_pkey" PRIMARY KEY ("id")
);

-- Down Migration

DROP TABLE "StripeEvent";
