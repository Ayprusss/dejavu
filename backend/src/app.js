const express = require('express')
const cors = require('cors')
const productRoutes = require('./routes/router');
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const userRoutes = require('./routes/userRoutes');
const checkoutRoutes = require('./routes/checkoutRoutes');

const app = express()
app.use(cors())
app.use(express.json())
app.use('/api/products', productRoutes)
app.use('/api/auth', authRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/user', userRoutes)
app.use('/api/checkout', checkoutRoutes);

app.get('/api/status', async (_req, res, _next) => {
    const healthcheck = {
        uptime: process.uptime(),
        message: "OK",
        timestamp: Date.now()
    };

    try {
        res.send(healthcheck);
    } catch (error) {
        healthcheck.message = error;
        res.status(503).send();
    }
})

app.get('/', (req, res) => {
    res.send('Hello World!')
})

module.exports = app;