
import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { InterviewStatus, InterviewPersona, TranscriptItem } from '../types';

const AI_KEY = process.env.API_KEY || '';

// Define specific focus areas for different roles to guide the AI
const ROLE_GUIDES: Record<string, string> = {
  "Software Engineer": "Focus on algorithms, data structures, code quality, and system design patterns.",
  "Frontend Engineer": "Focus on React/DOM manipulation, CSS responsiveness, state management, and web accessibility (a11y).",
  "Backend Engineer": "Focus on API design (REST/GraphQL), database optimization, concurrency, and microservices.",
  "Data Scientist": "Focus STRICTLY on statistical modeling, data cleaning, Python/Pandas, SQL, and ML concepts. Do NOT ask about CSS, React, or mobile app development.",
  "DevOps Engineer": "Focus on CI/CD pipelines, Docker/Kubernetes, Infrastructure as Code (Terraform), and bash scripting. Do NOT ask about frontend frameworks.",
  "Product Manager": "Focus on product sense, metric prioritization, stakeholder management, and user empathy. No coding questions unless asked.",
  "Mobile Developer": "Focus on native platforms (iOS/Android), memory management, offline storage, and UI thread performance.",
  "Cybersecurity Analyst": "Focus on network security, threat vectors, log analysis, penetration testing methodologies, and compliance.",
  "Cloud Architect": "Focus on AWS/Azure services, high availability, disaster recovery, and cost optimization."
};

export const useLiveAudio = (role: string, persona: InterviewPersona, userContext: string) => {
  const [status, setStatus] = useState<InterviewStatus>('idle');
  const [volume, setVolume] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [connectionLogs, setConnectionLogs] = useState<string[]>([]);
  
  // Refs for audio and state management
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourceNodesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const checkIntervalRef = useRef<any>(null);
  const isMutedRef = useRef(isMuted);
  const isResettingRef = useRef(false);

  // Keep ref in sync with state for callbacks
  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  const addLog = (msg: string) => setConnectionLogs(prev => [...prev.slice(-4), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  const generateId = () => Math.random().toString(36).substring(2, 9) + Date.now().toString(36);

  // --- Helpers ---
  const createBlob = (data: Float32Array) => {
    const l = data.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) int16[i] = data[i] * 32768;
    const uint8 = new Uint8Array(int16.buffer);
    let binary = '';
    const len = uint8.byteLength;
    for (let i = 0; i < len; i++) binary += String.fromCharCode(uint8[i]);
    return { data: btoa(binary), mimeType: 'audio/pcm;rate=16000' };
  };

  const decodeAudioData = async (base64: string, ctx: AudioContext) => {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    const dataInt16 = new Int16Array(bytes.buffer);
    const buffer = ctx.createBuffer(1, dataInt16.length, 24000);
    const channelData = buffer.getChannelData(0);
    for (let i = 0; i < channelData.length; i++) channelData[i] = dataInt16[i] / 32768.0;
    return buffer;
  };

  const playTestSound = async () => {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
    setTimeout(() => ctx.close(), 500);
  };

  const stopCheckLoop = () => {
    if (checkIntervalRef.current) {
        cancelAnimationFrame(checkIntervalRef.current);
        checkIntervalRef.current = null;
    }
  };

  const checkMic = async () => {
     try {
       stopCheckLoop();
       setConnectionLogs([]);
       addLog("Requesting Mic Access...");
       const stream = await navigator.mediaDevices.getUserMedia({ 
           audio: { 
               echoCancellation: true, 
               noiseSuppression: true, 
               autoGainControl: true 
           } 
       });
       addLog("Mic Access Granted");
       setStatus('mic-check');
       
       const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
       if (inputContextRef.current) inputContextRef.current.close();
       
       inputContextRef.current = new AudioCtx({ sampleRate: 16000 });
       const source = inputContextRef.current.createMediaStreamSource(stream);
       const analyzer = inputContextRef.current.createAnalyser();
       analyzer.fftSize = 256;
       source.connect(analyzer);
       
       const dataArray = new Uint8Array(analyzer.frequencyBinCount);
       const updateVolume = () => {
         analyzer.getByteFrequencyData(dataArray);
         let sum = 0;
         for (let i=0; i<dataArray.length; i++) sum += dataArray[i];
         setVolume((sum / dataArray.length) / 128); 
         checkIntervalRef.current = requestAnimationFrame(updateVolume);
       };
       updateVolume();
       streamRef.current = stream;
     } catch (e) {
       console.error("Mic check failed", e);
       addLog("Mic Access Denied/Error");
       alert("Could not access microphone.");
       setStatus('error');
     }
  };

  const getSystemInstruction = () => {
    let style = "";
    if (persona === 'Junior Peer') style = "PERSONA: Junior Peer. Friendly. Start with: 'Hey! Ready to chat about the role?'";
    else if (persona === 'Senior Engineer') style = "PERSONA: Senior Engineer. Direct. Start with: 'Hello. Let's review your technical background.'";
    else if (persona === 'Staff Architect') style = "PERSONA: Staff Architect. Focus on scale. Start with: 'Hi. I want to dig into how you design systems.'";
    else if (persona === 'Tech Lead') style = "PERSONA: Tech Lead. Focus on quality. Start with: 'Hi. Let's discuss your approach to maintainability.'";
    else style = "PERSONA: Hiring Manager. Focus on soft skills. Start with: 'Hi. Tell me what drives you in your career.'";

    // Get specific technical focus based on the selected role
    const roleFocus = ROLE_GUIDES[role] || "Focus on general technical and problem-solving skills relevant to the role.";

    return `
      You are Agent Charlie, an interviewer for a ${role} position.
      ${style}
      
      ROLE-SPECIFIC INSTRUCTIONS:
      ${roleFocus}

      Candidate Context: "${userContext}"
      
      INSTRUCTIONS:
      1. YOU SPEAK FIRST using the exact greeting above.
      2. Keep verbal questions short (1-2 sentences).
      3. Wait for the user to answer.
      4. DO NOT repeat the user's answer back to them.
      5. Adjust your technical questions to match the '${role}'.
      
      CODING MODE INSTRUCTIONS:
      The user may submit code via text. When you receive a text message starting with "[CODE SUBMITTED]":
      1. This is the candidate's solution to a problem or your previous question.
      2. Analyze it immediately.
      3. If they used the 'Scratchpad' (context provided in message), they are likely answering the question you JUST asked verbally. Link the code to that context.
      4. Give VERBAL feedback like a real interviewer (e.g., "I see you used a hash map there, that's good for lookup time...").
    `;
  };

  const sendTextMessage = useCallback((text: string) => {
      if (sessionPromiseRef.current) {
          addLog("Sending Text/Code...");
          sessionPromiseRef.current.then(session => {
              session.sendRealtimeInput([{ mimeType: 'text/plain', data: btoa(text) }]);
              
              setTranscript(prev => {
                  const next = [...prev];
                  // Mark previous item complete
                  if (next.length > 0) next[next.length - 1].isComplete = true;
                  
                  next.push({
                    id: generateId(),
                    speaker: 'user',
                    text: `[CODE SUBMITTED]:\n${text}`,
                    timestamp: new Date().toLocaleTimeString(),
                    isComplete: true
                  });
                  return next;
              });
          });
      }
  }, []);

  const disconnect = useCallback(() => {
    stopCheckLoop();
    if (sessionPromiseRef.current) sessionPromiseRef.current.then(s => s.close());
    streamRef.current?.getTracks().forEach(t => t.stop());
    inputContextRef.current?.close();
    audioContextRef.current?.close();
    sourceNodesRef.current.forEach(s => s.stop());
    sourceNodesRef.current.clear();
    
    // Only set finished if we are NOT in the middle of a reset
    if (!isResettingRef.current) {
        setStatus('finished');
    }
    setIsAiSpeaking(false);
  }, []);

  const resetSession = useCallback(() => {
      // Set reset flag to true to prevent onclose callback from setting status to 'finished'
      isResettingRef.current = true;
      disconnect();
      setTranscript([]);
      setConnectionLogs([]);
      setStatus('idle');
      setVolume(0);
      
      // Clear flag after a safety buffer
      setTimeout(() => {
          isResettingRef.current = false;
      }, 1000);
  }, [disconnect]);

  const connect = useCallback(async () => {
    if (!AI_KEY) return;
    stopCheckLoop();
    setStatus('connecting');
    setTranscript([]); 
    addLog("Initializing Session...");

    try {
      const ai = new GoogleGenAI({ apiKey: AI_KEY });
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      
      if (inputContextRef.current) inputContextRef.current.close();
      inputContextRef.current = new AudioCtx({ sampleRate: 16000 });

      if (audioContextRef.current) audioContextRef.current.close();
      audioContextRef.current = new AudioCtx({ sampleRate: 24000 });
      
      await inputContextRef.current.resume();
      await audioContextRef.current.resume();
      
      let stream = streamRef.current;
      if (!stream || !stream.active) {
         addLog("Re-acquiring Mic...");
         stream = await navigator.mediaDevices.getUserMedia({ 
             audio: { 
                 echoCancellation: true, 
                 noiseSuppression: true, 
                 autoGainControl: true
             } 
         });
         streamRef.current = stream;
      }

      const config = {
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: persona === 'Staff Architect' ? 'Fenrir' : 'Puck' } },
          },
          systemInstruction: getSystemInstruction(),
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      };

      addLog("Connecting to Gemini Live...");
      const sessionPromise = ai.live.connect({
        model: config.model,
        config: config.config,
        callbacks: {
          onopen: async () => {
            setStatus('active');
            addLog("Connected! Sending greeting trigger...");
            nextStartTimeRef.current = audioContextRef.current?.currentTime || 0;
            
            sessionPromiseRef.current?.then(session => {
               session.sendRealtimeInput([{ mimeType: 'text/plain', data: btoa("User connected. Say your greeting now.") }]);
            });

            const source = inputContextRef.current!.createMediaStreamSource(streamRef.current!);
            const processor = inputContextRef.current!.createScriptProcessor(4096, 1, 1);
            
            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              let sum = 0;
              for(let i=0; i<inputData.length; i++) sum += inputData[i] * inputData[i];
              setVolume(Math.sqrt(sum / inputData.length));

              if (!isMutedRef.current) {
                 const blob = createBlob(inputData);
                 sessionPromiseRef.current?.then(session => session.sendRealtimeInput({ media: blob }));
              }
            };

            source.connect(processor);
            processor.connect(inputContextRef.current!.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
            const serverContent = msg.serverContent;
            
            setTranscript(prev => {
                const next = [...prev];
                let last = next.length > 0 ? next[next.length - 1] : null;

                const markLastComplete = () => {
                    if (last && !last.isComplete) {
                        next[next.length - 1] = { ...last, isComplete: true };
                        last = next[next.length - 1]; // Update reference
                    }
                };

                // 1. Handle Turn Completion/Interruption FIRST
                if (serverContent?.turnComplete || serverContent?.interrupted) {
                    markLastComplete();
                }

                // 2. Handle AI Speech
                if (serverContent?.outputTranscription?.text) {
                    const text = serverContent.outputTranscription.text;
                    if (text && text.trim().length > 0) {
                        if (last && last.speaker === 'ai' && !last.isComplete) {
                            next[next.length - 1] = { ...last, text: last.text + text };
                        } else {
                            markLastComplete();
                            const newItem: TranscriptItem = {
                                id: generateId(),
                                speaker: 'ai',
                                text: text,
                                timestamp: new Date().toLocaleTimeString(),
                                isComplete: false
                            };
                            next.push(newItem);
                            last = newItem;
                        }
                    }
                }

                // 3. Handle User Speech
                if (serverContent?.inputTranscription?.text) {
                    const text = serverContent.inputTranscription.text;
                    if (text && text.trim().length > 0) {
                        if (last && last.speaker === 'user' && !last.isComplete) {
                            next[next.length - 1] = { ...last, text: last.text + text };
                        } else {
                            markLastComplete();
                            const newItem: TranscriptItem = {
                                id: generateId(),
                                speaker: 'user',
                                text: text,
                                timestamp: new Date().toLocaleTimeString(),
                                isComplete: false
                            };
                            next.push(newItem);
                            last = newItem;
                        }
                    }
                }

                return next;
            });

            if (serverContent?.interrupted) {
                for (const source of sourceNodesRef.current) source.stop();
                sourceNodesRef.current.clear();
                nextStartTimeRef.current = audioContextRef.current?.currentTime || 0;
            }

            const data = serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (data && audioContextRef.current) {
              const buffer = await decodeAudioData(data, audioContextRef.current);
              const source = audioContextRef.current.createBufferSource();
              source.buffer = buffer;
              source.connect(audioContextRef.current.destination);
              const startTime = Math.max(nextStartTimeRef.current, audioContextRef.current.currentTime);
              source.start(startTime);
              nextStartTimeRef.current = startTime + buffer.duration;
              sourceNodesRef.current.add(source);
              setIsAiSpeaking(true);
              source.onended = () => {
                sourceNodesRef.current.delete(source);
                if (sourceNodesRef.current.size === 0) setIsAiSpeaking(false);
              };
            }
          },
          onclose: () => {
             // If we are intentionally resetting, ignore this close event
             if (isResettingRef.current) return;
             
             setStatus('finished'); 
             setIsAiSpeaking(false); 
             addLog("Session Closed"); 
          },
          onerror: (err) => { console.error(err); setStatus('error'); setIsAiSpeaking(false); addLog(`Error: ${err}`); }
        }
      });
      sessionPromiseRef.current = sessionPromise;
    } catch (e) {
      console.error(e);
      setStatus('error');
      addLog("Connection Failed");
    }
  }, [role, persona, userContext]); 

  const toggleMute = () => setIsMuted(!isMuted);

  return { checkMic, playTestSound, connect, disconnect, resetSession, toggleMute, sendTextMessage, isMuted, isAiSpeaking, status, volume, transcript, connectionLogs };
};
