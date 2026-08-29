const mongoose = require('mongoose');

const LectureGroupSchema = new mongoose.Schema({
  syllabusTopics: [String],
  videos: [{
    videoId: String,
    title: String,
    url: String
  }],
  topicMatches: [{
    topic: String,
    matches: [{
      videoId: String,
      startTime: Number,
      endTime: Number,
      confidenceScore: Number
    }],
    examNote: Object,
    flashcards: [Object],
    quiz: [Object],
    difficulty: String,
    masteryStatus: { type: String, default: 'Not Started' },
    pyqCount: { type: Number, default: 0 }
  }]
}, { timestamps: true });

module.exports = mongoose.model('LectureGroup', LectureGroupSchema);
