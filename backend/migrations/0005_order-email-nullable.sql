-- `Order.customerEmail` is NOT NULL, but webhookController.js:76 inserts
-- `customerEmail || null`.
--
-- A Stripe session without `customer_details.email` therefore fails the insert
-- outright -> the handler 500s -> Stripe retries the event on its backoff
-- schedule, forever. The column has to accept what the code can produce.

-- Up Migration

ALTER TABLE "Order" ALTER COLUMN "customerEmail" DROP NOT NULL;

-- Down Migration

-- Fails if any guest order was recorded without an email — which is exactly
-- the case this migration exists to allow.
ALTER TABLE "Order" ALTER COLUMN "customerEmail" SET NOT NULL;
