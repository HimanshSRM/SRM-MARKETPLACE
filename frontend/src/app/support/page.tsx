'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { auth } from '@/lib/firebase';
import { getInbox, createSupportTicket } from '@/lib/api';

export default function SupportPage() {
  const router = useRouter();
  const { profile } = useAuth();
  
  const [tickets, setTickets] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  // New Ticket Form State
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadTickets = async () => {
    if (!profile) return;
    try {
      setIsLoading(true);
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;

      const inbox = await getInbox(token);
      // We only care about support tickets here!
      setTickets(inbox.support || []);
    } catch (error) {
      console.error("Failed to load tickets:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadTickets();
  }, [profile]);

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) return;

    try {
      setIsSubmitting(true);
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;

      // 🚨 Sends the data to the new unified function we just wrote in api.ts
      const response = await createSupportTicket(token, { subject, message });
      
      // Close modal and instantly redirect them into the new live chat room!
      setIsModalOpen(false);
      router.push(`/chat/${response.ticket_id}`);
      
    } catch (error: any) {
      alert(error.message || "Failed to submit ticket.");
      setIsSubmitting(false);
    }
  };

  if (isLoading || profile === undefined) return <div className="min-h-screen flex items-center justify-center font-bold text-gray-500">Loading Support Center...</div>;
  if (profile === null) return <div className="min-h-screen flex items-center justify-center font-bold text-red-500">Please log in to access Support.</div>;

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      
      {/* 🚨 RAISE TICKET MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl animate-fade-in-up">
            <h2 className="text-2xl font-black text-gray-900 mb-2">Raise a Ticket</h2>
            <p className="text-sm text-gray-500 mb-6">Describe your issue and our Admin team will get back to you shortly.</p>
            
            <form onSubmit={handleCreateTicket} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1 uppercase tracking-wider">Subject</label>
                <input 
                  type="text" required placeholder="e.g., Shop application question"
                  value={subject} onChange={(e) => setSubject(e.target.value)}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-bold"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1 uppercase tracking-wider">Message</label>
                <textarea 
                  required rows={4} placeholder="Please provide details..."
                  value={message} onChange={(e) => setMessage(e.target.value)}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-bold"
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-3 bg-gray-100 text-gray-600 font-bold rounded-xl hover:bg-gray-200 transition">
                  Cancel
                </button>
                <button type="submit" disabled={isSubmitting} className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition disabled:opacity-50">
                  {isSubmitting ? 'Sending...' : 'Submit Ticket'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="max-w-4xl mx-auto space-y-6">
        {/* HEADER */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <div>
            <h1 className="text-2xl font-black text-gray-900">Support Center</h1>
            <p className="text-gray-500 text-sm mt-1">Manage your appeals, reports, and communications with Admins.</p>
          </div>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-sm transition whitespace-nowrap"
          >
            + Raise New Ticket
          </button>
        </div>

        {/* TICKET LIST */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {tickets.length === 0 ? (
            <div className="p-12 text-center">
              <div className="w-16 h-16 bg-gray-100 text-gray-400 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl">📥</div>
              <h3 className="text-lg font-bold text-gray-900">No Support Tickets</h3>
              <p className="text-gray-500 text-sm mt-1">You don't have any open issues or appeals right now.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {tickets.map((ticket) => (
                <div 
                  key={ticket.id} 
                  onClick={() => router.push(`/chat/${ticket.id}`)}
                  className="p-4 sm:p-6 hover:bg-gray-50 cursor-pointer transition-colors flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      {/* Ticket Status Badge */}
                      <span className={`px-2.5 py-1 text-[10px] font-black uppercase tracking-widest rounded-md ${
                        ticket.status === 'resolved' ? 'bg-gray-200 text-gray-600' : 
                        ticket.subject?.includes('❌') || ticket.subject?.includes('🛑') ? 'bg-red-100 text-red-700' : 
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {ticket.status === 'resolved' ? 'Resolved' : 'Action Required'}
                      </span>
                      <span className="text-xs text-gray-400 font-medium font-mono">
                         {new Date(ticket.updated_at || ticket.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <h3 className="font-bold text-gray-900 text-lg line-clamp-1">{ticket.subject || 'Support Request'}</h3>
                    <p className="text-sm text-gray-500 line-clamp-1 mt-1 font-medium">{ticket.last_message || 'Open chat to view details.'}</p>
                  </div>
                  
                  <button className="text-blue-600 bg-blue-50 px-4 py-2 rounded-xl text-sm font-bold shrink-0 hover:bg-blue-100 transition">
                    View Thread →
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}