export default function ChatPage() {
  return (
    <main className="flex flex-col h-screen">
      <header className="border-b border-gray-800 px-6 py-4">
        <h1 className="text-xl font-semibold">Gateway Chat</h1>
      </header>
      <section className="flex-1 overflow-y-auto p-6">
        <p className="text-gray-400 text-sm">Start a conversation…</p>
      </section>
      <footer className="border-t border-gray-800 p-4">
        <input
          className="w-full rounded-lg bg-gray-900 border border-gray-700 px-4 py-2 text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Type a message…"
        />
      </footer>
    </main>
  )
}
