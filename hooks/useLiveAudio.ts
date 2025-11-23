import { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { InterviewStatus, InterviewPersona, TranscriptItem } from '../types';

const AI_KEY = process.env.API_KEY || '';

export const useLiveAudio = (role: string, persona: InterviewPersona, userContext: string) => {
  const [status, setStatus] = useState<InterviewStatus>('idle');
  const [volume, setVolume] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  
  // Refs for audio processing
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourceNodesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  // Helper: Create PCM Blob
  const createBlob = (data: Float32Array) => {
    const l = data.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) {
      int16[i] = data[i] * 32768;
    }
    const uint8 = new Uint8Array(int16.buffer);
    let binary = '';
    const len = uint8.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(uint8[i]);
    }
    const b64 = btoa(binary);
    return {
      data: b64,
      mimeType: 'audio/pcm;rate=16000',
    };
  };

  // Helper: Decode Audio
  const decodeAudioData = async (base64: string, ctx: AudioContext) => {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const dataInt16 = new Int16Array(bytes.buffer);
    const buffer = ctx.createBuffer(1, dataInt16.length, 24000);
    const channelData = buffer.getChannelData(0);
    for (let i = 0; i < channelData.length; i++) {
      channelData[i] = dataInt16[i] / 32768.0;
    }
    return buffer;
  };

  const getSystemInstruction = () => {
    const base = `You are an experienced technical interviewer conducting a voice-only interview for a ${role} position.`;
    
    let style = "Tone: Professional, balanced. Focus on core competencies and problem solving.";
    
    if (persona === 'Junior Peer') {
       style = "Tone: Friendly, casual, encouraging. Focus on collaboration, basic knowledge, and willingness to learn.";
    } else if (persona === 'Senior Engineer') {
       style = "Tone: Professional, standard technical depth. Expect solid reasoning and best practices.";
    } else if (persona === 'Staff Architect') {
       style = "Tone: Strict, high-level system design focused. Probe for scalability limits, trade-offs, and failure modes.";
    } else if (persona === 'Tech Lead') {
       style = "Tone: Pragmatic, focused on code maintainability, team impact, and technical debt. Ask about 'why' not just 'how'.";
    } else if (persona === 'Hiring Manager') {
       style = "Tone: Behavioral, focus on culture fit, career goals, conflict resolution, and soft skills (use STAR method).";
    }

    return `
      ${base}
      ${style}
      
      Candidate Context: "${userContext}"
      Adjust your questions to match the candidate's stated experience level and focus area.

      CRITICAL RULES:
      1. Keep your responses BRIEF (1-3 sentences). This is a conversation, not a lecture.
      2. Ask ONE question at a time. Wait for the user to answer.
      3. If the user is silent, prompt them gently.
      4. Listen to the user's answer. If it's vague, dig deeper.
      5. Do not hallucinate code. Focus on concepts and verbal problem solving.
      6. Treat this as a real-time back-and-forth dialogue.
    `;
  };

  const connect = useCallback(async () => {
    if (!AI_KEY) {
      console.error("No API Key");
      return;
    }
    setStatus('connecting');
    setTranscript([]); // Clear previous transcript

    try {
      const ai = new GoogleGenAI({ apiKey: AI_KEY });
      
      // Initialize Audio Contexts
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      inputContextRef.current = new AudioCtx({ sampleRate: 16000 });
      audioContextRef.current = new AudioCtx({ sampleRate: 24000 });
      
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const config = {
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: persona === 'Staff Architect' ? 'Fenrir' : 'Puck' } },
          },
          systemInstruction: getSystemInstruction(),
          // Fix: Send empty objects to enable transcription. Do not send { model: ... } here.
          inputAudioTranscription: {}, 
          outputAudioTranscription: {}, 
        },
      };

      const sessionPromise = ai.live.connect({
        model: config.model,
        config: config.config,
        callbacks: {
          onopen: () => {
            setStatus('active');
            nextStartTimeRef.current = audioContextRef.current?.currentTime || 0;
            
            if (!inputContextRef.current || !streamRef.current) return;
            
            const source = inputContextRef.current.createMediaStreamSource(streamRef.current);
            const processor = inputContextRef.current.createScriptProcessor(4096, 1, 1);
            
            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              let sum = 0;
              for(let i=0; i<inputData.length; i++) sum += inputData[i] * inputData[i];
              const vol = Math.sqrt(sum / inputData.length);
              setVolume(vol);

              if (!isMuted) {
                 const blob = createBlob(inputData);
                 sessionPromiseRef.current?.then(session => {
                   session.sendRealtimeInput({ media: blob });
                 });
              }
            };

            source.connect(processor);
            processor.connect(inputContextRef.current.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
            // Handle Transcription
            if (msg.serverContent?.outputTranscription?.text) {
               setTranscript(prev => [...prev, { speaker: 'ai', text: msg.serverContent?.outputTranscription?.text || '', timestamp: new Date().toLocaleTimeString() }]);
            }
            if (msg.serverContent?.inputTranscription?.text) {
               setTranscript(prev => [...prev, { speaker: 'user', text: msg.serverContent?.inputTranscription?.text || '', timestamp: new Date().toLocaleTimeString() }]);
            }

            // Handle Audio
            const data = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (data && audioContextRef.current) {
              if (audioContextRef.current.state === 'suspended') {
                 await audioContextRef.current.resume();
              }

              const buffer = await decodeAudioData(data, audioContextRef.current);
              const source = audioContextRef.current.createBufferSource();
              source.buffer = buffer;
              source.connect(audioContextRef.current.destination);
              
              const currentTime = audioContextRef.current.currentTime;
              const startTime = Math.max(nextStartTimeRef.current, currentTime);
              source.start(startTime);
              nextStartTimeRef.current = startTime + buffer.duration;
              
              sourceNodesRef.current.add(source);
              setIsAiSpeaking(true);
              source.onended = () => {
                sourceNodesRef.current.delete(source);
                if (sourceNodesRef.current.size === 0) {
                    setIsAiSpeaking(false);
                }
              };
            }
          },
          onclose: () => {
            setStatus('idle');
            setIsAiSpeaking(false);
          },
          onerror: (err) => {
            console.error("Live Error", err);
            setStatus('error');
            setIsAiSpeaking(false);
          }
        }
      });

      sessionPromiseRef.current = sessionPromise;

    } catch (e) {
      console.error(e);
      setStatus('error');
    }
  }, [role, persona, userContext, isMuted]);

  const disconnect = useCallback(() => {
    if (sessionPromiseRef.current) {
      sessionPromiseRef.current.then(s => s.close());
    }
    streamRef.current?.getTracks().forEach(t => t.stop());
    inputContextRef.current?.close();
    audioContextRef.current?.close();
    sourceNodesRef.current.forEach(s => s.stop());
    sourceNodesRef.current.clear();
    
    setStatus('idle');
    setVolume(0);
    setIsAiSpeaking(false);
  }, []);

  const toggleMute = () => setIsMuted(!isMuted);

  return { connect, disconnect, toggleMute, isMuted, isAiSpeaking, status, volume, transcript };
};