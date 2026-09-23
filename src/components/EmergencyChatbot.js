import React, { useState, useRef, useEffect } from 'react';
import './EmergencyChatbot.css';

// Voice-first Q&A assistant, contextual to the active emergency.
// Speech-to-text and text-to-speech both use the browser's built-in Web
// Speech API - free, no extra backend service, works in Chrome/Edge/Safari
// (desktop and Android; iOS Safari has partial SpeechRecognition support,
// see the note in the README this ships with).
//
// Text goes to POST /api/chat on the Flask backend, which is powered by
// Claude (see app.py) and is grounded in this specific emergency.

const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;

function EmergencyChatbot({ emergencyType, severity, eta }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: `I'm here to help with this ${emergencyType || 'emergency'}. Tap the mic or type a question - what's happening right now?`,
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
  }, [messages, open]);

  const speak = (text) => {
    if (!voiceOutEnabled || !window.speechSynthesis) return;
    window.speechSynthesis.cancel(); // don't stack utterances
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
      const res = await fetch(`${process.env.REACT_APP_API_URL || `http://${window.location.hostname}:5000`}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userText,
          emergency_type: emergencyType,
          severity,
          eta,
          history: newMessages
            .slice(-6)
            .map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      const replyText = data.reply || "Sorry, I couldn't get a response.";
      setMessages((prev) => [...prev, { role: 'assistant', content: replyText }]);
      speak(replyText);
    } catch (err) {
      const fallback =
        'I could not reach the assistant. Please follow the guidance panel above, and call emergency services if this is serious.';
      setMessages((prev) => [...prev, { role: 'assistant', content: fallback }]);
      speak(fallback);
    } finally {
      setLoading(false);
    }
  };

  const toggleListening = () => {
    if (!SpeechRecognition) {
      alert('Voice input is not supported in this browser. Try Chrome or Edge, or just type your question.');
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
      >
        {open ? '✕' : '🎙️'}
      </button>

      {open && (
        <div className="chatbot-panel">
          <div className="chatbot-header">
            <div>
              <strong>Emergency Assistant</strong>
              <div className="chatbot-subtitle">{emergencyType}</div>
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
            {loading && <div className="chatbot-bubble assistant typing">…</div>}
            <div ref={messagesEndRef} />
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
              placeholder="Ask a question..."
            />
            <button className="chatbot-send" onClick={() => sendMessage(input)}>
              ➤
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default EmergencyChatbot;
