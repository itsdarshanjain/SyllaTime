import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
});

export const processLectures = async (syllabusTopics, videoUrls) => {
  const response = await api.post('/lectures', {
    syllabusTopics,
    videoUrls
  });
  return response.data;
};

export const generateAIContent = async (lectureGroupId, topicIndex, topicName, context) => {
  const response = await api.post(`/lectures/${lectureGroupId}/topics/${topicIndex}/generate`, {
    topicName,
    context
  });
  return response.data;
};

export const updateMastery = async (lectureGroupId, topicIndex, status) => {
  const response = await api.patch(`/lectures/${lectureGroupId}/topics/${topicIndex}/mastery`, { status });
  return response.data;
};

export const updatePYQ = async (lectureGroupId, topicIndex, delta) => {
  const response = await api.patch(`/lectures/${lectureGroupId}/topics/${topicIndex}/pyq`, { delta });
  return response.data;
};
