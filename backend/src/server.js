const app = require('./app');
const env = require('./config/env');

app.listen(env.PORT, () => {
  console.log(`Server app listening on port ${env.PORT}`);
});

module.exports = app;
