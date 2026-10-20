const { YoutubeTranscript } = require('youtube-transcript');

// Extract video ID from any YouTube URL format, cleanly stripping query params & accidental trailing chars
function extractVideoId(url) {
  if (!url || typeof url !== 'string') return null;
  const cleaned = url.trim().replace(/[<>()[\]'"]+/g, '');
  const regExp = /(?:youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([a-zA-Z0-9_-]{11})/i;
  const match = cleaned.match(regExp);
  if (match && match[1]) {
    return match[1];
  }
  // If the user pasted just the 11-char ID directly
  const pureIdMatch = cleaned.match(/^([a-zA-Z0-9_-]{11})$/);
  return pureIdMatch ? pureIdMatch[1] : null;
}

// Parse timestamp chapters from video description text
function parseChapters(text, totalDuration = 0) {
  if (!text) return [];
  const lineRegex = /(?:^|\n)\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s+[-–—:]?\s*(.+?)(?=\r?\n|$)/g;
  const chapters = [];
  let m;
  while ((m = lineRegex.exec(text)) !== null) {
    const hours = m[1] ? parseInt(m[1], 10) : 0;
    const minutes = parseInt(m[2], 10);
    const seconds = parseInt(m[3], 10);
    const totalSeconds = hours * 3600 + minutes * 60 + seconds;
    const title = m[4].replace(/\\u[0-9a-fA-F]{4}/g, '').trim();
    if (title) {
      chapters.push({ title, startTime: totalSeconds });
    }
  }

  // Calculate contiguous end times
  for (let i = 0; i < chapters.length; i++) {
    if (i < chapters.length - 1) {
      chapters[i].endTime = chapters[i + 1].startTime;
    } else {
      chapters[i].endTime = totalDuration > chapters[i].startTime ? totalDuration : chapters[i].startTime + 1800;
    }
  }
  return chapters;
}

function extractDurationFromTitle(title) {
  if (!title) return 0;
  const hrMatch = title.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|hr)\b/i);
  if (hrMatch) return Math.round(parseFloat(hrMatch[1]) * 3600);
  const minMatch = title.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|min)\b/i);
  if (minMatch) return Math.round(parseFloat(minMatch[1]) * 60);
  if (/one\s*shot/i.test(title)) return 18000; // ~5 hours for full-syllabus semester exam videos
  return 0;
}

// Fetch YouTube video details via official oEmbed and page HTML
async function getVideoDetails(videoId) {
  let title = `Video ${videoId}`;
  let author = '';
  let chapters = [];
  let duration = 0;

  // 1. Check video existence and fetch title via YouTube oEmbed
  try {
    const oembedRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, {
      signal: AbortSignal.timeout(6000)
    });
    if (oembedRes.status === 404) {
      throw new Error(`YouTube video "${videoId}" was not found (404). Please verify that the YouTube URL is correct and characters (such as uppercase I vs lowercase l) match.`);
    }
    if (oembedRes.ok) {
      const data = await oembedRes.json();
      title = data.title || title;
      author = data.author_name || '';
    }
  } catch (err) {
    if (err.message.includes('404')) throw err;
    console.warn(`[oEmbed] Fetch notice for ${videoId}:`, err.message);
  }

  // 2. Fetch page HTML with consent cookie to extract description chapters & approx duration
  try {
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Cookie': 'SOCS=CAESEwgDEgk2OTQ0MzA2NTQaAmVuIAEaBgiA_LyaBg; PREF=hl=en',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      signal: AbortSignal.timeout(8000)
    });
    if (pageRes.ok) {
      const html = await pageRes.text();
      
      const durMatch = html.match(/"approxDurationMs":"(\d+)"/) || html.match(/"lengthSeconds":"(\d+)"/);
      if (durMatch) {
        duration = durMatch[1].length > 6 ? Math.round(parseInt(durMatch[1], 10) / 1000) : parseInt(durMatch[1], 10);
      }

      const descMatch = html.match(/"shortDescription":"(.*?)"/);
      if (descMatch) {
        const rawDesc = descMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
        chapters = parseChapters(rawDesc, duration);
      }
    }
  } catch (err) {
    console.warn(`[HTML Page] Parse notice for ${videoId}:`, err.message);
  }

  // Fallback duration based on title (e.g. "4 Hours", "6 hrs", "one shot")
  if (!duration || duration <= 0) {
    duration = extractDurationFromTitle(title) || 14400;
  }

  return { videoId, title, author, chapters, duration };
}

// Fetch transcript with graceful fallback
async function fetchTranscript(videoUrl) {
  const videoId = extractVideoId(videoUrl);
  if (!videoId) {
    throw new Error(`Invalid YouTube URL: ${videoUrl}`);
  }

  try {
    const transcript = await YoutubeTranscript.fetchTranscript(videoId);
    if (transcript && transcript.length > 0) {
      return transcript;
    }
  } catch (error) {
    console.warn(`[Transcript] Direct transcript fetch failed for ${videoId}:`, error.message);
  }
  return null;
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

    if (currentChunk.text) {
      currentChunk.text += ' ' + item.text;
    } else {
      currentChunk.text = item.text;
    }
    
    currentChunk.endTime = itemEndTime;

    const currentDuration = currentChunk.endTime - currentChunk.startTime;
    if (currentDuration >= targetDurationSec || i === transcript.length - 1) {
      chunks.push({ ...currentChunk });
      
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
  getVideoDetails,
  fetchTranscript,
  chunkTranscript,
  formatTranscriptForLLM,
  parseChapters
};
