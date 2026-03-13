require('dotenv').config()
const express = require('express')
const cors = require('cors')
const productRoutes = require('./routes/router');

const app = express()
app.use(cors())
app.use(express.json())
app.use('/api/products', productRoutes)

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