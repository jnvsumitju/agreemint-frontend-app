import { useCallback, useEffect, useState } from 'react'
import { useEditorStore } from '../../stores/editorStore'
import { useAuthStore } from '../../stores/authStore'
import type { ElementComment, LayoutElement } from '../../types/layout'
import { Avatar } from '../ui/Avatar'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'

type FilterMode = 'all' | 'open' | 'resolved'

function countDeep(comments: ElementComment[]): number {
  return comments.reduce((n, c) => n + 1 + countDeep(c.replies ?? []), 0)
}

function countOpenDeep(comments: ElementComment[]): number {
  return comments.reduce((n, c) => n + (c.resolved ? 0 : 1) + countOpenDeep(c.replies ?? []), 0)
}

function filterTree(comments: ElementComment[], mode: FilterMode): ElementComment[] {
  if (mode === 'all') return comments
  const result: ElementComment[] = []
  for (const c of comments) {
    const filteredReplies = filterTree(c.replies ?? [], mode)
    const selfMatch = mode === 'open' ? !c.resolved : c.resolved
    if (selfMatch || filteredReplies.length > 0) {
      result.push({ ...c, replies: filteredReplies.length > 0 ? filteredReplies : c.replies })
    }
  }
  return result
}

function timeAgo(iso: string | number): string {
  const ts = typeof iso === 'string' ? new Date(iso).getTime() : iso
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function CommentsPanel() {
  const pages = useEditorStore((s) => s.pages)
  const activePageIndex = useEditorStore((s) => s.activePageIndex)
  const select = useEditorStore((s) => s.select)
  const addComment = useEditorStore((s) => s.addComment)
  const addReply = useEditorStore((s) => s.addReply)
  const resolveComment = useEditorStore((s) => s.resolveComment)
  const deleteComment = useEditorStore((s) => s.deleteComment)
  const setCommentHighlightId = useEditorStore((s) => s.setCommentHighlightId)
  const commentHighlightId = useEditorStore((s) => s.commentHighlightId)
  const commentingEnabled = useEditorStore((s) => s.commentingEnabled)
  const authUser = useAuthStore((s) => s.user)
  const authorName = authUser?.name ?? 'User'

  const [filter, setFilter] = useState<FilterMode>('all')
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [newText, setNewText] = useState('')
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')

  const elements: LayoutElement[] = pages[activePageIndex]?.elements ?? []

  const commented = elements
    .filter((el) => el.comments && el.comments.length > 0)
    .map((el) => ({ el, comments: filterTree(el.comments ?? [], filter) }))
    .filter((e) => e.comments.length > 0)

  const totalCount = elements.reduce((n, el) => n + countDeep(el.comments ?? []), 0)
  const openCount = elements.reduce((n, el) => n + countOpenDeep(el.comments ?? []), 0)

  const submitComment = (elementId: string) => {
    const t = newText.trim()
    if (!t) return
    addComment(elementId, t, authorName)
    setNewText('')
    setAddingTo(null)
  }

  const submitReply = (elementId: string, commentId: string) => {
    const t = replyText.trim()
    if (!t) return
    addReply(elementId, commentId, t, authorName)
    setReplyText('')
    setReplyingTo(null)
  }

  const handleHighlight = useCallback((elId: string) => {
    select(elId)
    setCommentHighlightId(elId)
  }, [select, setCommentHighlightId])

  useEffect(() => {
    if (!commentHighlightId) return
    const timer = setTimeout(() => setCommentHighlightId(null), 2000)
    return () => clearTimeout(timer)
  }, [commentHighlightId, setCommentHighlightId])

  const elementLabel = (el: LayoutElement) => (el as LayoutElement & { name?: string }).name?.trim() || `${el.type} element`

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Header with count */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Comments</span>
          {totalCount > 0 && <Badge variant="primary" size="sm">{totalCount}</Badge>}
        </div>
        {openCount > 0 && <Badge variant="warning" size="sm" dot>{openCount} open</Badge>}
      </div>

      {/* Filter pills */}
      <div className="flex gap-1 rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800">
        {(['all', 'open', 'resolved'] as const).map((f) => (
          <button
            key={f}
            type="button"
            className={`flex-1 rounded-md px-2 py-1 text-[10px] font-medium capitalize transition-colors ${
              filter === f
                ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
            }`}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Threads */}
      {commented.length === 0 ? (
        <EmptyState
          title={filter === 'all' ? 'No comments yet' : filter === 'open' ? 'No open comments' : 'No resolved comments'}
          description="Right-click an element to add a comment"
          icon={
            <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
            </svg>
          }
          className="py-8"
        />
      ) : (
        <div className="flex flex-col gap-2">
          {commented.map(({ el, comments }) => (
            <div
              key={el.id}
              className={`overflow-hidden rounded-lg border transition-colors ${
                commentHighlightId === el.id
                  ? 'border-amber-400 bg-amber-50/50 dark:border-amber-500/60 dark:bg-amber-900/10'
                  : 'border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900'
              }`}
            >
              {/* Element header */}
              <button
                type="button"
                className="flex w-full items-center gap-2 border-b border-zinc-100 px-3 py-2 text-left text-[11px] font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800/50"
                onClick={() => handleHighlight(el.id)}
              >
                <ElementTypeIcon type={el.type} />
                <span className="min-w-0 flex-1 truncate">{elementLabel(el)}</span>
                <Badge variant="default" size="sm">{countDeep(comments)}</Badge>
              </button>

              {/* Comment threads */}
              <div className="px-2 py-2">
                <CommentThread
                  comments={comments}
                  depth={0}
                  elementId={el.id}
                  replyingTo={replyingTo}
                  replyText={replyText}
                  onReplyTextChange={setReplyText}
                  onStartReply={(cId) => { setReplyingTo(cId); setReplyText('') }}
                  onCancelReply={() => { setReplyingTo(null); setReplyText('') }}
                  onSubmitReply={(cId) => submitReply(el.id, cId)}
                  onResolve={(cId) => resolveComment(el.id, cId)}
                  onDelete={(cId) => deleteComment(el.id, cId)}
                  onClickComment={() => handleHighlight(el.id)}
                />
              </div>

              {/* Add comment */}
              {commentingEnabled && (
                addingTo === el.id ? (
                  <div className="flex gap-1.5 border-t border-zinc-100 px-2 py-2 dark:border-zinc-800">
                    <input
                      type="text"
                      className="min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] outline-none transition-colors focus:border-violet-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      placeholder="Add a comment..."
                      value={newText}
                      autoFocus
                      onChange={(e) => setNewText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') submitComment(el.id)
                        if (e.key === 'Escape') { setAddingTo(null); setNewText('') }
                      }}
                    />
                    <Button variant="primary" size="xs" disabled={!newText.trim()} onClick={() => submitComment(el.id)}>
                      Add
                    </Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="w-full border-t border-zinc-100 px-3 py-1.5 text-left text-[10px] text-zinc-400 transition-colors hover:bg-zinc-50 hover:text-violet-600 dark:border-zinc-800 dark:hover:bg-zinc-800/50 dark:hover:text-violet-400"
                    onClick={() => { setAddingTo(el.id); setNewText('') }}
                  >
                    + Add comment
                  </button>
                )
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Recursive thread renderer ── */

function CommentThread({
  comments, depth, elementId, replyingTo, replyText,
  onReplyTextChange, onStartReply, onCancelReply, onSubmitReply,
  onResolve, onDelete, onClickComment,
}: {
  comments: ElementComment[]; depth: number; elementId: string
  replyingTo: string | null; replyText: string
  onReplyTextChange: (v: string) => void; onStartReply: (commentId: string) => void
  onCancelReply: () => void; onSubmitReply: (commentId: string) => void
  onResolve: (commentId: string) => void; onDelete: (commentId: string) => void
  onClickComment: () => void
}) {
  return (
    <ul className="flex flex-col gap-1.5">
      {comments.map((c) => (
        <li key={c.id} className="relative">
          {/* Thread connecting line for nested replies */}
          {depth > 0 && (
            <div
              className="absolute -left-2 top-0 bottom-0 w-px bg-zinc-200 dark:bg-zinc-700"
              style={{ left: `${depth * 12 - 4}px` }}
            />
          )}

          <div
            className={`cursor-pointer rounded-lg p-2.5 text-[11px] transition-colors ${
              c.resolved
                ? 'bg-zinc-50 text-zinc-400 dark:bg-zinc-800/30 dark:text-zinc-500'
                : 'bg-zinc-50 text-zinc-700 hover:bg-zinc-100 dark:bg-zinc-800/50 dark:text-zinc-300 dark:hover:bg-zinc-800'
            }`}
            style={{ marginLeft: depth * 12 }}
            onClick={onClickComment}
          >
            {/* Author row */}
            <div className="flex items-center gap-2">
              <Avatar name={c.author} size="xs" />
              <div className="min-w-0 flex-1">
                <span className="font-medium">{c.author}</span>
                <span className="ml-1.5 text-[9px] text-zinc-400 dark:text-zinc-500">{timeAgo(c.createdAt)}</span>
              </div>
              {c.resolved && <Badge variant="success" size="sm">Resolved</Badge>}
            </div>

            {/* Text */}
            <p className={`mt-1 leading-relaxed ${c.resolved ? 'line-through opacity-60' : ''}`}>{c.text}</p>

            {/* Actions */}
            <div className="mt-1.5 flex items-center gap-2">
              <button
                type="button"
                className="text-[9px] font-medium text-violet-500 hover:text-violet-700 dark:text-violet-400"
                onClick={(e) => { e.stopPropagation(); onStartReply(c.id) }}
              >
                Reply
              </button>
              {!c.resolved && (
                <button
                  type="button"
                  className="text-[9px] font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
                  onClick={(e) => { e.stopPropagation(); onResolve(c.id) }}
                >
                  Resolve
                </button>
              )}
              <button
                type="button"
                className="text-[9px] font-medium text-red-500 hover:text-red-700 dark:text-red-400"
                onClick={(e) => { e.stopPropagation(); onDelete(c.id) }}
              >
                Delete
              </button>
            </div>
          </div>

          {/* Reply input */}
          {replyingTo === c.id && (
            <div className="mt-1 flex gap-1.5" style={{ marginLeft: (depth + 1) * 12 }}>
              <input
                type="text"
                className="min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] outline-none transition-colors focus:border-violet-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                placeholder="Write a reply..."
                value={replyText}
                autoFocus
                onChange={(e) => onReplyTextChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onSubmitReply(c.id)
                  if (e.key === 'Escape') onCancelReply()
                }}
              />
              <Button variant="primary" size="xs" disabled={!replyText.trim()} onClick={() => onSubmitReply(c.id)}>
                Reply
              </Button>
            </div>
          )}

          {/* Nested replies */}
          {c.replies && c.replies.length > 0 && (
            <div className="mt-1">
              <CommentThread
                comments={c.replies}
                depth={depth + 1}
                elementId={elementId}
                replyingTo={replyingTo}
                replyText={replyText}
                onReplyTextChange={onReplyTextChange}
                onStartReply={onStartReply}
                onCancelReply={onCancelReply}
                onSubmitReply={onSubmitReply}
                onResolve={onResolve}
                onDelete={onDelete}
                onClickComment={onClickComment}
              />
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

/* ── Element type icon ── */

function ElementTypeIcon({ type }: { type: string }) {
  const cls = 'h-3.5 w-3.5 shrink-0 text-zinc-400'
  switch (type) {
    case 'TEXT':
      return <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h10" /></svg>
    case 'IMAGE':
      return <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" /></svg>
    case 'TABLE':
      return <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-12.75m0 0A1.125 1.125 0 013.375 4.5h17.25c.621 0 1.125.504 1.125 1.125m-20.625 0v12.75m20.625-12.75v12.75m0 0a1.125 1.125 0 01-1.125 1.125m1.125-1.125v-12.75m0 12.75h-7.5a1.125 1.125 0 01-1.125-1.125m8.625-12.75h-17.25" /></svg>
    case 'LIST':
      return <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h7.5M8.25 12h7.5m-7.5 5.25h7.5M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" /></svg>
    default:
      return <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021.75 18V6a2.25 2.25 0 00-2.25-2.25H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25z" /></svg>
  }
}
