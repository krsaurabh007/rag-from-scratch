import { useState, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { sendChatMessage, uploadDocument, listDocuments } from './services/api';
import { useChatStore } from './store/chatStore';
import type { ChatMode } from './types/chat';
import { ArrowUp, BookOpen, FileText, MessageSquare, Paperclip, Sparkles, WandSparkles } from 'lucide-react';
import Sidebar from './components/Sidebar';
import './styles/App.css';

function App() {
  const [input, setInput] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => window.matchMedia('(max-width: 800px)').matches
  );
  const [mode, setMode] = useState<ChatMode>('normal');
  const { messages, addMessage, isLoading, setLoading } = useChatStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { refetch: refetchDocuments } = useQuery({
    queryKey: ['documents'],
    queryFn: listDocuments
  });

  const chatMutation = useMutation({
    mutationFn: ({ question, mode }: { question: string; mode: ChatMode }) =>
      sendChatMessage(question, mode),
    onMutate: () => setLoading(true),
    onSuccess: (data) => {
      addMessage({ role: 'assistant', content: data.answer });
      setLoading(false);
    },
    onError: () => {
      addMessage({ role: 'assistant', content: 'Error: failed to get a response.' });
      setLoading(false);
    }
  });

  const uploadMutation = useMutation({
    mutationFn: uploadDocument,
    onSuccess: () => {
      refetchDocuments();
      alert('Document uploaded and processed successfully.');
    },
    onError: () => alert('Upload failed.')
  });

  const handleSend = () => {
    if (!input.trim()) return;
    addMessage({ role: 'user', content: input });
    chatMutation.mutate({ question: input, mode });
    setInput('');
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadMutation.mutate(file);
  };

  const suggestions = [
    'Summarize the uploaded document',
    'What are the key points in my documents?',
    'Find the important dates and numbers mentioned'
  ];

  return (
    <div className="app">
      {!sidebarCollapsed && <div className="backdrop" onClick={() => setSidebarCollapsed(true)} />}
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />

      <div className="main">
        <div className="mode-toggle" role="tablist" aria-label="Chat mode">
          <button
            role="tab"
            aria-selected={mode === 'normal'}
            className={mode === 'normal' ? 'active' : ''}
            onClick={() => setMode('normal')}
          >
            <MessageSquare size={14} /> Normal Chat
          </button>
          <button
            role="tab"
            aria-selected={mode === 'rag'}
            className={mode === 'rag' ? 'active' : ''}
            onClick={() => setMode('rag')}
          >
            <BookOpen size={14} /> RAG Chat
          </button>
        </div>

        {messages.length === 0 && !isLoading ? (
          <div className="welcome">
            <div className="logo logo-lg"><Sparkles size={28} /></div>
            <div className="sub">Welcome to Echo AI</div>
            <h1>Your documents, now in conversation.</h1>
            <p className="tagline">
              Upload a PDF and ask anything. Echo retrieves the most relevant passages and answers from your own content, not guesswork.
            </p>
            <div className="cards">
              {suggestions.map((s) => (
                <button key={s} className="card" onClick={() => setInput(s)}>
                  <span>{s}</span>
                  <FileText size={18} />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="chat">
            {messages.map((msg, i) => (
              <div key={i} className={`msg ${msg.role}`}>
                <span className="bubble">{msg.content}</span>
              </div>
            ))}
            {isLoading && <div className="thinking">Thinking...</div>}
          </div>
        )}

        <div className="composer-wrap">
          <div className="composer">
            <div className="composer-input">
              <WandSparkles size={18} />
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder="Ask AI anything or write your request..."
              />
            </div>
            <div className="composer-bar">
              <div className="left">
                {mode === 'rag' && (
                  <>
                    <input
                      type="file"
                      accept=".pdf"
                      ref={fileInputRef}
                      onChange={handleFileChange}
                      hidden
                    />
                    <button className="icon-btn" onClick={() => fileInputRef.current?.click()} title="Upload PDF">
                      <Paperclip size={18} />
                    </button>
                  </>
                )}
              </div>
              <div className="right">
                {uploadMutation.isPending && <span className="uploading">Uploading...</span>}
                <button className="send-btn" onClick={handleSend} disabled={isLoading} title="Send">
                  <ArrowUp size={18} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
