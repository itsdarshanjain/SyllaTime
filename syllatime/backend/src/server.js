require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const lecturesRoute = require('./routes/lectures');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/lectures', lecturesRoute);

// Basic health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'SyllaTime Backend is running!' });
});

// Database connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB');
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
  });

// Server start
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
