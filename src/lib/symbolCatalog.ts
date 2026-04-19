/**
 * Catalog of math symbols and emoji shown by the left-palette symbol picker.
 *
 * The lists are deliberately curated (not exhaustive) so the popover stays
 * scannable — each entry is one glyph plus a short label and keywords used
 * by the search box. Items can be reordered freely; they render in the
 * order declared here, grouped by {@code category}.
 */

export interface SymbolEntry {
  /** The actual character(s) to insert. Single code point for most, but
   *  a few emoji are ZWJ sequences — don't assume string length 1. */
  char: string
  /** Short human label — shown in the tooltip. */
  label: string
  /** Synonyms the search input matches against (case-insensitive substring). */
  keywords: string
  /** Section header the glyph lives under. */
  category: string
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  Math symbols                                                             */
/* ──────────────────────────────────────────────────────────────────────── */

export const MATH_SYMBOLS: SymbolEntry[] = [
  // Operators
  { char: '+', label: 'plus', keywords: 'plus add', category: 'Operators' },
  { char: '−', label: 'minus', keywords: 'minus subtract', category: 'Operators' },
  { char: '×', label: 'times', keywords: 'multiply times x', category: 'Operators' },
  { char: '÷', label: 'divide', keywords: 'divide division', category: 'Operators' },
  { char: '·', label: 'middle dot', keywords: 'dot product', category: 'Operators' },
  { char: '±', label: 'plus-minus', keywords: 'plus minus', category: 'Operators' },
  { char: '∓', label: 'minus-plus', keywords: 'minus plus', category: 'Operators' },
  { char: '√', label: 'square root', keywords: 'root sqrt', category: 'Operators' },
  { char: '∛', label: 'cube root', keywords: 'cube root', category: 'Operators' },
  { char: '∜', label: 'fourth root', keywords: 'fourth root', category: 'Operators' },
  { char: '∑', label: 'sum', keywords: 'sum sigma', category: 'Operators' },
  { char: '∏', label: 'product', keywords: 'product pi', category: 'Operators' },
  { char: '∫', label: 'integral', keywords: 'integral', category: 'Operators' },
  { char: '∬', label: 'double integral', keywords: 'double integral', category: 'Operators' },
  { char: '∮', label: 'contour integral', keywords: 'contour integral', category: 'Operators' },
  { char: '∂', label: 'partial derivative', keywords: 'partial derivative', category: 'Operators' },
  { char: '∇', label: 'nabla', keywords: 'nabla del gradient', category: 'Operators' },
  { char: '∞', label: 'infinity', keywords: 'infinity infinite', category: 'Operators' },

  // Comparison / equality
  { char: '=', label: 'equals', keywords: 'equals equal', category: 'Comparison' },
  { char: '≠', label: 'not equal', keywords: 'not equal', category: 'Comparison' },
  { char: '≈', label: 'approximately', keywords: 'approx approximately', category: 'Comparison' },
  { char: '≡', label: 'identical', keywords: 'identical equiv', category: 'Comparison' },
  { char: '≤', label: 'less or equal', keywords: 'less or equal lte', category: 'Comparison' },
  { char: '≥', label: 'greater or equal', keywords: 'greater or equal gte', category: 'Comparison' },
  { char: '<', label: 'less than', keywords: 'less than lt', category: 'Comparison' },
  { char: '>', label: 'greater than', keywords: 'greater than gt', category: 'Comparison' },
  { char: '≪', label: 'much less', keywords: 'much less', category: 'Comparison' },
  { char: '≫', label: 'much greater', keywords: 'much greater', category: 'Comparison' },

  // Logic / sets
  { char: '∈', label: 'element of', keywords: 'in member element', category: 'Sets & Logic' },
  { char: '∉', label: 'not element of', keywords: 'not in not member', category: 'Sets & Logic' },
  { char: '⊂', label: 'subset', keywords: 'subset', category: 'Sets & Logic' },
  { char: '⊆', label: 'subset or equal', keywords: 'subset or equal', category: 'Sets & Logic' },
  { char: '⊃', label: 'superset', keywords: 'superset', category: 'Sets & Logic' },
  { char: '⊇', label: 'superset or equal', keywords: 'superset or equal', category: 'Sets & Logic' },
  { char: '∪', label: 'union', keywords: 'union', category: 'Sets & Logic' },
  { char: '∩', label: 'intersection', keywords: 'intersection and', category: 'Sets & Logic' },
  { char: '∅', label: 'empty set', keywords: 'empty null set', category: 'Sets & Logic' },
  { char: '∀', label: 'for all', keywords: 'for all forall', category: 'Sets & Logic' },
  { char: '∃', label: 'exists', keywords: 'exists there exists', category: 'Sets & Logic' },
  { char: '∄', label: 'does not exist', keywords: 'not exists', category: 'Sets & Logic' },
  { char: '¬', label: 'logical not', keywords: 'not negation', category: 'Sets & Logic' },
  { char: '∧', label: 'logical and', keywords: 'and wedge', category: 'Sets & Logic' },
  { char: '∨', label: 'logical or', keywords: 'or vee', category: 'Sets & Logic' },
  { char: '⊕', label: 'xor', keywords: 'xor exclusive or', category: 'Sets & Logic' },

  // Arrows
  { char: '→', label: 'right arrow', keywords: 'right arrow to', category: 'Arrows' },
  { char: '←', label: 'left arrow', keywords: 'left arrow from', category: 'Arrows' },
  { char: '↑', label: 'up arrow', keywords: 'up arrow', category: 'Arrows' },
  { char: '↓', label: 'down arrow', keywords: 'down arrow', category: 'Arrows' },
  { char: '↔', label: 'left-right arrow', keywords: 'left right arrow', category: 'Arrows' },
  { char: '⇒', label: 'right double arrow', keywords: 'implies double right', category: 'Arrows' },
  { char: '⇐', label: 'left double arrow', keywords: 'double left', category: 'Arrows' },
  { char: '⇔', label: 'iff', keywords: 'iff equivalent double left right', category: 'Arrows' },
  { char: '⇑', label: 'up double arrow', keywords: 'up double arrow', category: 'Arrows' },
  { char: '⇓', label: 'down double arrow', keywords: 'down double arrow', category: 'Arrows' },

  // Greek letters (lowercase)
  { char: 'α', label: 'alpha', keywords: 'alpha a', category: 'Greek' },
  { char: 'β', label: 'beta', keywords: 'beta b', category: 'Greek' },
  { char: 'γ', label: 'gamma', keywords: 'gamma g', category: 'Greek' },
  { char: 'δ', label: 'delta', keywords: 'delta d', category: 'Greek' },
  { char: 'ε', label: 'epsilon', keywords: 'epsilon e', category: 'Greek' },
  { char: 'ζ', label: 'zeta', keywords: 'zeta z', category: 'Greek' },
  { char: 'η', label: 'eta', keywords: 'eta', category: 'Greek' },
  { char: 'θ', label: 'theta', keywords: 'theta', category: 'Greek' },
  { char: 'ι', label: 'iota', keywords: 'iota', category: 'Greek' },
  { char: 'κ', label: 'kappa', keywords: 'kappa k', category: 'Greek' },
  { char: 'λ', label: 'lambda', keywords: 'lambda l', category: 'Greek' },
  { char: 'μ', label: 'mu', keywords: 'mu micro', category: 'Greek' },
  { char: 'ν', label: 'nu', keywords: 'nu', category: 'Greek' },
  { char: 'ξ', label: 'xi', keywords: 'xi', category: 'Greek' },
  { char: 'π', label: 'pi', keywords: 'pi', category: 'Greek' },
  { char: 'ρ', label: 'rho', keywords: 'rho r', category: 'Greek' },
  { char: 'σ', label: 'sigma', keywords: 'sigma s', category: 'Greek' },
  { char: 'τ', label: 'tau', keywords: 'tau t', category: 'Greek' },
  { char: 'υ', label: 'upsilon', keywords: 'upsilon u', category: 'Greek' },
  { char: 'φ', label: 'phi', keywords: 'phi f', category: 'Greek' },
  { char: 'χ', label: 'chi', keywords: 'chi', category: 'Greek' },
  { char: 'ψ', label: 'psi', keywords: 'psi', category: 'Greek' },
  { char: 'ω', label: 'omega', keywords: 'omega o', category: 'Greek' },
  // Uppercase (the most-used)
  { char: 'Δ', label: 'Delta', keywords: 'delta cap d', category: 'Greek' },
  { char: 'Θ', label: 'Theta', keywords: 'theta cap', category: 'Greek' },
  { char: 'Λ', label: 'Lambda', keywords: 'lambda cap', category: 'Greek' },
  { char: 'Ξ', label: 'Xi', keywords: 'xi cap', category: 'Greek' },
  { char: 'Π', label: 'Pi', keywords: 'pi cap', category: 'Greek' },
  { char: 'Σ', label: 'Sigma', keywords: 'sigma cap sum', category: 'Greek' },
  { char: 'Φ', label: 'Phi', keywords: 'phi cap', category: 'Greek' },
  { char: 'Ψ', label: 'Psi', keywords: 'psi cap', category: 'Greek' },
  { char: 'Ω', label: 'Omega', keywords: 'omega cap ohm', category: 'Greek' },

  // Misc common in math / typography
  { char: '°', label: 'degree', keywords: 'degree deg', category: 'Misc' },
  { char: '′', label: 'prime', keywords: 'prime minute', category: 'Misc' },
  { char: '″', label: 'double prime', keywords: 'double prime second', category: 'Misc' },
  { char: '‰', label: 'per mille', keywords: 'per mille promille thousand', category: 'Misc' },
  { char: '¼', label: 'one quarter', keywords: 'one quarter fraction', category: 'Misc' },
  { char: '½', label: 'one half', keywords: 'one half fraction', category: 'Misc' },
  { char: '¾', label: 'three quarters', keywords: 'three quarters fraction', category: 'Misc' },
  { char: 'ℝ', label: 'real numbers', keywords: 'real numbers r set', category: 'Misc' },
  { char: 'ℕ', label: 'natural numbers', keywords: 'natural numbers n set', category: 'Misc' },
  { char: 'ℤ', label: 'integers', keywords: 'integers z set', category: 'Misc' },
  { char: 'ℚ', label: 'rationals', keywords: 'rationals q set', category: 'Misc' },
  { char: 'ℂ', label: 'complex', keywords: 'complex c set', category: 'Misc' },
  { char: 'ℵ', label: 'aleph', keywords: 'aleph', category: 'Misc' },
]

/* ──────────────────────────────────────────────────────────────────────── */
/*  Emoji                                                                    */
/* ──────────────────────────────────────────────────────────────────────── */

export const EMOJI_SYMBOLS: SymbolEntry[] = [
  // Smileys
  { char: '😀', label: 'grinning', keywords: 'grin happy smile', category: 'Smileys' },
  { char: '😃', label: 'smiling', keywords: 'smile happy', category: 'Smileys' },
  { char: '😄', label: 'smiling eyes', keywords: 'smile eyes happy', category: 'Smileys' },
  { char: '😁', label: 'beaming', keywords: 'beam grin smile', category: 'Smileys' },
  { char: '😂', label: 'tears of joy', keywords: 'laugh cry lol joy', category: 'Smileys' },
  { char: '🤣', label: 'rofl', keywords: 'rofl laugh floor', category: 'Smileys' },
  { char: '😊', label: 'blushing', keywords: 'blush happy smile', category: 'Smileys' },
  { char: '🙂', label: 'slight smile', keywords: 'smile small', category: 'Smileys' },
  { char: '😉', label: 'winking', keywords: 'wink', category: 'Smileys' },
  { char: '😍', label: 'heart eyes', keywords: 'love heart eyes', category: 'Smileys' },
  { char: '🤩', label: 'starstruck', keywords: 'star struck excited', category: 'Smileys' },
  { char: '😘', label: 'blowing kiss', keywords: 'kiss love', category: 'Smileys' },
  { char: '😎', label: 'sunglasses', keywords: 'cool sunglasses', category: 'Smileys' },
  { char: '🤔', label: 'thinking', keywords: 'think hmm', category: 'Smileys' },
  { char: '😐', label: 'neutral', keywords: 'neutral meh', category: 'Smileys' },
  { char: '😑', label: 'expressionless', keywords: 'expressionless blank', category: 'Smileys' },
  { char: '😴', label: 'sleeping', keywords: 'sleep tired', category: 'Smileys' },
  { char: '😭', label: 'crying', keywords: 'cry sad tears', category: 'Smileys' },
  { char: '😡', label: 'pouting', keywords: 'angry mad', category: 'Smileys' },
  { char: '🤯', label: 'mind blown', keywords: 'mind blown wow', category: 'Smileys' },
  { char: '🥳', label: 'partying', keywords: 'party celebrate', category: 'Smileys' },
  { char: '🤝', label: 'handshake', keywords: 'handshake deal', category: 'Smileys' },
  { char: '🙏', label: 'folded hands', keywords: 'thanks pray please', category: 'Smileys' },

  // Gestures / people
  { char: '👍', label: 'thumbs up', keywords: 'thumbs up like yes', category: 'Gestures' },
  { char: '👎', label: 'thumbs down', keywords: 'thumbs down dislike no', category: 'Gestures' },
  { char: '👋', label: 'wave', keywords: 'wave hi hello bye', category: 'Gestures' },
  { char: '👏', label: 'clapping', keywords: 'clap applause', category: 'Gestures' },
  { char: '💪', label: 'flexed bicep', keywords: 'strong muscle flex', category: 'Gestures' },
  { char: '🤚', label: 'raised hand', keywords: 'stop hand raised', category: 'Gestures' },
  { char: '✌️', label: 'victory', keywords: 'peace victory', category: 'Gestures' },
  { char: '🤞', label: 'fingers crossed', keywords: 'crossed fingers luck', category: 'Gestures' },
  { char: '👌', label: 'ok hand', keywords: 'ok okay perfect', category: 'Gestures' },
  { char: '🤙', label: 'call me', keywords: 'call hang loose shaka', category: 'Gestures' },
  { char: '✍️', label: 'writing hand', keywords: 'writing pen', category: 'Gestures' },
  { char: '👀', label: 'eyes', keywords: 'eyes look watch', category: 'Gestures' },

  // Hearts / feelings
  { char: '❤️', label: 'red heart', keywords: 'heart love red', category: 'Hearts' },
  { char: '🧡', label: 'orange heart', keywords: 'heart orange', category: 'Hearts' },
  { char: '💛', label: 'yellow heart', keywords: 'heart yellow', category: 'Hearts' },
  { char: '💚', label: 'green heart', keywords: 'heart green', category: 'Hearts' },
  { char: '💙', label: 'blue heart', keywords: 'heart blue', category: 'Hearts' },
  { char: '💜', label: 'purple heart', keywords: 'heart purple', category: 'Hearts' },
  { char: '🖤', label: 'black heart', keywords: 'heart black', category: 'Hearts' },
  { char: '🤍', label: 'white heart', keywords: 'heart white', category: 'Hearts' },
  { char: '💔', label: 'broken heart', keywords: 'broken heart sad', category: 'Hearts' },
  { char: '✨', label: 'sparkles', keywords: 'sparkle shine magic', category: 'Hearts' },
  { char: '🔥', label: 'fire', keywords: 'fire flame lit hot', category: 'Hearts' },
  { char: '💯', label: 'hundred', keywords: 'hundred 100 perfect', category: 'Hearts' },

  // Objects / work
  { char: '📄', label: 'document', keywords: 'document page file', category: 'Objects' },
  { char: '📝', label: 'memo', keywords: 'memo note document', category: 'Objects' },
  { char: '📋', label: 'clipboard', keywords: 'clipboard list', category: 'Objects' },
  { char: '📌', label: 'pushpin', keywords: 'pin pushpin', category: 'Objects' },
  { char: '📎', label: 'paperclip', keywords: 'paperclip attach', category: 'Objects' },
  { char: '🔗', label: 'link', keywords: 'link chain url', category: 'Objects' },
  { char: '📧', label: 'email', keywords: 'email mail envelope', category: 'Objects' },
  { char: '📞', label: 'telephone', keywords: 'phone telephone call', category: 'Objects' },
  { char: '💼', label: 'briefcase', keywords: 'briefcase work business', category: 'Objects' },
  { char: '💡', label: 'lightbulb', keywords: 'idea lightbulb bulb', category: 'Objects' },
  { char: '🔍', label: 'magnifying glass', keywords: 'search zoom find', category: 'Objects' },
  { char: '🔒', label: 'locked', keywords: 'lock locked secure', category: 'Objects' },
  { char: '🔓', label: 'unlocked', keywords: 'unlock unlocked', category: 'Objects' },
  { char: '🔑', label: 'key', keywords: 'key password', category: 'Objects' },
  { char: '💰', label: 'money bag', keywords: 'money bag cash', category: 'Objects' },
  { char: '💳', label: 'credit card', keywords: 'credit card pay', category: 'Objects' },
  { char: '📅', label: 'calendar', keywords: 'calendar date', category: 'Objects' },
  { char: '⏰', label: 'alarm clock', keywords: 'clock alarm time', category: 'Objects' },
  { char: '⌛', label: 'hourglass', keywords: 'hourglass time wait', category: 'Objects' },
  { char: '📊', label: 'bar chart', keywords: 'chart bar graph data', category: 'Objects' },
  { char: '📈', label: 'chart up', keywords: 'chart up rising growth', category: 'Objects' },
  { char: '📉', label: 'chart down', keywords: 'chart down falling', category: 'Objects' },

  // Symbols
  { char: '✅', label: 'check mark', keywords: 'check done yes tick', category: 'Symbols' },
  { char: '☑️', label: 'ballot check', keywords: 'checkbox ticked', category: 'Symbols' },
  { char: '✔️', label: 'heavy check', keywords: 'check tick done', category: 'Symbols' },
  { char: '❌', label: 'cross mark', keywords: 'cross no wrong x', category: 'Symbols' },
  { char: '⭐', label: 'star', keywords: 'star favorite', category: 'Symbols' },
  { char: '🌟', label: 'glowing star', keywords: 'star glow shine', category: 'Symbols' },
  { char: '⚡', label: 'high voltage', keywords: 'bolt lightning electric', category: 'Symbols' },
  { char: '⚠️', label: 'warning', keywords: 'warning caution alert', category: 'Symbols' },
  { char: '❗', label: 'exclamation', keywords: 'exclamation important', category: 'Symbols' },
  { char: '❓', label: 'question mark', keywords: 'question mark ask', category: 'Symbols' },
  { char: '➡️', label: 'arrow right', keywords: 'right arrow', category: 'Symbols' },
  { char: '⬅️', label: 'arrow left', keywords: 'left arrow', category: 'Symbols' },
  { char: '⬆️', label: 'arrow up', keywords: 'up arrow', category: 'Symbols' },
  { char: '⬇️', label: 'arrow down', keywords: 'down arrow', category: 'Symbols' },
  { char: '🔄', label: 'refresh', keywords: 'refresh reload cycle', category: 'Symbols' },
  { char: '©️', label: 'copyright', keywords: 'copyright c', category: 'Symbols' },
  { char: '®️', label: 'registered', keywords: 'registered r', category: 'Symbols' },
  { char: '™️', label: 'trademark', keywords: 'trademark tm', category: 'Symbols' },

  // Flora / nature / food — a small taste
  { char: '🌸', label: 'cherry blossom', keywords: 'cherry blossom flower', category: 'Nature' },
  { char: '🌞', label: 'sun with face', keywords: 'sun', category: 'Nature' },
  { char: '🌙', label: 'crescent moon', keywords: 'moon night', category: 'Nature' },
  { char: '☀️', label: 'sun', keywords: 'sun weather', category: 'Nature' },
  { char: '☁️', label: 'cloud', keywords: 'cloud weather', category: 'Nature' },
  { char: '☔', label: 'umbrella with rain', keywords: 'rain umbrella', category: 'Nature' },
  { char: '❄️', label: 'snowflake', keywords: 'snow snowflake winter', category: 'Nature' },
  { char: '🌈', label: 'rainbow', keywords: 'rainbow color', category: 'Nature' },
  { char: '☕', label: 'coffee', keywords: 'coffee tea drink', category: 'Nature' },
  { char: '🍕', label: 'pizza', keywords: 'pizza food', category: 'Nature' },
  { char: '🎂', label: 'birthday cake', keywords: 'cake birthday', category: 'Nature' },
  { char: '🎉', label: 'party popper', keywords: 'party celebrate popper', category: 'Nature' },
  { char: '🎁', label: 'gift', keywords: 'gift present box', category: 'Nature' },
]

/** Group the catalog by its `category` field, preserving list order. */
export function groupByCategory(entries: SymbolEntry[]): Array<{
  category: string
  items: SymbolEntry[]
}> {
  const order: string[] = []
  const map = new Map<string, SymbolEntry[]>()
  for (const e of entries) {
    const existing = map.get(e.category)
    if (existing) {
      existing.push(e)
    } else {
      order.push(e.category)
      map.set(e.category, [e])
    }
  }
  return order.map((category) => ({ category, items: map.get(category)! }))
}

/**
 * Case-insensitive substring match against {@code label}, {@code keywords},
 * and the raw character. Used by the popover's search input.
 */
export function filterSymbols(entries: SymbolEntry[], query: string): SymbolEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return entries
  return entries.filter(
    (e) =>
      e.label.toLowerCase().includes(q) ||
      e.keywords.toLowerCase().includes(q) ||
      e.char.toLowerCase().includes(q),
  )
}
