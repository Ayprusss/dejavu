-- Every controller sets `updatedAt` by hand on every write. That is one
-- forgotten line away from being silently wrong, and there is no way to tell
-- from the data that it happened. Move it into the database.
--
-- The trigger is the authority from here on: the controller rewrite drops all
-- the manual `updatedAt: new Date().toISOString()` assignments.
--
-- `now()` is transaction_timestamp(), so a row inserted and then updated inside
-- one transaction keeps updatedAt == createdAt. That is intended — the whole
-- transaction happened at one instant — but it surprises anyone testing the
-- trigger from inside a single BEGIN block. Use clock_timestamp() only if
-- sub-transaction ordering ever needs to be observable, which it does not here.

-- Up Migration

CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW."updatedAt" = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER "User_set_updated_at"
    BEFORE UPDATE ON "User"
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER "Product_set_updated_at"
    BEFORE UPDATE ON "Product"
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER "ProductVariant_set_updated_at"
    BEFORE UPDATE ON "ProductVariant"
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER "Order_set_updated_at"
    BEFORE UPDATE ON "Order"
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER "OrderItem_set_updated_at"
    BEFORE UPDATE ON "OrderItem"
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TRIGGER "OrderItem_set_updated_at" ON "OrderItem";
DROP TRIGGER "Order_set_updated_at" ON "Order";
DROP TRIGGER "ProductVariant_set_updated_at" ON "ProductVariant";
DROP TRIGGER "Product_set_updated_at" ON "Product";
DROP TRIGGER "User_set_updated_at" ON "User";

DROP FUNCTION set_updated_at();
