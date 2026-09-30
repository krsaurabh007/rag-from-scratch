import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, PanelLeft, Plus, Sparkles, Trash2 } from 'lucide-react';
import { listDocuments, deleteDocument } from '../services/api';
import { useChatStore } from '../store/chatStore';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const queryClient = useQueryClient();
  const { clearMessages, isLoading: chatLoading } = useChatStore();

  const { data: documents, isLoading } = useQuery({
    queryKey: ['documents'],
    queryFn: listDocuments
  });

  const deleteMutation = useMutation({
    mutationFn: deleteDocument,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
    onError: () => alert('Failed to delete document.')
  });

  const handleDelete = (documentId: number, source: string) => {
    if (confirm(`Delete "${source}" and all its data?`)) {
      deleteMutation.mutate(documentId);
    }
  };

  if (collapsed) {
    return (
      <div className="sidebar collapsed">
        <button className="icon-btn" onClick={onToggle} title="Expand">
          <PanelLeft size={18} />
        </button>
        <button className="icon-btn collapsed-new" onClick={clearMessages} disabled={chatLoading} title="New Chat">
          <Plus size={18} />
        </button>
      </div>
    );
  }

  return (
    <div className="sidebar">
      <div className="brand">
        <div className="brand-left">
          <div className="logo"><Sparkles size={14} /></div>
          Echo
        </div>
        <button className="icon-btn" onClick={onToggle} title="Collapse">
          <PanelLeft size={18} />
        </button>
      </div>

      <button className="new-chat" onClick={clearMessages} disabled={chatLoading}>
        <Plus size={16} /> New Chat
      </button>

      <div className="side-label">Documents</div>

      {isLoading && <div className="side-hint">Loading...</div>}

      {documents?.length === 0 && (
        <div className="side-hint">No documents uploaded yet.</div>
      )}

      <div className="doc-list">
        {documents?.map((doc: any) => (
          <div key={doc.document_id} className="doc-item">
            <FileText size={16} className="doc-icon" />
            <div className="doc-meta">
              <div className="doc-name">{doc.source}</div>
              <div className="doc-sub">{doc.chunk_count} chunks</div>
            </div>
            <button
              className="icon-btn"
              onClick={() => handleDelete(doc.document_id, doc.source)}
              disabled={deleteMutation.isPending}
              title="Delete document"
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default Sidebar;
