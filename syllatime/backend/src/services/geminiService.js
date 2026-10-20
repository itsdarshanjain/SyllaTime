require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

function getModel() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is missing from environment variables. Please add it to your Vercel project settings.');
  }
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({ 
    model: "gemini-3.6-flash", 
    generationConfig: { responseMimeType: "application/json" } 
  });
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Single combined prompt — 1 API call instead of 4
const COMBINED_PROMPT = (topic, context) => `
You are a study assistant. Based ONLY on the transcript excerpt below, generate study materials for the topic "${topic}".

Return a SINGLE strict JSON object with EXACTLY this structure — no extra fields, no markdown:
{
  "examNote": {
    "title": "string",
    "summary": "string (2-3 sentences)",
    "keyPoints": ["string", "string", "string"]
  },
  "flashcards": [
    { "front": "string (question)", "back": "string (answer)" },
    { "front": "string (question)", "back": "string (answer)" },
    { "front": "string (question)", "back": "string (answer)" },
    { "front": "string (question)", "back": "string (answer)" },
    { "front": "string (question)", "back": "string (answer)" }
  ],
  "quiz": [
    {
      "question": "string",
      "options": ["string", "string", "string", "string"],
      "correctAnswer": "string (must match one option exactly)",
      "explanation": "string"
    },
    {
      "question": "string",
      "options": ["string", "string", "string", "string"],
      "correctAnswer": "string (must match one option exactly)",
      "explanation": "string"
    },
    {
      "question": "string",
      "options": ["string", "string", "string", "string"],
      "correctAnswer": "string (must match one option exactly)",
      "explanation": "string"
    }
  ],
  "difficulty": "Easy"
}

The "difficulty" field must be exactly one of: "Easy", "Medium", or "Hard".

Transcript:
${context}
`;

async function generateTopicContent(topic, context, maxRetries = 3) {
  // Trim context to avoid hitting token limits
  const trimmedContext = context ? context.slice(0, 2500) : `Topic: ${topic}`;
  const prompt = COMBINED_PROMPT(topic, trimmedContext);
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let rawText = '';
    try {
      if (attempt > 0) {
        // Exponential backoff: 2s, 4s, 8s — respect the rate limit window
        const delay = Math.pow(2, attempt) * 2000;
        console.log(`[Gemini] Overloaded. Attempt ${attempt + 1}/${maxRetries + 1} — waiting ${delay / 1000}s...`);
        await sleep(delay);
      }

      console.log(`[Gemini] Generating content for topic: "${topic}" (attempt ${attempt + 1})`);
      const model = getModel();
      const result = await model.generateContent(prompt);
      rawText = result.response.text();

      // Strip markdown code fences if present
      let cleanText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
      
      // Extract the outermost JSON object
      const jsonMatch = cleanText.match(/(\{[\s\S]*\})/);
      if (jsonMatch) {
        cleanText = jsonMatch[0];
      }

      const parsed = JSON.parse(cleanText);

      // Basic validation
      if (!parsed.examNote || !parsed.flashcards || !parsed.quiz) {
        throw new Error('Response missing required fields (examNote, flashcards, or quiz)');
      }

      console.log(`[Gemini] Successfully generated content for: "${topic}"`);
      return {
        examNote: parsed.examNote,
        flashcards: parsed.flashcards,
        quiz: parsed.quiz,
        difficulty: parsed.difficulty || 'Medium'
      };

    } catch (err) {
      lastError = err;
      const isRateLimit = err.message?.includes('overloaded') || 
                          err.message?.includes('503') || 
                          err.message?.includes('429') ||
                          err.message?.includes('quota');
      
      console.warn(`[Gemini] Attempt ${attempt + 1} failed: ${err.message}`);
      if (rawText) console.warn(`[Gemini] Raw response snippet:`, rawText.slice(0, 300));

      if (!isRateLimit && !(err instanceof SyntaxError)) {
        // Non-retryable error (e.g. bad API key, invalid model)
        throw err;
      }
    }
  }

  throw new Error(`Gemini API failed after ${maxRetries + 1} attempts. ${lastError?.message || ''}`);
}

module.exports = { generateTopicContent };
