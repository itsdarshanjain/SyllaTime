const STOP_WORDS = new Set(['the', 'is', 'in', 'at', 'of', 'on', 'and', 'a', 'to', 'for', 'with', 'an', 'this', 'that', 'by', 'about', 'as', 'are', 'was', 'were', 'be', 'it', 'or', 'so', 'if', 'we', 'you', 'they']);

// Basic suffix stemming to catch plurals and conjugations
function stem(word) {
  if (word.length <= 4) return word;
  return word.replace(/(ing|s|es|ed|tion|ly|ment|ness|al|ic)$/, '');
}

// Calculates advanced fuzzy semantic similarity between chunk text and a topic
function calculateSimilarity(text, topic) {
  const textWords = (text.toLowerCase().match(/[a-z0-9]+/g) || [])
    .filter(w => !STOP_WORDS.has(w));
  const topicWords = (topic.toLowerCase().match(/[a-z0-9]+/g) || [])
    .filter(w => !STOP_WORDS.has(w));
  
  if (topicWords.length === 0) return 0;

  let score = 0;
  let matches = 0;
  const textRoots = textWords.map(stem);
  
  for (const tw of topicWords) {
    const topicRoot = stem(tw);
    
    // 1. Exact match (highest confidence)
    if (textWords.includes(tw)) {
      score += 1.0;
      matches++;
      continue;
    }
    
    // 2. Root match (e.g., biology -> biology)
    if (textRoots.includes(topicRoot)) {
      score += 0.85;
      matches++;
      continue;
    }
    
    // 3. Substring match for long words (e.g., biologic vs biology)
    if (topicRoot.length >= 4 && textRoots.some(tr => tr.length >= 4 && (tr.includes(topicRoot) || topicRoot.includes(tr)))) {
      score += 0.5;
      matches++;
      continue;
    }
  }
  
  const finalScore = score / topicWords.length;
  // Penalize if there are absolutely no matches, to encourage DP to insert gaps for irrelevant chatter
  return matches > 0 ? finalScore : -0.15;
}

// DP sequence-alignment algorithm (Needleman-Wunsch inspired)
function alignTranscriptToTopics(chunks, topics) {
  const n = chunks.length;
  const m = topics.length;
  
  if (n === 0 || m === 0) return [];

  // dp[i][j] = best score using first i chunks and first j topics
  const dp = Array(n + 1).fill(null).map(() => Array(m + 1).fill(-Infinity));
  const ptr = Array(n + 1).fill(null).map(() => Array(m + 1).fill(0)); 
  // 1 = skip chunk (gap), 2 = continue topic j, 3 = start new topic j

  for (let i = 0; i <= n; i++) {
    dp[i][0] = 0; // 0 score for matching 0 topics
  }

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const matchScore = calculateSimilarity(chunks[i-1].text, topics[j-1]);
      
      let maxScore = dp[i-1][j]; // Option 1: skip chunk i
      let bestPtr = 1;

      // Option 2: continue topic j with chunk i
      if (dp[i-1][j] !== -Infinity) {
        const continueScore = dp[i-1][j] + matchScore;
        if (continueScore > maxScore) {
          maxScore = continueScore;
          bestPtr = 2;
        }
      }

      // Option 3: start topic j with chunk i
      if (dp[i-1][j-1] !== -Infinity) {
        const newTopicScore = dp[i-1][j-1] + matchScore;
        if (newTopicScore > maxScore) {
          maxScore = newTopicScore;
          bestPtr = 3;
        }
      }

      dp[i][j] = maxScore;
      ptr[i][j] = bestPtr;
    }
  }

  // Find the best j to start backtracking from, in case not all topics could be matched
  // Ideally, we want to match all m topics (dp[n][m]).
  let bestJ = m;
  if (dp[n][m] === -Infinity) {
    for (let j = m - 1; j >= 0; j--) {
      if (dp[n][j] !== -Infinity) {
        bestJ = j;
        break;
      }
    }
  }

  let i = n;
  let j = bestJ;
  const assignments = [];

  while (i > 0 && j > 0) {
    if (ptr[i][j] === 3) {
      assignments.push({ chunkIndex: i - 1, topicIndex: j - 1 });
      i--;
      j--;
    } else if (ptr[i][j] === 2) {
      assignments.push({ chunkIndex: i - 1, topicIndex: j - 1 });
      i--;
    } else { // 1 (skip) or 0
      i--;
    }
  }
  
  assignments.reverse();

  // Group by topic
  const topicIntervals = topics.map(t => ({ topic: t, chunks: [], startTime: Infinity, endTime: -Infinity, score: 0 }));
  
  for (const a of assignments) {
    const topicData = topicIntervals[a.topicIndex];
    const chunk = chunks[a.chunkIndex];
    topicData.chunks.push(chunk);
    topicData.startTime = Math.min(topicData.startTime, chunk.startTime);
    topicData.endTime = Math.max(topicData.endTime, chunk.endTime);
    topicData.score += calculateSimilarity(chunk.text, topics[a.topicIndex]);
    topicData.context = (topicData.context ? topicData.context + ' ' : '') + chunk.text;
  }

  return topicIntervals
    .filter(t => t.chunks.length > 0)
    .map(t => ({
      topic: t.topic,
      startTime: t.startTime,
      endTime: t.endTime,
      confidenceScore: +(t.score / t.chunks.length).toFixed(2),
      context: t.context
    }));
}

// Binary search to find interval by timestamp in O(log n)
function findTopicByTimestamp(intervals, timestamp) {
  let left = 0;
  let right = intervals.length - 1;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const interval = intervals[mid];

    if (timestamp >= interval.startTime && timestamp <= interval.endTime) {
      return interval;
    } else if (timestamp < interval.startTime) {
      right = mid - 1;
    } else {
      left = mid + 1;
    }
  }
  return null;
}

module.exports = {
  alignTranscriptToTopics,
  findTopicByTimestamp,
  calculateSimilarity
};
