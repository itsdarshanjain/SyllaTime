require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Candidate models in priority order: start with fast, reliable flash models
const CANDIDATE_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.8-flash',
  'gemini-3.6-flash'
];

async function generateWithFallback(prompt, isJson = true) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is missing from environment variables. Please add it to your Vercel project settings.');
  }
  const genAI = new GoogleGenerativeAI(apiKey);
  let lastError;

  for (const modelName of CANDIDATE_MODELS) {
    try {
      console.log(`[Gemini] Calling model ${modelName}...`);
      const model = genAI.getGenerativeModel({ 
        model: modelName,
        ...(isJson ? { generationConfig: { responseMimeType: "application/json" } } : {})
      });
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      console.log(`[Gemini] Model ${modelName} succeeded.`);
      return text;
    } catch (err) {
      console.warn(`[Gemini] Model ${modelName} failed (${err.message}). Trying next candidate...`);
      lastError = err;
    }
  }
  throw lastError;
}

function safeJsonParse(rawText) {
  let cleanText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
  const match = cleanText.match(/(\[[\s\S]*\])/);
  if (match) {
    cleanText = match[1];
  }
  const parsed = JSON.parse(cleanText);
  if (!Array.isArray(parsed)) {
    throw new Error('Response must be a JSON array');
  }
  return parsed;
}

const ALIGNMENT_PROMPT = (topics, transcript) => `
You are an expert curriculum aligner. Given a list of syllabus topics and a video transcript with timestamps [in seconds], map each topic to the most relevant segment in the video.

Syllabus Topics:
${JSON.stringify(topics)}

Return a STRICT JSON array of objects. Each object must have:
- "topic": The exact syllabus topic string.
- "startTime": The start time in seconds (number).
- "endTime": The end time in seconds (number).
- "confidenceScore": A number between 0.0 and 1.0 indicating how confident you are that this segment covers the topic.
- "context": A brief 1-2 sentence summary of what is discussed in this segment.

Important Instructions:
- The video may be taught in a different language (e.g. Hindi) than the syllabus topics (English). You must translate and understand the context to find the matches.
- A topic can be covered in multiple segments. If so, return the single largest contiguous segment (from the start of the first segment to the end of the last segment).
- If a topic is completely missing from the transcript, do NOT include it in the array.
- Make sure "startTime" and "endTime" are valid numbers.
- Only output the JSON array, no markdown.

Transcript:
${transcript}
`;

async function alignTopicsWithGemini(topics, formattedTranscript) {
  const prompt = ALIGNMENT_PROMPT(topics, formattedTranscript);
  const rawText = await generateWithFallback(prompt, true);
  return safeJsonParse(rawText);
}

// Chapter-based alignment when chapters exist in description
async function alignTopicsWithChapters(topics, chapters, videoMeta) {
  const prompt = `
You are an expert curriculum aligner. Given a list of syllabus topics and chapter segments from a video lecture titled "${videoMeta.title}", map each syllabus topic to the most relevant segment in the video.

Syllabus Topics:
${JSON.stringify(topics)}

Video Chapters:
${JSON.stringify(chapters)}

Return a STRICT JSON array of objects. Each object must have:
- "topic": The exact syllabus topic string.
- "startTime": The start time in seconds (number).
- "endTime": The end time in seconds (number).
- "confidenceScore": A number between 0.80 and 0.98.
- "context": A brief 1-2 sentence summary of what this topic covers in this lecture segment.

Ensure startTime and endTime are numbers matching the chapter timestamps.
Only output the JSON array, no markdown.
`;

  const rawText = await generateWithFallback(prompt, true);
  return safeJsonParse(rawText);
}

// AI curriculum alignment across video duration when no transcript or chapters exist
async function alignTopicsWithVideoContext(topics, videoMeta) {
  const durationSec = videoMeta.duration || 3600;
  const prompt = `
You are an expert curriculum aligner. Given a list of syllabus topics and a video lecture of duration ${durationSec} seconds titled "${videoMeta.title}", distribute and map each syllabus topic chronologically across the lecture video based on standard university software engineering syllabus progression.

Syllabus Topics:
${JSON.stringify(topics)}

Return a STRICT JSON array of objects. Each object must have:
- "topic": The exact syllabus topic string.
- "startTime": The estimated start time in seconds (number).
- "endTime": The estimated end time in seconds (number, must be > startTime and <= ${durationSec}).
- "confidenceScore": A number between 0.70 and 0.85 indicating alignment confidence.
- "context": A brief 1-2 sentence description of what the student should focus on for this topic during this segment.

Ensure the topics are ordered logically across the video duration from 0 to ${durationSec}.
Only output the JSON array, no markdown.
`;

  const rawText = await generateWithFallback(prompt, true);
  return safeJsonParse(rawText);
}

module.exports = {
  alignTopicsWithGemini,
  alignTopicsWithChapters,
  alignTopicsWithVideoContext,
  generateWithFallback
};
