const { fetchTranscript, chunkTranscript } = require('./src/services/transcriptService.js');
const { alignTranscriptToTopics, calculateSimilarity } = require('./src/services/alignmentService.js');

const topics = [
  "CPU Scheduling: Process Concept",
  "Scheduling Concepts",
  "Types of Schedulers",
  "Scheduling Criteria",
  "Process State Diagram",
  "Scheduling Algorithms",
  "Operation on Process",
  "Algorithms Evaluation",
  "System calls for Process Management",
  "Multiple Processor Scheduling",
  "Concept of Threads"
];

async function run() {
  const raw = await fetchTranscript('https://youtu.be/xw_OuOhjauw?si=jR4YC98pguMUkKvf');
  const chunks = chunkTranscript(raw, 45);
  console.log(`Total chunks: ${chunks.length}`);
  
  const aligned = alignTranscriptToTopics(chunks, topics);
  console.log(aligned.map(a => `${a.topic} : ${a.startTime} - ${a.endTime} (Score: ${a.confidenceScore})`));
}
run();
