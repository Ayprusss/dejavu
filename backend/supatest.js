require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

console.log("URL:", process.env.SUPABASE_URL ? "Exists" : "Missing");
console.log("KEY:", process.env.SUPABASE_KEY ? "Exists" : "Missing");

try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
    console.log("Supabase Client initialized successfully!");
} catch (e) {
    console.error("Crash:", e.message);
}
