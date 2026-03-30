export interface TranslationResponse {
  translatedText: string;
  detectedLanguage: string;
  reasoning: string;
  highlightedWords: {
    word: string;
    explanation: string;
  }[];
}

export interface LogEntry {
  id: string;
  timestamp: Date;
  type: 'info' | 'error' | 'success';
  message: string;
}
