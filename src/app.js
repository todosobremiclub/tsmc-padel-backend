const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth.routes');
const matchesRoutes = require('./routes/matches.routes');
const playersRoutes = require('./routes/players.routes'); // ✅ NUEVO
const reportsRoutes = require('./routes/reports.routes');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/matches', matchesRoutes);
app.use('/api/players', playersRoutes); // ✅ NUEVO
app.use('/api/reports', reportsRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

module.exports = app;