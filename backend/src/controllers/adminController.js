const supabase = require("../supabase");

const createProduct = async(req, res) => { 
    const { stripeProductId, name, description, price, images, sizeGuide } = req.body;

    if (!stripeProductId || !name || !description || !price || !images) {
        return res.status(400).json({ message: "Required product fields are missing" });
    }

    try {
        const { data, error } = await supabase.from("Product").insert({
            stripeProductId,
            name,
            description,
            price,
            images,
            sizeGuide,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        }).select();

        if (error) throw error;
        
        res.status(201).json({ message: "Product created successfully", product: data[0] });
    } catch (error) {
        console.error("Error creating product:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

const updateProduct = async(req, res) => {
    const { id } = req.params;
    const updates = req.body;
    
    // Ensure we don't accidentally update id
    delete updates.id;
    updates.updatedAt = new Date().toISOString();

    try {
        const { data, error } = await supabase
            .from("Product")
            .update(updates)
            .eq("id", id)
            .select();

        if (error) throw error;
        if (data.length === 0) return res.status(404).json({ message: "Product not found" });

        res.status(200).json({ message: "Product updated successfully", product: data[0] });
    } catch (error) {
        console.error("Error updating product:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

const updateInventory = async(req, res) => {
    const { variantId } = req.params;
    const { stock } = req.body;

    if (stock === undefined) {
        return res.status(400).json({ message: "Stock value is required" });
    }

    try {
        const { data, error } = await supabase
            .from("ProductVariant")
            .update({ stock, updatedAt: new Date().toISOString() })
            .eq("id", variantId)
            .select();

        if (error) throw error;
        if (data.length === 0) return res.status(404).json({ message: "Variant not found" });

        res.status(200).json({ message: "Inventory updated successfully", variant: data[0] });
    } catch (error) {
        console.error("Error updating inventory:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

const getOrders = async(req, res) => {
    try {
        // Fetch orders, customer info, and order items
        const { data, error } = await supabase
            .from("Order")
            .select(`
                *,
                User ( email, firstName, lastName ),
                OrderItem (*)
            `)
            .order('createdAt', { ascending: false });

        if (error) throw error;

        res.status(200).json(data);
    } catch (error) {
        console.error("Error fetching orders:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

module.exports = {
    createProduct,
    updateProduct,
    updateInventory,
    getOrders
};
