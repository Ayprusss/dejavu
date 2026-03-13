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

const login = async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
    }

    try {
        const { data: user, error } = await supabase.from("User").select("*").eq("email", email).single();

        if (error && error.code === 'PGRST116') {
            return res.status(401).json({ message: "Invalid email or password" });
        } else if (error) {
            throw error;
        }

        const isMatch = await bcrypt.compare(password, user.passwordHash);

        if (!isMatch) {
            return res.status(401).json({ message: "Invalid email or password" });
        }

        const token = jwt.sign(
            { id: user.id, isAdmin: user.isAdmin },
            process.env.JWT_SECRET || 'super_secret_jwt_key',
            { expiresIn: "24h" }
        );

        res.status(200).json({ 
            message: "Login successful", 
            user: {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                isAdmin: user.isAdmin
            }, 
            token 
        });
    } catch (error) {
        console.error("Error thrown when logging in user: ", error);
        return res.status(500).json({ message: "Internal server error" });
    }
}

module.exports = {
    register,
    login
};