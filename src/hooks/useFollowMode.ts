import { useEffect, useRef } from 'react'
import { usePresenceStore } from '../stores/presenceStore'
import type { PresenceUser } from '../stores/presenceStore'
import { useEditorStore } from '../stores/editorStore'

/**
 * Follow Mode hook — mirrors the followed user's viewport.
 *
 * When `followingUserId` is set, every viewport update from that user sets the
 * local `canvasZoom` and scrolls the canvas scroll container to match.
 *
 * Any manual scroll or zoom by the local user breaks follow mode.
 */
export function useFollowMode(): {
  isFollowing: boolean
  followedUser: PresenceUser | null
} {
  const followingUserId = usePresenceStore((s) => s.followingUserId)
  const followedViewport = usePresenceStore(
    (s) => (followingUserId ? s.viewports[followingUserId] : undefined) ?? null,
  )
  const users = usePresenceStore((s) => s.users)
  const setFollowing = usePresenceStore((s) => s.setFollowing)
  const setCanvasZoom = useEditorStore((s) => s.setCanvasZoom)
  const setActivePageIndex = useEditorStore((s) => s.setActivePageIndex)
  const localActivePageIndex = useEditorStore((s) => s.activePageIndex)
  const pagesLength = useEditorStore((s) => s.pages.length)

  // Track whether the most recent scroll/zoom was triggered by follow mode
  // so we can distinguish programmatic changes from manual user input.
  const programmaticRef = useRef(false)

  // Apply the followed user's viewport when it changes
  useEffect(() => {
    if (!followingUserId || !followedViewport) return

    programmaticRef.current = true
    setCanvasZoom(followedViewport.zoom)

    // Jump to the same page the leader is on, if provided and valid.
    const targetPage = followedViewport.activePageIndex
    if (
      typeof targetPage === 'number' &&
      targetPage >= 0 &&
      targetPage < pagesLength &&
      targetPage !== localActivePageIndex
    ) {
      setActivePageIndex(targetPage)
    }

    const scrollContainer = document.querySelector<HTMLElement>(
      '[data-agreemint-scroll-container]',
    )
    if (scrollContainer) {
      scrollContainer.scrollTo({
        left: followedViewport.scrollX,
        top: followedViewport.scrollY,
        behavior: 'smooth',
      })
    }

    // Reset the flag after the browser has had a chance to fire the scroll event
    const id = window.setTimeout(() => {
      programmaticRef.current = false
    }, 300)

    return () => window.clearTimeout(id)
  }, [
    followingUserId,
    followedViewport,
    setCanvasZoom,
    setActivePageIndex,
    localActivePageIndex,
    pagesLength,
  ])

  // Break follow mode on manual scroll
  useEffect(() => {
    if (!followingUserId) return

    const scrollContainer = document.querySelector<HTMLElement>(
      '[data-agreemint-scroll-container]',
    )
    if (!scrollContainer) return

    const onScroll = () => {
      if (programmaticRef.current) return
      setFollowing(null)
    }

    scrollContainer.addEventListener('scroll', onScroll, { passive: true })
    return () => scrollContainer.removeEventListener('scroll', onScroll)
  }, [followingUserId, setFollowing])

  // Break follow mode on manual zoom (wheel with ctrl/meta)
  useEffect(() => {
    if (!followingUserId) return

    const onWheel = (e: WheelEvent) => {
      if (programmaticRef.current) return
      if (e.ctrlKey || e.metaKey) {
        setFollowing(null)
      }
    }

    window.addEventListener('wheel', onWheel, { passive: true })
    return () => window.removeEventListener('wheel', onWheel)
  }, [followingUserId, setFollowing])

  const followedUser = followingUserId
    ? users.find((u) => u.userId === followingUserId) ?? null
    : null

  return { isFollowing: followingUserId !== null, followedUser }
}
