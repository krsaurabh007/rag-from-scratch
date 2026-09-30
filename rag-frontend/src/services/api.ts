import axios from 'axios';
import type { ChatMode, ChatResponse } from '../types/chat';

const API_BASE = 'http://localhost:3000';

export async function sendChatMessage(question: string, mode: ChatMode): Promise<ChatResponse> {
  const response = await axios.post(`${API_BASE}/chat`, { question, mode });
  return response.data;
}

export async function uploadDocument(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  const response = await axios.post(`${API_BASE}/documents/upload`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return response.data;
}

export async function listDocuments() {
  const response = await axios.get(`${API_BASE}/documents`);
  return response.data;
}

export async function deleteDocument(documentId: number) {
  const response = await axios.delete(`${API_BASE}/documents/${documentId}`);
  return response.data;
}