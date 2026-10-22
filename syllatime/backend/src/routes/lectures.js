const express = require('express');
const router = express.Router();
const { 
  fetchTranscript, 
  formatTranscriptForLLM, 
  extractVideoId,
  getVideoDetails 
} = require('../services/transcriptService');
const { 
  alignTopicsWithGemini, 
  alignTopicsWithChapters, 
  alignTopicsWithVideoContext 
} = require('../services/geminiAlignment');
const LectureGroup = require('../models/LectureGroup');

const MIN_CONFIDENCE_THRESHOLD = 0.65;

// Topic normalization helper for reliable matching
const normalizeTopic = (str) => {
  if (!str || typeof str !== 'string') return '';
  return str
    .toLowerCase()
    .replace(/^\s*(?:\d+[\.\)]|[-•*])\s*/, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const findMatchingSyllabusTopic = (returnedTopic, topics) => {
  if (!returnedTopic) return null;
  if (topics.includes(returnedTopic)) return returnedTopic;
  const normReturned = normalizeTopic(returnedTopic);

  // 1. Exact normalized match
  for (const orig of topics) {
    const normOrig = normalizeTopic(orig);
    if (normReturned === normOrig) return orig;
  }

  // 2. Substring match
  for (const orig of topics) {
    const normOrig = normalizeTopic(orig);
    if (normOrig.length > 3 && normReturned.length > 3) {
      if (normReturned.includes(normOrig) || normOrig.includes(normReturned)) {
        return orig;
      }
    }
  }

  // 3. Word overlap match (handles plurals, acronyms, and partial names)
  const retWords = new Set(normReturned.split(' ').filter(w => w.length > 2));
  let bestMatch = null;
  let maxOverlap = 0;
  for (const orig of topics) {
    const origWords = normalizeTopic(orig).split(' ').filter(w => w.length > 2);
    let overlap = 0;
    origWords.forEach(w => { if (retWords.has(w)) overlap++; });
    if (overlap > maxOverlap && overlap >= Math.ceil(origWords.length / 2)) {
      maxOverlap = overlap;
      bestMatch = orig;
    }
  }
  return bestMatch;
};

// POST /api/lectures
// Accepts { syllabusTopics: [String], videoUrls: [String] }
// Returns LectureGroup with the SINGLE BEST seek time per topic across all videos
router.post('/', async (req, res) => {
  try {
    const { syllabusTopics, videoUrls } = req.body;

    if (!videoUrls || !Array.isArray(videoUrls) || videoUrls.length === 0) {
      return res.status(400).json({ error: 'Please provide at least one valid videoUrl' });
    }
    if (videoUrls.length > 3) {
      return res.status(400).json({ error: 'Maximum of 3 videos allowed per syllabus to ensure reliability.' });
    }
    if (!syllabusTopics || !Array.isArray(syllabusTopics) || syllabusTopics.length === 0) {
      return res.status(400).json({ error: 'Please provide an array of syllabusTopics' });
    }

    const videoDocs = [];
    const failedVideos = [];
    
    // Collect ALL alignment candidates from ALL videos
    // Key: topic name -> array of { videoId, startTime, endTime, confidenceScore, context, videoTitle }
    const candidatesByTopic = {};
    syllabusTopics.forEach(topic => {
      candidatesByTopic[topic] = [];
    });

    for (const rawUrl of videoUrls) {
      const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';
      if (!url) continue;

      const videoId = extractVideoId(url);
      if (!videoId) {
        failedVideos.push({ url, error: 'Invalid YouTube URL format' });
        continue;
      }

      try {
        // 1. Fetch video metadata (verifies video exists on YouTube)
        const videoMeta = await getVideoDetails(videoId);
        
        videoDocs.push({
          videoId,
          title: videoMeta.title || `Video ${videoId}`,
          url
        });

        let alignments = [];
        let aligned = false;

        // Strategy A: Direct Transcript with Gemini (HIGHEST ACCURACY)
        // Scans the spoken transcript for exact minute/second markers for each topic across 100% video duration
        try {
          const rawTranscript = await fetchTranscript(url);
          if (rawTranscript && rawTranscript.length > 0) {
            console.log(`[Lectures] Using direct transcript for ${videoId} (${rawTranscript.length} segments, full duration)`);
            const formattedTranscript = formatTranscriptForLLM(rawTranscript);
            alignments = await alignTopicsWithGemini(syllabusTopics, formattedTranscript);
            if (Array.isArray(alignments) && alignments.length > 0) {
              aligned = true;
              console.log(`[Lectures] Transcript aligned ${alignments.length} topics for ${videoId}`);
            }
          }
        } catch (trErr) {
          console.warn(`[Lectures] Transcript alignment failed for ${videoId} (${trErr.message}). Falling back to chapters/context.`);
        }

        // Strategy B: Fallback to video description chapters if transcript failed or was unavailable
        if (!aligned && videoMeta.chapters && videoMeta.chapters.length >= 2) {
          console.log(`[Lectures] Using ${videoMeta.chapters.length} author description chapters for ${videoId}`);
          try {
            alignments = await alignTopicsWithChapters(syllabusTopics, videoMeta.chapters, videoMeta);
            if (Array.isArray(alignments) && alignments.length > 0) {
              aligned = true;
            }
          } catch (chErr) {
            console.warn(`[Lectures] Chapters alignment failed for ${videoId}:`, chErr.message);
          }
        }

        // Strategy C: Final fallback to video metadata context (title, duration, description)
        if (!aligned) {
          console.log(`[Lectures] Aligning syllabus using video context for ${videoId}`);
          try {
            alignments = await alignTopicsWithVideoContext(syllabusTopics, videoMeta);
            if (Array.isArray(alignments) && alignments.length > 0) {
              aligned = true;
            }
          } catch (ctxErr) {
            console.warn(`[Lectures] Video context alignment failed for ${videoId}:`, ctxErr.message);
          }
        }

        // Collect all alignment candidates with video info
        if (Array.isArray(alignments)) {
          alignments.forEach(align => {
            const matchedTopicKey = findMatchingSyllabusTopic(align.topic, syllabusTopics);
            if (!matchedTopicKey) return;

            const conf = typeof align.confidenceScore === 'number' ? align.confidenceScore : 0;
            
            // Discard low-confidence or non-matching candidates
            if (conf < MIN_CONFIDENCE_THRESHOLD) {
              console.log(`[Lectures] Discarding candidate for "${matchedTopicKey}" with confidence ${conf}`);
              return;
            }

            const startTime = Math.max(0, Math.round(align.startTime || 0));
            let endTime = Math.round(align.endTime || (startTime + 600));
            if (endTime <= startTime) {
              endTime = startTime + 300;
            }

            // Filter out accidental placeholders at 00:00 indicating missing topic
            const ctx = (align.context || '').toLowerCase();
            if (startTime === 0 && endTime <= 60 && (ctx.includes('not discussed') || ctx.includes('not covered') || ctx.includes('not in the transcript'))) {
              return;
            }

            candidatesByTopic[matchedTopicKey].push({
              videoId,
              videoTitle: videoMeta.title || `Video ${videoId}`,
              startTime,
              endTime,
              confidenceScore: conf,
              context: align.context || `Covers ${matchedTopicKey}`
            });
          });
        }

      } catch (error) {
        console.error(`Error processing video ${url}:`, error.message);
        failedVideos.push({ url, videoId, error: error.message });
      }
    }

    if (videoDocs.length === 0) {
      const errorMsg = failedVideos.map(f => `${f.url}: ${f.error}`).join('; ');
      return res.status(400).json({ 
        error: `Could not process video(s). ${errorMsg || 'Please ensure the YouTube URLs are valid and accessible.'}`,
        details: failedVideos
      });
    }

    // ──────────────────────────────────────────────────────────
    // CORE LOGIC: Pick the SINGLE BEST match per topic
    // from all candidates across all videos (confidence >= 0.65)
    // ──────────────────────────────────────────────────────────
    const formattedTopicMatches = syllabusTopics.map(topic => {
      const candidates = candidatesByTopic[topic] || [];
      
      // Only accept genuine matches above the confidence threshold
      const validCandidates = candidates.filter(c => c.confidenceScore >= MIN_CONFIDENCE_THRESHOLD);

      if (validCandidates.length === 0) {
        return { topic, bestMatch: null, matches: [] };
      }

      // Sort by confidence score descending, pick the best
      validCandidates.sort((a, b) => b.confidenceScore - a.confidenceScore);
      const best = validCandidates[0];

      return {
        topic,
        bestMatch: {
          videoId: best.videoId,
          videoTitle: best.videoTitle,
          startTime: best.startTime,
          endTime: best.endTime,
          confidenceScore: best.confidenceScore,
          context: best.context
        },
        // Keep all valid matches as backup for reference
        matches: validCandidates.map(c => ({
          videoId: c.videoId,
          videoTitle: c.videoTitle,
          startTime: c.startTime,
          endTime: c.endTime,
          confidenceScore: c.confidenceScore,
          context: c.context
        }))
      };
    });

    // Save to DB (Optional fallback if DB not connected)
    try {
      const lectureGroup = new LectureGroup({
        syllabusTopics,
        videos: videoDocs,
        topicMatches: formattedTopicMatches
      });
      await lectureGroup.save();
      res.json(lectureGroup);
    } catch (dbError) {
      console.warn('Could not save to MongoDB. Returning generated results anyway.', dbError.message);
      res.json({
        syllabusTopics,
        videos: videoDocs,
        topicMatches: formattedTopicMatches
      });
    }
  } catch (error) {
    console.error('Error processing lectures:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

const { generateTopicContent } = require('../services/geminiService');

// In-memory fallback cache for when MongoDB is disconnected (for testing in restricted environments)
const fallbackCache = {}; 

// POST /api/lectures/:id/topics/:topicIndex/generate
router.post('/:id/topics/:topicIndex/generate', async (req, res) => {
  try {
    const { id, topicIndex } = req.params;
    
    // Check fallback cache first (if used previously)
    const cacheKey = `${id}_${topicIndex}`;
    if (fallbackCache[cacheKey]) {
      console.log('Serving from fallback memory cache!');
      return res.json({ ...fallbackCache[cacheKey], source: 'memory-cache' });
    }

    // Try finding in DB
    let group = null;
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1 && mongoose.Types.ObjectId.isValid(id)) {
      group = await LectureGroup.findById(id);
    }
    
    if (group && group.topicMatches && group.topicMatches[topicIndex]) {
      const topicMatch = group.topicMatches[topicIndex];
      if (topicMatch.examNote) {
        console.log('Serving from MongoDB cache!');
        return res.json({
          examNote: topicMatch.examNote,
          flashcards: topicMatch.flashcards,
          quiz: topicMatch.quiz,
          difficulty: topicMatch.difficulty,
          source: 'db-cache'
        });
      }
    }

    // Not in cache, we need to generate!
    const { context, topicName } = req.body;
    
    if (!context || !topicName) {
      return res.status(400).json({ error: 'Missing context or topicName in body' });
    }

    console.log(`Calling Gemini API for topic: ${topicName}...`);
    const generatedData = await generateTopicContent(topicName, context);
    
    // Cache it!
    if (group) {
      group.topicMatches[topicIndex].examNote = generatedData.examNote;
      group.topicMatches[topicIndex].flashcards = generatedData.flashcards;
      group.topicMatches[topicIndex].quiz = generatedData.quiz;
      group.topicMatches[topicIndex].difficulty = generatedData.difficulty;
      try {
        await group.save();
      } catch (dbErr) {
        console.warn('Failed to save generated content to DB, using memory fallback:', dbErr.message);
        fallbackCache[cacheKey] = generatedData;
      }
    } else {
      // Save to memory cache if DB is down
      fallbackCache[cacheKey] = generatedData;
    }

    res.json({ ...generatedData, source: 'gemini-api' });

  } catch (error) {
    console.error('Error generating AI content:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// In-memory mastery + PYQ fallback for when MongoDB is down
const masteryFallback = {};   // key: `${lectureGroupId}_${topicIndex}` -> status string
const pyqFallback = {};       // key: `${lectureGroupId}_${topicIndex}` -> count number

// VALID mastery state machine transitions
const MASTERY_TRANSITIONS = {
  'Not Started': ['Studied'],
  'Studied':     ['Needs Revision', 'Not Started'],
  'Needs Revision': ['Reviewed', 'Not Started'],
  'Reviewed':    ['Not Started', 'Needs Revision'],
};
const ALL_STATUSES = Object.keys(MASTERY_TRANSITIONS);

// PATCH /api/lectures/:id/topics/:topicIndex/mastery
// Body: { status: 'Studied' | 'Needs Revision' | 'Reviewed' | 'Not Started' }
router.patch('/:id/topics/:topicIndex/mastery', async (req, res) => {
  try {
    const { id, topicIndex } = req.params;
    const { status } = req.body;

    if (!ALL_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${ALL_STATUSES.join(', ')}` });
    }

    const cacheKey = `${id}_${topicIndex}`;
    const mongoose = require('mongoose');
    let updatedStatus = status;

    if (mongoose.connection.readyState === 1 && mongoose.Types.ObjectId.isValid(id)) {
      const group = await LectureGroup.findById(id);
      if (group && group.topicMatches[topicIndex]) {
        group.topicMatches[topicIndex].masteryStatus = status;
        await group.save();
        updatedStatus = group.topicMatches[topicIndex].masteryStatus;
      }
    } else {
      masteryFallback[cacheKey] = status;
    }

    res.json({ topicIndex, masteryStatus: updatedStatus });
  } catch (err) {
    console.error('Error updating mastery:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/lectures/:id/topics/:topicIndex/pyq
// Body: { delta: 1 } to increment or { delta: -1 } to decrement
router.patch('/:id/topics/:topicIndex/pyq', async (req, res) => {
  try {
    const { id, topicIndex } = req.params;
    const { delta = 1 } = req.body;
    const cacheKey = `${id}_${topicIndex}`;
    const mongoose = require('mongoose');
    let newCount = 0;

    if (mongoose.connection.readyState === 1 && mongoose.Types.ObjectId.isValid(id)) {
      const group = await LectureGroup.findById(id);
      if (group && group.topicMatches[topicIndex]) {
        const current = group.topicMatches[topicIndex].pyqCount || 0;
        group.topicMatches[topicIndex].pyqCount = Math.max(0, current + delta);
        await group.save();
        newCount = group.topicMatches[topicIndex].pyqCount;
      }
    } else {
      const current = pyqFallback[cacheKey] || 0;
      pyqFallback[cacheKey] = Math.max(0, current + delta);
      newCount = pyqFallback[cacheKey];
    }

    res.json({ topicIndex, pyqCount: newCount });
  } catch (err) {
    console.error('Error updating PYQ count:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
