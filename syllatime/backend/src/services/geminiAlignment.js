require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

// ── Model candidates in priority order ──
// Use known, stable model identifiers that actually exist on the Gemini API
const CANDIDATE_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-3.5-flash',
  'gemini-3.6-flash',
  'gemini-3.8-flash',
];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function generateWithFallback(prompt, isJson = true, maxRetries = 1) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is missing from environment variables.');
  }
  const genAI = new GoogleGenerativeAI(apiKey);
  let lastError;

  for (const modelName of CANDIDATE_MODELS) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = 1500;
          console.log(`[Gemini] Retry ${attempt}/${maxRetries} for ${modelName} — waiting ${delay / 1000}s...`);
          await sleep(delay);
        }

        console.log(`[Gemini] Calling model ${modelName} (attempt ${attempt + 1})...`);
        const model = genAI.getGenerativeModel({
          model: modelName,
          ...(isJson ? { generationConfig: { responseMimeType: 'application/json', temperature: 0.1 } } : { generationConfig: { temperature: 0.1 } })
        });
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        console.log(`[Gemini] Model ${modelName} succeeded (${text.length} chars).`);
        return text;
      } catch (err) {
        lastError = err;
        const isRetryable = err.message?.includes('overloaded') ||
          err.message?.includes('503') ||
          err.message?.includes('429') ||
          err.message?.includes('quota') ||
          err.message?.includes('RESOURCE_EXHAUSTED');

        console.warn(`[Gemini] ${modelName} attempt ${attempt + 1} failed: ${err.message}`);

        if (!isRetryable) break; // Non-retryable → try next model
      }
    }
    console.warn(`[Gemini] Model ${modelName} exhausted. Trying next candidate...`);
  }
  throw new Error(`All Gemini models failed. Last error: ${lastError?.message || 'Unknown'}`);
}

function safeJsonParse(rawText) {
  let cleanText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
  // Try to extract a JSON array
  const arrayMatch = cleanText.match(/(\[[\s\S]*\])/);
  if (arrayMatch) {
    cleanText = arrayMatch[1];
  }
  const parsed = JSON.parse(cleanText);
  if (!Array.isArray(parsed)) {
    throw new Error('Response must be a JSON array');
  }
  return parsed;
}

// ──────────────────────────────────────────────────────────────
// CORE ALIGNMENT PROMPT — Engineered for maximum cross-lingual
// accuracy between English syllabus topics and Hindi/Devanagari
// or Hinglish video transcripts
// ──────────────────────────────────────────────────────────────
const ALIGNMENT_PROMPT = (topics, transcript) => `You are an expert academic curriculum-to-video aligner. Your job is to find the EXACT timestamps where each syllabus topic is taught in a video lecture transcript.

## SYLLABUS TOPICS TO FIND:
${topics.map((t, i) => `${i + 1}. "${t}"`).join('\n')}

## CRITICAL CROSS-LINGUAL UNDERSTANDING:
The transcript below may be in Hindi, Hinglish, or Devanagari script while the syllabus topics are in English. You MUST understand the semantic meaning across languages. Examples:
- "डेडलॉक" or "deadlock ke baare mein" = "Deadlock"
- "बायनरी सर्च ट्री" or "binary search tree kya hota hai" = "Binary Search Tree"
- "यूलर पाथ" = "Eulerian Path"
- "सीपीयू शेड्यूलिंग" = "CPU Scheduling"
- "ऑपरेटिंग सिस्टम" = "Operating System"
- "नॉर्मलाइजेशन" or "normalization samjhte hain" = "Normalization"

You must match topics based on MEANING, not just exact string match. A topic is "covered" when the instructor is teaching, explaining, or deriving concepts related to that topic — not just mentioning the word in passing.

## RULES FOR ACCURACY:
1. Return ONLY topics that are GENUINELY taught/explained in the transcript for at least 30+ seconds.
2. If a topic is merely mentioned in passing (e.g., "next class we will cover X") or used as a casual reference without educational substance, DO NOT include it.
3. If a topic is NOT covered in this video at all, OMIT it from the output. Return an empty array [] if nothing matches.
4. DO NOT guess or fabricate timestamps. Every startTime and endTime must correspond to actual [Xs] markers visible in the transcript.
5. startTime = the [Xs] marker where the instructor BEGINS explaining this topic.
6. endTime = the [Xs] marker where the instructor STOPS discussing this topic or transitions away.
7. endTime MUST be greater than startTime by at least 30 seconds.
8. confidenceScore: 0.85-1.0 = topic explicitly named and taught in detail; 0.70-0.84 = topic clearly covered as part of a larger discussion; below 0.70 = DO NOT INCLUDE.

## OUTPUT FORMAT:
Return a strict JSON array. Each element:
{
  "topic": "exact topic string from the syllabus list above",
  "startTime": <number in seconds>,
  "endTime": <number in seconds>,
  "confidenceScore": <number 0.70 to 1.0>,
  "context": "1-2 sentence summary of what the instructor teaches in this segment"
}

Only output the JSON array. No markdown, no explanation.

## VIDEO TRANSCRIPT:
${transcript}`;

async function alignTopicsWithGemini(topics, formattedTranscript) {
  const prompt = ALIGNMENT_PROMPT(topics, formattedTranscript);
  const rawText = await generateWithFallback(prompt, true);
  const parsed = safeJsonParse(rawText);

  // Post-process: validate, fix missing endTimes, and clean results
  return parsed.map(item => {
    const start = typeof item.startTime === 'number' ? Math.max(0, item.startTime) : 0;
    let end = typeof item.endTime === 'number' ? item.endTime : 0;
    if (end <= start) {
      end = start + 600;
    }
    return {
      ...item,
      startTime: start,
      endTime: end,
      confidenceScore: typeof item.confidenceScore === 'number' ? item.confidenceScore : 0.85
    };
  }).filter(item => {
    if (!item.topic) return false;
    if (item.confidenceScore < 0.65) return false;
    return true;
  });
}

// ── Chapter-based alignment ──
async function alignTopicsWithChapters(topics, chapters, videoMeta) {
  const prompt = `You are an expert academic curriculum aligner.
Given syllabus topics and video chapter markers from "${videoMeta.title}", find which chapters cover which syllabus topics.

## SYLLABUS TOPICS:
${topics.map((t, i) => `${i + 1}. "${t}"`).join('\n')}

## VIDEO CHAPTERS:
${JSON.stringify(chapters, null, 2)}

## RULES:
1. ONLY match a topic to a chapter if the chapter genuinely teaches that topic.
2. If a syllabus topic is NOT covered by any chapter, OMIT it from output.
3. If NONE match, return [].
4. Use the chapter's startTime and endTime directly.
5. confidenceScore: 0.85-0.99 = chapter title explicitly names the topic; 0.70-0.84 = clearly covers it.
6. The transcript may use Hindi/Hinglish terms — match by MEANING, not exact words.

Return a strict JSON array with: "topic", "startTime", "endTime", "confidenceScore", "context".
Only output the JSON array, no markdown.`;

  const rawText = await generateWithFallback(prompt, true);
  return safeJsonParse(rawText);
}

// ── Fallback: metadata-based alignment ──
async function alignTopicsWithVideoContext(topics, videoMeta) {
  const durationSec = videoMeta.duration || 3600;
  const prompt = `You are an expert academic curriculum aligner.
Given syllabus topics and a video lecture titled "${videoMeta.title}" (duration: ${durationSec}s / ${Math.round(durationSec / 60)} min), determine which topics are genuinely within scope.

## SYLLABUS TOPICS:
${topics.map((t, i) => `${i + 1}. "${t}"`).join('\n')}

## VIDEO DETAILS:
- Title: "${videoMeta.title}"
- Author: "${videoMeta.author || 'Unknown'}"
- Duration: ${durationSec}s (${Math.round(durationSec / 60)} min)
- Description:
${(videoMeta.description || '').slice(0, 3000)}

## RULES:
1. ONLY include a topic if this specific video genuinely covers it based on title, description, and subject scope.
2. If a topic is outside the subject or unit scope, OMIT it completely.
3. If NONE match, return [].
4. Estimate reasonable startTime and endTime within 0 to ${durationSec}.
5. confidenceScore should be 0.65-0.80 for metadata-based estimates.
6. Match by MEANING across languages (Hindi/Hinglish → English).

Return a strict JSON array with: "topic", "startTime", "endTime", "confidenceScore", "context".
Only output the JSON array, no markdown.`;

  const rawText = await generateWithFallback(prompt, true);
  return safeJsonParse(rawText);
}

module.exports = {
  alignTopicsWithGemini,
  alignTopicsWithChapters,
  alignTopicsWithVideoContext,
  generateWithFallback
};
