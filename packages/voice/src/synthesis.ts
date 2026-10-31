/** Spoken text is separate from the original displayed mathematical markup. */
export function segmentNarration(text: string): string[] {
  if (typeof text !== 'string' || text.length > 12000) throw Error('Narration exceeds 12000 characters');
  const spoken = text.replace(/```[\s\S]*?```/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '$1 divided by $2')
    .replace(/\\sqrt\{([^{}]+)\}/g, ' square root of $1 ')
    .replace(/\\(alpha|beta|gamma|theta|pi|delta|lambda|sigma)\b/g, '$1')
    .replace(/\\times\b/g, ' times ').replace(/\\cdot\b/g, ' times ')
    .replace(/\^\{?2\}?/g, ' squared ').replace(/\^\{?3\}?/g, ' cubed ')
    .replace(/\^\{?([^\s{}]+)\}?/g, ' to the power of $1 ')
    .replace(/[$*_`#{}]/g, '').replace(/\\[()[\]]/g, '').replace(/\s+/g, ' ').trim();
  if (!spoken) return [];
  const result: string[] = []; let remaining = spoken;
  while (remaining.length > 600) {
    const prefix = remaining.slice(0, 600); let cut = Math.max(prefix.lastIndexOf('. '), prefix.lastIndexOf('? '), prefix.lastIndexOf('! '));
    cut = cut > 100 ? cut + 1 : prefix.lastIndexOf(' '); if (cut < 1) cut = 600;
    result.push(remaining.slice(0, cut).trim()); remaining = remaining.slice(cut).trim();
  }
  if (remaining) result.push(remaining); return result;
}
