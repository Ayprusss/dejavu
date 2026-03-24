const supabase = require("../supabase");
const stripe = require("../../stripe");

const FRONTEND_URL = process.env.FRONTEND_URL || "https://dejavustudio.xyz";

const createCheckout = async (req, res) => {
    try {
        const { items } = req.body;

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ message: "Cart is empty" });
        }

        const parsedItems = items.map((item) => ({
            variantId: item?.variantId,
            quantity: Number(item?.quantity),
        }));

        const hasInvalidItem = parsedItems.some(
            (item) => !item.variantId || !Number.isInteger(item.quantity) || item.quantity <= 0
        );

        if (hasInvalidItem) {
            return res.status(400).json({
                message: "Each cart item must include a variantId and a positive integer quantity",
            });
        }

        const variantIds = [...new Set(parsedItems.map((item) => item.variantId))];

        const { data: variants, error: variantError } = await supabase
            .from("ProductVariant")
            .select(`
                id,
                size,
                stock,
                Product (
                    name,
                    price
                )
            `)
            .in("id", variantIds);

        if (variantError) {
            throw variantError;
        }

        const variantMap = new Map((variants || []).map((variant) => [variant.id, variant]));
        const lineItems = [];

        for (const item of parsedItems) {
            const variant = variantMap.get(item.variantId);

            if (!variant) {
                return res.status(400).json({
                    message: `Variant ${item.variantId} was not found`,
                });
            }

            if (typeof variant.stock === "number" && item.quantity > variant.stock) {
                return res.status(400).json({
                    message: `Only ${variant.stock} units left for variant ${item.variantId}`,
                });
            }

            const unitAmount = Math.round(Number(variant.Product?.price) * 100);

            if (!Number.isFinite(unitAmount) || unitAmount <= 0) {
                throw new Error(`Variant ${item.variantId} is missing a valid product price`);
            }

            lineItems.push({
                price_data: {
                    currency: "usd",
                    product_data: {
                        name: `${variant.Product.name} - ${variant.size}`,
                        metadata: {
                            variantId: item.variantId,
                        },
                    },
                    unit_amount: unitAmount,
                },
                quantity: item.quantity,
            });
        }

        const session = await stripe.checkout.sessions.create({
            mode: "payment",
            line_items: lineItems,
            success_url: `${FRONTEND_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${FRONTEND_URL}/checkout/cancel`,
            shipping_address_collection: {
                allowed_countries: ["US", "CA"],
            },
            metadata: {
                source: "dejavu-backend",
            },
        });

        return res.status(200).json({
            checkoutUrl: session.url,
        });
    } catch (error) {
        console.error("Error creating checkout session:", error);

        return res.status(500).json({
            message: "Internal server error",
            error: error.message,
            stack: error.stack
        });
    }
};

module.exports = {
    createCheckout,
};
