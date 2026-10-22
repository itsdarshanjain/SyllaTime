require('dotenv').config();
const dns = require('dns');
// Set DNS servers to ensure reliable resolution of MongoDB Atlas SRV records across environments
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (e) {
  // Fallback for environments where custom DNS servers cannot be set
}
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

// Health check with environment diagnostics
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'SyllaTime Backend is running!',
    diagnostics: {
      hasGeminiApiKey: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.length > 5),
      hasMongoUri: Boolean(process.env.MONGODB_URI && /^mongodb(?:\+srv)?:\/\//.test(process.env.MONGODB_URI)),
      dbConnected: mongoose.connection.readyState === 1
    }
  });
});

// Database connection. Vercel reuses warm function instances, so avoid opening
// a new connection every time the function handler is invoked.
if (/^mongodb(?:\+srv)?:\/\//.test(process.env.MONGODB_URI || '')) {
  mongoose.connect(process.env.MONGODB_URI)
    .then(() => {
      console.log('Connected to MongoDB');
    })
    .catch((err) => {
      console.error('MongoDB connection error:', err);
    });
}

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

module.exports = app;
