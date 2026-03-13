const supabase = require("../supabase");
const { validate: isUuid } = require("uuid");

const getProducts = async (req, res) => {

    try {
        const { data: products, error } = await supabase.from("Product").select("*");

        if (error) {
            throw error;
        }

        res.status(200).json(products);
    } catch (error) {
        console.error("Error fetching products: ", error);

        res.status(500).json({ message: "Internal server error" });
    }
}

const getProductById = async (req, res) => {

    const { id } = req.params;
    console.log("FETCHING PRODUCT FOR ID:", id);
    try {
        let query = supabase.from("Product").select("*, ProductVariant (*)");

        if (isUuid(id)) {
            query = query.eq("id", id);
        } else {
            query = query.eq("stripeProductId", id);
        }

        const { data: product, error } = await query.single();

        if (error) {

            if (error.code === 'PGRST116') {
                return res.status(404).json({ message: "Product not found" });
            }
            throw error;
        }

        res.status(200).json(product);
    } catch (error) {
        console.error("Error fetching product: ", error);

        res.status(500).json({ message: "Server error fetching product details" });
    }
}

module.exports = {
    getProducts,
    getProductById
}




