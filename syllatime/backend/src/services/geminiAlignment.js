const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// We use flash for speed and large context window capability
const model = genAI.getGenerativeModel({ 
  model: "gemini-3.6-flash", // Using the same model alias as geminiService.js
  generationConfig: { responseMimeType: "application/json" } 
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

async function alignTopicsWithGemini(topics, formattedTranscript, maxRetries = 3) {
  const prompt = ALIGNMENT_PROMPT(topics, formattedTranscript);
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let rawText = '';
    try {
      if (attempt > 0) {
        // Exponential backoff
        const delay = Math.pow(2, attempt) * 2000;
        console.log(`[Gemini Alignment] Overloaded. Attempt ${attempt + 1}/${maxRetries + 1} — waiting ${delay / 1000}s...`);
        await sleep(delay);
      }

      console.log(`[Gemini Alignment] Aligning ${topics.length} topics (attempt ${attempt + 1})`);
      const result = await model.generateContent(prompt);
      rawText = result.response.text();

      // Strip markdown code fences if present
      let cleanText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
      
      const parsed = JSON.parse(cleanText);

      if (!Array.isArray(parsed)) {
        throw new Error('Response must be a JSON array');
      }

      console.log(`[Gemini Alignment] Successfully aligned topics.`);
      return parsed;

    } catch (err) {
      lastError = err;
      const isRateLimit = err.message?.includes('overloaded') || 
                          err.message?.includes('503') || 
                          err.message?.includes('429') ||
                          err.message?.includes('quota');
      
      console.warn(`[Gemini Alignment] Attempt ${attempt + 1} failed: ${err.message}`);
      
      if (!isRateLimit && !(err instanceof SyntaxError)) {
        // Non-retryable error
        throw err;
      }
    }
  }

  throw new Error(`Gemini Alignment failed after ${maxRetries + 1} attempts. ${lastError?.message || ''}`);
}

module.exports = { alignTopicsWithGemini };
