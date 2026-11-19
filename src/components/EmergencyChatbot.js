import React, { useState, useRef, useEffect } from 'react';
import './EmergencyChatbot.css';

// Voice-first AI medical triage & first-aid assistant contextual to the emergency.
// Text-to-speech and Speech-to-text use browser built-in Web Speech API.
// Powered by Gemini 2.5 Flash on the backend with multi-turn context.

const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;

const QUICK_PROMPTS = [
  'What should I do right now?',
  'How do I check breathing & pulse?',
  'Steps to stop severe bleeding',
  'Should I give water or food?'
];

function EmergencyChatbot({ emergencyType = 'General Medical', severity = 'High', eta }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: `I am your AI Emergency First-Aid Assistant. The ambulance has been dispatched for ${emergencyType}. Ask me for immediate first-aid steps or tap any quick question below:`,
    },
  ]);
  const [input, setInput] = useState('');
  const [listening, setListening] = useState(false);
  const [loading, setLoading] = useState(false);
  const [voiceOutEnabled, setVoiceOutEnabled] = useState(true);
  const recognitionRef = useRef(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open, loading]);

  const speak = (text) => {
    if (!voiceOutEnabled || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.02;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  };

  const sendMessage = async (text) => {
    const userText = text.trim();
    if (!userText || loading) return;

    const newMessages = [...messages, { role: 'user', content: userText }];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const apiHost = process.env.REACT_APP_API_URL || (typeof window !== 'undefined' ? `http://${window.location.hostname}:5000` : 'https://aro-backend-tvkq.onrender.com');
      const res = await fetch(`${apiHost}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userText,
          emergency_type: emergencyType,
          severity,
          eta,
          messages: newMessages.slice(-6).map((m) => ({ role: m.role, content: m.content })),
          history: newMessages.slice(-6).map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      const replyText = data.reply || "Stay calm, keep the patient comfortable, and wait for the ambulance team.";
      setMessages((prev) => [...prev, { role: 'assistant', content: replyText }]);
      speak(replyText);
    } catch (err) {
      const fallback =
        'Please stay calm. Keep the patient in a comfortable resting position, monitor their breathing, and call local emergency services if symptoms worsen.';
      setMessages((prev) => [...prev, { role: 'assistant', content: fallback }]);
      speak(fallback);
    } finally {
      setLoading(false);
    }
  };

  const toggleListening = () => {
    if (!SpeechRecognition) {
      alert('Voice input is not supported in this browser. Try Chrome or Edge, or type your question below.');
      return;
    }

    if (listening) {
      recognitionRef.current?.stop();
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      sendMessage(transcript);
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  return (
    <>
      <button
        className="chatbot-fab"
        onClick={() => setOpen((o) => !o)}
        aria-label="Open emergency assistant"
        title="Gemini AI First-Aid Assistant"
      >
        {open ? '✕' : '✨ 🎙️'}
      </button>

      {open && (
        <div className="chatbot-panel">
          <div className="chatbot-header">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <strong>Gemini AI Medical Assistant</strong>
                <span style={{ fontSize: '0.68rem', background: 'rgba(255,255,255,0.25)', padding: '2px 6px', borderRadius: '8px', fontWeight: 'bold' }}>2.5 Flash</span>
              </div>
              <div className="chatbot-subtitle">{emergencyType} • Triage & First-Aid</div>
            </div>
            <button
              className="chatbot-voice-toggle"
              onClick={() => setVoiceOutEnabled((v) => !v)}
              title="Toggle spoken replies"
            >
              {voiceOutEnabled ? '🔊' : '🔇'}
            </button>
          </div>

          <div className="chatbot-messages">
            {messages.map((m, i) => (
              <div key={i} className={`chatbot-bubble ${m.role}`}>
                {m.content}
              </div>
            ))}
            {loading && (
              <div className="chatbot-bubble assistant typing-indicator">
                <span className="dot"></span>
                <span className="dot"></span>
                <span className="dot"></span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick prompt chips */}
          <div className="chatbot-quick-chips">
            {QUICK_PROMPTS.map((q, idx) => (
              <button
                key={idx}
                className="chatbot-chip"
                onClick={() => sendMessage(q)}
                disabled={loading}
              >
                {q}
              </button>
            ))}
          </div>

          <div className="chatbot-input-row">
            <button
              className={`chatbot-mic ${listening ? 'listening' : ''}`}
              onClick={toggleListening}
              title="Speak your question"
            >
              {listening ? '● Listening' : '🎤'}
            </button>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage(input)}
              placeholder="Ask first-aid instructions..."
              disabled={loading}
            />
            <button className="chatbot-send" onClick={() => sendMessage(input)} disabled={loading || !input.trim()}>
              ➤
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default EmergencyChatbot;
