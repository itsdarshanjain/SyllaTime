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

async function alignTopicsWithGemini(topics, formattedTranscript, maxRetries = 2) {
  const prompt = ALIGNMENT_PROMPT(topics, formattedTranscript);
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = Math.pow(2, attempt) * 2000;
        console.log(`[Gemini Alignment] Retry ${attempt + 1}/${maxRetries + 1} — waiting ${delay / 1000}s...`);
        await sleep(delay);
      }

      console.log(`[Gemini Alignment] Aligning ${topics.length} topics via transcript (attempt ${attempt + 1})`);
      const model = getModel();
      const result = await model.generateContent(prompt);
      const parsed = safeJsonParse(result.response.text());
      console.log(`[Gemini Alignment] Successfully aligned topics via transcript.`);
      return parsed;

    } catch (err) {
      lastError = err;
      console.warn(`[Gemini Alignment] Attempt ${attempt + 1} failed: ${err.message}`);
      const isRateLimit = err.message?.includes('overloaded') || 
                          err.message?.includes('503') || 
                          err.message?.includes('429') ||
                          err.message?.includes('quota');
      if (!isRateLimit && !(err instanceof SyntaxError)) {
        throw err;
      }
    }
  }

  throw new Error(`Gemini Alignment failed after ${maxRetries + 1} attempts. ${lastError?.message || ''}`);
}

// Chapter-based alignment when chapters exist in description
async function alignTopicsWithChapters(topics, chapters, videoMeta, maxRetries = 2) {
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

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) await sleep(2000);
      console.log(`[Gemini Chapters] Aligning ${topics.length} topics with ${chapters.length} chapters`);
      const model = getModel();
      const result = await model.generateContent(prompt);
      const parsed = safeJsonParse(result.response.text());
      console.log(`[Gemini Chapters] Successfully aligned topics with chapters.`);
      return parsed;
    } catch (err) {
      lastError = err;
      console.warn(`[Gemini Chapters] Attempt ${attempt + 1} failed: ${err.message}`);
    }
  }
  throw new Error(`Chapter alignment failed: ${lastError?.message || ''}`);
}

// AI curriculum alignment across video duration when no transcript or chapters exist
async function alignTopicsWithVideoContext(topics, videoMeta, maxRetries = 2) {
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

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) await sleep(2000);
      console.log(`[Gemini Context] Aligning ${topics.length} topics across ${durationSec}s video`);
      const model = getModel();
      const result = await model.generateContent(prompt);
      const parsed = safeJsonParse(result.response.text());
      console.log(`[Gemini Context] Successfully aligned topics across video timeline.`);
      return parsed;
    } catch (err) {
      lastError = err;
      console.warn(`[Gemini Context] Attempt ${attempt + 1} failed: ${err.message}`);
    }
  }
  throw new Error(`Context alignment failed: ${lastError?.message || ''}`);
}

module.exports = {
  alignTopicsWithGemini,
  alignTopicsWithChapters,
  alignTopicsWithVideoContext
};
