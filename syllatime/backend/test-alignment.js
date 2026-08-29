const { fetchTranscript, chunkTranscript } = require('./src/services/transcriptService');
const { alignTranscriptToTopics } = require('./src/services/alignmentService');

async function runTest() {
  const url = "https://www.youtube.com/watch?v=O6P86uwfdR0"; // React in 100 Seconds / UseState 15 mins
  const syllabusTopics = ["React Hooks", "State Management", "Class Components", "Use Effect"];

  console.log('Fetching transcript...');
  const rawTranscript = await fetchTranscript(url);
  
  console.log('Chunking transcript...');
  const chunks = chunkTranscript(rawTranscript, 45);

  console.log('Aligning to topics...');
  const alignments = alignTranscriptToTopics(chunks, syllabusTopics);

  console.log('\n--- DP Alignment Results ---\n');
  console.log(JSON.stringify(alignments, null, 2));
}

runTest().catch(console.error);
