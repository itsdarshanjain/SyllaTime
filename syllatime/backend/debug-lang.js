const { fetchTranscript } = require('./src/services/transcriptService.js');
async function run() {
  const raw = await fetchTranscript('https://youtu.be/xw_OuOhjauw?si=jR4YC98pguMUkKvf');
  console.log(raw.slice(0, 10).map(r => r.text));
}
run();
