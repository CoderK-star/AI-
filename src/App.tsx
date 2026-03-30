/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Settings, 
  HelpCircle, 
  Volume2, 
  Send, 
  Terminal, 
  Languages, 
  AlertCircle, 
  CheckCircle2, 
  Info,
  X,
  Play,
  Loader2,
  BookOpen,
  Mic,
  MicOff,
  Square
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Type, Modality } from "@google/genai";
import ReactMarkdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { TranslationResponse, LogEntry } from './types';

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey?: () => Promise<boolean>;
      openSelectKey?: () => Promise<void>;
    };
    webkitAudioContext?: typeof AudioContext;
  }
}

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const DEFAULT_SYSTEM_PROMPT = "あなたはプロの翻訳家です。入力されたテキストを正確に翻訳してください。検出された言語、翻訳の根拠（ニュアンスを含む詳細な説明）、および重要な単語とその説明を提供してください。ニュアンスが分からない場合は、素直に「分かりません」と答えてください。出力は必ずJSON形式で行ってください。";

export default function App() {
  // State
  const [inputText, setInputText] = useState('');
  const [translation, setTranslation] = useState<TranslationResponse | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [selectedWord, setSelectedWord] = useState<{word: string, explanation: string} | null>(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [targetLanguage, setTargetLanguage] = useState('日本語');
  
  // Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessingSpeech, setIsProcessingSpeech] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const logEndRef = useRef<HTMLDivElement>(null);

  const LANGUAGES = [
    '日本語', '英語', '中国語', '韓国語', 'スペイン語', 'フランス語', 'ドイツ語', 'イタリア語'
  ];

  // Models
  const TRANSLATION_MODEL = "gemini-3-flash-preview";
  const TTS_MODEL = "gemini-2.5-flash-preview-tts";

  // Initialize
  useEffect(() => {
    addLog('info', 'アプリケーションが起動しました。翻訳の準備ができました。');
    checkApiKey();
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const checkApiKey = async () => {
    if (window.aistudio?.hasSelectedApiKey) {
      const has = await window.aistudio.hasSelectedApiKey();
      setHasApiKey(has);
    } else {
      setHasApiKey(true); // Assume env key is present
    }
  };

  const addLog = (type: LogEntry['type'], message: string) => {
    setLogs(prev => [...prev, {
      id: Math.random().toString(36).substring(7),
      timestamp: new Date(),
      type,
      message
    }].slice(-50)); // Keep last 50 logs
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        handleSpeechInput(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      addLog('info', 'マイク入力を開始しました。お話しください...');
    } catch (error) {
      console.error(error);
      addLog('error', 'マイクの起動に失敗しました。権限を確認してください。');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      addLog('info', 'マイク入力を停止しました。音声を解析中...');
    }
  };

  const handleSpeechInput = async (audioBlob: Blob) => {
    setIsProcessingSpeech(true);
    try {
      const reader = new FileReader();
      reader.readAsDataURL(audioBlob);
      reader.onloadend = async () => {
        const base64Audio = (reader.result as string).split(',')[1];
        
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const response = await ai.models.generateContent({
          model: TRANSLATION_MODEL,
          contents: [
            {
              inlineData: {
                mimeType: "audio/webm",
                data: base64Audio
              }
            },
            {
              text: `この音声を文字起こしして、${targetLanguage}に翻訳してください。翻訳結果、検出言語、翻訳の根拠、重要な単語のリストをJSON形式で出力してください。`
            }
          ],
          config: {
            systemInstruction: systemPrompt,
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                translatedText: { type: Type.STRING },
                detectedLanguage: { type: Type.STRING },
                reasoning: { type: Type.STRING },
                highlightedWords: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      word: { type: Type.STRING },
                      explanation: { type: Type.STRING }
                    },
                    required: ["word", "explanation"]
                  }
                },
                transcription: { type: Type.STRING }
              },
              required: ["translatedText", "detectedLanguage", "reasoning", "highlightedWords"]
            }
          }
        });

        const result = JSON.parse(response.text || '{}');
        if (result.transcription) {
          setInputText(result.transcription);
        }
        setTranslation(result as TranslationResponse);
        addLog('success', `音声解析が完了しました。検出言語: ${result.detectedLanguage}`);
      };
    } catch (error) {
      console.error(error);
      addLog('error', '音声の解析に失敗しました。');
    } finally {
      setIsProcessingSpeech(false);
    }
  };

  const handleTranslate = async () => {
    if (!inputText.trim()) return;

    setIsTranslating(true);
    addLog('info', `${targetLanguage}への翻訳を開始します: "${inputText.substring(0, 30)}..."`);
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: TRANSLATION_MODEL,
        contents: `以下のテキストを${targetLanguage}に翻訳してください:\n\n${inputText}`,
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              translatedText: { type: Type.STRING },
              detectedLanguage: { type: Type.STRING },
              reasoning: { type: Type.STRING },
              highlightedWords: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    word: { type: Type.STRING },
                    explanation: { type: Type.STRING }
                  },
                  required: ["word", "explanation"]
                }
              }
            },
            required: ["translatedText", "detectedLanguage", "reasoning", "highlightedWords"]
          }
        }
      });

      const result = JSON.parse(response.text || '{}') as TranslationResponse;
      setTranslation(result);
      addLog('success', `翻訳が完了しました。検出言語: ${result.detectedLanguage}`);
    } catch (error) {
      console.error(error);
      addLog('error', `翻訳に失敗しました: ${error instanceof Error ? error.message : '不明なエラー'}`);
    } finally {
      setIsTranslating(false);
    }
  };

  const handleTTS = async () => {
    if (!translation?.translatedText || isPlayingAudio) return;

    setIsPlayingAudio(true);
    addLog('info', '音声を生成中...');

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: TTS_MODEL,
        contents: [{ parts: [{ text: translation.translatedText }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const audioBlob = new Blob(
          [Uint8Array.from(atob(base64Audio), c => c.charCodeAt(0))],
          { type: 'audio/pcm' }
        );
        
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const arrayBuffer = await audioBlob.arrayBuffer();
        
        // Gemini TTS returns 24kHz PCM 16-bit mono
        const audioBuffer = audioContext.createBuffer(1, arrayBuffer.byteLength / 2, 24000);
        const nowBuffering = audioBuffer.getChannelData(0);
        const dataView = new DataView(arrayBuffer);
        for (let i = 0; i < nowBuffering.length; i++) {
          nowBuffering[i] = dataView.getInt16(i * 2, true) / 32768;
        }

        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContext.destination);
        source.onended = () => setIsPlayingAudio(false);
        source.start();
        addLog('success', '音声の再生を開始しました。');
      }
    } catch (error) {
      console.error(error);
      addLog('error', '音声の生成に失敗しました。');
      setIsPlayingAudio(false);
    }
  };

  const openKeySelection = async () => {
    if (window.aistudio?.openSelectKey) {
      await window.aistudio.openSelectKey();
      checkApiKey();
    }
  };

  return (
    <div className="min-h-screen flex flex-col p-3 md:p-8 gap-4 md:gap-6 max-w-6xl mx-auto">
      {/* Header */}
      <header className="flex items-center justify-between glass-card p-3 md:p-4 px-4 md:px-6">
        <div className="flex items-center gap-2 md:gap-3">
          <div className="bg-blue-600 p-1.5 md:p-2 rounded-lg">
            <Languages className="text-white w-5 h-5 md:w-6 md:h-6" />
          </div>
          <div>
            <h1 className="text-lg md:text-xl font-bold tracking-tight">AI 翻訳プロ</h1>
            <div className="hidden sm:flex items-center gap-2 mt-0.5">
              <span className="text-[9px] md:text-[10px] font-mono text-gray-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                {TRANSLATION_MODEL}
              </span>
              <span className="text-[9px] md:text-[10px] font-mono text-gray-400">/</span>
              <span className="text-[9px] md:text-[10px] font-mono text-gray-400">
                {TTS_MODEL}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 md:gap-2">
          <button 
            onClick={() => setShowHelp(true)}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            title="使い方ガイド"
          >
            <HelpCircle className="w-5 h-5 text-gray-600" />
          </button>
          <button 
            onClick={() => setShowSettings(true)}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            title="設定"
          >
            <Settings className="w-5 h-5 text-gray-600" />
          </button>
        </div>
      </header>

      <main className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6 flex-1">
        {/* Left Column: Input & Results */}
        <div className="lg:col-span-2 flex flex-col gap-4 md:gap-6">
          {/* Input Area */}
          <section className="glass-card p-4 md:p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <label className="text-[10px] md:text-xs font-semibold uppercase tracking-wider text-gray-500 flex items-center gap-2">
                入力テキスト
              </label>
              {translation && (
                <span className="text-[10px] md:text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-md font-medium">
                  検出言語: {translation.detectedLanguage}
                </span>
              )}
            </div>
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="翻訳したいテキストを入力または貼り付けてください..."
              className="w-full h-24 md:h-32 p-3 md:p-4 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all resize-none text-sm md:text-base"
            />
            
            {/* Target Language Selection */}
            <div className="flex flex-col gap-2">
              <label className="text-[10px] md:text-xs font-semibold uppercase tracking-wider text-gray-500">
                翻訳先の言語
              </label>
              <div className="flex flex-wrap gap-2">
                {LANGUAGES.map((lang) => (
                  <button
                    key={lang}
                    onClick={() => setTargetLanguage(lang)}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-medium transition-all border",
                      targetLanguage === lang
                        ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                        : "bg-white text-gray-600 border-gray-200 hover:border-blue-300"
                    )}
                  >
                    {lang}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-2">
              <button
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isTranslating || isProcessingSpeech}
                className={cn(
                  "flex items-center gap-2 px-3 md:px-4 py-2.5 md:py-3 rounded-xl font-semibold transition-all text-sm md:text-base",
                  isRecording 
                    ? "bg-red-500 text-white animate-pulse shadow-lg shadow-red-200"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                )}
              >
                {isRecording ? <Square className="w-4 h-4 md:w-5 md:h-5 fill-current" /> : <Mic className="w-4 h-4 md:w-5 md:h-5" />}
                <span className="hidden sm:inline">{isRecording ? "停止" : "音声入力"}</span>
                <span className="sm:hidden">{isRecording ? "停止" : "音声"}</span>
              </button>
              <button
                onClick={handleTranslate}
                disabled={isTranslating || isRecording || isProcessingSpeech || !inputText.trim()}
                className={cn(
                  "flex items-center gap-2 px-4 md:px-6 py-2.5 md:py-3 rounded-xl font-semibold transition-all text-sm md:text-base",
                  isTranslating || isRecording || isProcessingSpeech || !inputText.trim() 
                    ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                    : "bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-200 active:scale-95"
                )}
              >
                {isTranslating || isProcessingSpeech ? (
                  <Loader2 className="w-4 h-4 md:w-5 md:h-5 animate-spin" />
                ) : (
                  <Send className="w-4 h-4 md:w-5 md:h-5" />
                )}
                翻訳する
              </button>
            </div>
          </section>

          {/* Translation Result Area */}
          <AnimatePresence mode="wait">
            {translation && (
              <motion.section
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="glass-card p-4 md:p-6 flex flex-col gap-4"
              >
                <div className="flex items-center justify-between">
                  <label className="text-[10px] md:text-xs font-semibold uppercase tracking-wider text-gray-500">
                    翻訳結果
                  </label>
                  <button
                    onClick={handleTTS}
                    disabled={isPlayingAudio}
                    className={cn(
                      "p-1.5 md:p-2 rounded-lg transition-colors flex items-center gap-2 text-xs md:text-sm font-medium",
                      isPlayingAudio ? "text-blue-600 bg-blue-50" : "text-gray-600 hover:bg-gray-100"
                    )}
                  >
                    {isPlayingAudio ? <Loader2 className="w-4 h-4 animate-spin" /> : <Volume2 className="w-4 h-4" />}
                    読み上げ
                  </button>
                </div>
                
                <div className="p-3 md:p-4 bg-blue-50/50 border border-blue-100 rounded-xl min-h-[80px] md:min-h-[100px] text-base md:text-lg leading-relaxed">
                  {translation.translatedText.split(/(\s+)/).map((part, i) => {
                    if (part.trim() === '') return part;
                    
                    // Clean word for matching (remove punctuation)
                    const cleanPart = part.replace(/[.,!?;:()]/g, '');
                    const highlight = translation.highlightedWords.find(h => 
                      cleanPart.toLowerCase() === h.word.toLowerCase()
                    );

                    if (highlight) {
                      return (
                        <span key={i} className="relative group">
                          <button
                            onClick={() => setSelectedWord(highlight)}
                            className="font-bold text-blue-700 underline decoration-blue-300 underline-offset-4 hover:bg-blue-100 px-1 rounded transition-colors"
                          >
                            {part}
                          </button>
                        </span>
                      );
                    }
                    return part;
                  })}
                </div>

                {/* Reasoning */}
                <div className="mt-2 md:mt-4">
                  <div className="flex items-center gap-2 mb-2">
                    <BookOpen className="w-4 h-4 text-gray-400" />
                    <span className="text-[10px] md:text-xs font-semibold uppercase tracking-wider text-gray-500">翻訳の根拠とニュアンス</span>
                  </div>
                  <div className="p-3 md:p-4 bg-gray-50 border border-gray-100 rounded-xl">
                    <div className="markdown-body text-xs md:text-sm">
                      <ReactMarkdown>
                        {translation.reasoning}
                      </ReactMarkdown>
                    </div>
                  </div>
                </div>
              </motion.section>
            )}
          </AnimatePresence>
        </div>

        {/* Right Column: Logs & Info */}
        <div className="flex flex-col gap-4 md:gap-6">
          {/* System Logs */}
          <section className="glass-card flex-1 flex flex-col overflow-hidden min-h-[300px] lg:min-h-[400px]">
            <div className="p-3 md:p-4 border-bottom border-gray-100 flex items-center justify-between bg-gray-50/50">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-gray-500" />
                <span className="text-[10px] md:text-xs font-bold uppercase tracking-widest text-gray-500">システムログ</span>
              </div>
              <button 
                onClick={() => setLogs([])}
                className="text-[9px] md:text-[10px] text-gray-400 hover:text-gray-600 uppercase font-bold"
              >
                クリア
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 md:p-4 font-mono text-[10px] md:text-[11px] flex flex-col gap-2">
              {logs.map((log) => (
                <div key={log.id} className="flex gap-2">
                  <span className="text-gray-400 shrink-0">
                    [{log.timestamp.toLocaleTimeString([], { hour12: false })}]
                  </span>
                  <span className={cn(
                    "font-medium shrink-0",
                    log.type === 'error' && "text-red-500",
                    log.type === 'success' && "text-green-600",
                    log.type === 'info' && "text-blue-500"
                  )}>
                    {log.type.toUpperCase()}
                  </span>
                  <span className="text-gray-700 break-words">{log.message}</span>
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </section>

          {/* Word Detail Card */}
          <AnimatePresence>
            {selectedWord && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="glass-card p-3 md:p-4 border-l-4 border-l-blue-600 relative"
              >
                <button 
                  onClick={() => setSelectedWord(null)}
                  className="absolute top-2 right-2 p-1 hover:bg-gray-100 rounded-full"
                >
                  <X className="w-4 h-4 text-gray-400" />
                </button>
                <h3 className="font-bold text-blue-700 mb-1 text-sm md:text-base">{selectedWord.word}</h3>
                <p className="text-[11px] md:text-xs text-gray-600 leading-relaxed">{selectedWord.explanation}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Settings Dialog */}
      <Dialog 
        isOpen={showSettings} 
        onClose={() => setShowSettings(false)}
        title="設定"
      >
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-semibold text-gray-700">APIキーの選択</label>
            <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "w-3 h-3 rounded-full",
                  hasApiKey ? "bg-green-500" : "bg-red-500"
                )} />
                <span className="text-sm font-medium">
                  {hasApiKey ? "APIキー接続済み" : "APIキー未選択"}
                </span>
              </div>
              <button 
                onClick={openKeySelection}
                className="text-xs bg-white border border-gray-200 px-3 py-1.5 rounded-lg font-semibold hover:bg-gray-50 transition-colors"
              >
                キーを選択
              </button>
            </div>
            <p className="text-[10px] text-gray-400">
              高度な機能を使用するには、有料のGemini APIキーが必要です。
              <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" className="text-blue-500 hover:underline ml-1">詳細はこちら</a>
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-semibold text-gray-700">システムプロンプト</label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              className="w-full h-32 p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button 
              onClick={() => setSystemPrompt(DEFAULT_SYSTEM_PROMPT)}
              className="text-[10px] text-blue-500 font-bold self-end hover:underline"
            >
              デフォルトに戻す
            </button>
          </div>
        </div>
      </Dialog>

      {/* Help Dialog */}
      <Dialog 
        isOpen={showHelp} 
        onClose={() => setShowHelp(false)}
        title="使い方ガイド"
      >
        <div className="flex flex-col gap-4 text-sm text-gray-600 leading-relaxed">
          <div className="flex gap-3">
            <div className="bg-blue-100 p-2 rounded-lg shrink-0 h-fit">
              <Play className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <p className="font-bold text-gray-900 mb-1">使い方</p>
              <p>翻訳したいテキストを入力エリアに入力し、「翻訳する」をクリックしてください。AIが自動的に言語を検出します。</p>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="bg-blue-100 p-2 rounded-lg shrink-0 h-fit">
              <Mic className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <p className="font-bold text-gray-900 mb-1">音声入力</p>
              <p>「音声入力」ボタンをクリックしてマイクに向かって話すと、AIが音声を文字起こしし、自動的に翻訳を行います。</p>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="bg-blue-100 p-2 rounded-lg shrink-0 h-fit">
              <Volume2 className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <p className="font-bold text-gray-900 mb-1">翻訳の読み上げ</p>
              <p>「読み上げ」ボタンをクリックすると、高品質なAI音声合成を使用して翻訳テキストを聴くことができます。</p>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="bg-blue-100 p-2 rounded-lg shrink-0 h-fit">
              <Info className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <p className="font-bold text-gray-900 mb-1">単語の意味を調べる</p>
              <p>太字で表示された単語をクリックすると、その単語の意味や文脈に応じた使い方の詳細な解説が表示されます。</p>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="bg-blue-100 p-2 rounded-lg shrink-0 h-fit">
              <Terminal className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <p className="font-bold text-gray-900 mb-1">システムログ</p>
              <p>システムログエリアで、翻訳プロセスや接続状況をリアルタイムで確認できます。</p>
            </div>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

// Simple Dialog Component
function Dialog({ isOpen, onClose, title, children }: { isOpen: boolean, onClose: () => void, title: string, children: React.ReactNode }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/20 backdrop-blur-sm" 
      />
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
      >
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>
        <div className="p-6">
          {children}
        </div>
        <div className="p-6 bg-gray-50 border-t border-gray-100 flex justify-end">
          <button 
            onClick={onClose}
            className="px-6 py-2 bg-gray-900 text-white rounded-xl font-semibold hover:bg-gray-800 transition-all"
          >
            閉じる
          </button>
        </div>
      </motion.div>
    </div>
  );
}
