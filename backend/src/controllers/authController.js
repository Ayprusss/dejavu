const supabase = require("../supabase");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { validate: isUuid } = require("uuid");

const register = async (req, res) => {
    const { email, password, firstName, lastName } = req.body;

    if (!email || !password || !firstName || !lastName) {
        return res.status(400).json({ message: "All fields are required" });
    }

    try {
        const { data: existingUser, error: existingError } = await supabase.from("User").select("*").eq("email", email).single();

        if (existingError && existingError.code !== 'PGRST116') {
            throw existingError;
        }

        if (existingUser) {
            return res.status(409).json({ message: "User already exists" });
        }
    } catch (error) {
        console.error("Error thrown when checking for existing user: ", error);
        return res.status(500).json({ message: "Internal server error" });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);

        const { data: newUser, error: newUserError } = await supabase.from("User").insert({
            email,
            passwordHash: hashedPassword,
            firstName,
            lastName,
            isAdmin: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        }).select();

        if (newUserError) {
            throw newUserError;
        }

        const token = jwt.sign(
            { id: newUser[0].id, isAdmin: newUser[0].isAdmin },
            process.env.JWT_SECRET || 'super_secret_jwt_key',
            { expiresIn: "24h" }
        );

        res.status(201).json({ message: "User Registered Successfully", user: newUser[0], token });
    } catch (error) {
        console.error("Error thrown when creating new user: ", error);
        return res.status(500).json({ message: "Internal server error" });
    }
}

module.exports = {
    register
};