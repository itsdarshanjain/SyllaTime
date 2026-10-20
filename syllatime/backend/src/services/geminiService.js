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

const { generateWithFallback } = require('./geminiAlignment');

async function generateTopicContent(topic, context) {
  // Trim context to avoid hitting token limits
  const trimmedContext = context ? context.slice(0, 2500) : `Topic: ${topic}`;
  const prompt = COMBINED_PROMPT(topic, trimmedContext);

  console.log(`[Gemini] Generating study content for topic: "${topic}"`);
  const rawText = await generateWithFallback(prompt, true);

  // Strip markdown code fences if present
  let cleanText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
  const jsonMatch = cleanText.match(/(\{[\s\S]*\})/);
  if (jsonMatch) {
    cleanText = jsonMatch[0];
  }

  const parsed = JSON.parse(cleanText);

  if (!parsed.examNote || !parsed.flashcards || !parsed.quiz) {
    throw new Error('Response missing required fields (examNote, flashcards, or quiz)');
  }

  return {
    examNote: parsed.examNote,
    flashcards: parsed.flashcards,
    quiz: parsed.quiz,
    difficulty: parsed.difficulty || 'Medium'
  };
}

module.exports = { generateTopicContent };
