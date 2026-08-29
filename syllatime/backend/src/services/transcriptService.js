const { YoutubeTranscript } = require('youtube-transcript');

// Extract video ID from URL
function extractVideoId(url) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

// Fetch transcript
async function fetchTranscript(videoUrl) {
  try {
    const videoId = extractVideoId(videoUrl);
    if (!videoId) {
      throw new Error(`Invalid YouTube URL: ${videoUrl}`);
    }

    const transcript = await YoutubeTranscript.fetchTranscript(videoId);
    return transcript; // Array of { text, duration, offset }
  } catch (error) {
    console.error(`Error fetching transcript for ${videoUrl}:`, error.message);
    throw new Error(`Failed to fetch transcript: ${error.message}`);
  }
}

// Chunk transcript into ~30-60s chunks
function chunkTranscript(transcript, targetDurationSec = 45) {
  const chunks = [];
  let currentChunk = {
    text: '',
    startTime: 0,
    endTime: 0
  };
  
  if (!transcript || transcript.length === 0) return chunks;

  currentChunk.startTime = transcript[0].offset / 1000;

  for (let i = 0; i < transcript.length; i++) {
    const item = transcript[i];
    const itemStartTime = item.offset / 1000;
    const itemDuration = item.duration / 1000;
    const itemEndTime = itemStartTime + itemDuration;

    // Append text
    if (currentChunk.text) {
      currentChunk.text += ' ' + item.text;
    } else {
      currentChunk.text = item.text;
    }
    
    currentChunk.endTime = itemEndTime;

    // Check if chunk duration exceeds target
    const currentDuration = currentChunk.endTime - currentChunk.startTime;
    if (currentDuration >= targetDurationSec || i === transcript.length - 1) {
      chunks.push({ ...currentChunk });
      
      // Start new chunk
      if (i < transcript.length - 1) {
        const nextItem = transcript[i + 1];
        currentChunk = {
          text: '',
          startTime: nextItem.offset / 1000,
          endTime: nextItem.offset / 1000
        };
      }
    }
  }

  return chunks;
}

// Format the raw transcript array for LLM consumption efficiently
function formatTranscriptForLLM(transcript) {
  if (!transcript || !Array.isArray(transcript)) return '';
  // Combine 3-4 segments together to save tokens on the [XXs] prefixes
  const formatted = [];
  let currentGroupText = '';
  let groupStartTime = 0;

  for (let i = 0; i < transcript.length; i++) {
    const item = transcript[i];
    if (i % 3 === 0) {
      groupStartTime = Math.floor(item.offset / 1000);
      currentGroupText = item.text;
    } else {
      currentGroupText += ' ' + item.text;
    }

    if ((i + 1) % 3 === 0 || i === transcript.length - 1) {
      formatted.push(`[${groupStartTime}s] ${currentGroupText.trim()}`);
    }
  }
  return formatted.join('\n');
}

module.exports = {
  extractVideoId,
  fetchTranscript,
  chunkTranscript,
  formatTranscriptForLLM
};
