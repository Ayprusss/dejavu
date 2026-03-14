const supabase = require('../supabase');

const getUserOrders = async (req, res) => {
    try {
        const userId = req.user.id;

        const { data, error } = await supabase
            .from('Order')
            .select(`
                *,
                OrderItem (
                    id,
                    quantity,
                    priceAtSale,
                    ProductVariant (
                        id,
                        size,
                        Product (
                            id,
                            name,
                            images
                        )
                    )
                )
            `)
            .eq('userId', userId)
            .order('createdAt', { ascending: false });

        if (error) throw error;

        res.status(200).json(data);
    } catch (error) {
        console.error("Error fetching user orders:", error.message);
        res.status(500).json({ error: error.message });
    }
};

module.exports = {
    getUserOrders
};
