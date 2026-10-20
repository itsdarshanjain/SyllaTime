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

// POST /api/lectures
// Accepts { syllabusTopics: [String], videoUrls: [String] }
// Returns saved LectureGroup with aligned topicMatches
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
    const allTopicMatches = {}; 
    const failedVideos = [];
    
    // Initialize topic tracking
    syllabusTopics.forEach(topic => {
      allTopicMatches[topic] = [];
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
        
        let alignments = [];

        // 2. Try fetching raw transcript
        const rawTranscript = await fetchTranscript(url);

        if (rawTranscript && rawTranscript.length > 0) {
          console.log(`[Lectures] Using direct transcript for ${videoId} (${rawTranscript.length} segments)`);
          const formattedTranscript = formatTranscriptForLLM(rawTranscript);
          alignments = await alignTopicsWithGemini(syllabusTopics, formattedTranscript);
        } else if (videoMeta.chapters && videoMeta.chapters.length > 0) {
          // 3. Fallback: Use video description chapters
          console.log(`[Lectures] Transcript unavailable; using ${videoMeta.chapters.length} description chapters for ${videoId}`);
          alignments = await alignTopicsWithChapters(syllabusTopics, videoMeta.chapters, videoMeta);
        } else {
          // 4. Fallback: AI curriculum alignment across video duration
          console.log(`[Lectures] Aligning syllabus across video duration for ${videoId}`);
          alignments = await alignTopicsWithVideoContext(syllabusTopics, videoMeta);
        }

        videoDocs.push({
          videoId,
          title: videoMeta.title || `Video ${videoId}`,
          url
        });

        // Merge alignment results
        if (Array.isArray(alignments)) {
          alignments.forEach(align => {
            if (allTopicMatches[align.topic]) {
              allTopicMatches[align.topic].push({
                videoId,
                startTime: Math.round(align.startTime || 0),
                endTime: Math.round(align.endTime || (align.startTime ? align.startTime + 600 : 600)),
                confidenceScore: align.confidenceScore || 0.85,
                context: align.context || `Covers ${align.topic}`
              });
            }
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

    // Format topicMatches for Mongoose schema
    const formattedTopicMatches = syllabusTopics.map(topic => ({
      topic,
      matches: allTopicMatches[topic] || []
    }));

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
    // Since we need context, let's accept context in the request body for simplicity,
    // or fetch it. To be self-contained, frontend can send the context or we can fetch.
    // Let's expect { context: "text..." } from the frontend body to avoid slow refetching.
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
