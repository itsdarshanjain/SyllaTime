require('dotenv').config();
const { fetchTranscript, formatTranscriptForLLM } = require('./src/services/transcriptService');
const { alignTopicsWithGemini } = require('./src/services/geminiAlignment');

const topics = [
  "CPU Scheduling: Process Concept",
  "Scheduling Concepts",
  "Types of Schedulers"
];

async function run() {
  const raw = await fetchTranscript('https://youtu.be/xw_OuOhjauw?si=jR4YC98pguMUkKvf');
  // Just use first 30 mins to test speed
  const subset = raw.filter(r => r.offset < 1800000); 
  const formatted = formatTranscriptForLLM(subset);
  
  console.log('Sending to Gemini...');
  const start = Date.now();
  const res = await alignTopicsWithGemini(topics, formatted);
  console.log('Time:', Date.now() - start, 'ms');
  console.log(res);
}
run();
