const stripe = require("../../stripe");
const supabase = require("../supabase");
const { randomUUID } = require("crypto");

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

const handleStripeWebhook = async (req, res) => {
    const sig = req.headers["stripe-signature"];

    if (!WEBHOOK_SECRET) {
        console.error("STRIPE_WEBHOOK_SECRET is not set");
        return res.status(500).json({ message: "Webhook secret not configured" });
    }

    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
    } catch (err) {
        console.error("Webhook signature verification failed:", err.message);
        return res.status(400).json({ message: `Webhook Error: ${err.message}` });
    }

    if (event.type === "checkout.session.completed") {
        const session = event.data.object;

        try {
            await handleCheckoutCompleted(session);
        } catch (err) {
            console.error("Error processing checkout.session.completed:", err);
            return res.status(500).json({ message: "Webhook handler failed" });
        }
    }

    // Acknowledge receipt of the event
    return res.status(200).json({ received: true });
};

async function handleCheckoutCompleted(session) {
    // --- Idempotency check: skip if we already processed this session ---
    const { data: existingOrder } = await supabase
        .from("Order")
        .select("id")
        .eq("stripeSessionId", session.id)
        .maybeSingle();

    if (existingOrder) {
        console.log(`Order for session ${session.id} already exists, skipping.`);
        return;
    }

    // --- Retrieve line items with product metadata (contains variantId) ---
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
        expand: ["data.price.product"],
    });

    // --- Look up user by email (nullable for guest checkouts) ---
    let userId = null;
    const customerEmail = session.customer_details?.email;

    if (customerEmail) {
        const { data: user } = await supabase
            .from("User")
            .select("id")
            .eq("email", customerEmail)
            .maybeSingle();

        if (user) {
            userId = user.id;
        }
    }

    // --- Create the Order row ---
    const orderId = randomUUID();

    const { error: orderError } = await supabase.from("Order").insert({
        id: orderId,
        stripeSessionId: session.id,
        userId,
        customerEmail: customerEmail || null,
        totalAmount: (session.amount_total || 0) / 100,
        status: "PAID",
        shippingAddress: session.shipping_details?.address
            ? JSON.stringify(session.shipping_details.address)
            : null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    });

    if (orderError) {
        throw new Error(`Failed to create Order: ${orderError.message}`);
    }

    console.log(`Created Order ${orderId} for session ${session.id}`);

    // --- Create OrderItem rows and decrement stock ---
    for (const item of lineItems.data) {
        const variantId = item.price?.product?.metadata?.variantId;
        const quantity = item.quantity || 1;
        const priceAtSale = (item.amount_total || 0) / 100 / quantity;

        // Skip items without a variantId (e.g. synthetic events from `stripe trigger`)
        if (!variantId) {
            console.warn("Skipping line item with no variantId metadata (likely a test event)");
            continue;
        }

        // Create the OrderItem
        const { error: itemError } = await supabase.from("OrderItem").insert({
            id: randomUUID(),
            orderId,
            variantId,
            quantity,
            priceAtSale,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });

        if (itemError) {
            console.error(`Failed to create OrderItem for variant ${variantId}:`, itemError.message);
        }

        // Decrement stock for the variant
        if (variantId) {
            const { data: variant, error: fetchError } = await supabase
                .from("ProductVariant")
                .select("stock")
                .eq("id", variantId)
                .single();

            if (fetchError) {
                console.error(`Failed to fetch stock for variant ${variantId}:`, fetchError.message);
                continue;
            }

            const newStock = Math.max((variant.stock || 0) - quantity, 0);

            const { error: updateError } = await supabase
                .from("ProductVariant")
                .update({ stock: newStock, updatedAt: new Date().toISOString() })
                .eq("id", variantId);

            if (updateError) {
                console.error(`Failed to update stock for variant ${variantId}:`, updateError.message);
            } else {
                console.log(`Decremented stock for variant ${variantId}: ${variant.stock} → ${newStock}`);
            }
        }
    }
}

module.exports = {
    handleStripeWebhook,
};
