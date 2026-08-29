require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
  model: "gemini-3.6-flash", 
  generationConfig: { responseMimeType: "application/json" } 
});

const schema = `
[
  { 
    "question": "String",
    "options": ["String", "String", "String", "String"],
    "correctAnswer": "String (exact match to one of the options)",
    "explanation": "String"
  }
]`;

async function test() {
  try {
    const result = await model.generateContent(`Generate a 3-question multiple choice quiz. Return STRICT JSON matching this schema: ${schema}`);
    console.log("RAW TEXT:", result.response.text());
  } catch(e) {
    console.error(e);
  }
}
test();
