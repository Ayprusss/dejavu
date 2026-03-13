const app = require('./app');

const port = process.env.PORT || 5000

app.listen(port, () => {
    console.log(`Server app listening on port ${port}`)
})

module.exports = app;